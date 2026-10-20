'use strict';
/** 写操作审计：谁在何时对哪个实体做了什么（不记录请求体，避免敏感信息落库） */
const { now } = require('../db');

const ENTITY_LABEL = {
  accounts: 'account', assets: 'asset', events: 'event', cashflows: 'cashflow',
  'dca-plans': 'dca_plan', snapshots: 'snapshot', benchmarks: 'benchmark',
  fx: 'fx', auth: 'auth', admin: 'admin', import: 'import', demo: 'demo',
};

function actionOf(method) {
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return String(method || '').toLowerCase();
}

/** 从 /api/assets/12 解析 entity / entityId */
function parsePath(path) {
  const parts = String(path || '').split('?')[0].split('/').filter(Boolean);
  const i = parts[0] === 'api' ? 1 : 0;
  const seg = parts[i] || '';
  const entity = ENTITY_LABEL[seg] || seg || null;
  const idPart = parts[i + 1];
  const entityId = idPart && /^\d+$/.test(idPart) ? idPart : null;
  return { entity, entityId };
}

function log(db, { userId, action, entity, entityId, path, status, ip }) {
  db.prepare(`INSERT INTO audit_log (user_id,action,entity,entity_id,path,status,ip,created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId || null, action, entity || null, entityId || null,
      path || null, status || null, ip || null, now());
}

function list(db, limit = 200) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  return db.prepare(`SELECT a.*, u.username FROM audit_log a
                     LEFT JOIN user u ON u.id=a.user_id
                     ORDER BY a.id DESC LIMIT ?`).all(n);
}

module.exports = { log, list, actionOf, parsePath };
