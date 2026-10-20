'use strict';
/** 交易与现金流事件 CRUD（统一 event 表） */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');
const { checkSellable } = require('../services/position');
const archive = require('../services/archive');

const router = express.Router();
router.use(authRequired);

const STOCK_SIDES = ['buy', 'sell', 'div', 'bonus', 'split', 'opening'];
const FLOW_KINDS = ['invest', 'redeem', 'income', 'opening'];

function mapRow(e) {
  return {
    id: String(e.id), assetId: String(e.asset_id), date: e.date, kind: e.kind, side: e.side,
    qty: e.qty, price: e.price, amount: e.amount, ratio: e.ratio, fee: e.fee || 0,
    fx: e.fx || 1, isT: e.is_t ? 1 : 0, note: e.note || '', createdAt: e.created_at,
    marginCNY: e.margin_cny || 0,
  };
}

/** 校验并归一化事件载荷 */
function normalize(body, asset) {
  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '日期格式应为 YYYY-MM-DD' };
  const isStock = asset.type === 'stock';
  const allowed = isStock ? STOCK_SIDES : FLOW_KINDS;
  const type = isStock ? String(body.side || body.kind || '') : String(body.kind || '');
  if (!allowed.includes(type)) return { error: `该资产允许的事件类型：${allowed.join(' / ')}` };

  /* 手续费：所有类型均可录，含税；不能为负（可为 0） */
  const fee = Math.max(0, Number(body.fee) || 0);
  /* 融资额：本次买入使用的融资（CNY，前端按币种与汇率换算后提交）；不能为负 */
  const marginCNY = Math.max(0, Number(body.marginCNY != null ? body.marginCNY : body.margin) || 0);
  /* 收益类（分红/利息）录入币种换算：仅这类金额支持 CNY/USD 切换 */
  const incomeAmount = () => {
    const raw = Number(body.amount);
    if (!isFinite(raw) || raw === 0) return { error: '金额需为非 0 数值（收益可为负，用于记录融资利息等支出）' };
    const rate = (+body.fx > 0) ? +body.fx : (asset.currency === 'USD' ? currentFx(date) : 7.1);
    const inCur = ['CNY', 'USD'].includes(body.inputCurrency) ? body.inputCurrency : asset.currency;
    if (inCur === asset.currency) return { amount: raw };
    if (asset.currency === 'CNY') return { amount: raw * rate };        // 录 USD → CNY
    return { amount: raw / rate };                                      // 录 CNY → USD
  };
  let fx = Number(body.fx);
  if (!isFinite(fx) || fx <= 0) fx = asset.currency === 'USD' ? currentFx(date) : 1;
  if (asset.currency === 'CNY') fx = 1;

  const v = { date, fee, fx, note: String(body.note || ''), isT: body.isT ? 1 : 0, marginCNY: 0 };
  if (isStock) {
    v.kind = type; v.side = type;
    if (type === 'opening') {
      /* 期初建仓：记账开始前已持有的股数 + 成本单价（不产生现金流） */
      const qty = Number(body.qty), price = Number(body.price);
      if (!(qty > 0)) return { error: '期初份额需大于 0' };
      if (!(price >= 0)) return { error: '期初成本单价需 ≥ 0' };
      v.qty = qty; v.price = price; v.amount = +(qty * price).toFixed(2);
    } else if (type === 'buy' || type === 'sell') {
      const qty = Number(body.qty), price = Number(body.price);
      if (!(qty > 0) || !(price > 0)) return { error: '数量与成交价需大于 0' };
      v.qty = qty; v.price = price;
      v.marginCNY = marginCNY;      // 买入：本次使用的融资额；卖出：忽略（还款由引擎按所得自动计算）
      /* 融资与成交金额必须同口径比较：marginCNY 为 CNY，成交金额/手续费为账户币种，需 ×fx 换算
        （此前裸比导致 USD 全融资买入被误判「融资超过成交金额」）。
        上限 = 成交金额 + 手续费（×fx），与引擎现金公式 cash -= (gross+fee)×f − margin 的自付≥0 对齐，
        即手续费也可由融资覆盖。 */
      if (type === 'buy' && marginCNY > (qty * price + fee) * fx + 1e-6) {
        return { error: `融资（¥${marginCNY}）不能超过成交金额+手续费（¥${+((qty * price + fee) * fx).toFixed(2)}）—— 成交金额请填「自付 + 融资」的总额` };
      }
    } else if (type === 'div') {
      const r = incomeAmount();
      if (r.error) return r;
      v.amount = r.amount;
    } else if (type === 'bonus') {
      const qty = Number(body.qty);
      if (!(qty > 0)) return { error: '送股数量需大于 0' };
      v.qty = qty;
    } else if (type === 'split') {
      const ratio = Number(body.ratio);
      if (!(ratio > 0)) return { error: '拆分比例需大于 0（0.5 表示合股）' };
      v.ratio = ratio;
    }
  } else {
    v.kind = type; v.side = null;
    if (type === 'opening') {
      /* 期初建仓：期初份额 + 成本单价 */
      const qty = Number(body.qty), price = Number(body.price);
      if (!(qty > 0)) return { error: '期初份额需大于 0' };
      if (!(price >= 0)) return { error: '期初成本单价需 ≥ 0' };
      v.qty = qty; v.price = price; v.amount = +(qty * price).toFixed(2);
    } else if (type === 'invest' || type === 'redeem') {
      /* v5：申购 / 赎回必须填份额；单位净值缺省时可由金额反推，金额以「份额 × 净值」为准 */
      const qty = Number(body.qty);
      if (!(qty > 0)) return { error: '份额需大于 0（申购/赎回必须填写份额）' };
      let price = Number(body.price);
      if (!(price > 0)) {
        const amt = Number(body.amount);
        if (amt > 0) price = amt / qty;
        else return { error: '请填写单位净值（或金额）' };
      }
      v.qty = qty; v.price = price; v.amount = +(qty * price).toFixed(2);
      v.marginCNY = marginCNY;      // 申购：本次使用的融资额
      /* 同买入：与成交金额+手续费（×fx → CNY）同口径比较，与引擎现金公式对齐 */
      if (type === 'invest' && marginCNY > (qty * price + fee) * fx + 1e-6) {
        return { error: `融资（¥${marginCNY}）不能超过申购金额+手续费（¥${+((qty * price + fee) * fx).toFixed(2)}）—— 金额请填「自付 + 融资」的总额` };
      }
    } else {
      const r = incomeAmount();
      if (r.error) return r;
      v.amount = r.amount;          // 利息/理财收益：支持负数（记录融资利息等支出）
    }
  }
  return { value: v };
}

router.get('/', (req, res) => {
  const db = getDb();
  let sql = `SELECT e.* FROM event e JOIN asset a ON e.asset_id=a.id
             WHERE e.user_id=?`;
  const params = [req.user.id];
  if (req.query.assetId) { sql += ' AND e.asset_id=?'; params.push(req.query.assetId); }
  if (req.query.accountId) { sql += ' AND a.account_id=?'; params.push(req.query.accountId); }
  if (req.query.kind) { sql += ' AND e.kind=?'; params.push(req.query.kind); }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  res.json(db.prepare(sql).all(...params).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const asset = ownedRow(getDb(), 'asset', req.body?.assetId, req.user.id);
  if (!asset) return badRequest(res, '资产不存在或无权操作');
  const { value, error } = normalize(req.body || {}, asset);
  if (error) return badRequest(res, error);
  /* 卖出/赎回不得超过该资产截至事件日的可用份额（编辑时排除自身） */
  const act = value.side || value.kind;
  const posErr = checkSellable(getDb(), req.user.id, asset, value.date, act, value.qty, null);
  if (posErr) return badRequest(res, posErr);
  /* 融资仅限券商账户 */
  if (value.marginCNY > 0) {
    const acc = getDb().prepare('SELECT kind FROM account WHERE id=? AND user_id=?')
      .get(asset.account_id, req.user.id);
    if (!acc || acc.kind !== 'broker') return badRequest(res, '仅券商账户的买入/申购支持录入融资');
  }

  const info = getDb().prepare(`INSERT INTO event
    (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.user.id, asset.id, value.date, value.kind, value.side,
    value.qty ?? null, value.price ?? null, value.amount ?? null, value.ratio ?? null,
    value.fee, value.marginCNY || 0, value.fx, value.isT, value.note, now());
  res.status(201).json(mapRow(ownedRow(getDb(), 'event', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const row = ownedRow(db, 'event', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const asset = db.prepare('SELECT * FROM asset WHERE id=? AND user_id=?').get(row.asset_id, req.user.id);
  const merged = {
    date: req.body.date ?? row.date, kind: row.kind, side: row.side,
    qty: row.qty, price: row.price, amount: row.amount, ratio: row.ratio,
    fee: row.fee, fx: row.fx, isT: row.is_t, note: row.note,
    marginCNY: row.margin_cny,   // ★ 缺省=保留；显式 0 才清空（否则任何编辑都会丢融资）
    ...req.body,
  };
  const { value, error } = normalize(merged, asset);
  if (error) return badRequest(res, error);
  const act = value.side || value.kind;
  const posErr = checkSellable(db, req.user.id, asset, value.date, act, value.qty, row.id);
  if (posErr) return badRequest(res, posErr);
  db.prepare(`UPDATE event SET date=?,kind=?,side=?,qty=?,price=?,amount=?,ratio=?,fee=?,margin_cny=?,fx=?,is_t=?,note=?
              WHERE id=? AND user_id=?`).run(
    value.date, value.kind, value.side, value.qty ?? null, value.price ?? null,
    value.amount ?? null, value.ratio ?? null, value.fee, value.marginCNY || 0,
    value.fx, value.isT, value.note,
    row.id, req.user.id);
  res.json(mapRow(ownedRow(db, 'event', row.id, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'event', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const db = getDb();
  let archivedId = null;
  db.transaction(() => {
    const ar = archive.archiveEvent(db, req.user.id, row.id);
    archivedId = ar ? String(ar.id) : null;
    db.prepare('DELETE FROM event WHERE id=? AND user_id=?').run(row.id, req.user.id);
  })();
  res.json({ ok: true, archivedId });
});

module.exports = router;
