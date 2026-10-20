'use strict';
/**
 * 基准指数月末点位同步
 *
 * 数据源：新浪财经日线接口（返回类 JSON，key 无引号，需先规范化）
 *   https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
 *      ?symbol=sh000300&scale=240&ma=no&datalen=320
 *   scale=240 为日线；按 YYYY-MM 归并后取**每月最后一个交易日收盘** = 月末收盘点位。
 *
 * 设计要点：
 *  - 只写入**已结束的月份**，避免当月未走完时写入不断变动的"月末值"；
 *  - 幂等：已存在的月份默认跳过（不覆盖手工录入），`overwrite` 可选强制覆盖；
 *  - 抓取失败逐级降级（多源重试），任一环节失败都返回可读原因，不抛异常打断调用方。
 */

const { getDb, now } = require('../db');
const { localDate } = require('../time');

/** 内置支持的基准指数（A 股为主；如需港股/美股需另接数据源） */
const INDICES = {
  CSI300: { name: '沪深300', symbol: 'sh000300' },
  CSI500: { name: '中证500', symbol: 'sh000905' },
  SSE: { name: '上证指数', symbol: 'sh000001' },
  SZSE: { name: '深证成指', symbol: 'sz399001' },
  GEM: { name: '创业板指', symbol: 'sz399006' },
  STAR50: { name: '科创50', symbol: 'sh000688' },
  SSE50: { name: '上证50', symbol: 'sh000016' },
};

const DEFAULT_CODE = 'CSI300';
const URL_BASE = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';

function indexList() {
  return Object.keys(INDICES).map(code => ({ code, name: INDICES[code].name }));
}
function isSupported(code) {
  return Object.prototype.hasOwnProperty.call(INDICES, code);
}

/** 把新浪返回的「类 JSON」（`{day:"...",close:"..."}`）规范化为标准 JSON 后解析 */
function parseSinaKline(raw) {
  const text = String(raw || '').trim();
  if (!text || text[0] !== '[') return [];
  const fixed = text.replace(/([{,])\s*([A-Za-z_]\w*)\s*:/g, '$1"$2":');
  let rows;
  try { rows = JSON.parse(fixed); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    day: String(r.day || '').slice(0, 10),
    close: Number(r.close),
  })).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && isFinite(r.close) && r.close > 0);
}

/** 按月份归并，取每月**最后一个交易日**的收盘价 */
function monthEndCloses(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const m = r.day.slice(0, 7);
    const prev = byMonth.get(m);
    if (!prev || r.day > prev.day) byMonth.set(m, r);
  }
  return Array.from(byMonth.entries())
    .map(([date, r]) => ({ date, value: +r.close.toFixed(2) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 判断某月是否已结束（该月最后一天已过） */
function monthFinished(month, today) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}` <= today;
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; InvestmentManager/1.0)',
        Referer: 'https://finance.sina.com.cn/',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取某指数的月末点位（仅返回已结束月份），带重试 */
async function fetchMonthEnds(code, opts = {}) {
  const idx = INDICES[code];
  if (!idx) return { ok: false, error: `不支持的基准代码：${code}` };
  const datalen = Math.min(Math.max(+opts.datalen || 400, 60), 1200);
  const today = localDate();
  const url = `${URL_BASE}?symbol=${idx.symbol}&scale=240&ma=no&datalen=${datalen}`;
  let lastErr = '';
  for (let i = 1; i <= 3; i++) {
    try {
      const rows = parseSinaKline(await fetchText(url));
      if (!rows.length) throw new Error('返回数据为空或格式不符');
      const all = monthEndCloses(rows);
      const finished = all.filter(x => monthFinished(x.date, today));
      return { ok: true, code, name: idx.name, symbol: idx.symbol, months: finished, tradingDays: rows.length };
    } catch (e) {
      lastErr = e.message;
      if (i < 3) await new Promise(r => setTimeout(r, 900 * i));
    }
  }
  return { ok: false, error: `抓取失败（${idx.name}）：${lastErr}` };
}

/**
 * 同步基准点位入库。
 * @param {number} userId
 * @param {string} code  基准代码（默认 CSI300）
 * @param {object} opts  { overwrite: boolean, months: 可选，指定月份数组 }
 */
async function syncBenchmark(userId, code = DEFAULT_CODE, opts = {}) {
  if (!isSupported(code)) return { ok: false, error: `不支持的基准代码：${code}（可选：${Object.keys(INDICES).join('、')}）` };
  const fetched = await fetchMonthEnds(code, opts);
  if (!fetched.ok) return fetched;

  let months = fetched.months;
  if (Array.isArray(opts.months) && opts.months.length) {
    const want = new Set(opts.months);
    months = months.filter(m => want.has(m.date));
  }
  if (!months.length) return { ok: true, code, name: fetched.name, added: 0, updated: 0, skipped: 0, latest: null };

  const db = getDb();
  const existing = new Map(
    db.prepare('SELECT date, value FROM benchmark WHERE user_id=? AND code=?').all(userId, code)
      .map(r => [r.date, r.value])
  );
  const ins = db.prepare(`INSERT INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)
                          ON CONFLICT(user_id,code,date) DO UPDATE SET value=excluded.value`);
  let added = 0, updated = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const m of months) {
      const has = existing.has(m.date);
      if (has && !opts.overwrite) { skipped++; continue; }          // 幂等：默认不覆盖既有值
      if (has) { if (Math.abs(existing.get(m.date) - m.value) > 1e-9) { ins.run(userId, code, m.date, m.value); updated++; } else skipped++; }
      else { ins.run(userId, code, m.date, m.value); added++; }
    }
  });
  tx();
  const latest = months[months.length - 1];
  return { ok: true, code, name: fetched.name, added, updated, skipped, latest, tradingDays: fetched.tradingDays };
}

/** 为所有用户同步所有内置基准（定时任务用；单个失败不影响其他） */
async function syncAllUsersAllIndices() {
  const db = getDb();
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  const out = [];
  for (const u of users) {
    for (const code of Object.keys(INDICES)) {
      try {
        const r = await syncBenchmark(u.id, code, {});
        if (r.ok && (r.added || r.updated)) out.push({ userId: u.id, code, ...r });
      } catch (e) {
        out.push({ userId: u.id, code, ok: false, error: e.message });
      }
    }
  }
  return out;
}

module.exports = {
  INDICES, DEFAULT_CODE,
  indexList, isSupported, parseSinaKline, monthEndCloses, monthFinished,
  fetchMonthEnds, syncBenchmark, syncAllUsersAllIndices,
};
