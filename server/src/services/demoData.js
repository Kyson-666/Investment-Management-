'use strict';
/**
 * 示例数据（与设计原型 seed 对齐，用于体验与交叉验证）。
 * 可通过「数据」页按钮或 scripts/seed-demo.js 装载；会先自动备份。
 *
 * ⚠️ 不得写入显式主键：account/asset/event 的 id 是全局自增的，
 *    第二个用户载入示例数据会与第一个用户冲突（UNIQUE constraint failed）。
 *    这里统一插入后取 lastInsertRowid，并用 Map 建立“示例编号 → 实际 id”的映射。
 */
const { now } = require('../db');

function loadDemoData(db, userId) {
  const ts = now();
  const insAccount = db.prepare(`INSERT INTO account (user_id,name,kind,currency,note,created_at)
    VALUES (?,?,?,?,?,?)`);
  const insAsset = db.prepare(`INSERT INTO asset
    (user_id,account_id,name,code,market,type,currency,price,market_value,unit_price,alerts_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insEvent = db.prepare(`INSERT INTO event
    (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSnap = db.prepare('INSERT OR REPLACE INTO snapshot (user_id,month,total) VALUES (?,?,?)');
  const insBench = db.prepare('INSERT OR REPLACE INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)');
  const insCash = db.prepare(`INSERT INTO cash_flow
    (user_id,account_id,date,kind,amount,fx,input_currency,input_amount,note)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insPlan = db.prepare(`INSERT INTO dca_plan
    (user_id,asset_id,start_month,months,day,amount,note,active,created_at)
    VALUES (?,?,?,?,?,?,?,1,?)`);
  const insFxAuto = db.prepare(`INSERT INTO fx_rate (date,rate,source,note) VALUES (?,?,?,?)
    ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`);

  const clearUser = () => {
    for (const t of ['event', 'asset', 'account', 'snapshot', 'benchmark', 'cash_flow', 'dca_plan', 'notification', 'deletion_archive']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(userId);
    }
  };

  const run = db.transaction(() => {
    clearUser();

    // 全局汇率（不存在才插，避免覆盖管理员数据）
    const fxCount = db.prepare("SELECT COUNT(*) n FROM fx_rate").get().n;
    if (!fxCount) {
      insFxAuto.run('2026-01-01', 7.10, 'manual', '初始汇率');
      insFxAuto.run('2026-06-01', 7.28, 'manual', '年中调整');
      insFxAuto.run('2026-09-21', 6.6954, 'auto', '自动同步');
    }

    // 账户（示例编号 → 实际 id）
    const acc = new Map();
    const A = (key, name, kind, currency, note) => {
      acc.set(key, insAccount.run(userId, name, kind, currency, note, ts).lastInsertRowid);
    };
    A(1, '华泰证券', 'broker', 'CNY', 'A股主账户');
    A(2, '招商银行', 'bank', 'CNY', '理财/债券');
    A(3, '富途证券', 'broker', 'USD', '美股账户');

    // 资产
    const ast = new Map();
    const S = (key, accKey, name, code, market, type, currency, price, marketValue, unitPrice, alerts) => {
      const id = insAsset.run(userId, acc.get(accKey), name, code, market, type, currency,
        price, marketValue, unitPrice, alerts ? JSON.stringify(alerts) : null, ts).lastInsertRowid;
      ast.set(key, id);
    };
    S(1, 1, '贵州茅台', '600519', 'CN', 'stock', 'CNY', 1330, 0, 0,
      { takeProfitPrice: 1450, stopLossPrice: 1100 });
    S(2, 2, '宁德时代', '300750', 'CN', 'stock', 'CNY', 210, 0, 0, null);
    // 购入时净值 1.00（份额=金额）；当前净值 = 市值 / 累计份额
    S(3, 3, '标普500 ETF', 'VOO', 'US', 'fund', 'USD', 0, 8600, 8600 / 8000, null);
    S(4, 2, '招银理财·稳健', '', '', 'wealth', 'CNY', 0, 51000, 51000 / 50000, null);
    S(5, 2, '国债2401', '', '', 'bond', 'CNY', 0, 20300, 20300 / 20000, null);

    // 事件
    const E = (assetKey, date, kind, side, v) => insEvent.run(userId, ast.get(assetKey), date, kind, side,
      v?.qty ?? null, v?.price ?? null, v?.amount ?? null, v?.ratio ?? null, v?.fee ?? 0,
      v?.fx ?? 1, v?.isT ?? 0, v?.note ?? '', ts);
    E(1, '2026-02-10', 'buy', 'buy', { qty: 100, price: 1500, fee: 15, note: '建仓' });
    E(1, '2026-03-12', 'buy', 'buy', { qty: 100, price: 1450, fee: 15, note: '补仓' });
    E(1, '2026-03-20', 'sell', 'sell', { qty: 100, price: 1560, fee: 17, isT: 1, note: 'T出' });
    E(1, '2026-06-30', 'div', 'div', { amount: 300, note: '现金分红' });
    E(1, '2026-07-10', 'bonus', 'bonus', { qty: 20, note: '10送2' });
    E(1, '2026-08-15', 'buy', 'buy', { qty: 100, price: 1400, fee: 15, note: '回调买入' });
    E(2, '2026-05-08', 'buy', 'buy', { qty: 200, price: 180, fee: 20, note: '买入' });
    // 非股票：申购/赎回带份额（净值 1.00），金额保持与原演示数据一致
    E(3, '2026-01-15', 'invest', null, { qty: 5000, price: 1, amount: 5000, fx: 7.10, note: '美股权重' });
    E(3, '2026-07-15', 'invest', null, { qty: 3000, price: 1, amount: 3000, fx: 7.28, note: '加仓' });
    E(3, '2026-08-01', 'income', null, { amount: 60, fx: 7.28, note: '分红' });
    E(4, '2026-01-20', 'invest', null, { qty: 50000, price: 1, amount: 50000, note: '' });
    E(4, '2026-06-20', 'income', null, { amount: 1200, note: '半年利息' });
    E(5, '2026-04-01', 'invest', null, { qty: 20000, price: 1, amount: 20000, note: '' });

    // 月末快照
    const snaps = [['2026-01', 86000], ['2026-02', 237000], ['2026-03', 236500], ['2026-04', 246000],
      ['2026-05', 289000], ['2026-06', 291500], ['2026-07', 314500], ['2026-08', 520000]];
    snaps.forEach(([m, t]) => insSnap.run(userId, m, t));

    // 基准点位（沪深300）
    const bench = [['2026-01', 3800], ['2026-02', 3920], ['2026-03', 3860], ['2026-04', 4010],
      ['2026-05', 4180], ['2026-06', 4090], ['2026-07', 4260], ['2026-08', 4430]];
    bench.forEach(([m, v]) => insBench.run(userId, 'CSI300', m, v));

    // 出入金（v5：现金口径要求入金足以覆盖买入/申购支出，故券商入金由 30 万调为 34 万，
    //          使账户现金为正值；不影响收益口径——追加本金会同等计入累计投入）
    const C = (accKey, date, kind, amount, fx, note, inputCurrency) =>
      insCash.run(userId, acc.get(accKey), date, kind, amount, fx, inputCurrency || null, amount, note);
    C(1, '2026-02-01', 'deposit', 340000, 1, '券商入金', 'CNY');
    C(2, '2026-01-15', 'deposit', 90000, 1, '银行入金', 'CNY');
    C(2, '2026-05-01', 'withdraw', 20000, 1, '取现', 'CNY');
    C(3, '2026-01-10', 'deposit', 8000, 7.10, '美元入金', 'USD');

    // 定投计划
    insPlan.run(userId, ast.get(3), '2026-09', 12, 15, 400, '标普500月定投', ts);
  });

  run();
  return { ok: true };
}

module.exports = { loadDemoData };
