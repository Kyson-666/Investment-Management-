'use strict';
/**
 * 把数据库行组装成 calc 引擎需要的状态对象 S。
 * 引擎为纯函数、使用字符串 id；数据库为整数自增 id，这里统一转成字符串。
 */
const { getDb } = require('./db');
const Calc = require('./calc');
const cache = require('./services/cache');

const DEFAULT_SETTINGS = {
  costMethod: 'wavg',
  dividendReducesCost: false,
  allocTargets: { ...Calc.ALLOC_DEFAULT },
  taxRules: { ...Calc.TAX_DEFAULT },
  warnSingle: 0.2,
  warnTop5: 0.6,
  benchmarkCode: 'CSI300',
};

function getUser(userId) {
  return getDb().prepare('SELECT * FROM user WHERE id=?').get(userId);
}

function getUserSettings(user) {
  let s = {};
  try { s = JSON.parse(user.settings_json || '{}'); } catch { s = {}; }
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    allocTargets: { ...DEFAULT_SETTINGS.allocTargets, ...(s.allocTargets || {}) },
    taxRules: {
      ...DEFAULT_SETTINGS.taxRules,
      ...(s.taxRules || {}),
      cnDiv: { ...DEFAULT_SETTINGS.taxRules.cnDiv, ...((s.taxRules || {}).cnDiv || {}) },
    },
  };
}

function saveUserSettings(userId, patch) {
  const user = getUser(userId);
  const cur = getUserSettings(user);
  const next = { ...cur, ...patch };
  getDb().prepare('UPDATE user SET settings_json=? WHERE id=?').run(JSON.stringify(next), userId);
  return next;
}

/** 组装引擎状态对象（账户过滤由引擎 opts.accountId 处理）
 *  结果按数据版本缓存：同一版本内多次调用（10 个只读端点、多月快照派生）只查一次库。
 *  调用方只读不修改返回对象（scope/filter/map 均生成新数组）。 */
function buildState(userId) {
  const key = `S|${cache.vOf(userId)}|${userId}`;
  const hit = cache.getCache(key);
  if (hit) return hit;

  const db = getDb();
  const user = getUser(userId);
  const settings = getUserSettings(user);

  const accounts = db.prepare('SELECT * FROM account WHERE user_id=? ORDER BY id').all(userId)
    .map(a => ({ id: String(a.id), name: a.name, kind: a.kind, currency: a.currency, note: a.note }));

  const assets = db.prepare('SELECT * FROM asset WHERE user_id=? ORDER BY id').all(userId).map(a => ({
    id: String(a.id),
    accountId: String(a.account_id),
    name: a.name,
    code: a.code || '',
    market: a.market || '',
    type: a.type,
    currency: a.currency,
    price: a.price || 0,
    marketValue: a.market_value || 0,
    unitPrice: a.unit_price || 0,
    priceSource: a.price_source || '',
    priceDate: a.price_date || '',
    marginCNY: a.margin_cny || 0,
    alerts: a.alerts_json ? JSON.parse(a.alerts_json) : null,
  }));

  const events = db.prepare('SELECT * FROM event WHERE user_id=? ORDER BY date, id').all(userId).map(e => ({
    id: String(e.id),
    assetId: String(e.asset_id),
    date: e.date,
    kind: e.kind,
    side: e.side || null,
    qty: e.qty,
    price: e.price,
    amount: e.amount,
    ratio: e.ratio,
    fee: e.fee || 0,
    marginCNY: e.margin_cny || 0,
    fx: e.fx || 1,
    isT: e.is_t ? 1 : 0,
    note: e.note || '',
  }));

  const fx = db.prepare('SELECT date, rate, source, note FROM fx_rate ORDER BY date').all()
    .map(f => ({ date: f.date, rate: f.rate, source: f.source, note: f.note || '' }));

  const snapshots = db.prepare('SELECT month, total, source, derived_at FROM snapshot WHERE user_id=? ORDER BY month').all(userId)
    .map(s => ({ month: s.month, total: s.total, source: s.source || 'manual', derivedAt: s.derived_at || null }));

  const benchRows = db.prepare('SELECT date, value FROM benchmark WHERE user_id=? AND code=? ORDER BY date')
    .all(userId, settings.benchmarkCode)
    .map(b => ({ date: b.date, value: b.value }));

  const cashFlows = db.prepare('SELECT * FROM cash_flow WHERE user_id=? ORDER BY date, id').all(userId)
    .map(c => ({
      id: String(c.id), accountId: String(c.account_id), date: c.date, kind: c.kind,
      amount: c.amount, fx: c.fx || 1, note: c.note || '',
      amountCNY: Math.round((+c.amount || 0) * (c.fx || 1) * 100) / 100,
      inputCurrency: c.input_currency || null, inputAmount: c.input_amount != null ? c.input_amount : c.amount,
      toAccountId: c.to_account_id != null ? String(c.to_account_id) : null,
      toAmount: c.to_amount, toCurrency: c.to_currency, toFx: c.to_fx,
      toAmountCNY: c.to_amount != null ? Math.round((+c.to_amount || 0) * (c.to_fx || 1) * 100) / 100 : null,
    }));

  const dcaPlans = db.prepare('SELECT * FROM dca_plan WHERE user_id=? ORDER BY id').all(userId)
    .map(p => ({
      id: String(p.id), assetId: String(p.asset_id), startMonth: p.start_month, months: p.months,
      day: p.day, amount: p.amount, note: p.note || '', active: p.active ? true : false,
    }));

  return cache.setCache(key, {
    userId,
    settings: { costMethod: settings.costMethod, dividendReducesCost: settings.dividendReducesCost },
    fullSettings: settings,
    accounts, assets, events, fx, snapshots,
    benchSeries: benchRows, cashFlows, dcaPlans,
  });
}


/* getUser / DEFAULT_SETTINGS 仅内部使用，不对外导出 */
module.exports = { buildState, getUserSettings, saveUserSettings };
