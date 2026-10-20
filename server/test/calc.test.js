/**
 * 成本核算引擎测试（Node）
 * 运行：node server/calc.test.js
 */
const C = require('../src/calc.js');

let pass = 0, fail = 0;
function eq(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${name}: got=${(+got).toFixed(4)} want=${(+want).toFixed(4)}`);
  ok ? pass++ : fail++;
}

/* ---------- 场景 1：摊薄加权平均 + 做 T ---------- */
{
  const S = { settings: { costMethod: 'wavg' }, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: '贵州茅台', code: '600519', type: 'stock', currency: 'CNY', price: 1580 }],
    events: [
      { assetId: 'a1', date: '2026-02-10', kind: 'buy', side: 'buy', qty: 100, price: 1500, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-03-12', kind: 'buy', side: 'buy', qty: 100, price: 1450, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-03-20', kind: 'sell', side: 'sell', qty: 100, price: 1560, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-08-15', kind: 'buy', side: 'buy', qty: 100, price: 1400, fee: 0, fx: 1 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景1 摊薄+做T —');
  eq('持股数量', r.qty, 200, 1e-6);
  eq('摊薄成本(原币)', r.avgLocal, 287500 / 200, 0.01);   // 卖前均价1475 → 卖100 → 余147500 → +140000 = 287500/200 = 1437.5
  eq('卖出已实现', r.realCNY, (1560 - 1475) * 100, 0.01);  // 卖前均价=(1500+1450)/2=1475 → +8500
}

/* ---------- 场景 2：FIFO 与摊薄对比 ---------- */
{
  const base = { fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 20 }] };
  const evs = [
    { assetId: 'a1', date: '2026-01-01', kind: 'buy', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
    { assetId: 'a1', date: '2026-02-01', kind: 'buy', side: 'buy', qty: 100, price: 20, fee: 0, fx: 1 },
    { assetId: 'a1', date: '2026-03-01', kind: 'sell', side: 'sell', qty: 100, price: 30, fee: 0, fx: 1 }
  ];
  console.log('\n— 场景2 FIFO vs 摊薄 —');
  const w = C.calcAsset(base.assets[0], { ...base, events: evs, settings: { costMethod: 'wavg' } });
  const f = C.calcAsset(base.assets[0], { ...base, events: evs, settings: { costMethod: 'fifo' } });
  eq('摊薄·卖出已实现', w.realCNY, (30 - 15) * 100, 0.01);   // 卖前均价15 → +1500
  eq('FIFO·卖出已实现', f.realCNY, (30 - 10) * 100, 0.01);   // 卖最早批次成本10 → +2000
  eq('摊薄·剩余成本(原币)', w.costLocal, 15 * 100, 0.01);
  eq('FIFO·剩余成本(原币)', f.costLocal, 20 * 100, 0.01);    // 剩第二批 20*100
}

/* ---------- 场景 3：分红开关 ---------- */
{
  const mk = (reduce) => ({ fx: [], accounts: [{ id: 'acc1' }],
    settings: { costMethod: 'wavg', dividendReducesCost: reduce },
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 12 }],
    events: [
      { assetId: 'a1', date: '2026-01-01', kind: 'buy', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-01', kind: 'div', side: 'div', amount: 200, fx: 1 }
    ] });
  console.log('\n— 场景3 分红开关 —');
  const a = C.calcAsset(mk(false).assets[0], mk(false));
  const b = C.calcAsset(mk(true).assets[0], mk(true));
  eq('默认·已实现分红', a.divCNY, 200, 0.01);
  eq('默认·成本不变', a.costCNY, 1000, 0.01);
  eq('冲减·已实现分红=0', b.divCNY, 0, 0.01);
  eq('冲减·成本=800', b.costCNY, 800, 0.01);
}

/* ---------- 场景 4：送股 / 拆分 ---------- */
{
  const S = { fx: [], accounts: [{ id: 'acc1' }], settings: {},
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 5 }],
    events: [
      { assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-01', side: 'bonus', qty: 20, fx: 1 },
      { assetId: 'a1', date: '2026-03-01', side: 'split', ratio: 2, fx: 1 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景4 送股+拆分 —');
  eq('股数', r.qty, (100 + 20) * 2, 1e-6);
  eq('成本总额不变', r.costCNY, 1000, 0.01);
  eq('摊薄成本', r.avgCNY, 1000 / 240, 0.001);
}

/* ---------- 场景 5：双币种 + 汇率锁定 ---------- */
{
  const S = { fx: [{ date: '2026-01-01', rate: 7.10 }, { date: '2026-06-01', rate: 7.30 }],
    accounts: [{ id: 'acc1' }], settings: {},
    assets: [{ id: 'a1', accountId: 'acc1', name: 'VOO', code: 'VOO', type: 'stock', currency: 'USD', price: 100 }],
    events: [
      { assetId: 'a1', date: '2026-02-01', side: 'buy', qty: 10, price: 90, fee: 0, fx: 7.10 },
      { assetId: 'a1', date: '2026-07-01', side: 'buy', qty: 10, price: 95, fee: 0, fx: 7.30 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景5 双币汇率锁定 —');
  eq('成本(¥)·各笔用自身汇率', r.costCNY, 10 * 90 * 7.10 + 10 * 95 * 7.30, 0.01);
  eq('市值(¥)·用当前汇率7.30', r.mvCNY, 20 * 100 * 7.30, 0.01);
  eq('当前汇率', C.currentFx(S), 7.30, 1e-9);
}

/* ---------- 场景 6：多账户汇总 ---------- */
{
  const S = { fx: [], settings: {}, accounts: [{ id: 'A', name: '券商A' }, { id: 'B', name: '券商B' }],
    assets: [
      { id: 'a1', accountId: 'A', name: '茅台', code: '600519', market: 'CN', type: 'stock', currency: 'CNY', price: 1580 },
      { id: 'a2', accountId: 'B', name: '茅台', code: '600519', market: 'CN', type: 'stock', currency: 'CNY', price: 1580 }
    ],
    events: [
      { assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 1500, fee: 0, fx: 1 },
      { assetId: 'a2', date: '2026-01-01', side: 'buy', qty: 50, price: 1400, fee: 0, fx: 1 }
    ] };
  console.log('\n— 场景6 多账户 + 跨账户合并 —');
  const as = C.accountSummary(S);
  eq('账户A市值', as.byAccount[0].mv, 100 * 1580, 0.01);
  eq('账户B市值', as.byAccount[1].mv, 50 * 1580, 0.01);
  eq('汇总市值', as.total.mv, 150 * 1580, 0.01);
  const agg = C.securityAggregation(S);
  eq('合并后茅台股数', agg[0].qty, 150, 1e-6);
  eq('合并覆盖账户数', agg[0].accounts.length, 2, 1e-6);
}

/* ---------- 场景 7：月度/年度报表 ---------- */
{
  const S = { fx: [], settings: {}, accounts: [{ id: 'acc1' }], snapshots: [{ month: '2026-01', total: 10000 }, { month: '2026-02', total: 12000 }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 10 }],
    events: [
      { assetId: 'a1', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-05', side: 'sell', qty: 50, price: 12, fee: 0, fx: 1 }
    ] };
  console.log('\n— 场景7 报表 —');
  const mr = C.monthRows(S);
  const feb = mr.find(x => x.month === '2026-02');
  eq('2月已实现', feb.real, 100, 0.01);
  /* 规格 §7：含浮动 = 当月已实现 + (快照差 − 当月净投入)。
     快照为「持仓市值」，卖出/分红不改变它，故此处相加**不构成重复计算**。 */
  eq('2月纯浮动(快照差−净投入)', feb.pureFloat, 12000 - 10000 - (-600), 0.01); // 净投入=卖出+600
  eq('2月含浮动(已实现+纯浮动)', feb.floatTotal, 100 + (12000 - 10000 - (-600)), 0.01);
  const yr = C.yearRows(S);
  eq('年度已实现', yr[0].real, 100, 0.01);
}

console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);

/* =========================================================
 * v4 场景：绩效 / 配置 / 风控 / 税务 / 定投 / 预警 / 出入金
 * ========================================================= */
const near = (name, got, want, tol = 0.001) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${name}: got=${got == null ? 'null' : (+got).toFixed(6)} want=${(+want).toFixed(6)}`);
  ok ? pass++ : fail++;
};

/* ---------- 场景 8：XIRR 年化（已知答案校验） ---------- */
{
  console.log('\n— 场景8 XIRR —');
  // 投入1000，一年后收回1100 → 年化 10%
  const r = C.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  near('一年期 XIRR', r, 0.10, 0.002);
  // 两笔各投 1000（相隔一年），第二笔投入时价值 1100 → 期末 2310
  const r2 = C.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: -1000 }, { date: '2027-01-01', amount: 2310 }]);
  near('两笔定投 XIRR', r2, 0.10, 0.003);
  near('annualized 简单年化', C.annualized(0.21, 365 * 2), Math.sqrt(1.21) - 1, 0.002);
}

/* ---------- 场景 9：TWR 时间加权（经理有无择时不应影响） ---------- */
{
  console.log('\n— 场景9 TWR —');
  // 1月10000 → 2月12000（无净投入）→ 3月（净投入5000）18000 → 月收益 +20%, +16.67%
  // TWR = 1.2 * (18000/(12000+5000)) - 1 = 1.2*1.058823 - 1 = 0.270588
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'wealth', currency: 'CNY', marketValue: 18000 }],
    events: [{ assetId: 'a1', date: '2026-01-10', kind: 'invest', amount: 10000, fx: 1 },
             { assetId: 'a1', date: '2026-03-10', kind: 'invest', amount: 5000, fx: 1 }],
    snapshots: [{ month: '2026-01', total: 10000 }, { month: '2026-02', total: 12000 }, { month: '2026-03', total: 18000 }] };
  near('TWR 累计', C.twr(S), 1.2 * (18000 / 17000) - 1, 0.0005);
}

/* ---------- 场景 10：资产配置再平衡 ---------- */
{
  console.log('\n— 场景10 配置再平衡 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [
      { id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 100 },
      { id: 'a2', accountId: 'acc1', type: 'wealth', currency: 'CNY', marketValue: 20000 }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 800, price: 100, fee: 0, fx: 1 }] };
  // 股票80000 / 理财20000 → 总100000；目标 股60% 理15%（其他0）
  const al = C.allocation(S, { stock: 0.6, fund: 0, wealth: 0.15, bond: 0 });
  near('股票当前占比', al.rows.find(r => r.type === 'stock').curPct, 0.8, 1e-6);
  near('股票目标金额', al.rows.find(r => r.type === 'stock').tgtAmt, 60000, 0.01);
  near('股票应卖出额(-)', al.rows.find(r => r.type === 'stock').diff, -20000, 0.01);
  near('理财应买入额(+)', al.rows.find(r => r.type === 'wealth').diff, -5000, 0.01);
  near('偏离度(半总)', al.drift, (20000 + 5000 + 0 + 0) / 2, 0.01);
}

/* ---------- 场景 11：集中度风控 ---------- */
{
  console.log('\n— 场景11 集中度 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 100 }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 1000, price: 100, fee: 0, fx: 1 }] };
  const c = C.concentration(S, { warnSingle: 0.2 });
  near('单一持仓占比', c.top1, 1.0, 1e-6);
  console.log(`${c.alerts.length > 0 ? '✅' : '❌'} 触发集中度告警: ${c.alerts.join(' | ')}`);
  c.alerts.length > 0 ? pass++ : fail++;
}

/* ---------- 场景 12：税务估算 ---------- */
{
  console.log('\n— 场景12 税务 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [
      { id: 'cn', accountId: 'acc1', name: 'A股', type: 'stock', currency: 'CNY', market: 'CN', price: 10 },
      { id: 'us', accountId: 'acc1', name: '美股', type: 'stock', currency: 'USD', market: 'US', price: 10 }],
    events: [
      { assetId: 'cn', date: '2026-01-01', side: 'buy', qty: 1000, price: 10, fee: 0, fx: 1 },
      { assetId: 'cn', date: '2026-01-20', side: 'div', amount: 100, fx: 1 },   // 持股19天 → 20%
      { assetId: 'cn', date: '2026-06-01', side: 'div', amount: 100, fx: 1 },   // 持股151天 → 10%
      { assetId: 'us', date: '2026-01-01', side: 'buy', qty: 100, price: 10, fee: 0, fx: 7 },
      { assetId: 'us', date: '2026-02-01', side: 'div', amount: 10, fx: 7 },    // 美元分红 → 30%
      { assetId: 'us', date: '2026-03-01', side: 'sell', qty: 100, price: 15, fee: 0, fx: 7 }] };  // 资本利得 US
  const t = C.taxEstimate(S);
  near('A股短期分红税(20%)', t.dividends[0].tax, 20, 0.01);
  near('A股中期分红税(10%)', t.dividends[1].tax, 10, 0.01);
  near('美股分红税(30%)', t.dividends[2].tax, 10 * 7 * 0.3, 0.01);
  near('美股已实现利得(¥)', t.capGain.US.gain, (15 - 10) * 100 * 7, 0.01);
  near('分红税合计', t.divTax, 20 + 10 + 21, 0.01);
}

/* ---------- 场景 13：定投计划生成 ---------- */
{
  console.log('\n— 场景13 定投 —');
  const rows = C.dcaGenerate({ startMonth: '2026-01', months: 12, day: 10, amount: 1000, note: '月定投' });
  eq('生成期数', rows.length, 12, 0);
  console.log(`${rows[0].date === '2026-01-10' && rows[11].date === '2026-12-10' ? '✅' : '❌'} 日期序列: ${rows[0].date} … ${rows[11].date}`);
  rows[0].date === '2026-01-10' && rows[11].date === '2026-12-10' ? pass++ : fail++;
  near('每期金额', rows[5].amount, 1000, 0.01);
}

/* ---------- 场景 14：止盈止损预警 ---------- */
{
  console.log('\n— 场景14 预警 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', type: 'stock', currency: 'CNY', market: 'CN', price: 130,
      alerts: { takeProfitPrice: 120, stopLossPrice: 90 } }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 100, fee: 0, fx: 1 }] };
  const al = C.checkAlerts(S);
  console.log(`${al.length > 0 && al[0].level === '止盈' ? '✅' : '❌'} 预警: ${al.map(a => a.level + ' ' + a.msg).join(' | ')}`);
  al.length > 0 && al[0].level === '止盈' ? pass++ : fail++;
}

/* ---------- 场景 15：出入金（不计入收益） ---------- */
{
  console.log('\n— 场景15 出入金 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }], assets: [], events: [],
    cashFlows: [{ accountId: 'acc1', date: '2026-01-01', kind: 'deposit', amount: 50000, fx: 1 },
                { accountId: 'acc1', date: '2026-03-01', kind: 'withdraw', amount: 20000, fx: 1 }] };
  const cf = C.cashFlowSummary(S);
  near('累计入金', cf.deposit, 50000, 0.01);
  near('累计出金', cf.withdraw, 20000, 0.01);
  near('净入金', cf.net, 30000, 0.01);
}

/* ---------- 场景 16：组合 XIRR（多笔 + 期末市值） ---------- */
{
  console.log('\n— 场景16 组合XIRR —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 110 }],
    events: [{ assetId: 'a1', date: '2025-09-22', side: 'buy', qty: 100, price: 100, fee: 0, fx: 1 }] };
  const r = C.portfolioXirr(S);
  console.log(`${r != null && r > 0 ? '✅' : '❌'} 组合XIRR: ${r == null ? 'null' : (r * 100).toFixed(2) + '%'}`);
  (r != null && r > 0) ? pass++ : fail++;
}

/* =========================================================
 * v5 新增口径：期初建仓 / 全类型份额 / 账户现金 / 双口径
 * ========================================================= */
{
  console.log('\n— 场景17 期初建仓（opening）—');
  const S = {
    fx: [{ date: '2026-01-01', rate: 7.1, source: 'manual' }], settings: {},
    accounts: [{ id: 'acc1' }],
    assets: [{ id: 'f1', accountId: 'acc1', name: '期初基金', type: 'fund', currency: 'CNY', unitPrice: 1.2, marketValue: 0 }],
    events: [{ assetId: 'f1', date: '2025-06-01', kind: 'opening', qty: 10000, price: 1.0, fx: 1 }],
    cashFlows: [], snapshots: [],
  };
  const r = C.calcAsset(S.assets[0], S);
  eq('期初份额', r.qty, 10000, 0.001);
  eq('期初成本(¥)', r.costCNY, 10000, 0.01);
  eq('单位成本', r.avgCNY, 1, 0.001);
  eq('市值=份额×净值', r.mvCNY, 12000, 0.01);
  eq('累计收益(非全额虚增)', r.totalCNY, 2000, 0.01);
  eq('期初建仓不计入累计买入', r.buyAmtCNY, 0, 0.01);
  eq('期初建仓计入净投入', r.netInvestCNY, 10000, 0.01);
  console.log(`✅ 持有天数自期初建仓日算起: ${C.holdingDays(S)} 天`);
  (C.holdingDays(S) > 400) ? pass++ : fail++;

  console.log('\n— 场景18 非股票份额与成本单价 —');
  const S2 = {
    fx: [{ date: '2026-01-01', rate: 7.1, source: 'manual' }], settings: {},
    accounts: [{ id: 'acc1' }],
    assets: [{ id: 'f2', accountId: 'acc1', name: '基金', type: 'fund', currency: 'CNY', unitPrice: 1.1, marketValue: 0 }],
    events: [
      { assetId: 'f2', date: '2026-01-06', kind: 'invest', qty: 5000, price: 1.0, fee: 0, fx: 1 },
      { assetId: 'f2', date: '2026-02-10', kind: 'redeem', qty: 2000, price: 1.05, fee: 0, fx: 1 },
    ],
    cashFlows: [], snapshots: [],
  };
  const r2 = C.calcAsset(S2.assets[0], S2);
  eq('份额(5000−2000)', r2.qty, 3000, 0.001);
  eq('持仓成本(5000−2000)', r2.costCNY, 3000, 0.01);
  eq('单位成本', r2.avgCNY, 1, 0.001);
  eq('市值(3000×1.1)', r2.mvCNY, 3300, 0.01);
  eq('已实现(2100−2000)', r2.realCNY, 100, 0.01);
  eq('总收益(100+300)', r2.totalCNY, 400, 0.01);
  /* 赎回本金不得计入已实现 */
  const rm = C.realizedByMonth(S2);
  eq('月报已实现仅 100（赎回本金 2100 不计入）', rm['2026-02'], 100, 0.01);

  console.log('\n— 场景19 账户现金与双口径 —');
  const S3 = {
    fx: [{ date: '2026-01-01', rate: 7.1, source: 'manual' }], settings: {},
    accounts: [{ id: 'acc1' }],
    assets: [{ id: 's1', accountId: 'acc1', name: '股票', type: 'stock', currency: 'CNY', price: 12 }],
    events: [{ assetId: 's1', date: '2026-01-05', side: 'buy', qty: 1000, price: 10, fee: 0, fx: 1 }],
    cashFlows: [
      { accountId: 'acc1', date: '2026-01-01', kind: 'deposit', amount: 20000, fx: 1 },
      { accountId: 'acc1', date: '2026-03-01', kind: 'withdraw', amount: 5000, fx: 1 },
    ],
    snapshots: [],
  };
  const cf = C.accountCash(S3);
  eq('现金=入金−出金−买入', cf.cash, 20000 - 5000 - 10000, 0.01);
  eq('净入金', cf.netDeposit, 15000, 0.01);
  eq('有效净投入(无期初)', cf.effectiveInvest, 15000, 0.01);
  const s3 = C.summary(S3);
  eq('持仓市值', s3.mv, 12000, 0.01);
  eq('账户现金', s3.cash, 5000, 0.01);
  eq('累计收益 = 已实现 + 浮动', s3.profit, 17000 - 15000, 0.01);
  eq('有效净投入 = 净入金（无期初）', s3.invest, 15000, 0.01);
  eq('恒等式 profit = mv + cash − margin − invest', s3.profit, s3.mv + s3.cash - s3.marginTotal - s3.invest, 0.01);

  console.log('\n— 场景20 累计投入可增可减 —');
  const S4 = JSON.parse(JSON.stringify(S3));
  S4.cashFlows.push({ accountId: 'acc1', date: '2026-04-01', kind: 'withdraw', amount: 3000, fx: 1 });
  eq('再出金 3000 后累计投入下降', C.summary(S4).invest, 12000, 0.01);
  eq('再出金后现金', C.accountCash(S4).cash, 2000, 0.01);
  /* 清仓后持仓市值归零、现金留存 */
  const S5 = JSON.parse(JSON.stringify(S3));
  S5.events.push({ assetId: 's1', date: '2026-06-01', side: 'sell', qty: 1000, price: 12, fee: 0, fx: 1 });
  const s5 = C.summary(S5);
  eq('清仓后持仓市值', s5.mv, 0, 0.01);
  eq('清仓后现金(20000−5000−10000+12000)', s5.cash, 17000, 0.01);
  eq('清仓后持仓市值 = 0', s5.mv, 0, 0.01);
  eq('清仓后现金 = 17000', s5.cash, 17000, 0.01);
  eq('清仓后账户口径收益', s5.profit, 2000, 0.01);
  eq('清仓后恒等式仍成立', s5.profit, s5.mv + s5.cash - s5.marginTotal - s5.invest, 0.01);
}

/* =========================================================
 * 场景21 回归：XIRR 末值必须取「真实可变现总值」(mv + cash)
 * 曾误用「投入 + 收益」的合成口径，导致「仅期初建仓」场景严重失真
 * ========================================================= */
{
  console.log('\n— 场景21 XIRR 末值口径 —');
  const d365 = (() => { const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().slice(0, 10); })();
  const S = {
    fx: [{ date: '2024-01-01', rate: 7, source: 'manual' }], settings: {},
    accounts: [{ id: 'A' }],
    assets: [{ id: 'F1', accountId: 'A', name: '基金', type: 'fund', currency: 'CNY', unitPrice: 1.2 }],
    events: [{ assetId: 'F1', date: d365, kind: 'opening', qty: 10000, price: 1, amount: 10000, fx: 1 }],
    cashFlows: [], snapshots: [],
  };
  const x = C.portfolioXirr(S);
  eq('仅期初建仓 1 万→现值 1.2 万 XIRR ≈ +20%', x, 0.2, 0.005);
  const s = C.summary(S);
  /* v1.0.4 起取消「总资产」；持仓市值与现金各自独立展示 */
  eq('持仓市值 = 12000', s.mv, 12000, 0.01);
  eq('真实可变现 = 持仓市值 + 现金 = 12000', s.mv + s.cash, 12000, 0.01);
  const fl = C.portfolioFlows(S);
  const t0 = new Date(fl[0].date).getTime();
  const npv = fl.reduce((a, f) => a + f.amount / Math.pow(1 + x, (new Date(f.date).getTime() - t0) / 31536000000), 0);
  eq('XIRR 定义式 NPV≈0', npv, 0, 1);
  eq('末值类型为 realizable（非 totalAssets）', fl[fl.length - 1].kind === 'realizable' ? 1 : 0, 1, 0.01);
}

/* =========================================================
 * 场景22 手续费与融资（v7）
 * ========================================================= */
{
  console.log('\n— 场景22 手续费与融资 —');
  const mkS = (assets, events) => ({
    fx: [{ date: '2024-01-01', rate: 7, source: 'manual' }], settings: {},
    accounts: [{ id: 'A', kind: 'broker', currency: 'CNY' }],
    assets, events, cashFlows: [], snapshots: [],
  });
  const A1 = { id: 'S1', accountId: 'A', name: 'A', type: 'stock', currency: 'CNY', price: 2.5 / 3 * 10 };
  /* 需求6：买 2 万本金 + 1 万融资 = 3 万成本，现值 2.5 万 → 实际亏损 5 千 */
  const S = mkS([A1], [{ assetId: 'S1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 3000, price: 10, fee: 0, fx: 1, marginCNY: 10000 }]);
  const r = C.calcAsset(A1, S);
  eq('持仓成本 30000（含融资）', r.costCNY, 30000, 0.01);
  eq('融资余额 10000', r.marginCNY, 10000, 0.01);
  eq('实际净值 = 市值 − 融资 = 15000', r.netValueCNY, 15000, 0.01);
  eq('自付本金 = 成本 − 融资 = 20000', r.selfCostCNY, 20000, 0.01);
  eq('实际收益 = 实际净值 − 自付本金 = −5000', r.netValueCNY - r.selfCostCNY, -5000, 0.01);
  eq('引擎总收益同为 −5000', r.totalCNY, -5000, 0.01);
  /* 需求5：卖出所得优先还融资（还清为止，不多还） */
  const S2 = mkS([A1], [
    { assetId: 'S1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 3000, price: 10, fee: 0, fx: 1, marginCNY: 10000 },
    { assetId: 'S1', date: '2024-06-01', kind: 'sell', side: 'sell', qty: 1000, price: 12, fee: 0, fx: 1 }]);
  const r2 = C.calcAsset(A1, S2);
  eq('卖出 12000 全部用于还款（上限为欠款）', r2.marginRepaidCNY, 10000, 0.01);
  eq('剩余融资 0', r2.marginCNY, 0, 0.01);
  /* 需求1：手续费全类型累计（含 USD 按汇率折算） */
  const F1 = { id: 'F1', accountId: 'A', name: '基金', type: 'fund', currency: 'CNY', unitPrice: 1 };
  const U1 = { id: 'U1', accountId: 'A', name: '美股', type: 'stock', currency: 'USD', price: 12 };
  const S3 = mkS([A1, F1, U1], [
    { assetId: 'S1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 1000, price: 10, fee: 15, fx: 1 },
    { assetId: 'S1', date: '2024-02-01', kind: 'sell', side: 'sell', qty: 500, price: 12, fee: 17, fx: 1 },
    { assetId: 'S1', date: '2024-03-01', kind: 'div', side: 'div', amount: 300, fee: 3, fx: 1 },
    { assetId: 'F1', date: '2024-01-01', kind: 'invest', side: null, qty: 1000, price: 1, fee: 8, fx: 1 },
    { assetId: 'F1', date: '2024-04-01', kind: 'redeem', side: null, qty: 200, price: 1.1, fee: 2, fx: 1 },
    { assetId: 'U1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 100, price: 10, fee: 5, fx: 7 }]);
  const s3 = C.summary(S3);
  eq('股票手续费 15+17+3=35', C.calcAsset(A1, S3).feeTotalCNY, 35, 0.01);
  eq('基金手续费 8+2=10', C.calcAsset(F1, S3).feeTotalCNY, 10, 0.01);
  eq('USD 资产手续费 5×7=35', C.calcAsset(U1, S3).feeTotalCNY, 35, 0.01);
  eq('全局总手续费 80', s3.feeTotal, 80, 0.01);
  /* 需求7：利息为负（融资利息）计入收益 */
  const S4 = mkS([F1], [
    { assetId: 'F1', date: '2024-01-01', kind: 'invest', side: null, qty: 10000, price: 1, fee: 0, fx: 1 },
    { assetId: 'F1', date: '2024-06-01', kind: 'income', side: null, amount: -500, fee: 0, fx: 1 }]);
  eq('负数利息计入成本收益（−500）', C.calcAsset(F1, S4).totalCNY, -500, 0.01);
}

/* =========================================================
 * 场景23 融资口径不变量：融资不得进入收益与累计投入
 * ========================================================= */
{
  console.log('\n— 场景23 融资口径不变量 —');
  const mk = (assets, events, cfs) => ({
    fx: [{ date: '2024-01-01', rate: 7, source: 'manual' }], settings: {},
    accounts: [{ id: 'A', kind: 'broker', currency: 'CNY' }],
    assets, events, cashFlows: cfs || [], snapshots: [],
  });
  const A = { id: 'S1', accountId: 'A', name: '标的', type: 'stock', currency: 'CNY', price: 2.5 / 3 * 10 };
  /* 买 3 万（其中融资 1 万）→ 自付 2 万；现值 2.5 万 */
  const S = mk([A], [{ assetId: 'S1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 3000, price: 10, fee: 0, fx: 1, marginCNY: 10000 }],
    [{ accountId: 'A', date: '2024-01-01', kind: 'deposit', amount: 20000, fx: 1 }]);
  const s = C.summary(S), r = C.calcAsset(A, S);
  eq('融资余额 10000', r.marginCNY, 10000, 0.01);
  eq('实际净值 = 市值 − 融资 = 15000', r.netValueCNY, 15000, 0.01);
  eq('自付本金 = 成本 − 融资 = 20000', r.selfCostCNY, 20000, 0.01);
  eq('收益 = 实际净值 − 自付本金 = −5000（融资不计入收益）', r.netValueCNY - r.selfCostCNY, -5000, 0.01);
  eq('引擎收益同为 −5000', r.totalCNY, -5000, 0.01);
  eq('持仓市值 = 25000', s.mv, 25000, 0.01);
  eq('账户现金（自付已由入金覆盖）', s.cash, 0, 0.01);
  eq('全局融资合计 10000', s.marginTotal, 10000, 0.01);
  /* 融资额变化不应凭空改变收益，只改变净值与自付 */
  const A2 = { id: 'S1', accountId: 'A', name: '标的', type: 'stock', currency: 'CNY', price: 2.5 / 3 * 10 };
  const S2 = mk([A2], [{ assetId: 'S1', date: '2024-01-01', kind: 'buy', side: 'buy', qty: 3000, price: 10, fee: 0, fx: 1, marginCNY: 20000 }],
    [{ accountId: 'A', date: '2024-01-01', kind: 'deposit', amount: 10000, fx: 1 }]);
  const s2 = C.summary(S2), r2 = C.calcAsset(A2, S2);
  eq('融资 2 万时余额 20000', r2.marginCNY, 20000, 0.01);
  eq('融资 2 万时收益仍为 −5000（成本口径不变）', r2.totalCNY, -5000, 0.01);
  eq('融资 2 万时持仓市值仍为 25000', s2.mv, 25000, 0.01);
}

/* =========================================================
 * 场景24 清仓后不得残留市值
 * 历史缺陷：非股票资产在份额为 0 时回退取 asset.market_value（创建时的旧值），
 * 导致已清仓仓位残留旧市值（实测残留 ¥0.01，并虚增浮动盈亏与总收益）。
 * ========================================================= */
{
  console.log('\n— 场景24 清仓残留 —');
  const mk = (events, over) => ({
    fx: [{ date: '2024-01-01', rate: 1, source: 'manual' }], settings: {},
    accounts: [{ id: 'A', kind: 'other', currency: 'CNY' }],
    assets: [Object.assign({ id: 'F1', accountId: 'A', name: '基金', type: 'fund', currency: 'CNY' }, over || {})],
    events, cashFlows: [], snapshots: [],
  });
  const OPEN = { assetId: 'F1', date: '2024-01-01', kind: 'opening', qty: 0.1, price: 7946.7, amount: 794.67, fee: 0, fx: 1 };
  const REDEEM = { assetId: 'F1', date: '2026-01-01', kind: 'redeem', qty: 0.1, price: 0.1, fee: 0, fx: 1 };
  const r1 = C.calcAsset(mk([OPEN, REDEEM], { unitPrice: 0.1, marketValue: 0.01 }).assets[0], mk([OPEN, REDEEM], { unitPrice: 0.1, marketValue: 0.01 }));
  eq('清仓后份额 = 0', r1.qty, 0, 0.000001);
  eq('清仓后市值 = 0（修复前残留 0.01）', r1.mvCNY, 0, 0.001);
  eq('清仓后浮动盈亏 = 0', r1.unrealCNY, 0, 0.001);
  /* 回归：从未按份额记账的历史资产仍应回退 market_value */
  const S2 = mk([], { unitPrice: 0, marketValue: 3000 });
  eq('金额口径历史资产仍取 marketValue', C.calcAsset(S2.assets[0], S2).mvCNY, 3000, 0.01);
  /* 回归：正常持仓不受影响 */
  const S3 = mk([{ assetId: 'F1', date: '2024-01-01', kind: 'invest', qty: 1000, price: 1, amount: 1000, fee: 0, fx: 1 }], { unitPrice: 1.2, marketValue: 0 });
  eq('正常持仓市值 = 1000 × 1.2', C.calcAsset(S3.assets[0], S3).mvCNY, 1200, 0.01);
}

console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
