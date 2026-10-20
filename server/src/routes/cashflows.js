'use strict';
/**
 * 现金流水：
 *  - deposit / withdraw：外部本金进出（计入净入金、累计投入、XIRR）
 *  - transfer：账户间内部划转（可为不同币种；不计入净入金/投入，但两边现金都变）
 *  - adjust：现金校准（正=盘盈，负=盘亏；计入“其他损益”，不计入投入）
 *
 * 存储口径：`amount` 恒为**转出/本账户币种**金额；`fx` 为账户币种→CNY。
 * transfer 另存 `to_account_id / to_amount / to_currency / to_fx`，转入金额以转入账户币种计价。
 */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');
const archive = require('../services/archive');

const router = express.Router();
router.use(authRequired);

const round2 = n => Math.round((+n || 0) * 100) / 100;
const CCYS = ['CNY', 'USD'];
const KINDS = ['deposit', 'withdraw', 'transfer', 'adjust'];

function mapRow(c) {
  const fx = c.fx || 1;
  const cur = c.account_currency || null;
  const toFx = c.to_fx || 1;
  return {
    id: String(c.id), accountId: String(c.account_id), date: c.date, kind: c.kind,
    currency: cur,
    amount: c.amount,
    fx,
    amountCNY: round2(c.amount * fx),
    inputCurrency: c.input_currency || cur,
    inputAmount: c.input_amount != null ? c.input_amount : c.amount,
    toAccountId: c.to_account_id ? String(c.to_account_id) : null,
    toAccountName: c.to_account_name || null,
    toCurrency: c.to_currency || null,
    toAmount: c.to_amount != null ? c.to_amount : null,
    toFx,
    toAmountCNY: c.to_amount != null ? round2(c.to_amount * toFx) : null,
    note: c.note || '',
  };
}

const SELECT = `SELECT c.*, a.currency AS account_currency, a.name AS account_name,
                       ta.currency AS to_account_currency, ta.name AS to_account_name
                FROM cash_flow c
                JOIN account a ON a.id = c.account_id
                LEFT JOIN account ta ON ta.id = c.to_account_id`;

router.get('/', (req, res) => {
  let sql = `${SELECT} WHERE c.user_id=?`;
  const params = [req.user.id];
  if (req.query.accountId) {
    sql += ' AND (c.account_id=? OR c.to_account_id=?)';
    params.push(req.query.accountId, req.query.accountId);
  }
  sql += ' ORDER BY c.date DESC, c.id DESC';
  res.json(getDb().prepare(sql).all(...params).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const date = String(b.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  if (!KINDS.includes(b.kind)) return badRequest(res, '类型应为 deposit/withdraw/transfer/adjust');

  const db = getDb();
  const account = ownedRow(db, 'account', b.accountId, req.user.id);
  if (!account) return badRequest(res, '账户不存在');
  const acctCur = account.currency;

  const inputCurrency = CCYS.includes(b.inputCurrency) ? b.inputCurrency : acctCur;
  const inputAmount = Number(b.amount);
  if (!isFinite(inputAmount)) return badRequest(res, '金额非法');
  if (b.kind === 'adjust') {
    if (inputAmount === 0) return badRequest(res, '校准金额不能为 0');
  } else if (!(inputAmount > 0)) {
    return badRequest(res, `金额需大于 0（${inputCurrency}）`);
  }

  /* 汇率：USD→CNY；账户 CNY 且录入 CNY 时恒为 1 */
  let rate = Number(b.fx);
  if (!isFinite(rate) || rate <= 0) rate = currentFx(date);
  if (!isFinite(rate) || rate <= 0) rate = 7.1;
  if (inputCurrency === 'CNY' && acctCur === 'CNY') rate = 1;

  /* 换算为账户币种金额（adjust 保留符号） */
  let amount;
  if (inputCurrency === acctCur) amount = inputAmount;
  else if (inputCurrency === 'CNY') amount = inputAmount / rate; // 账户 USD，录 CNY
  else amount = inputAmount * rate;                              // 账户 CNY，录 USD
  amount = round2(amount);
  if (b.kind !== 'adjust' && !(amount > 0)) {
    return badRequest(res, '换算后的账户币种金额需大于 0（汇率或金额过小）');
  }
  const fx = acctCur === 'USD' ? rate : 1;

  let toAccountId = null, toAmount = null, toCurrency = null, toFx = null;
  if (b.kind === 'transfer') {
    const to = ownedRow(db, 'account', b.toAccountId, req.user.id);
    if (!to) return badRequest(res, '转入账户不存在');
    if (String(to.id) === String(account.id)) return badRequest(res, '转出与转入账户不能相同');
    const ta = Number(b.toAmount);
    if (!(ta > 0)) return badRequest(res, '转入金额需大于 0');
    let tf = Number(b.toFx);
    if (!isFinite(tf) || tf <= 0) tf = currentFx(date);
    if (to.currency === 'CNY') tf = 1;
    toAccountId = to.id;
    toAmount = round2(ta);
    toCurrency = to.currency;
    toFx = to.currency === 'USD' ? tf : 1;
  }

  const info = db.prepare(
    `INSERT INTO cash_flow
      (user_id,account_id,date,kind,amount,fx,input_currency,input_amount,
       to_account_id,to_amount,to_currency,to_fx,note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(req.user.id, account.id, date, b.kind, amount, fx, inputCurrency, inputAmount,
    toAccountId, toAmount, toCurrency, toFx, String(b.note || ''));

  const row = db.prepare(`${SELECT} WHERE c.id=? AND c.user_id=?`)
    .get(info.lastInsertRowid, req.user.id);
  res.status(201).json(mapRow(row));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'cash_flow', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const db = getDb();
  let archivedId = null;
  db.transaction(() => {
    const ar = archive.archiveCashFlow(db, req.user.id, row.id);
    archivedId = ar ? String(ar.id) : null;
    db.prepare('DELETE FROM cash_flow WHERE id=? AND user_id=?').run(row.id, req.user.id);
  })();
  res.json({ ok: true, archivedId });
});

module.exports = router;
