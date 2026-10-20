'use strict';
/** 删除归档列表 / 恢复 / 永久清理 */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');
const archive = require('../services/archive');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  res.json(archive.list(getDb(), req.user.id));
});

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const db = getDb();
  let result;
  db.transaction(() => { result = archive.restore(db, req.user.id, req.params.id); })();
  if (result.error) return badRequest(res, result.error);
  res.json(result);
}));

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM deletion_archive WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return notFound(res, '归档不存在');
  res.json({ ok: true });
});

module.exports = router;
