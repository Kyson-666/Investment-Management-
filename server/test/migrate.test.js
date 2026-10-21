'use strict';
/**
 * 存量数据修正迁移（期初建仓 fx 曾被写死为 1）· 独立临时库
 * 运行：node --test test/migrate.test.js
 *
 * 覆盖：
 *  1) 启动迁移：带坏数据的老库升级时，init → migrate → migrateOpeningFx 就地修正
 *     - 同日 manual 优先于 auto（与 services/fx.js currentFxRow 同口径）
 *     - 建仓日前无任何汇率记录 → 内置兜底 7.1
 *     - CNY 资产不受影响（fx 恒为 1）
 *  2) 幂等：修正后不再满足 fx=1 判定，重复迁移 0 笔
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `invest-migrate-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.CRON_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin12345';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

const MARKER = 'schema_opening_fx_fix';
const ts = '2026-01-01T00:00:00.000Z';

const clearMarker = () => db.getDb().prepare('DELETE FROM system_config WHERE key=?').run(MARKER);
const fxOf = assetId => db.getDb().prepare("SELECT fx FROM event WHERE asset_id=? AND kind='opening'").get(assetId).fx;

function seedBadData() {
  const d = db.getDb();
  const accUsd = d.prepare("INSERT INTO account (user_id,name,kind,currency,created_at) VALUES (1,'IBKR','broker','USD',?)").run(ts).lastInsertRowid;
  const accCny = d.prepare("INSERT INTO account (user_id,name,kind,currency,created_at) VALUES (1,'A股','broker','CNY',?)").run(ts).lastInsertRowid;
  const insAsset = d.prepare("INSERT INTO asset (user_id,account_id,name,type,currency,created_at) VALUES (1,?,?,'stock',?,?)");
  const usdA = insAsset.run(accUsd, 'USD资产-同日manual优先', 'USD', ts).lastInsertRowid;
  const usdB = insAsset.run(accUsd, 'USD资产-无历史汇率走兜底', 'USD', ts).lastInsertRowid;
  const cnyC = insAsset.run(accCny, 'CNY资产-不应改动', 'CNY', ts).lastInsertRowid;
  const ev = d.prepare("INSERT INTO event (user_id,asset_id,date,kind,qty,price,amount,fx,created_at) VALUES (1,?,?,'opening',?,?,?,1,?)");
  ev.run(usdA, '2026-01-02', 100, 10, 1000, ts);
  ev.run(usdB, '2024-01-01', 10, 5, 50, ts);
  ev.run(cnyC, '2026-01-02', 10, 10, 100, ts);
  return { usdA, usdB, cnyC };
}

test('启动迁移：坏数据在 init 时被就地修正（manual 优先 / 兜底 / CNY 不动）', () => {
  db.init(TMP_DB);                          // 全新库：迁移先跑一遍（0 行）并写标记
  assert.ok(db.getConfig(MARKER), '首次启动应写入迁移标记');
  const ids = seedBadData();

  /* 建仓日当天的两条汇率：manual 7.3 应优先于 auto 7.2 */
  db.getDb().prepare("INSERT INTO fx_rate (date,rate,source,note) VALUES ('2026-01-01',7.05,'auto','x'),('2026-01-02',7.2,'auto','x'),('2026-01-02',7.3,'manual','x')").run();

  clearMarker();
  db.init(TMP_DB);                          // 模拟「带坏数据的老库升级」：migrate() 重跑迁移

  assert.equal(fxOf(ids.usdA), 7.3, '同日 manual 优先于 auto');
  assert.equal(fxOf(ids.usdB), 7.1, '建仓日前无任何汇率记录 → 内置兜底 7.1');
  assert.equal(fxOf(ids.cnyC), 1, 'CNY 资产 fx 恒为 1，不受影响');
  assert.equal(db.getConfig(MARKER).fixed, 2, '标记应记录修正 2 笔');
});

test('幂等：迁移重复执行不二次改写', () => {
  clearMarker();
  db.init(TMP_DB);
  assert.equal(db.getConfig(MARKER).fixed, 0, '已修正的行不再满足 fx=1 判定，第二次应 0 笔');
});

/* 老库升级兼容：v4 风格老库（cash_flow 无划转列、user 无 token_version）走 init
   必须在 SCHEMA 执行阶段不崩溃（依赖补列的索引已移至 migrate 尾部创建） */
const OLD_DB = path.join(os.tmpdir(), `invest-migrate-oldschema-${process.pid}.db`);
test('老库兼容：cash_flow 缺划转列的库 init 不崩溃，补列与索引完成', () => {
  const Database = require('better-sqlite3');
  const old = new Database(OLD_DB);
  old.exec(`CREATE TABLE user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT, last_login_at TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE cash_flow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
      amount REAL NOT NULL, fx REAL, note TEXT);`);
  old.close();

  db.init(OLD_DB);   // 修复前此处崩溃：no such column: to_account_id
  const cols = db.getDb().prepare('PRAGMA table_info(cash_flow)').all().map(c => c.name);
  assert.ok(cols.includes('to_account_id'), 'migrate 应补 to_account_id');
  assert.ok(cols.includes('input_currency'), 'migrate 应补 input_currency');
  const idx = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cashflow_to_account'").get();
  assert.ok(idx, '补列后应创建 idx_cashflow_to_account');
  assert.ok(db.getDb().prepare('PRAGMA table_info(user)').all().map(c => c.name).includes('token_version'),
    'migrate 应补 user.token_version');
  try { db.getDb().close(); } catch { /* ignore */ }
  for (const f of [OLD_DB, OLD_DB + '-wal', OLD_DB + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

test.after(() => {
  for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});
