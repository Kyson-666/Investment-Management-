'use strict';
/**
 * 鉴权中间件：
 * - authRequired：校验 JWT，并每次请求回查 status（禁用即时失效）
 * - adminRequired：role='admin'
 */
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { config } = require('../config');

function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role, tv: user.token_version || 0 },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录或登录已失效' });
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: '登录令牌无效或已过期' });
  }
  const user = getDb().prepare('SELECT * FROM user WHERE id=?').get(payload.uid);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  if (user.status !== 'active') return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
  /* token_version 不匹配 = 改密/重置后签发的旧 token，立即失效 */
  if ((payload.tv || 0) !== (user.token_version || 0)) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
  req.user = user;
  req.token = token;
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = { signToken, authRequired, adminRequired };
