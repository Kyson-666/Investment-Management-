'use strict';
/**
 * 生产环境 JWT_SECRET 解析行为（node --test test/config.test.js）
 *
 * 背景：compose 曾提供示例默认值 `please-change-this-to-a-random-secret`，
 * 生产校验必然拒绝 → 容器首次部署直接退出（用户实际踩坑）。
 * 现行策略：未配置有效值时自动生成随机密钥并持久化到 DATA_DIR/.jwt-secret。
 *
 * 用子进程验证模块级行为（config 在 require 时求值），互不污染。
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = path.join(__dirname, '..', 'src', 'config.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-config-test-'));

function load(env) {
  const out = execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(CONFIG)}).config))`], {
    env: { ...process.env, NODE_ENV: 'production', ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('未配置 JWT_SECRET：自动生成随机密钥并持久化到数据目录', () => {
  const dir = path.join(TMP, 'a');
  const cfg = load({ DATA_DIR: dir, JWT_SECRET: '' });
  assert.ok(cfg.JWT_SECRET.length >= 64, '应生成 32 字节 hex 密钥');
  assert.equal(cfg.CONFIG_SECRET, cfg.JWT_SECRET, 'CONFIG_SECRET 缺省跟随 JWT_SECRET');
  const file = path.join(dir, '.jwt-secret');
  assert.ok(fs.existsSync(file), '应写入 .jwt-secret');
  assert.equal(fs.readFileSync(file, 'utf8').trim(), cfg.JWT_SECRET);
});

test('示例/过短 JWT_SECRET：视为未配置，自动生成（不再拒绝启动）', () => {
  const dir = path.join(TMP, 'b');
  const cfg = load({ DATA_DIR: dir, JWT_SECRET: 'please-change-this-to-a-random-secret' });
  assert.ok(cfg.JWT_SECRET.length >= 64);
  assert.notEqual(cfg.JWT_SECRET, 'please-change-this-to-a-random-secret');
});

test('重复启动复用同一密钥；显式合法密钥优先于文件', () => {
  const dir = path.join(TMP, 'c');
  const first = load({ DATA_DIR: dir, JWT_SECRET: '' });
  const second = load({ DATA_DIR: dir, JWT_SECRET: '' });
  assert.equal(first.JWT_SECRET, second.JWT_SECRET, '同一数据目录应复用持久化密钥');

  /* 显式合法值用纯 hex（随机密钥的常见形态；含 "secret/change/please" 的语义化弱密钥会被拒绝，属预期） */
  const explicit = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
  const third = load({ DATA_DIR: dir, JWT_SECRET: explicit });
  assert.equal(third.JWT_SECRET, explicit, '显式合法值应优先');
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
