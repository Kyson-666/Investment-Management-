'use strict';
/**
 * 轻量内存限流（单实例足够；多实例部署需换 Redis）。
 * 仅用于登录/注册/验证码等敏感入口，避免暴力尝试。
 */
const buckets = new Map();

function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, key } = {}) {
  return (req, res, next) => {
    const k = (typeof key === 'function' ? key(req) : req.ip) || req.ip || 'unknown';
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(k, b);
    }
    b.count++;
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((b.reset - now) / 1000))));
      return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
    }
    next();
  };
}

/* 定期清理过期桶，避免内存增长 */
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 10 * 60 * 1000);
if (timer.unref) timer.unref();

module.exports = { rateLimit };
