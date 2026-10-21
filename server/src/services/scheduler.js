'use strict';
/**
 * 定时任务（node-cron）：
 * - 汇率同步（每日 08:00，主源失败降级备用源）
 * - 月末快照（每月最后一天 23:50）
 * - 定投生成（每日 00:10 检查当日到期计划，幂等）
 * - 预警扫描（每日 16:00 收盘后，写站内通知；邮件通道尚未接入）
 * - 数据备份（每日 03:00，保留 30 天）
 */
const cron = require('node-cron');
const benchService = require('./benchmark');
const quotesService = require('./quotes');
const { getDb, now } = require('../db');
const { config } = require('../config');
const fxService = require('./fx');
const prices = require('./prices');
const { backupDatabase } = require('./backup');
const portfolio = require('./portfolio');
const Calc = require('../calc');
const cache = require('./cache');

function todayParts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    month: `${d.getFullYear()}-${p(d.getMonth() + 1)}`, day: d.getDate(),
    y: d.getFullYear(), m: d.getMonth() + 1 };
}

async function jobSyncFx() {
  const r = await fxService.syncFxRate();
  console.log(`[cron] 汇率同步：${r.ok ? `1 USD = ${r.rate} CNY${r.usedFallback ? '（备用源）' : ''}` : r.error}`);
}

/** 月末快照：为每位用户记录当月末持仓市值 */
function jobMonthlySnapshot() {
  const db = getDb();
  const { month } = todayParts();
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  let n = 0;
  for (const u of users) {
    try {
      /* v6 起 kpis 已无 total 字段（改用 mv = 持仓市值），快照即持仓市值口径 */
      const total = portfolio.computeAll(u.id).kpis.mv;
      if (!(total > 0)) continue;
      db.prepare(`INSERT INTO snapshot (user_id,month,total,source,derived_at) VALUES (?,?,?,'auto',?)
                  ON CONFLICT(user_id,month) DO UPDATE SET total=excluded.total,
                    source=excluded.source, derived_at=excluded.derived_at`).run(u.id, month, total, now());
      n++;
    } catch (e) { console.warn(`[cron] 快照失败 user=${u.id}: ${e.message}`); }
  }
  console.log(`[cron] 月末快照完成：${n} 位用户`);
}

/** 判断定投计划在给定日期是否到期（纯函数，便于单测） */
function planDue(plan, today) {
  const { y, m, day } = today;
  if (+plan.day !== +day) return false;
  const [sy, sm] = String(plan.start_month || '').split('-').map(Number);
  if (!sy || !sm) return false;
  const elapsed = (y - sy) * 12 + (m - sm);
  return elapsed >= 0 && elapsed < (plan.months || 12);
}

/** 定投生成：为今天到期的 active 计划补投（同日已有 invest 事件则跳过） */
function jobDcaGenerate() {
  const db = getDb();
  const parts = todayParts();
  const { date } = parts;
  const plans = db.prepare('SELECT * FROM dca_plan WHERE active=1').all();
  let count = 0;
  for (const p of plans) {
    if (!planDue(p, parts)) continue;
    const exists = db.prepare("SELECT id FROM event WHERE asset_id=? AND date=? AND kind='invest'").get(p.asset_id, date);
    if (exists) continue;
    const asset = db.prepare('SELECT * FROM asset WHERE id=?').get(p.asset_id);
    const fx = asset && asset.currency === 'USD' ? fxService.currentFx(date) : 1;
    /* ⚠️ 必须与手动接口（routes/dcaPlans.js）一致地写入 qty/price：
       只写 amount 会让引擎拿不到份额（tQty=0）→ 份额不增加、成本照常累加，
       账面会把全部定投本金显示为浮动亏损。净值优先取当日历史净值。 */
    const hist = prices.priceAt(db, p.asset_id, date);
    const nav = hist ? +hist.unit_price : (asset && +asset.unit_price > 0 ? +asset.unit_price : 1);
    const qty = +((+p.amount || 0) / nav).toFixed(6);
    db.prepare(`INSERT INTO event
                (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
                VALUES (?,?,?, 'invest', NULL,?,?,?,NULL,0,?,0,?,?)`)
      .run(p.user_id, p.asset_id, date, qty, nav, p.amount, fx, p.note || '定投', now());
    count++;
  }
  if (count) console.log(`[cron] 定投生成：${count} 笔`);
}

/** 预警扫描：集中度 + 止盈止损，写站内通知（同日同标的同类型去重） */
function jobScanAlerts() {
  const db = getDb();
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  const dayKey = todayParts().date;
  let count = 0;
  for (const u of users) {
    let data;
    try { data = portfolio.computeAll(u.id); } catch { continue; }
    const msgs = [
      ...data.concentration.alerts.map(t => ({ kind: 'concentration', title: '集中度风险', body: t })),
      ...data.alerts.map(a => ({ kind: 'price', title: `${a.level}预警 · ${a.asset}`, body: a.msg })),
    ];
    for (const msg of msgs) {
      const dedup = `${dayKey}:${msg.kind}:${msg.title}:${msg.body}`;
      const hit = db.prepare('SELECT id FROM notification WHERE user_id=? AND dedup_key=?').get(u.id, dedup);
      if (hit) continue;
      db.prepare('INSERT INTO notification (user_id,kind,title,body,is_read,dedup_key,created_at) VALUES (?,?,?,? ,0,?,?)')
        .run(u.id, msg.kind, msg.title, msg.body, dedup, now());
      count++;
    }
  }
  if (count) console.log(`[cron] 预警扫描：新增 ${count} 条通知`);
}

async function jobBackup() {
  try {
    const file = await backupDatabase(getDb());
    console.log(`[cron] 数据库已备份：${file}`);
  } catch (e) {
    console.warn(`[cron] 备份失败：${e.message}`);
  }
}

/** 判断今天是否本月最后一天 */
/** 基准指数月末点位同步（仅已结束的月份，幂等不覆盖手工值） */
async function jobSyncBenchmark() {
  try {
    const done = await benchService.syncAllUsersAllIndices();
    const changed = done.filter(x => x.added || x.updated);
    console.log(`[cron] 基准点位同步：${changed.length ? changed.map(x => `${x.code} +${x.added}/~${x.updated}`).join('、') : '无新增'}`);
  } catch (e) {
    console.warn(`[cron] 基准点位同步失败：${e.message}`);
  }
}

function isLastDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
}

/**
 * 行情同步：按资产代码拉取最新单价回写（股票→price，基金→unit_price）。
 * 自动运行（force=false）跳过用户手动改过价格（price_source='manual'）的资产；
 * 手动「同步行情」按钮走 POST /api/quotes/sync（force=true 强制刷新）。
 * @param {string[]} kinds ['stock']（每 15 分钟）/ ['fund']（每日 21:05 收盘净值）
 */
async function jobSyncQuotes(kinds) {
  const db = getDb();
  try {
    const r = await quotesService.syncAllUsers(db, { force: false, kinds });
    const parts = [];
    if (r.updated) parts.push(`更新 ${r.updated}`);
    if (r.unchanged) parts.push(`无变化 ${r.unchanged}`);
    if (r.skippedManual) parts.push(`跳过手动维护 ${r.skippedManual}`);
    if (r.errors) parts.push(`失败 ${r.errors}`);
    if (parts.length) console.log(`[cron] 行情同步(${kinds.join('/')}，${r.users} 用户)：${parts.join('，')}`);
  } catch (e) {
    console.warn(`[cron] 行情同步失败: ${e.message}`);
  }
}

function startScheduler() {
  /* 定时任务经 service 层直接写库（不经 HTTP 层），执行后统一失效计算缓存 */
  const after = fn => () => { try { fn(); } finally { cache.bumpAll(); } };
  const afterAsync = p => p.finally ? p.finally(() => cache.bumpAll()) : Promise.resolve().then(cache.bumpAll);

  // 汇率同步（写 fx_rate，全局生效）
  cron.schedule(config.FX.syncCron, () => { afterAsync(jobSyncFx()).catch(e => console.warn(`[cron] fx: ${e.message}`)); });
  // 每日 00:10 定投（写 event）
  cron.schedule('10 0 * * *', after(jobDcaGenerate));
  // 每日 03:00 备份
  cron.schedule('0 3 * * *', () => { jobBackup(); });
  // 每日 16:00 预警扫描（只写通知，不触达组合数据）
  cron.schedule('0 16 * * *', jobScanAlerts);
  // 每月最后一天 23:50 快照（每天 23:50 检查是否月末；写 snapshot）
  cron.schedule('50 23 * * *', () => { if (isLastDayOfMonth()) after(jobMonthlySnapshot)(); });
  /* 每月最后一天 23:55 同步基准指数月末点位（排在月末快照之后；写 benchmark） */
  cron.schedule('55 23 * * *', () => { if (isLastDayOfMonth()) afterAsync(jobSyncBenchmark()).catch(() => {}); });

  /* 行情同步：股票每 15 分钟一次；基金每日 21:05 一次（收盘净值公布后）。
     休市/净值未更新时报价与现值一致 → 天然幂等空转（写 asset 价格/历史净值） */
  cron.schedule(config.QUOTES.stockCron, () => { afterAsync(jobSyncQuotes(['stock'])).catch(() => {}); });
  cron.schedule(config.QUOTES.fundCron, () => { afterAsync(jobSyncQuotes(['fund'])).catch(() => {}); });

  if (config.FX.syncOnStart) {
    afterAsync(jobSyncFx()).catch(e => console.warn(`[startup] fx: ${e.message}`));
  }
  console.log('[cron] 定时任务已启动');
}

module.exports = {
  startScheduler, jobSyncFx, jobMonthlySnapshot, jobDcaGenerate, jobScanAlerts, jobBackup, jobSyncQuotes,
  planDue,
};
