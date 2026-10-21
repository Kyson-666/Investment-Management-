/**
 * 主题色（JS 侧取值）
 *
 * ECharts 等需要具体色值，无法直接使用 CSS 变量；为避免色值与主题漂移，
 * 这里统一从 `:root` 的 CSS 变量读取（单一来源仍是 `styles/index.css`），
 * 读取失败（非浏览器环境 / 样式尚未注入）时退回兜底常量。
 */
function cssVar(name, fallback) {
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  }
  return fallback;
}

/** 上涨 / 盈利（A 股习惯：红） */
export const up = () => cssVar('--up', '#e0463e');
/** 下跌 / 亏损（绿） */
export const down = () => cssVar('--down', '#1c9c5a');
/** 主色（藏青） */
export const navy = () => cssVar('--navy', '#1f3a5f');
/** 主色·浅（藏青浅） */
export const navyLight = () => cssVar('--navy-light', '#2c507e');
/** Element Plus 主色（蓝，用于“正常/未超限”语义） */
export const primary = () => cssVar('--el-color-primary', '#2b6cb0');
/** 警示（橙黄） */
export const warn = () => cssVar('--warn', '#e8a93b');
/** 次要/弱化（灰） */
export const muted = () => cssVar('--muted', '#8a94a3');

/**
 * 图表调色板（前 3 色取自主题语义色，其余为图表专用的细分色）。
 * 统一在此维护，避免各页面各自硬编码导致色系漂移。
 */
export function palette() {
  return [navy(), primary(), cssVar('--accent', '#17a2b8'), '#3aa6a0', '#7c52b8',
    warn(), '#e08a3e', muted()];
}
