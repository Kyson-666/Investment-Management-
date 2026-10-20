'use strict';
/**
 * 删除归档 / 恢复。
 * 采用“先归档、再硬删除”的方式，避免给所有查询加 deleted_at 过滤；
 * 归档保留原始 id 关系，恢复时统一重映射主键（与导入同一思路）。
 */
const { now } = require('../db');

const round2 = n => Math.round((+n || 0) * 100) / 100;

function save(db, userId, kind, label, payload) {
  return db.prepare(`INSERT INTO deletion_archive (user_id,kind,label,payload,created_at)
                     VALUES (?,?,?,?,?)`)
    .run(userId, kind, label || '', JSON.stringify(payload), now()).lastInsertRowid;
}

function archiveAccount(db, userId, accountId) {
  const account = db.prepare('SELECT * FROM account WHERE id=? AND user_id=?').get(accountId, userId);
  if (!account) return null;
  const assets = db.prepare('SELECT * FROM asset WHERE account_id=? AND user_id=? ORDER BY id').all(accountId, userId);
  const ids = assets.map(a => a.id);
  const ph = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const events = ids.length
    ? db.prepare(`SELECT * FROM event WHERE user_id=? AND asset_id IN (${ph}) ORDER BY id`).all(userId, ...ids)
    : [];
  const cashFlows = db.prepare(`SELECT * FROM cash_flow WHERE user_id=? AND (account_id=? OR to_account_id=?) ORDER BY id`)
    .all(userId, accountId, accountId);
  const dcaPlans = ids.length
    ? db.prepare(`SELECT * FROM dca_plan WHERE user_id=? AND asset_id IN (${ph}) ORDER BY id`).all(userId, ...ids)
    : [];
  const priceHistory = ids.length
    ? db.prepare(`SELECT * FROM asset_price_history WHERE asset_id IN (${ph}) ORDER BY asset_id,date`).all(...ids)
    : [];
  const id = save(db, userId, 'account', account.name, { account, assets, events, cashFlows, dcaPlans, priceHistory });
  return { id, counts: { account: 1, assets: assets.length, events: events.length,
    cashFlows: cashFlows.length, dcaPlans: dcaPlans.length, priceHistory: priceHistory.length } };
}

function archiveAsset(db, userId, assetId) {
  const asset = db.prepare('SELECT * FROM asset WHERE id=? AND user_id=?').get(assetId, userId);
  if (!asset) return null;
  const events = db.prepare('SELECT * FROM event WHERE asset_id=? AND user_id=? ORDER BY id').all(assetId, userId);
  const dcaPlans = db.prepare('SELECT * FROM dca_plan WHERE asset_id=? AND user_id=? ORDER BY id').all(assetId, userId);
  const priceHistory = db.prepare('SELECT * FROM asset_price_history WHERE asset_id=? ORDER BY date').all(assetId);
  const id = save(db, userId, 'asset', asset.name, { asset, events, dcaPlans, priceHistory });
  return { id, counts: { assets: 1, events: events.length, dcaPlans: dcaPlans.length, priceHistory: priceHistory.length } };
}

function archiveEvent(db, userId, eventId) {
  const event = db.prepare('SELECT * FROM event WHERE id=? AND user_id=?').get(eventId, userId);
  if (!event) return null;
  const asset = db.prepare('SELECT name FROM asset WHERE id=? AND user_id=?').get(event.asset_id, userId);
  const id = save(db, userId, 'event', `${asset ? asset.name + ' · ' : ''}${event.date} ${event.kind || event.side || ''}`,
    { event });
  return { id, counts: { events: 1 } };
}

function archiveCashFlow(db, userId, cashFlowId) {
  const cashFlow = db.prepare('SELECT * FROM cash_flow WHERE id=? AND user_id=?').get(cashFlowId, userId);
  if (!cashFlow) return null;
  const id = save(db, userId, 'cashflow', `${cashFlow.date} ${cashFlow.kind}`, { cashFlow });
  return { id, counts: { cashFlows: 1 } };
}

function list(db, userId) {
  return db.prepare(`SELECT id,kind,label,created_at FROM deletion_archive
                     WHERE user_id=? ORDER BY id DESC`).all(userId)
    .map(r => ({ id: String(r.id), kind: r.kind, label: r.label || '', createdAt: r.created_at }));
}

function insertAccount(db, userId, a) {
  return db.prepare(`INSERT INTO account (user_id,name,kind,currency,note,created_at)
                     VALUES (?,?,?,?,?,?)`)
    .run(userId, a.name, a.kind || 'broker', a.currency || 'CNY', a.note || '', a.created_at || now())
    .lastInsertRowid;
}

function insertAsset(db, userId, a, accountId) {
  return db.prepare(`INSERT INTO asset
    (user_id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,price_source,price_date,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, accountId, a.name, a.code || '', a.market || '', a.type, a.currency || 'CNY',
      a.price || 0, a.market_value || 0, a.unit_price || 0, a.margin_cny || 0,
      a.alerts_json || null, a.price_source || null, a.price_date || null, a.created_at || now())
    .lastInsertRowid;
}

function insertEvent(db, userId, e, assetId) {
  return db.prepare(`INSERT INTO event
    (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, assetId, e.date, e.kind, e.side || null, e.qty ?? null, e.price ?? null,
      e.amount ?? null, e.ratio ?? null, e.fee || 0, e.margin_cny || 0, e.fx || 1,
      e.is_t || 0, e.note || '', e.created_at || now())
    .lastInsertRowid;
}

function insertCashFlow(db, userId, c, accountId, toAccountId) {
  return db.prepare(`INSERT INTO cash_flow
    (user_id,account_id,date,kind,amount,fx,input_currency,input_amount,
     to_account_id,to_amount,to_currency,to_fx,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, accountId, c.date, c.kind, c.amount, c.fx || 1,
      c.input_currency || null, c.input_amount == null ? c.amount : c.input_amount,
      toAccountId, c.to_amount == null ? null : c.to_amount, c.to_currency || null,
      c.to_fx == null ? null : c.to_fx, c.note || '');
}

function insertPriceHistory(db, assetId, h) {
  if (!(h.unit_price > 0) || !h.date) return;
  db.prepare(`INSERT INTO asset_price_history (asset_id,date,unit_price,source,created_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(asset_id,date) DO UPDATE SET unit_price=excluded.unit_price,
                source=excluded.source, created_at=excluded.created_at`)
    .run(assetId, h.date, h.unit_price, h.source || 'restore', h.created_at || now());
}

function insertDca(db, userId, p, assetId) {
  return db.prepare(`INSERT INTO dca_plan
    (user_id,asset_id,start_month,months,day,amount,note,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(userId, assetId, p.start_month, p.months || 12, p.day || 15, p.amount,
      p.note || '定投', p.active === undefined ? 1 : (p.active ? 1 : 0), p.created_at || now())
    .lastInsertRowid;
}

/**
 * 恢复归档。返回新建的实体 id 与数量；引用不存在时返回 error 字符串。
 */
function restore(db, userId, archiveId) {
  const row = db.prepare('SELECT * FROM deletion_archive WHERE id=? AND user_id=?').get(archiveId, userId);
  if (!row) return { error: '归档不存在' };
  let p;
  try { p = JSON.parse(row.payload); } catch { return { error: '归档数据损坏' }; }
  const reason = (msg) => ({ error: msg });

  if (row.kind === 'account') {
    const accountId = insertAccount(db, userId, p.account || {});
    const accMap = new Map([[String(p.account.id), accountId]]);
    const assetMap = new Map();
    for (const a of p.assets || []) {
      const id = insertAsset(db, userId, a, accountId);
      assetMap.set(String(a.id), id);
    }
    for (const e of p.events || []) {
      const aid = assetMap.get(String(e.asset_id));
      if (aid) insertEvent(db, userId, e, aid);
    }
    for (const c of p.cashFlows || []) {
      /* 转入/转出对方账户：若也在本次归档中则用新 id，否则沿用仍存在的账户 */
      const src = accMap.get(String(c.account_id))
        || (db.prepare('SELECT id FROM account WHERE id=? AND user_id=?').get(c.account_id, userId) || {}).id;
      if (!src) continue;
      const to = c.to_account_id == null ? null
        : (accMap.get(String(c.to_account_id))
          || (db.prepare('SELECT id FROM account WHERE id=? AND user_id=?').get(c.to_account_id, userId) || {}).id
          || null);
      insertCashFlow(db, userId, c, src, to);
    }
    for (const d of p.dcaPlans || []) {
      const aid = assetMap.get(String(d.asset_id));
      if (aid) insertDca(db, userId, d, aid);
    }
    for (const h of p.priceHistory || []) {
      const aid = assetMap.get(String(h.asset_id));
      if (aid) insertPriceHistory(db, aid, h);
    }
    return { ok: true, kind: row.kind, accountId: String(accountId),
      counts: { accounts: 1, assets: (p.assets || []).length, events: (p.events || []).length,
        cashFlows: (p.cashFlows || []).length, dcaPlans: (p.dcaPlans || []).length } };
  }

  if (row.kind === 'asset') {
    const a = p.asset || {};
    const account = db.prepare('SELECT id FROM account WHERE id=? AND user_id=?').get(a.account_id, userId);
    if (!account) return reason('原账户已不存在，无法恢复资产；请先恢复账户');
    const assetId = insertAsset(db, userId, a, account.id);
    let events = 0, dcaPlans = 0;
    for (const e of p.events || []) { insertEvent(db, userId, e, assetId); events++; }
    for (const d of p.dcaPlans || []) { insertDca(db, userId, d, assetId); dcaPlans++; }
    for (const h of p.priceHistory || []) insertPriceHistory(db, assetId, h);
    return { ok: true, kind: row.kind, assetId: String(assetId),
      counts: { assets: 1, events, dcaPlans, priceHistory: (p.priceHistory || []).length } };
  }

  if (row.kind === 'event') {
    const e = p.event || {};
    const asset = db.prepare('SELECT id FROM asset WHERE id=? AND user_id=?').get(e.asset_id, userId);
    if (!asset) return reason('原资产已不存在，无法恢复流水');
    const id = insertEvent(db, userId, e, asset.id);
    return { ok: true, kind: row.kind, eventId: String(id), counts: { events: 1 } };
  }

  if (row.kind === 'cashflow') {
    const c = p.cashFlow || {};
    const account = db.prepare('SELECT id FROM account WHERE id=? AND user_id=?').get(c.account_id, userId);
    if (!account) return reason('原账户已不存在，无法恢复现金流水');
    const to = c.to_account_id == null ? null
      : (db.prepare('SELECT id FROM account WHERE id=? AND user_id=?').get(c.to_account_id, userId) || {}).id || null;
    const id = insertCashFlow(db, userId, c, account.id, to);
    return { ok: true, kind: row.kind, cashFlowId: String(id), counts: { cashFlows: 1 } };
  }

  return reason('不支持的归档类型');
}

module.exports = {
  archiveAccount, archiveAsset, archiveEvent, archiveCashFlow,
  list, restore,
  _round2: round2,
};
