'use strict';
/**
 * 全局配置：统一从环境变量读取，提供默认值。
 * 本地开发可用 `node --env-file=.env src/server.js` 注入根目录 .env。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(ROOT, '..', 'data'));

const config = {
  ROOT,
  DATA_DIR,
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'),
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'invest.db'),
  PORT: parseInt(process.env.PORT || '8080', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  JWT_SECRET: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CONFIG_SECRET: process.env.CONFIG_SECRET || process.env.JWT_SECRET || 'dev-insecure-secret-change-me',

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

/* 生产环境拒绝默认/过短 JWT 密钥：默认 docker-compose 也能启动是审计中的 P0 风险 */
if (config.NODE_ENV === 'production') {
  const secret = String(process.env.JWT_SECRET || '');
  if (!secret || secret.length < 32 || /change|secret|please/i.test(secret)) {
    throw new Error('[config] 生产环境必须设置至少 32 位的随机 JWT_SECRET（当前为默认值或过短）');
  }
}

module.exports = { config, ensureDirs };
