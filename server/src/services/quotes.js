'use strict';
/**
 * 行情同步服务：按「资产代码」拉取最新单价并回写，盈亏/市值由 calc 引擎实时重算。
 *
 * 覆盖范围：type='stock'（回写 price）与 type='fund'（回写 unit_price）；
 *   wealth / bond / 未填代码的资产不参与。只更新单价，**不动份额**。
 *
 * 数据源（主源失败或缺失标的时自动降级备用源）：
 *   股票  主源 腾讯 qt.gtimg.cn（免鉴权，A股/美股可一次批量）
 *         备源 新浪 hq.sinajs.cn（需 Referer；A股 sh/sz/bj、美股 gb_ 前缀）
 *   基金  主源 新浪 f_<code>（需 Referer，返回确认净值 + 净值日期）
 *         备源 东财 api.fund.eastmoney.com/f10/lsjz（需 Referer，逐个查询）
 *   ⚠️ 场外基金只有收盘后确认净值，无免费盘中估值源（fundgz 已下线）。
 *
 * 手动维护保护：用户在资产编辑里改过价格 → price_source='manual'；
 *   自动定时同步跳过这些资产（skippedManual），手动「同步行情」按钮强制刷新（force=true）。
 *
 * 解析说明：腾讯/新浪返回 GBK，但代码/价格字段均为 ASCII，按「代码键」匹配即可，
 *   无需解码中文名称（名称一律用本地资产名，避免编码坑）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const prices = require('./prices');
const { localDate } = require('../time');

/* ---------- 传输 ---------- */
async function httpGetText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ---------- 代码 → 符号 ---------- */
/** A股：6/9 开头沪市，0/3 开头深市，4/8（含 92）北交所；美股统一 us 前缀 */
function cnPrefix(code) {
  if (/^(6|9)/.test(code)) return 'sh';
  if (/^(0|3)/.test(code)) return 'sz';
  if (/^(4|8)/.test(code)) return 'bj';
  return '';
}
function stockKeys(a) {
  const code = String(a.code || '').trim().toUpperCase();
  if (a.market === 'CN') {
    const p = cnPrefix(code);
    return p ? { tencent: `${p}${code}`, sina: `${p}${code}` } : null;   // 前缀不识别 → 无法同步
  }
  return { tencent: `us${code}`, sina: `gb${code}` };
}

/* ---------- 解析（纯函数，便于单测） ---------- */
/** '20261009161459' / '2026-10-09 16:00:01' → 'YYYY-MM-DD'；异常返回 '' */
function normalizeDate(s) {
  const m = String(s || '').match(/(\d{4})(\d{2})(\d{2})/) || String(s || '').match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}-${m[3]}` : m[1];
}

/** 腾讯：`v_sh600519="1~贵州茅台~600519~1263.00~...";`（分号分隔多标的） */
function parseTencent(text) {
  const out = new Map();
  for (const seg of String(text || '').split(';')) {
    const kv = seg.split('=');
    if (kv.length < 2) continue;
    const f = (kv[1].match(/"([^"]*)"/) || [])[1];
    if (!f) continue;
    const cols = f.split('~');
    if (cols.length < 4) continue;
    const code = String(cols[2] || '').split('.')[0].trim().toUpperCase();   // 美股 'AAPL.OQ' → 'AAPL'
    const price = Number(cols[3]);
    if (!code || !(price > 0)) continue;
    out.set(code, { price, date: normalizeDate(cols[30]) });
  }
  return out;
}

/** 新浪股票：`var hq_str_sh600519="名称,今开,昨收,现价,...,日期,时间";` / 美股 gb_：第 1 列为最新价 */
function parseSinaStock(text) {
  const out = new Map();
  for (const m of String(text || '').matchAll(/hq_str_(sh|sz|bj)(\d{4,6})="([^"]*)"/g)) {
    const cols = m[3].split(',');
    const price = Number(cols[3]);
    if (price > 0) out.set(m[2], { price, date: normalizeDate(cols[30]) });
  }
  for (const m of String(text || '').matchAll(/hq_str_gb([A-Za-z.]+)="([^"]*)"/g)) {
    const cols = m[2].split(',');
    const price = Number(cols[1]);
    if (price > 0) out.set(m[1].split('.')[0].toUpperCase(), { price, date: '' });
  }
  return out;
}

/** 新浪基金：`var hq_str_f_018125="名称,单位净值,累计净值,昨净值,日期,...";` */
function parseSinaFund(text) {
  const out = new Map();
  for (const m of String(text || '').matchAll(/hq_str_f_(\d{6})="([^"]*)"/g)) {
    const cols = m[2].split(',');
    const nav = Number(cols[1]);
    if (nav > 0) out.set(m[1], { nav, date: normalizeDate(cols[4]) });
  }
  return out;
}

/** 东财历史净值 JSON（lsjz）：取第一行 = 最新一条 */
function parseEastmoneyLsjz(text) {
  try {
    const row = (JSON.parse(text).Data || {}).LSJZList?.[0];
    const nav = Number(row && row.DWJZ);
    if (!(nav > 0)) return null;
    return { nav, date: normalizeDate(row.FSRQ) };
  } catch { return null; }
}

/* ---------- 同步编排 ---------- */
/**
 * 同步某用户的行情。
 * @param {object} o
 * @param {boolean} [o.force=false]  true=手动同步（强制刷新含手动维护价）；false=自动定时（跳过 manual）
 * @param {string[]} [o.kinds]       参与的资产类型子集（['stock'] / ['fund'] / 缺省全部）
 * @param {Function}[o.fetchText]    传输注入点（单测替换）；默认真实 HTTP
 */
async function syncUserQuotes(db, userId, { force = false, kinds, fetchText = httpGetText } = {}) {
  const want = (k) => !kinds || kinds.includes(k);
  const rows = db.prepare('SELECT * FROM asset WHERE user_id=? ORDER BY id').all(userId)
    .filter(a => (a.type === 'stock' && want('stock') && String(a.code || '').trim())
               || (a.type === 'fund' && want('fund') && String(a.code || '').trim()));

  const result = { updated: [], unchanged: 0, skippedManual: 0, errors: [], source: { stocks: '', funds: '' } };
  if (!rows.length) return result;

  const upd = db.prepare('UPDATE asset SET price=?, unit_price=?, price_source=?, price_date=? WHERE id=?');
  const apply = (row, value, date, field) => {
    if (!force && row.price_source === 'manual') { result.skippedManual++; return; }
    const cur = field === 'price' ? row.price : row.unit_price;
    const sameValue = Math.abs(cur - value) < 1e-9;
    const sameDate = (row.price_date || '') === (date || '');
    if (sameValue && sameDate && !force) { result.unchanged++; return; }
    const isStock = row.type === 'stock';
    upd.run(isStock ? value : row.price, isStock ? row.unit_price : value, 'auto', date || null, row.id);
    /* 记录净值/价格历史：定投补投与历史估值按发生日取数 */
    prices.recordPrice(db, row.id, date || localDate(), value, 'auto');
    result.updated.push({ id: String(row.id), name: row.name, code: row.code, field,
      from: cur, to: value, date: date || '' });
  };

  /* ---- 股票：主源腾讯，缺失/失败 → 备源新浪 ---- */
  const stocks = rows.filter(a => a.type === 'stock');
  if (stocks.length) {
    const keys = new Map(stocks.map(a => [a.id, stockKeys(a)]).filter(([, k]) => k));
    /* 代码无法识别的资产单独报错，不能因为一个非法代码让整批同步抛异常 */
    const validStocks = stocks.filter(a => keys.get(a.id));
    stocks.filter(a => !keys.get(a.id)).forEach(a => {
      result.errors.push(err(a, '代码无法识别市场（仅支持 6/9/0/3/4/8 开头A股与美股代码）'));
    });
    if (validStocks.length) {
    const tencentQ = validStocks.map(a => keys.get(a.id).tencent).join(',');
    let quotes = new Map();
    let primaryOk = false;
    try {
      quotes = parseTencent(await fetchText(`https://qt.gtimg.cn/q=${tencentQ}`));
      primaryOk = true;
    } catch { /* 主源失败，整批走备源 */ }

    const missing = validStocks.filter(a => {
      const k = keys.get(a.id);
      return !quotes.get(extractCode(k.tencent, k.sina));
    });
    if (missing.length) {
      try {
        const sinaList = missing.map(a => (keys.get(a.id) || {}).sina).filter(Boolean).join(',');
        if (sinaList) {
          const m2 = parseSinaStock(await fetchText(`https://hq.sinajs.cn/list=${sinaList}`,
            { Referer: 'https://finance.sina.com.cn' }));
          let backupResolved = 0;
          for (const [k, v] of m2) {
            if (!quotes.has(k)) backupResolved++;
            quotes.set(k, v);
          }
          if (primaryOk) result.source.stocks = backupResolved ? 'tencent+sina' : 'tencent';
          else result.source.stocks = 'sina';
        }
      } catch { /* 备源也失败，下方按错误上报 */ }
    } else if (primaryOk) {
      result.source.stocks = 'tencent';
    }

    for (const a of validStocks) {
      const k = keys.get(a.id);
      const hit = quotes.get(extractCode(k.tencent, k.sina));
      if (!hit) { result.errors.push(err(a, primaryOk ? '接口未返回该代码的报价' : '主备源均未获取到报价')); continue; }
      apply(a, hit.price, hit.date, 'price');
    }
    }
  }

  /* ---- 基金：主源新浪 f_，缺失/失败 → 备源东财 lsjz ---- */
  const funds = rows.filter(a => a.type === 'fund');
  if (funds.length) {
    const codes = funds.map(a => String(a.code).trim());
    let quotes = new Map();
    let primaryOk = false;
    try {
      quotes = parseSinaFund(await fetchText(`https://hq.sinajs.cn/list=${codes.map(c => `f_${c}`).join(',')}`,
        { Referer: 'https://finance.sina.com.cn' }));
      primaryOk = true;
    } catch { /* 主源失败走备源 */ }

    let usedBackup = false;
    for (const a of funds) {
      const code = String(a.code).trim();
      if (quotes.has(code)) continue;
      try {
        const t = await fetchText(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`,
          { Referer: `https://fundf10.eastmoney.com/jjjz_${code}.html` });
        const hit = parseEastmoneyLsjz(t);
        if (hit) { quotes.set(code, hit); usedBackup = true; }
      } catch { /* 单个失败继续下一个 */ }
    }
    result.source.funds = primaryOk ? (usedBackup ? 'sina+eastmoney' : 'sina') : 'eastmoney';

    for (const a of funds) {
      const code = String(a.code).trim();
      const hit = quotes.get(code);
      if (!hit) { result.errors.push(err(a, primaryOk ? '接口未返回该代码的净值' : '主备源均未获取到净值')); continue; }
      apply(a, hit.nav, hit.date, 'unitPrice');
    }
  }

  return result;
}

/** 腾讯与新浪的代码键归一（腾讯美股会带 .OQ/.N 后缀，统一剥掉） */
function extractCode(tencentKey, sinaKey) {
  const m = tencentKey.match(/^(?:sh|sz|bj)?(?:us)?(.+)$/);
  return (m ? m[1] : tencentKey).split('.')[0].toUpperCase();
}
const err = (a, reason) => ({ id: String(a.id), name: a.name, code: String(a.code || '').trim(), reason });

/** 为全部活跃用户同步（定时任务用），返回聚合摘要 */
async function syncAllUsers(db, opts = {}) {
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  const summary = { users: 0, updated: 0, unchanged: 0, skippedManual: 0, errors: 0 };
  for (const u of users) {
    try {
      const r = await syncUserQuotes(db, u.id, opts);
      summary.users++;
      summary.updated += r.updated.length;
      summary.unchanged += r.unchanged;
      summary.skippedManual += r.skippedManual;
      summary.errors += r.errors.length;
    } catch { /* 单用户失败不影响其余用户 */ }
  }
  return summary;
}

module.exports = {
  syncUserQuotes, syncAllUsers,
  parseTencent, parseSinaStock, parseSinaFund, parseEastmoneyLsjz,
  stockKeys, normalizeDate,
};
