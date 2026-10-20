'use strict';
/** 账户 CRUD（券商/银行/其他） */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const archive = require('../services/archive');

const router = express.Router();
router.use(authRequired);

const KINDS = ['broker', 'bank', 'other'];
const CCYS = ['CNY', 'USD'];

function mapRow(a) {
  return { id: String(a.id), name: a.name, kind: a.kind, currency: a.currency, note: a.note || '', createdAt: a.created_at };
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM account WHERE user_id=? ORDER BY id').all(req.user.id);
  res.json(rows.map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return badRequest(res, '请填写账户名称');
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'broker';
  const currency = CCYS.includes(req.body?.currency) ? req.body.currency : 'CNY';
  const note = String(req.body?.note || '');
  const info = getDb().prepare(
    'INSERT INTO account (user_id,name,kind,currency,note,created_at) VALUES (?,?,?,?,?,?)'
  ).run(req.user.id, name, kind, currency, note, now());
  res.status(201).json(mapRow(ownedRow(getDb(), 'account', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = ownedRow(getDb(), 'account', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  if (!name) return badRequest(res, '账户名称不能为空');
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : row.kind;
  const currency = CCYS.includes(req.body?.currency) ? req.body.currency : row.currency;
  const note = req.body?.note !== undefined ? String(req.body.note) : row.note;
  /* 币种一旦有资产或出入金就不可改：cash_flow.amount 恒以账户币种存储，
     改币种会把历史金额按新币种重新解释（CNY→USD 会缩水约 7 倍）。 */
  if (currency !== row.currency) {
    const used = getDb().prepare(`SELECT
      (SELECT COUNT(*) FROM asset WHERE account_id=? AND user_id=?) +
      (SELECT COUNT(*) FROM cash_flow WHERE account_id=? AND user_id=?) AS n`)
      .get(row.id, req.user.id, row.id, req.user.id).n;
    if (used > 0) return badRequest(res, '该账户已有资产或出入金记录，币种不可修改；如需换币种请新建账户');
  }
  getDb().prepare('UPDATE account SET name=?,kind=?,currency=?,note=? WHERE id=? AND user_id=?')
    .run(name, kind, currency, note, row.id, req.user.id);
  res.json(mapRow(ownedRow(getDb(), 'account', row.id, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'account', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const assetCount = getDb().prepare('SELECT COUNT(*) n FROM asset WHERE account_id=? AND user_id=?')
    .get(row.id, req.user.id).n;
  const db = getDb();
  let archivedId = null;
  /* 先归档再硬删除（同一事务）：删除仍走 FK 级联，恢复时重映射主键 */
  db.transaction(() => {
    const ar = archive.archiveAccount(db, req.user.id, row.id);
    archivedId = ar ? String(ar.id) : null;
    db.prepare('DELETE FROM account WHERE id=? AND user_id=?').run(row.id, req.user.id);
  })();
  res.json({ ok: true, deletedAssets: assetCount, archivedId });
});

module.exports = router;
