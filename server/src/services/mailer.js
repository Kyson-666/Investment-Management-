'use strict';
/**
 * 邮件服务：SMTP 配置优先取数据库（管理后台可配），缺省回退环境变量。
 * SMTP 密码加密存储；支持连接验证与发送测试信。
 */
const nodemailer = require('nodemailer');
const { getDb, getConfig } = require('../db');
const { decrypt } = require('../crypto');
const { config } = require('../config');

const MAIL_CONFIG_KEY = 'smtp';

function getMailConfig() {
  const saved = getConfig(MAIL_CONFIG_KEY, null) || {};
  /* 显式清空（saved.pass === ''）不应回退环境变量；只有“从未配置过”才回退 */
  const hasSavedPass = Object.prototype.hasOwnProperty.call(saved, 'pass');
  return {
    host: saved.host ?? config.SMTP.host,
    port: saved.port ?? config.SMTP.port,
    secure: saved.secure ?? config.SMTP.secure,
    user: saved.user ?? config.SMTP.user,
    pass: hasSavedPass ? decrypt(saved.pass) : config.SMTP.pass,
    from: saved.from ?? config.SMTP.from,
  };
}

function isConfigured(cfg = getMailConfig()) {
  return !!(cfg.host && cfg.user);
}

function buildTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: !!cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
  });
}

/** 验证连通性；sendTo 非空时顺带发一封测试信 */
async function testConnection(sendTo) {
  const cfg = getMailConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: 'SMTP 尚未配置（缺少 host 或账号）' };
  }
  const transporter = buildTransporter(cfg);
  try {
    await transporter.verify();
    if (sendTo) {
      await transporter.sendMail({
        from: cfg.from || cfg.user,
        to: sendTo,
        subject: '【投资管家】SMTP 测试邮件',
        text: `这是一封来自投资管家的测试邮件，发送时间 ${new Date().toLocaleString('zh-CN')}。收到说明邮箱配置正确。`,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendMail(to, subject, text, html) {
  const cfg = getMailConfig();
  if (!isConfigured(cfg)) throw new Error('SMTP 未配置，无法发送邮件');
  const transporter = buildTransporter(cfg);
  return transporter.sendMail({ from: cfg.from || cfg.user, to, subject, text, html });
}

async function sendLoginCode(to, code) {
  return sendMail(
    to,
    '【投资管家】登录验证码',
    `您的登录验证码为 ${code}，5 分钟内有效，请勿泄露给他人。如非本人操作请忽略。`,
    `<p>您的登录验证码为 <b style="font-size:18px">${code}</b>，5 分钟内有效。</p><p>如非本人操作请忽略。</p>`
  );
}

module.exports = { getMailConfig, isConfigured, testConnection, sendMail, sendLoginCode, MAIL_CONFIG_KEY };
