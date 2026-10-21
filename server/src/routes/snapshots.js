'use strict';
/** 月末快照（含浮动收益、TWR、基准曲线的输入；支持按事件与净值历史派生对账） */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');
const { deriveSnapshot, autofillSnapshots, diffReport } = require('../services/snapshots');

const router = express.Router();
router.use(authRequired);

const mapRow = r => ({
  id: String(r.id), month: r.month, total: r.total,
  source: r.source || 'manual', derivedAt: r.derived_at || null,
});

function withDerived(db, uid, month, saved) {
  const d = deriveSnapshot(db, uid, month);
  const total = saved != null ? +saved : null;
  const diff = total != null && d.complete ? +(total - d.total).toFixed(2) : null;
  const diffPct = (diff != null && d.total > 0) ? +(diff / d.total).toFixed(6) : null;
  return { ...d, saved: total, diff, diffPct };
}

router.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM snapshot WHERE user_id=? ORDER BY month')
    .all(req.user.id).map(mapRow));
});

/* 只派生、不落库；用于保存前对比/页面“对比派生值” */
router.get('/derive', (req, res) => {
  const month = String(req.query.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest(res, '月份格式应为 YYYY-MM');
  const db = getDb();
  const saved = db.prepare('SELECT total FROM snapshot WHERE user_id=? AND month=?')
    .get(req.user.id, month);
  res.json(withDerived(db, req.user.id, month, saved ? saved.total : null));
});

/* 快照差异报告：全月份 saved vs derived 对账（仅 complete 月计算 diff） */
router.get('/report', (req, res) => {
  res.json(diffReport(getDb(), req.user.id));
});

/* 批量回填历史缺失月末快照（source='derived'，绝不覆盖已有快照）。
 * body 可选：{from, to, includeCurrent}；缺省从最早数据月回填到上个月。 */
router.post('/autofill', (req, res) => {
  const opt = req.body || {};
  for (const k of ['from', 'to']) {
    if (opt[k] != null && !/^\d{4}-\d{2}$/.test(String(opt[k]))) {
      return badRequest(res, `${k} 格式应为 YYYY-MM`);
    }
  }
  res.json(autofillSnapshots(getDb(), req.user.id, opt));
});

router.post('/', asyncHandler(async (req, res) => {
  const month = String(req.body?.month || '').slice(0, 7);
  const total = Number(req.body?.total);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest(res, '月份格式应为 YYYY-MM');
  if (!(total >= 0)) return badRequest(res, '月末持仓市值需为非负数');
  const source = req.body?.source === 'derived' ? 'derived' : 'manual';
  const db = getDb();
  db.prepare(`INSERT INTO snapshot (user_id,month,total,source,derived_at) VALUES (?,?,?,?,?)
              ON CONFLICT(user_id,month) DO UPDATE SET total=excluded.total,
                source=excluded.source, derived_at=excluded.derived_at`)
    .run(req.user.id, month, total, source, source === 'derived' ? now() : null);
  const row = db.prepare('SELECT * FROM snapshot WHERE user_id=? AND month=?').get(req.user.id, month);
  res.status(201).json({ ...mapRow(row), derived: withDerived(db, req.user.id, month, total) });
}));

router.delete('/:month', (req, res) => {
  const month = String(req.params.month);
  const info = getDb().prepare('DELETE FROM snapshot WHERE user_id=? AND month=?').run(req.user.id, month);
  if (!info.changes) return notFound(res, '快照不存在');
  res.json({ ok: true });
});

module.exports = router;
