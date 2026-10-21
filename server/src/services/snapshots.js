'use strict';
/**
 * 月末快照派生与对账。
 * 口径：持仓市值 = Σ 份额 × 发生日最近单价（asset_price_history）× 估值日汇率；
 * 没有历史单价时退回当前单价并标记 source='current'，避免静默丢资产。
 *
 * 自动化能力：
 * - autofillSnapshots：回填历史缺失月末快照（source='derived'），不覆盖任何已有快照；
 * - diffReport：全月份 saved vs derived 差异报告（complete 月才计算 diff，与保存前对比口径一致）。
 */
const { buildState } = require('../state');
const { priceAt } = require('./prices');
const { currentFx } = require('./fx');
const { replayQty } = require('./position');
const { localDate } = require('../time');
const { now } = require('../db');
const cache = require('./cache');

const round2 = n => Math.round((+n || 0) * 100) / 100;

/** YYYY-MM -> 该月最后一天 YYYY-MM-DD */
function monthEnd(month) {
  const m = String(month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 0).getDate();
  return `${m}-${String(d).padStart(2, '0')}`;
}

/**
 * 派生某月月末持仓市值。
 * @param {object} [S] 预构建状态（批量派生/回填时复用，避免逐月重复查库）
 * @returns {{month,asOf,total,byAsset,missingPrice,estimatedPrice,complete}}
 */
function deriveSnapshot(db, userId, month, S) {
  const end = monthEnd(month);
  if (!end) return { month, asOf: null, total: 0, byAsset: [], missingPrice: 0, estimatedPrice: 0, complete: false };
  S = S || buildState(userId);
  const byAsset = [];
  let total = 0;
  let missingPrice = 0;
  let estimatedPrice = 0;
  const isCurrent = end >= localDate();

  for (const a of S.assets) {
    const evs = (S.events || []).filter(e => e.assetId === a.id && String(e.date) <= end);
    const qty = replayQty(evs);
    const fx = a.currency === 'USD' ? currentFx(end) : 1;

    /* 历史金额口径资产（没有事件、只有 market_value）：按当前市值计入，并明确标记 */
    if (!(qty > 0)) {
      if (!evs.length && +a.marketValue > 0) {
        const mv = +a.marketValue * fx;
        total += mv;
        if (!isCurrent) estimatedPrice++;
        byAsset.push({ id: String(a.id), name: a.name, type: a.type, qty: 0,
          price: null, source: 'current-legacy', mvCNY: round2(mv) });
      }
      continue;
    }

    let price = null;
    let source = null;
    const hist = priceAt(db, a.id, end);
    if (hist && +hist.unit_price > 0) {
      price = +hist.unit_price;
      source = 'history';
    } else if (a.type === 'stock' && +a.price > 0) {
      price = +a.price;
      source = 'current';
    } else if (a.type !== 'stock' && +a.unitPrice > 0) {
      price = +a.unitPrice;
      source = 'current';
    }
    if (!(price > 0)) { missingPrice++; continue; }
    if (source === 'current' && !isCurrent) estimatedPrice++;

    const mv = qty * price * fx;
    total += mv;
    byAsset.push({ id: String(a.id), name: a.name, type: a.type, qty: +qty.toFixed(6),
      price, source, mvCNY: round2(mv) });
  }

  return { month: String(month).slice(0, 7), asOf: end, total: round2(total),
    byAsset, missingPrice, estimatedPrice, complete: missingPrice === 0 && estimatedPrice === 0 };
}

/** YYYY-MM 月份 +1 */
function nextMonth(month) {
  const [y, m] = String(month).slice(0, 7).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/**
 * 数据覆盖的月份范围（最早数据月 → 到 todayParts 月份）。
 * 起点 = min(最早事件月, 最早出入金月, 最早已有快照月)；无数据返回空数组。
 */
function coveredMonths(db, userId) {
  const r = db.prepare(`SELECT MIN(date) AS d FROM (
      SELECT MIN(date) AS date FROM event WHERE user_id=?
      UNION ALL
      SELECT MIN(date) FROM cash_flow WHERE user_id=?)`).get(userId, userId);
  const snapMin = db.prepare('SELECT MIN(month) AS m FROM snapshot WHERE user_id=?').get(userId).m;
  const candidates = [r && r.d ? String(r.d).slice(0, 7) : null, snapMin || null].filter(Boolean);
  if (!candidates.length) return [];
  const start = candidates.sort()[0];
  const today = localDate();
  const end = today.slice(0, 7);
  const months = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 1200) { months.push(cur); cur = nextMonth(cur); }
  return months;
}

/**
 * 批量回填历史缺失月末快照。
 * 规则：
 * - 已有任何来源快照（manual/auto/derived）的月份一律跳过，绝不覆盖手填值；
 * - 派生 total 为 0 且无持仓明细的月份视为「无持仓月」，不落快照（避免 0 快照破坏 TWR 区间）；
 * - 落库 source='derived'、derived_at=now()。
 * @param {{from?:string,to?:string,includeCurrent?:boolean}} [opt]
 * @returns {{from,to,filled,skipped,empty,incomplete}}
 */
function autofillSnapshots(db, userId, opt = {}) {
  const months = coveredMonths(db, userId);
  if (!months.length) {
    return { from: null, to: null, filled: [], skipped: [], empty: [], incomplete: [] };
  }
  const todayMonth = localDate().slice(0, 7);
  const from = /^\d{4}-\d{2}$/.test(String(opt.from || '')) ? String(opt.from).slice(0, 7) : months[0];
  const to = /^\d{4}-\d{2}$/.test(String(opt.to || '')) ? String(opt.to).slice(0, 7)
    : (opt.includeCurrent ? todayMonth : prevMonthOf(todayMonth));
  const S = buildState(userId);   // 全范围复用一次状态构建

  const filled = [], skipped = [], empty = [], incomplete = [];
  for (const month of months) {
    if (month < from || month > to) continue;
    const existing = db.prepare('SELECT source FROM snapshot WHERE user_id=? AND month=?').get(userId, month);
    if (existing) { skipped.push({ month, source: existing.source || 'manual' }); continue; }
    const d = deriveSnapshot(db, userId, month, S);
    if (!(d.total > 0) && !d.byAsset.length) { empty.push(month); continue; }
    db.prepare(`INSERT INTO snapshot (user_id,month,total,source,derived_at) VALUES (?,?,?,'derived',?)
                ON CONFLICT(user_id,month) DO UPDATE SET total=excluded.total,
                  source=excluded.source, derived_at=excluded.derived_at`)
      .run(userId, month, d.total, now());
    (d.complete ? filled : incomplete).push({
      month, total: d.total, missingPrice: d.missingPrice, estimatedPrice: d.estimatedPrice,
    });
  }
  cache.bumpUser(userId);   // 写库后失效该用户缓存
  return { from, to, filled, skipped, empty, incomplete };
}

function prevMonthOf(month) {
  const [y, m] = String(month).slice(0, 7).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/**
 * 全月份差异报告：saved（已存快照）vs derived（事件重放 + 净值历史派生）。
 * 仅 complete（无缺价/无估价）的月份计算 diff，口径与保存前对比一致。
 * @returns {{summary,rows}}
 */
function diffReport(db, userId) {
  const months = coveredMonths(db, userId);
  const S = buildState(userId);
  const rows = months.map(month => {
    const saved = db.prepare('SELECT total,source FROM snapshot WHERE user_id=? AND month=?').get(userId, month);
    const d = deriveSnapshot(db, userId, month, S);
    const savedTotal = saved ? +saved.total : null;
    const diff = saved && d.complete ? +(savedTotal - d.total).toFixed(2) : null;
    const diffPct = (diff != null && d.total > 0) ? +(diff / d.total).toFixed(6) : null;
    return {
      month,
      saved: savedTotal,
      savedSource: saved ? (saved.source || 'manual') : null,
      derived: d.total,
      complete: d.complete,
      missingPrice: d.missingPrice,
      estimatedPrice: d.estimatedPrice,
      diff,
      diffPct,
    };
  });
  const diffs = rows.filter(r => r.diff != null);
  const pctVals = diffs.map(r => Math.abs(r.diffPct || 0));
  const summary = {
    months: rows.length,
    saved: rows.filter(r => r.saved != null).length,
    missing: rows.filter(r => r.saved == null).length,
    incomplete: rows.filter(r => r.saved != null && !r.complete).length,
    mismatch: diffs.filter(r => Math.abs(r.diff) > 0.01).length,
    maxAbsDiff: diffs.length ? round2(Math.max(...diffs.map(r => Math.abs(r.diff)))) : 0,
    maxAbsDiffPct: pctVals.length ? Math.max(...pctVals) : 0,
  };
  return { summary, rows };
}

module.exports = { deriveSnapshot, monthEnd, autofillSnapshots, diffReport, coveredMonths };
