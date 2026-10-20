'use strict';
/**
 * 持仓可用份额校验（写入前）。
 * 引擎侧对超卖做了防御性钳制；这里在写入前给出可读错误，避免脏数据进入事件表。
 */

function replayQty(events) {
  let qty = 0;
  for (const e of events) {
    const act = e.side || e.kind || '';
    const q = +e.qty || 0;
    if (act === 'opening' || act === 'buy' || act === 'invest') qty += q;
    else if (act === 'sell' || act === 'redeem') {
      if (q > 0) qty = Math.max(0, qty - q);
      else if (act === 'redeem') qty = 0;          // 金额口径赎回：视同清仓
    } else if (act === 'bonus') qty += q;
    else if (act === 'split') qty *= (+e.ratio || 1);
  }
  return qty;
}

/**
 * 某资产在指定日期（含当日）的可用份额。
 * @param {object} db better-sqlite3 实例
 * @param {number} userId
 * @param {number} assetId
 * @param {string} date YYYY-MM-DD
 * @param {number|null} excludeEventId 编辑时排除自身
 */
function availableQty(db, userId, assetId, date, excludeEventId) {
  const rows = db.prepare(`SELECT id,date,kind,side,qty,ratio FROM event
    WHERE user_id=? AND asset_id=? AND date<=? ORDER BY date,id`).all(userId, assetId, date);
  return replayQty(rows.filter(r => String(r.id) !== String(excludeEventId)));
}

/**
 * 校验卖出/赎回份额。返回错误字符串或 null。
 */
function checkSellable(db, userId, asset, date, act, qty, excludeEventId) {
  if (!(act === 'sell' || act === 'redeem')) return null;
  if (!(qty > 0)) return '份额需大于 0';
  const available = availableQty(db, userId, asset.id, date, excludeEventId);
  if (qty > available + 1e-6) {
    const unit = asset.type === 'stock' ? '股' : '份';
    return `可用${unit}额不足：该资产在 ${date} 及之前仅有 ${+available.toFixed(6)} ${unit}，无法卖出/赎回 ${qty} ${unit}`;
  }
  return null;
}

module.exports = { availableQty, checkSellable, replayQty };
