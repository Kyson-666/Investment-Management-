'use strict';
/**
 * 资产单价历史：定投补投、历史估值与未来对账的共同数据源。
 * 只记录“单价/净值”，不记录市值；市值仍由 calc 引擎按份额 × 单价实时计算。
 */
const { now } = require('../db');

function recordPrice(db, assetId, date, unitPrice, source = 'manual') {
  const p = +unitPrice;
  if (!(p > 0) || !date) return;
  db.prepare(`INSERT INTO asset_price_history (asset_id,date,unit_price,source,created_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(asset_id,date) DO UPDATE SET unit_price=excluded.unit_price,
                source=excluded.source, created_at=excluded.created_at`)
    .run(assetId, String(date).slice(0, 10), p, source, now());
}

/** 指定日期（含）最近一条净值；没有返回 null */
function priceAt(db, assetId, date) {
  const row = db.prepare(`SELECT unit_price,date,source FROM asset_price_history
    WHERE asset_id=? AND date<=? ORDER BY date DESC LIMIT 1`).get(assetId, String(date).slice(0, 10));
  return row || null;
}

/** 用资产现有事件里的成交价回填历史（仅 buy/invest，含日期） */
function backfillFromEvents(db, assetId) {
  const rows = db.prepare(`SELECT date, price FROM event
    WHERE asset_id=? AND price>0 AND (side='buy' OR kind='invest') ORDER BY date`).all(assetId);
  const tx = db.transaction(() => {
    for (const r of rows) recordPrice(db, assetId, r.date, r.price, 'event');
  });
  tx();
  return rows.length;
}

module.exports = { recordPrice, priceAt, backfillFromEvents };
