'use strict';
/**
 * 月末快照派生与对账。
 * 口径：持仓市值 = Σ 份额 × 发生日最近单价（asset_price_history）× 估值日汇率；
 * 没有历史单价时退回当前单价并标记 source='current'，避免静默丢资产。
 */
const { buildState } = require('../state');
const { priceAt } = require('./prices');
const { currentFx } = require('./fx');
const { replayQty } = require('./position');
const { localDate } = require('../time');

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
 * @returns {{month,asOf,total,byAsset,missingPrice,complete}}
 */
function deriveSnapshot(db, userId, month) {
  const end = monthEnd(month);
  if (!end) return { month, asOf: null, total: 0, byAsset: [], missingPrice: 0, complete: false };
  const S = buildState(userId);
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

module.exports = { deriveSnapshot, monthEnd };
