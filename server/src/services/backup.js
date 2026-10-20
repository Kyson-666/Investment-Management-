'use strict';
/**
 * 备份服务：
 * - 导入前 JSON 快照：data/backups/auto_YYYYMMDD_HHmm.json
 * - 每日数据库文件备份：data/backups/db_YYYYMMDD.db，保留 N 天
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeJsonBackup(payload, prefix = 'auto') {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  /* 秒级 + 随机后缀：同一分钟内连续导入/示例不会被覆盖 */
  const file = path.join(config.BACKUP_DIR,
    `${prefix}_${ts()}_${Math.random().toString(36).slice(2, 6)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

/** 在线备份 SQLite（WAL 下使用 backup API 保证一致性） */
function backupDatabase(db) {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  const day = ts().slice(0, 8);
  const dest = path.join(config.BACKUP_DIR, `db_${day}.db`);
  return new Promise((resolve, reject) => {
    db.backup(dest)
      .then(() => {
        pruneOldBackups();
        resolve(dest);
      })
      .catch(reject);
  });
}

function pruneOldBackups() {
  const keep = config.BACKUP_KEEP_DAYS;
  const cutoff = Date.now() - keep * 86400000;
  for (const f of fs.readdirSync(config.BACKUP_DIR)) {
    /* 只清理本服务生成的备份，避免误删用户放在同目录的其他文件 */
    if (!/^(auto|pre-import|pre-demo|db)_/.test(f)) continue;
    const full = path.join(config.BACKUP_DIR, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    } catch { /* ignore */ }
  }
}

module.exports = { writeJsonBackup, backupDatabase, pruneOldBackups };
