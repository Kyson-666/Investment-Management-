/** 后端 API 封装（fetch + JWT），401 自动跳登录 */
import { useAuthStore } from '../stores/auth';
import router from '../router';

const TOKEN_KEY = 'im_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, url, body) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('网络错误，无法连接服务器');
  }
  let json = null;
  try { json = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) {
    if (res.status === 401) {
      setToken('');
      const auth = useAuthStore();
      auth.token = '';
      auth.user = null;
      if (router.currentRoute.value.path !== '/login') {
        router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
      }
    }
    throw new Error(json?.error || `请求失败（${res.status}）`);
  }
  return json?.data !== undefined ? json.data : json;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b || {}),
  del: (u) => request('DELETE', u),
};

/* ---------- 鉴权 ---------- */
export const authApi = {
  login: (payload) => api.post('/api/auth/login', payload),
  register: (payload) => api.post('/api/auth/register', payload),
  sendCode: (email) => api.post('/api/auth/send-code', { email }),
  me: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
  putSettings: (patch) => api.put('/api/auth/settings', patch),
  changePassword: (oldPassword, newPassword) => api.put('/api/auth/password', { oldPassword, newPassword }),
};

/* ---------- 基础数据 ---------- */
export const accountsApi = {
  create: (b) => api.post('/api/accounts', b),
  update: (id, b) => api.put(`/api/accounts/${id}`, b),
  remove: (id) => api.del(`/api/accounts/${id}`),
};
export const assetsApi = {
  create: (b) => api.post('/api/assets', b),
  update: (id, b) => api.put(`/api/assets/${id}`, b),
  setAlerts: (id, alerts) => api.put(`/api/assets/${id}/alerts`, { alerts }),
  /* 期初建仓维护（v1.0.9）：转为买入会扣减账户现金，解决「入金未被建仓消耗」的假现金 */
  getOpening: (id) => api.get(`/api/assets/${id}/opening`),
  saveOpening: (id, b) => api.put(`/api/assets/${id}/opening`, b),
  clearOpening: (id) => api.del(`/api/assets/${id}/opening`),
  convertOpening: (id) => api.post(`/api/assets/${id}/opening/convert-to-buy`),
  remove: (id) => api.del(`/api/assets/${id}`),
};
export const eventsApi = {
  create: (b) => api.post('/api/events', b),
  update: (id, b) => api.put(`/api/events/${id}`, b),
  remove: (id) => api.del(`/api/events/${id}`),
};
export const fxApi = {
  list: () => api.get('/api/fx'),
  current: () => api.get('/api/fx/current'),
  addManual: (b) => api.post('/api/fx', b),
  sync: () => api.post('/api/fx/sync'),
  remove: (id) => api.del(`/api/fx/${id}`),
};
export const archiveApi = {
  list: () => api.get('/api/archive'),
  restore: (id) => api.post(`/api/archive/${id}/restore`),
  purge: (id) => api.del(`/api/archive/${id}`),
};
export const snapshotsApi = {
  save: (b) => api.post('/api/snapshots', b),
  derive: (month) => api.get(`/api/snapshots/derive?month=${encodeURIComponent(month)}`),
  /* 差异报告：全月份 saved vs 派生对账（仅派生完整月计算 diff） */
  report: () => api.get('/api/snapshots/report'),
  /* 批量回填历史缺失月末快照（不覆盖已有快照） */
  autofill: (b) => api.post('/api/snapshots/autofill', b || {}),
  remove: (month) => api.del(`/api/snapshots/${month}`),
};
export const benchmarksApi = {
  list: (code = 'CSI300') => api.get(`/api/benchmarks?code=${code}`),
  save: (b) => api.post('/api/benchmarks', b),
  remove: (id) => api.del(`/api/benchmarks/${id}`),
  /* 自动同步：补齐历史月末点位（仅管理员；只写已结束的月份，幂等不覆盖手工值） */
  sync: (b = {}) => api.post('/api/benchmarks/sync', b),
};
export const cashflowsApi = {
  create: (b) => api.post('/api/cashflows', b),
  remove: (id) => api.del(`/api/cashflows/${id}`),
};
export const dcaApi = {
  create: (b) => api.post('/api/dca-plans', b),
  update: (id, b) => api.put(`/api/dca-plans/${id}`, b),
  remove: (id) => api.del(`/api/dca-plans/${id}`),
  generate: (id) => api.post(`/api/dca-plans/${id}/generate`),
};
export const alertsApi = {
  list: () => api.get('/api/alerts'),
};
export const computeApi = {
  state: () => api.get('/api/state'),
  compute: (accountId = '') => api.get(`/api/compute${accountId ? `?accountId=${accountId}` : ''}`),
};
export const quotesApi = {
  /* 行情同步：按资产代码拉取最新单价（股票→现价，基金→净值），引擎重算盈亏/市值 */
  sync: () => api.post('/api/quotes/sync', {}),
};
export const dataApi = {
  exportUrl: '/api/export',
  import: (payload) => api.post('/api/import', payload),
  loadDemo: () => api.post('/api/demo'),
};
export const adminApi = {
  users: () => api.get('/api/admin/users'),
  setStatus: (id, status) => api.put(`/api/admin/users/${id}/status`, { status }),
  resetPassword: (id) => api.post(`/api/admin/users/${id}/reset-password`),
  getMail: () => api.get('/api/admin/mail'),
  putMail: (b) => api.put('/api/admin/mail', b),
  testMail: (to) => api.post('/api/admin/mail/test', { to }),
  stats: () => api.get('/api/admin/stats'),
};
export const notifyApi = {
  list: () => api.get('/api/notifications'),
  read: (id) => api.put(`/api/notifications/${id}/read`),
  readAll: () => api.post('/api/notifications/read-all'),
};
