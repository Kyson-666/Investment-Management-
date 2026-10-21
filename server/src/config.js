'use strict';
/**
 * 全局配置：统一从环境变量读取，提供默认值。
 * 本地开发可用 `node --env-file=.env src/server.js` 注入根目录 .env。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(ROOT, '..', 'data'));

/** 显式配置的 JWT_SECRET 是否可用：生产环境拒绝默认值 / 示例值 / 过短值 */
function isUsableSecret(s) {
  return !!s && s.length >= 32 && !/change|secret|please/i.test(s);
}

/**
 * 解析生产环境 JWT_SECRET：
 *  1) 显式配置且合法 → 直接使用（推荐：多实例部署时应共享同一密钥）；
 *  2) 未配置或为示例值 → 自动生成随机密钥并持久化到数据目录 `.jwt-secret`
 *     （首次启动写入、后续复用），避免「compose 示例默认值导致服务拒绝启动」；
 *     删除该文件并重启即可轮换（现有登录会失效，SMTP 密码需重新填写）。
 *  3) 数据目录不可写 → 抛出明确错误，不静默降级为固定密钥。
 * 密钥内容不打印到日志（仅提示文件路径）。
 */
function resolveJwtSecret(dataDir, nodeEnv) {
  const raw = process.env.JWT_SECRET;
  if (nodeEnv !== 'production') return raw || 'dev-insecure-secret-change-me';
  if (isUsableSecret(raw)) return raw;

  const file = path.join(dataDir, '.jwt-secret');
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved.length >= 32) {
        console.warn(`[config] JWT_SECRET 未配置有效值，使用已持久化的随机密钥：${file}`);
        return saved;
      }
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.warn(`[config] JWT_SECRET 未配置有效值，已自动生成随机密钥并保存到 ${file}`
      + '（请勿删除；轮换时删除该文件并重启，现有登录将失效）');
    return generated;
  } catch (e) {
    throw new Error(`[config] 生产环境需要 JWT_SECRET（至少 32 位随机值），`
      + `自动生成失败：${e.message}。请在 .env 中设置 JWT_SECRET，例如：`
      + 'JWT_SECRET=' + crypto.randomBytes(32).toString('hex'));
  }
}

const config = {
  ROOT,
  DATA_DIR,
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'),
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'invest.db'),
  PORT: parseInt(process.env.PORT || '8080', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  /* 以下两项在对象构建后由 resolveJwtSecret 赋值（见文件末尾） */
  JWT_SECRET: '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CONFIG_SECRET: '',

  ADMIN: {
    username: process.env.ADMIN_USERNAME || 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin12345',
  },

  FX: {
    sourceUrl: process.env.FX_SOURCE_URL || 'https://api.frankfurter.app/latest?from=USD&to=CNY',
    fallbackUrl: process.env.FX_FALLBACK_URL || 'https://open.er-api.com/v6/latest/USD',
    syncCron: process.env.FX_SYNC_CRON || '0 8 * * *',
    syncOnStart: String(process.env.FX_SYNC_ON_START || 'false').toLowerCase() === 'true',
  },

  // 行情同步（按资产代码拉取最新单价；股票 15 分钟一次，基金每日收盘净值一次）
  QUOTES: {
    stockCron: process.env.QUOTES_STOCK_CRON || '*/15 * * * *',
    fundCron: process.env.QUOTES_FUND_CRON || '5 21 * * *',
  },

  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: String(process.env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  // 定时任务开关（测试时关闭）
  CRON_ENABLED: String(process.env.CRON_ENABLED ?? 'true').toLowerCase() !== 'false',
  // 数据备份保留天数
  BACKUP_KEEP_DAYS: parseInt(process.env.BACKUP_KEEP_DAYS || '30', 10),
};

function ensureDirs() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
}

/* 生产环境密钥解析：显式合法值优先，否则自动生成并持久化（详见 resolveJwtSecret 注释） */
config.JWT_SECRET = resolveJwtSecret(config.DATA_DIR, config.NODE_ENV);
config.CONFIG_SECRET = process.env.CONFIG_SECRET || config.JWT_SECRET;

module.exports = { config, ensureDirs };
