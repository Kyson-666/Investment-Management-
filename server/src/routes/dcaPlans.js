'use strict';
/** 定投计划 CRUD + 一键生成投入记录（汇率按每期发生日生效汇率锁定） */
const express = require('express');
const { getDb, now } = require('../db');
const Calc = require('../calc');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');
const prices = require('../services/prices');

const router = express.Router();
router.use(authRequired);

function mapRow(p) {
  return {
    id: String(p.id), assetId: String(p.asset_id), startMonth: p.start_month, months: p.months,
    day: p.day, amount: p.amount, note: p.note || '', active: p.active ? true : false,
    createdAt: p.created_at,
  };
}

router.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM dca_plan WHERE user_id=? ORDER BY id')
    .all(req.user.id).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const asset = ownedRow(getDb(), 'asset', b.assetId, req.user.id);
  if (!asset) return badRequest(res, '资产不存在');
  if (asset.type === 'stock') return badRequest(res, '定投仅支持基金/理财/债券，股票请逐笔录入');
  const startMonth = String(b.startMonth || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return badRequest(res, '起始月份格式应为 YYYY-MM');
  const months = parseInt(b.months, 10);
  if (!(months >= 1 && months <= 360)) return badRequest(res, '期数需在 1~360 之间');
  const day = parseInt(b.day, 10);
  if (!(day >= 1 && day <= 28)) return badRequest(res, '扣款日需在 1~28 之间');
  const amount = Number(b.amount);
  if (!(amount > 0)) return badRequest(res, '每期金额需大于 0');

  const info = getDb().prepare(`INSERT INTO dca_plan
    (user_id,asset_id,start_month,months,day,amount,note,active,created_at)
    VALUES (?,?,?,?,?,?,?,1,?)`)
    .run(req.user.id, asset.id, startMonth, months, day, amount, String(b.note || '定投'), now());
  res.status(201).json(mapRow(ownedRow(getDb(), 'dca_plan', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = ownedRow(getDb(), 'dca_plan', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const b = req.body || {};
  const active = b.active === undefined ? row.active : (b.active ? 1 : 0);
  const amount = b.amount !== undefined ? Number(b.amount) : row.amount;
  const months = b.months !== undefined ? parseInt(b.months, 10) : row.months;
  const day = b.day !== undefined ? parseInt(b.day, 10) : row.day;
  const note = b.note !== undefined ? String(b.note) : row.note;
  if (!(amount > 0)) return badRequest(res, '每期金额需大于 0');
  getDb().prepare('UPDATE dca_plan SET active=?,amount=?,months=?,day=?,note=? WHERE id=? AND user_id=?')
    .run(active, amount, months, day, note, row.id, req.user.id);
  res.json(mapRow(ownedRow(getDb(), 'dca_plan', row.id, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'dca_plan', req.params.id, req.user.id);
  if (!row) return notFound(res);
  getDb().prepare('DELETE FROM dca_plan WHERE id=? AND user_id=?').run(row.id, req.user.id);
  res.json({ ok: true });
});

/**
 * 生成投入记录：
 * - 每期日期 = 起始月起第 i 月的扣款日；汇率取该发生日生效汇率（CNY 资产恒为 1）
 * - 同资产同日已有 invest 事件则跳过（可重复调用，幂等）
 */
router.post('/:id/generate', asyncHandler(async (req, res) => {
  const db = getDb();
  const plan = ownedRow(db, 'dca_plan', req.params.id, req.user.id);
  if (!plan) return notFound(res);
  const asset = db.prepare('SELECT * FROM asset WHERE id=? AND user_id=?').get(plan.asset_id, req.user.id);
  if (!asset) return notFound(res, '资产不存在');

  const rows = Calc.dcaGenerate({
    startMonth: plan.start_month, months: plan.months, day: plan.day,
    amount: plan.amount, note: plan.note || '定投',
  }, { until: Calc.TODAY() });   // 只补到今天的期次；未来期次由每日任务逐期生成

  /* 用历史成交价补齐净值序列，避免“所有历史期次都按今天的净值折算” */
  prices.backfillFromEvents(db, asset.id);

  const existsStmt = db.prepare('SELECT id FROM event WHERE asset_id=? AND date=? AND kind=\'invest\'');
  const insert = db.prepare(`INSERT INTO event
    (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
    VALUES (?,?,?,?,NULL,?,?,?,NULL,0,?,0,?,?)`);

  const inserted = [], skipped = [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (existsStmt.get(asset.id, r.date)) { skipped.push(r.date); continue; }
      /* 按发生日最近净值折算份额；无历史净值时退回当前净值并标记 estimated */
      const hist = prices.priceAt(db, asset.id, r.date);
      const nav = hist ? +hist.unit_price : (+asset.unit_price > 0 ? +asset.unit_price : 1);
      const fx = asset.currency === 'USD' ? currentFx(r.date) : 1;
      const qty = +((+r.amount || 0) / nav).toFixed(6);
      const info = insert.run(req.user.id, asset.id, r.date, 'invest', qty, nav, r.amount, fx,
        r.note || plan.note || '定投', now());
      inserted.push({ id: String(info.lastInsertRowid), date: r.date, amount: r.amount,
        qty, fx, nav, estimated: !hist });
    }
  });
  tx();
  const estimatedCount = inserted.filter(x => x.estimated).length;
  res.json({ ok: true, inserted, insertedCount: inserted.length,
    skippedCount: skipped.length, skipped, estimatedCount });
}));

module.exports = router;
