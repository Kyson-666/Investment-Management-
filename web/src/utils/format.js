/** 格式化与文案工具（全站统一） */

export const TYPE_LABEL = { stock: '股票', fund: '基金', wealth: '理财', bond: '债券' };
export const TYPE_BADGE = { stock: 'badge-stock', fund: 'badge-fund', wealth: 'badge-wealth', bond: 'badge-bond' };
export const TYPE_COLORS = { stock: '#e0463e', fund: '#17a2b8', wealth: '#7c52b8', bond: '#e8a93b' };
export const MARKET_LABEL = { CN: 'A股', US: '美股' };
export const ACCOUNT_KIND_LABEL = { broker: '券商', bank: '银行', other: '其他' };

/** 货币中文名（库存币种 + 常见外币，未知则回显代码）—— 仅本文件内部使用（经 ccyName 对外） */
const CCY_LABEL = {
  CNY: '人民币', USD: '美元', HKD: '港币', JPY: '日元', EUR: '欧元',
  GBP: '英镑', AUD: '澳元', CAD: '加元', SGD: '新加坡元', KRW: '韩元', TWD: '新台币',
};
export const ccyName = code => CCY_LABEL[String(code || '').toUpperCase()] || String(code || '');
export const EVENT_LABEL = {
  buy: '买入', sell: '卖出', div: '分红', bonus: '送股', split: '拆分',
  invest: '申购/投入', redeem: '赎回', income: '收益',
};
export const FX_SOURCE_LABEL = { manual: '手动', auto: '自动', fallback: '默认' };

export function money(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 带符号金额，红涨绿跌 class 由 signClass 决定 */
export function signedMoney(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : '') + money(v, digits);
}

export function pct(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return (Number(n) * 100).toFixed(digits) + '%';
}

export function signedPct(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';
}

/** A股习惯：正=红(up)，负=绿(down) */
export function signClass(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'up' : 'down';
}

export function todayStr() {
  /* 本地日期：toISOString 在东八区 00:00–08:00 会退回前一天 */
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function currentMonth() {
  return todayStr().slice(0, 7);
}

