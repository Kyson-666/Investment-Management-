'use strict';
/** 管理后台：用户管理 / 邮箱服务器配置+测试 / 汇率管理别名 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb, getConfig, setConfig } = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');
const { encrypt, decrypt, maskSecret } = require('../crypto');
const mailer = require('../services/mailer');
const audit = require('../services/audit');

const router = express.Router();
router.use(authRequired, adminRequired);

/* ================= 用户管理 ================= */
router.get('/users', (req, res) => {
  const rows = getDb().prepare(`SELECT id,username,email,role,status,created_at,last_login_at
                                FROM user ORDER BY id`).all();
  res.json(rows.map(u => ({
    id: u.id, username: u.username, email: u.email, role: u.role, status: u.status,
    createdAt: u.created_at, lastLoginAt: u.last_login_at,
  })));
});

router.put('/users/:id/status', (req, res) => {
  const status = req.body?.status;
  if (!['active', 'disabled'].includes(status)) return badRequest(res, '状态非法');
  const target = getDb().prepare('SELECT * FROM user WHERE id=?').get(req.params.id);
  if (!target) return notFound(res, '用户不存在');
  if (target.id === req.user.id && status === 'disabled') {
    return badRequest(res, '不能禁用当前登录的管理员自己');
  }
  getDb().prepare('UPDATE user SET status=? WHERE id=?').run(status, target.id);
  res.json({ ok: true });
});

/** 重置密码：生成一次性临时密码返回（管理员转交用户，用户登录后应自行修改） */
router.post('/users/:id/reset-password', (req, res) => {
  const target = getDb().prepare('SELECT * FROM user WHERE id=?').get(req.params.id);
  if (!target) return notFound(res, '用户不存在');
  const temp = crypto.randomBytes(6).toString('base64url').slice(0, 10) + 'A1';
  const hash = bcrypt.hashSync(temp, 10);
  getDb().prepare('UPDATE user SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hash, target.id);
  res.json({ ok: true, tempPassword: temp });
});

/* ================= 邮箱服务器配置 ================= */
router.get('/mail', (req, res) => {
  const cfg = mailer.getMailConfig();
  res.json({
    host: cfg.host || '',
    port: cfg.port || 465,
    secure: !!cfg.secure,
    user: cfg.user || '',
    from: cfg.from || '',
    hasPassword: !!cfg.pass,
    passwordMask: cfg.pass ? maskSecret(cfg.pass) : '',
    configured: mailer.isConfigured(cfg),
  });
});

router.put('/mail', (req, res) => {
  const b = req.body || {};
  const prev = getConfig(mailer.MAIL_CONFIG_KEY, {}) || {};
  const value = {
    host: String(b.host || '').trim(),
    port: parseInt(b.port, 10) || 465,
    secure: b.secure !== undefined ? !!b.secure : true,
    user: String(b.user || '').trim(),
    from: String(b.from || '').trim(),
    // 密码留空/缺省则保留原密码；显式传空串且原本有密码时清空
    pass: b.password === undefined ? prev.pass : (b.password === '' ? '' : encrypt(String(b.password))),
  };
  setConfig(mailer.MAIL_CONFIG_KEY, value);
  res.json({ ok: true });
});

/** 测试连通性；body.to 非空时顺带发测试信 */
router.post('/mail/test', asyncHandler(async (req, res) => {
  const to = req.body?.to ? String(req.body.to) : undefined;
  const result = await mailer.testConnection(to);
  res.status(result.ok ? 200 : 502).json(result);
}));

/* ================= 系统概览 ================= */
router.get('/stats', (req, res) => {
  const db = getDb();
  res.json({
    users: db.prepare('SELECT COUNT(*) n FROM user').get().n,
    activeUsers: db.prepare("SELECT COUNT(*) n FROM user WHERE status='active'").get().n,
    fxRows: db.prepare('SELECT COUNT(*) n FROM fx_rate').get().n,
    latestFx: db.prepare('SELECT * FROM fx_rate ORDER BY date DESC, id DESC LIMIT 1').get(),
    mailConfigured: mailer.isConfigured(),
  });
});

/* 最近写操作（谁在何时改了哪个实体） */
router.get('/audit', (req, res) => {
  res.json(audit.list(getDb(), req.query.limit));
});

module.exports = router;
