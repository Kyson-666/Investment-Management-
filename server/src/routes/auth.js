'use strict';
/** 鉴权路由：注册 / 登录（密码 或 邮箱验证码）/ 登出 / 当前用户 / 个人设置 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb, now } = require('../db');
const { config } = require('../config');
const { signToken, authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, validateRegistration, EMAIL_RE } = require('../middleware/helpers');
const mailer = require('../services/mailer');
const { getUserSettings, saveUserSettings } = require('../state');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email, role: u.role,
    status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at,
    settings: getUserSettings(u),
  };
}

/* ---------- 注册 ---------- */
router.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), asyncHandler(async (req, res) => {
  const err = validateRegistration(req.body || {});
  if (err) return badRequest(res, err);
  const username = String(req.body.username).trim();
  const email = String(req.body.email).trim().toLowerCase();
  const password = String(req.body.password);

  const db = getDb();
  if (db.prepare('SELECT id FROM user WHERE username=?').get(username)) {
    return badRequest(res, '用户名已被占用');
  }
  if (db.prepare('SELECT id FROM user WHERE email=?').get(email)) {
    return badRequest(res, '邮箱已被注册');
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO user (username,email,password_hash,role,status,created_at,settings_json)
                           VALUES (?,?,?,'user','active',?,?)`)
    .run(username, email, hash, now(), JSON.stringify({}));
  const user = db.prepare('SELECT * FROM user WHERE id=?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
}));

/* ---------- 发送邮箱验证码 ---------- */
router.post('/send-code', rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  key: req => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
}), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return badRequest(res, '邮箱格式不正确');
  const db = getDb();
  const user = db.prepare("SELECT * FROM user WHERE email=? AND status='active'").get(email);
  /* 不暴露“邮箱是否注册”：未注册也返回同样的 ok，但不发信 */
  if (!user) return res.json({ ok: true, sent: true });

  /* 同一邮箱只保留最新一条有效验证码，避免旧码长期可用 */
  db.prepare('UPDATE login_code SET used=1 WHERE email=? AND used=0').run(email);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO login_code (email,code,expires_at,used,attempts,created_at) VALUES (?,?,?,0,0,?)')
    .run(email, code, expiresAt, now());

  let sent = true;
  let devCode = null;
  try {
    await mailer.sendLoginCode(email, code);
  } catch (e) {
    sent = false;
    if (config.NODE_ENV !== 'production') devCode = code; // 仅开发环境回显，便于无 SMTP 调试
    console.warn(`[mail] 验证码邮件发送失败：${e.message}`);
  }
  res.json({
    ok: true,
    sent,
    ...(devCode ? { devCode, hint: '开发环境且 SMTP 未配置：验证码直接回显；生产环境不会返回' } : {}),
  });
}));

/* ---------- 登录（用户名+密码 或 邮箱+验证码） ---------- */
router.post('/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  key: req => `${req.ip}|${String(req.body?.username || req.body?.email || '').trim().toLowerCase()}`,
}), asyncHandler(async (req, res) => {
  const db = getDb();
  const { username, password, email, code } = req.body || {};

  let user = null;
  if (email && code) {
    const row = db.prepare(`SELECT * FROM login_code WHERE email=? AND used=0 ORDER BY id DESC LIMIT 1`)
      .get(String(email).trim().toLowerCase());
    if (!row || row.code !== String(code)) {
      /* 单码最多 5 次尝试；达到上限即作废，防止 6 位码被穷举 */
      if (row) {
        const attempts = (+row.attempts || 0) + 1;
        db.prepare('UPDATE login_code SET attempts=?, used=CASE WHEN ?>=5 THEN 1 ELSE used END WHERE id=?')
          .run(attempts, attempts, row.id);
      }
      return badRequest(res, '验证码错误');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) return badRequest(res, '验证码已过期');
    user = db.prepare("SELECT * FROM user WHERE email=?").get(String(email).trim().toLowerCase());
    db.prepare('UPDATE login_code SET used=1 WHERE id=?').run(row.id);
  } else if (username && password) {
    user = db.prepare('SELECT * FROM user WHERE username=?').get(String(username).trim());
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return badRequest(res, '用户名或密码错误');
    }
  } else {
    return badRequest(res, '请提供用户名+密码，或邮箱+验证码');
  }

  if (!user) return badRequest(res, '登录失败，用户不存在');
  if (user.status !== 'active') return res.status(403).json({ error: '账号已被禁用，请联系管理员' });

  db.prepare('UPDATE user SET last_login_at=? WHERE id=?').run(now(), user.id);
  user.last_login_at = now();
  res.json({ token: signToken(user), user: publicUser(user) });
}));

/* ---------- 登出（无状态 JWT：客户端丢弃即可；禁用账号靠每请求回查） ---------- */
router.post('/logout', authRequired, (req, res) => res.json({ ok: true }));

/* ---------- 当前用户 ---------- */
router.get('/me', authRequired, (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------- 个人设置 ---------- */
router.get('/settings', authRequired, (req, res) => {
  res.json({ settings: getUserSettings(req.user) });
});

const ALLOWED_SETTING_KEYS = ['costMethod', 'dividendReducesCost', 'allocTargets', 'taxRules',
  'warnSingle', 'warnTop5', 'benchmarkCode'];

router.put('/settings', authRequired, (req, res) => {
  const patch = {};
  for (const k of ALLOWED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) patch[k] = req.body[k];
  }
  if (patch.costMethod && !['wavg', 'fifo'].includes(patch.costMethod)) {
    return badRequest(res, '成本口径只能是 wavg 或 fifo');
  }
  if (patch.warnSingle !== undefined && (!(patch.warnSingle >= 0 && patch.warnSingle <= 1))) {
    return badRequest(res, '单一持仓阈值需在 0~1 之间');
  }
  if (patch.warnTop5 !== undefined && (!(patch.warnTop5 >= 0 && patch.warnTop5 <= 1))) {
    return badRequest(res, '前5大阈值需在 0~1 之间');
  }
  const next = saveUserSettings(req.user.id, patch);
  res.json({ settings: next });
});

/** 修改自己的密码 */
router.put('/password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return badRequest(res, '请提供原密码与新密码');
  if (String(newPassword).length < 8 || String(newPassword).length > 64) {
    return badRequest(res, '新密码长度需为 8-64 位');
  }
  if (!bcrypt.compareSync(String(oldPassword), req.user.password_hash)) {
    return badRequest(res, '原密码不正确');
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  /* token_version +1：改密后旧 JWT 立即失效（无需维护黑名单） */
  getDb().prepare('UPDATE user SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hash, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
