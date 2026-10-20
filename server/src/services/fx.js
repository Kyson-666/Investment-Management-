'use strict';
/**
 * 汇率服务：
 * - 管理员手动优先（fx_rate.source='manual'），自动源兜底（'auto'）
 * - 同日期 manual 与 auto 可并存，取数时 manual 优先
 * - 自动同步只影响此后新记录，历史 event.fx 永不回改
 */
const { getDb, now } = require('../db');
const { config } = require('../config');
const { localDate } = require('../time');

function todayStr(d = new Date()) {
  return localDate(d);
}

/** 从主源 Frankfurter（ECB）解析 USD→CNY */
function parseFrankfurter(json) {
  const rate = json?.rates?.CNY;
  if (typeof rate !== 'number' || !(rate > 0)) throw new Error('主源返回格式异常');
  return rate;
}

/** 从备用源 open.er-api.com 解析 USD→CNY */
function parseErApi(json) {
  const rate = json?.rates?.CNY;
  if (typeof rate !== 'number' || !(rate > 0)) throw new Error('备用源返回格式异常');
  return rate;
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 同步一次汇率：先主源，失败降级备用源；写入 fx_rate(source=auto)。
 * @returns {{ok:boolean, rate?:number, source?:string, error?:string, usedFallback?:boolean}}
 */
async function syncFxRate() {
  const db = getDb();
  const date = todayStr();
  let rate;
  let usedFallback = false;
  let lastError = '';
  try {
    rate = parseFrankfurter(await fetchJson(config.FX.sourceUrl));
  } catch (e1) {
    lastError = `主源失败：${e1.message}`;
    try {
      rate = parseErApi(await fetchJson(config.FX.fallbackUrl));
      usedFallback = true;
    } catch (e2) {
      return { ok: false, error: `${lastError}；备用源失败：${e2.message}` };
    }
  }
  db.prepare(`INSERT INTO fx_rate(date,rate,source,note) VALUES(?,?,'auto',?)
              ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`)
    .run(date, rate, usedFallback ? '自动同步(备用源)' : '自动同步');
  return { ok: true, rate, source: 'auto', date, usedFallback };
}

/** 手动录入汇率（source=manual，同日唯一） */
function addManualFx(date, rate, note) {
  getDb().prepare(`INSERT INTO fx_rate(date,rate,source,note) VALUES(?,?,'manual',?)
                   ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`)
    .run(date, rate, note || '');
}

/** 当前生效汇率（date<=今天 的最近一条；同日 manual 优先） */
/**
 * 当前生效汇率行（含日期与来源）—— 「当前汇率」的**权威实现**，各处应复用它。
 * 口径：date <= atDate 中最近一条；同一天 manual 优先于 auto。
 */
function currentFxRow(atDate = todayStr()) {
  const row = getDb().prepare(`
    SELECT rate, date, source, note FROM fx_rate
    WHERE date <= ?
    ORDER BY date DESC, CASE source WHEN 'manual' THEN 1 ELSE 0 END DESC, id DESC
    LIMIT 1`).get(atDate);
  return row
    ? { rate: row.rate, date: row.date, source: row.source, note: row.note || '' }
    : { rate: 7.1, date: null, source: 'fallback', note: '' };   // 无任何记录时沿用内置兜底
}

function currentFx(atDate = todayStr()) {
  return currentFxRow(atDate).rate;
}

module.exports = { syncFxRate, addManualFx, currentFx, currentFxRow, todayStr };
