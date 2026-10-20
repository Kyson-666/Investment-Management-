'use strict';
/** 数据导出 / 导入（事务覆盖，导入前自动 JSON 备份）/ 示例数据装载 */
const express = require('express');
const { getDb, now, fixOpeningFx } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');
const { writeJsonBackup } = require('../services/backup');
const { loadDemoData } = require('../services/demoData');
const { localDate } = require('../time');

const router = express.Router();
router.use(authRequired);

/* ---------- 导出 ---------- */
/* =========================================================
 * 备份 payload 公共构造
 *
 * ⚠️ 三种 payload 用途不同，**不可简单合并**：
 *   · 可移植导出（/export）    → 用**显式列名**，是跨设备迁移的稳定契约
 *   · 完整快照（导入前/示例前） → 用 `SELECT *`，要求列完整以便回滚
 * 故此处抽为两个单一职责函数，共享表名与列名定义，避免逐处重复又保留语义差异。
 * ========================================================= */

/** 备份格式标识（**非产品版本**，改动会破坏旧备份导入兼容性，勿随版本变更） */
const BACKUP_SCHEMA = 'invest-manager/v4';

/** 表名映射：payload 键 → 数据库表名 */
const BK_TABLES = {
  accounts: 'account', assets: 'asset', events: 'event', snapshots: 'snapshot',
  benchmarks: 'benchmark', cashFlows: 'cash_flow', dcaPlans: 'dca_plan',
};

/** 可移植导出使用的显式列名（改表结构时须同步此处） */
const BK_PORTABLE_COLS = {
  accounts: 'id,name,kind,currency,note,created_at',
  assets: 'id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at',
  events: 'id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at',
  snapshots: 'month,total,source,derived_at',
  benchmarks: 'code,date,value',
  cashFlows: 'id,account_id,date,kind,amount,fx,input_currency,input_amount,to_account_id,to_amount,to_currency,to_fx,note',
  dcaPlans: 'id,asset_id,start_month,months,day,amount,note,active,created_at',
};

/** 单价历史没有 user_id，需 JOIN asset 取；单独处理 */
function selectPriceHistory(db, uid, explicit) {
  const cols = explicit
    ? 'h.asset_id,h.date,h.unit_price,h.source'
    : 'h.*';
  return db.prepare(`SELECT ${cols} FROM asset_price_history h JOIN asset a ON a.id=h.asset_id
                     WHERE a.user_id=? ORDER BY h.asset_id,h.date`).all(uid);
}

/** 安全解析用户设置 JSON */
function readUserSettings(user) {
  try { return JSON.parse(user.settings_json || '{}'); } catch { return {}; }
}

/**
 * 可移植导出 payload（GET /export）。
 * @param {object} user 请求用户（用于取 settings_json）
 */
function buildPortablePayload(user) {
  const db = getDb();
  const uid = user.id;
  const out = {
    schema: BACKUP_SCHEMA,               // ⚠️ 格式标识，勿随产品版本变更
    exportedAt: now(),
    settings: readUserSettings(user),
    fx: db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all(),
  };
  for (const [key, table] of Object.entries(BK_TABLES)) {
    const order = key === 'snapshots' ? ' ORDER BY month' : ' ORDER BY id';
    out[key] = db.prepare(`SELECT ${BK_PORTABLE_COLS[key]} FROM ${table} WHERE user_id=?${order}`).all(uid);
  }
  out.priceHistory = selectPriceHistory(db, uid, true);
  return out;
}

/**
 * 完整快照（用于回滚）：`SELECT *` 取全列。
 * @param {number} uid 用户 id
 * @param {string[]} keys 需要快照的 payload 键（默认全部）
 * @param {boolean} withSettings 是否附带 settings 与 fx（默认 true）
 */
function buildFullSnapshot(uid, keys, withSettings = true) {
  const db = getDb();
  const out = { schema: BACKUP_SCHEMA, exportedAt: now() };
  if (withSettings) {
    const user = db.prepare('SELECT settings_json FROM user WHERE id=?').get(uid);
    out.settings = readUserSettings(user || {});
    out.fx = db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all();
  }
  for (const key of (keys || Object.keys(BK_TABLES))) {
    out[key] = db.prepare(`SELECT * FROM ${BK_TABLES[key]} WHERE user_id=?`).all(uid);
  }
  out.priceHistory = selectPriceHistory(db, uid, false);
  return out;
}

router.get('/export', (req, res) => {
  /* 可移植导出：显式列名 + settings/fx，见 buildPortablePayload */
  res.setHeader('Content-Disposition', `attachment; filename="invest-manager-backup-${localDate()}.json"`);
  res.json(buildPortablePayload(req.user));
});

/* ---------- 导入 ---------- */
const TABLES_USER = ['event', 'asset', 'account', 'snapshot', 'benchmark', 'cash_flow', 'dca_plan', 'notification', 'deletion_archive'];

router.post('/import', asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return badRequest(res, '导入内容不是合法 JSON 对象');
  if (body.schema && !String(body.schema).startsWith('invest-manager/')) {
    return badRequest(res, '文件标识不匹配，非本系统备份文件');
  }
  if (!Array.isArray(body.accounts) || !Array.isArray(body.assets) || !Array.isArray(body.events)) {
    return badRequest(res, '缺少 accounts/assets/events 必需数据段');
  }
  const db = getDb();
  const uid = req.user.id;

  /* ---------- 预检：重复源 id + 引用完整性 ----------
     导入是「整体替换」，必须在删除现有数据前完成校验；
     且不能直接写源 id（account/asset/event 是全局自增主键，多用户必冲突）。 */
  const dupCheck = (arr, label) => {
    const seen = new Set();
    for (const x of arr) {
      const k = String(x.id);
      if (seen.has(k)) return `${label} 存在重复 id：${k}`;
      seen.add(k);
    }
    return null;
  };
  const preErr = dupCheck(body.accounts, 'accounts') || dupCheck(body.assets, 'assets') || dupCheck(body.events, 'events');
  if (preErr) return badRequest(res, preErr);

  const srcAcc = new Set(body.accounts.map(a => String(a.id)));
  const srcAst = new Set(body.assets.map(a => String(a.id)));
  for (const a of body.assets) {
    if (!srcAcc.has(String(a.account_id))) return badRequest(res, `资产 #${a.id} 引用了不存在的账户 #${a.account_id}`);
  }
  for (const e of body.events) {
    if (!srcAst.has(String(e.asset_id))) return badRequest(res, `流水 #${e.id} 引用了不存在的资产 #${e.asset_id}`);
  }
  for (const c of body.cashFlows || []) {
    if (!srcAcc.has(String(c.account_id))) return badRequest(res, `出入金 #${c.id} 引用了不存在的账户 #${c.account_id}`);
    if (c.to_account_id != null && !srcAcc.has(String(c.to_account_id))) {
      return badRequest(res, `划转 #${c.id} 引用了不存在的转入账户 #${c.to_account_id}`);
    }
  }
  for (const p of body.dcaPlans || []) {
    if (!srcAst.has(String(p.asset_id))) return badRequest(res, `定投计划 #${p.id} 引用了不存在的资产 #${p.asset_id}`);
  }
  for (const h of body.priceHistory || []) {
    if (!srcAst.has(String(h.asset_id))) return badRequest(res, `净值历史引用了不存在的资产 #${h.asset_id}`);
  }

  // 导入前自动备份当前数据（完整快照，SELECT * 含全部列，用于回滚）
  const backupPayload = buildFullSnapshot(uid);
  const backupFile = writeJsonBackup(backupPayload, 'pre-import');

  const counts = { accounts: 0, assets: 0, events: 0, fx: 0, snapshots: 0, benchmarks: 0,
    cashFlows: 0, dcaPlans: 0, priceHistory: 0 };
  const astMap = new Map();

  const tx = db.transaction(() => {
    /* 单价历史没有 user_id，先按当前用户资产删除 */
    db.prepare('DELETE FROM asset_price_history WHERE asset_id IN (SELECT id FROM asset WHERE user_id=?)').run(uid);
    for (const t of TABLES_USER) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);

    const insAccount = db.prepare(`INSERT INTO account (user_id,name,kind,currency,note,created_at)
      VALUES (?,?,?,?,?,?)`);
    const accMap = new Map();
    for (const a of body.accounts) {
      const info = insAccount.run(uid, a.name, a.kind || 'broker', a.currency || 'CNY',
        a.note || '', a.created_at || now());
      accMap.set(String(a.id), info.lastInsertRowid);
      counts.accounts++;
    }

    const insAsset = db.prepare(`INSERT INTO asset
      (user_id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const a of body.assets) {
      const info = insAsset.run(uid, accMap.get(String(a.account_id)), a.name, a.code || '', a.market || '',
        a.type, a.currency, a.price || 0, a.market_value || 0, a.unit_price || 0, a.margin_cny || 0,
        typeof a.alerts_json === 'string' ? a.alerts_json : (a.alerts_json ? JSON.stringify(a.alerts_json) : null),
        a.created_at || now());
      astMap.set(String(a.id), info.lastInsertRowid);
      counts.assets++;
    }

    const insEvent = db.prepare(`INSERT INTO event
      (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const e of body.events) {
      insEvent.run(uid, astMap.get(String(e.asset_id)), e.date, e.kind, e.side || null,
        e.qty ?? null, e.price ?? null, e.amount ?? null, e.ratio ?? null, e.fee || 0,
        e.margin_cny || 0, e.fx || 1, e.is_t || 0, e.note || '', e.created_at || now());
      counts.events++;
    }

    for (const s of body.snapshots || []) {
      db.prepare('INSERT OR REPLACE INTO snapshot (user_id,month,total,source,derived_at) VALUES (?,?,?,?,?)')
        .run(uid, s.month, s.total, s.source || 'manual', s.derived_at || null);
      counts.snapshots++;
    }
    for (const b of body.benchmarks || []) {
      db.prepare('INSERT OR REPLACE INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)')
        .run(uid, b.code || 'CSI300', b.date, b.value);
      counts.benchmarks++;
    }
    for (const c of body.cashFlows || []) {
      db.prepare(`INSERT INTO cash_flow
        (user_id,account_id,date,kind,amount,fx,input_currency,input_amount,
         to_account_id,to_amount,to_currency,to_fx,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uid, accMap.get(String(c.account_id)), c.date, c.kind, c.amount, c.fx || 1,
          c.input_currency || null, c.input_amount == null ? c.amount : c.input_amount,
          c.to_account_id == null ? null : accMap.get(String(c.to_account_id)),
          c.to_amount == null ? null : c.to_amount, c.to_currency || null,
          c.to_fx == null ? null : c.to_fx, c.note || '');
      counts.cashFlows++;
    }
    for (const p of body.dcaPlans || []) {
      db.prepare(`INSERT INTO dca_plan (user_id,asset_id,start_month,months,day,amount,note,active,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`).run(
        uid, astMap.get(String(p.asset_id)), p.start_month, p.months || 12, p.day || 15, p.amount,
        p.note || '定投', p.active === undefined ? 1 : (p.active ? 1 : 0), p.created_at || now());
      counts.dcaPlans++;
    }
    for (const h of body.priceHistory || []) {
      const aid = astMap.get(String(h.asset_id));
      if (!aid || !(+h.unit_price > 0)) continue;
      db.prepare(`INSERT INTO asset_price_history (asset_id,date,unit_price,source,created_at)
                  VALUES (?,?,?,?,?)
                  ON CONFLICT(asset_id,date) DO UPDATE SET unit_price=excluded.unit_price, source=excluded.source`)
        .run(aid, String(h.date).slice(0, 10), +h.unit_price, h.source || 'import', now());
      counts.priceHistory++;
    }
    // 全局汇率仅管理员可导入
    if (req.user.role === 'admin' && Array.isArray(body.fx)) {
      for (const f of body.fx) {
        db.prepare(`INSERT INTO fx_rate (date,rate,source,note) VALUES (?,?,?,?)
                    ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`)
          .run(f.date, f.rate, f.source || 'manual', f.note || '');
        counts.fx++;
      }
    }
    if (body.settings && typeof body.settings === 'object') {
      db.prepare('UPDATE user SET settings_json=? WHERE id=?').run(JSON.stringify(body.settings), uid);
    }
  });
  tx();

  /* 旧备份可能没有 priceHistory：用已导入的成交价回填，保证定投可追溯 */
  for (const aid of astMap.values()) {
    try { require('../services/prices').backfillFromEvents(db, aid); } catch { /* 单资产失败不影响导入 */ }
  }

  /* 导入的若是在「期初建仓 fx 写死为 1」时期导出的备份，非人民币资产的期初成本仍会被低估
     → 导入后就地按建仓日汇率修正（同一判定与口径，天然幂等） */
  const fxFixed = fixOpeningFx().fixed;

  res.json({ ok: true, counts, fxFixed, backupFile: backupFile.replace(/\\/g, '/').split('/').pop() });
}));

/* ---------- 装载示例数据（会先备份） ---------- */
router.post('/demo', asyncHandler(async (req, res) => {
  const db = getDb();
  /* 示例数据会写入 accounts/assets/events/cash_flow/snapshot/benchmark/dca_plan，
     故前置备份必须是**完整快照**（全表 + settings/fx），否则回滚会丢数据。 */
  const backupFile = writeJsonBackup(buildFullSnapshot(req.user.id), 'pre-demo');
  loadDemoData(db, req.user.id);
  res.json({ ok: true, backupFile: backupFile.replace(/\\/g, '/').split('/').pop() });
}));

module.exports = router;
