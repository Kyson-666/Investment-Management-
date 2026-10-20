'use strict';
/**
 * 审计修复回归（纯引擎 / 服务层）。
 * 运行：node --test test/regression.test.js
 * 目标：把审计报告中的 P0/P1 结论固化为可执行断言。
 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/calc.js');
const { localDate } = require('../src/time');

const base = (over = {}) => Object.assign({
  settings: { costMethod: 'wavg', dividendReducesCost: false },
  fx: [], accounts: [{ id: 'A', currency: 'CNY', kind: 'broker' }],
  assets: [], events: [], cashFlows: [], snapshots: [],
}, over);

test('P0-1 融资不虚增 XIRR：入金100 + 融资100 + 价格不变 → 0%', () => {
  const S = base({
    assets: [{ id: 'S', accountId: 'A', name: '杠杆股', type: 'stock', currency: 'CNY', price: 10 }],
    cashFlows: [{ accountId: 'A', date: '2026-01-05', kind: 'deposit', amount: 100, fx: 1 }],
    events: [{ assetId: 'S', date: '2026-01-05', side: 'buy', qty: 20, price: 10, marginCNY: 100, fx: 1 }],
  });
  const x = C.portfolioXirr(S, { asOf: '2026-12-31' });
  assert.ok(Math.abs(x) < 1e-4, `XIRR 应≈0，实得 ${x}`);
  assert.equal(C.summary(S).profit, 0);
});

test('P0-2 未来事件不计入当前持仓；asOf 之后才计入', () => {
  const S = base({
    assets: [{ id: 'F', accountId: 'A', name: '基金', type: 'fund', currency: 'CNY', unitPrice: 2 }],
    events: [
      { assetId: 'F', date: '2026-01-05', kind: 'invest', qty: 100, price: 1, amount: 100, fx: 1 },
      { assetId: 'F', date: '2027-06-05', kind: 'invest', qty: 100, price: 1, amount: 100, fx: 1 },
    ],
  });
  assert.equal(C.calcAsset(S.assets[0], S).qty, 100);
  assert.equal(C.calcAsset(S.assets[0], S, { asOf: '2027-12-31' }).qty, 200);
});

test('P0-3 超卖被钳制，不产生负份额/负市值', () => {
  const S = base({
    assets: [{ id: 'S', accountId: 'A', name: '股票', type: 'stock', currency: 'CNY', price: 10 }],
    events: [
      { assetId: 'S', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fx: 1 },
      { assetId: 'S', date: '2026-02-05', side: 'sell', qty: 200, price: 12, fx: 1 },
    ],
  });
  const r = C.calcAsset(S.assets[0], S);
  assert.equal(r.qty, 0);
  assert.equal(r.mvCNY, 0);
  assert.equal(r.oversold, true);
});

test('P0-4 快照断档：区间申购不得被算成浮动收益', () => {
  const S = base({
    assets: [{ id: 'F', accountId: 'A', name: '基金', type: 'fund', currency: 'CNY', unitPrice: 1 }],
    events: [
      { assetId: 'F', date: '2026-01-05', kind: 'invest', qty: 1000, price: 1, amount: 1000, fx: 1 },
      { assetId: 'F', date: '2026-02-15', kind: 'invest', qty: 1000, price: 1, amount: 1000, fx: 1 },
    ],
    snapshots: [{ month: '2026-01', total: 1000 }, { month: '2026-03', total: 2000 }],
  });
  const mar = C.monthRows(S).find(x => x.month === '2026-03');
  assert.equal(mar.flow, 1000);
  assert.equal(mar.pureFloat, 0);
  assert.equal(mar.floatTotal, 0);
});

test('P1-1 期初建仓计入累计投入：1000→1200 收益率为 20%', () => {
  const S = base({
    assets: [{ id: 'S', accountId: 'A', name: '股票', type: 'stock', currency: 'CNY', price: 12 }],
    events: [{ assetId: 'S', date: '2025-01-05', side: 'opening', qty: 100, price: 10, fx: 1 }],
  });
  const s = C.summary(S);
  assert.equal(s.invest, 1000);
  assert.equal(s.profit, 200);
  assert.ok(Math.abs(s.rate - 0.2) < 1e-9, `rate 应 20%，实得 ${s.rate}`);
});

test('P1-2 资产级“已实现”与组合级同义（含分红/利息）', () => {
  const S = base({
    assets: [{ id: 'S', accountId: 'A', name: '股票', type: 'stock', currency: 'CNY', price: 10 }],
    events: [
      { assetId: 'S', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fx: 1 },
      { assetId: 'S', date: '2026-06-05', side: 'div', amount: 500, fx: 1 },
    ],
  });
  const r = C.calcAsset(S.assets[0], S);
  assert.equal(r.realCNY, 0);
  assert.equal(r.realTotalCNY, 500);
  assert.equal(C.summary(S).real, 500);
});

test('P1-3 清仓后收益率返回 null，而不是 0', () => {
  const S = base({
    assets: [{ id: 'W', accountId: 'A', name: '理财', type: 'wealth', currency: 'CNY', unitPrice: 1 }],
    events: [
      { assetId: 'W', date: '2026-01-05', kind: 'invest', qty: 5000, price: 1, amount: 5000, fx: 1 },
      { assetId: 'W', date: '2026-06-05', kind: 'redeem', qty: 5000, price: 1.1, amount: 5500, fx: 1 },
    ],
  });
  assert.equal(C.calcAsset(S.assets[0], S).rate, null);
});

test('P1-4 costBasisAt 继承 FIFO 与分红冲减口径', () => {
  const fifo = base({
    settings: { costMethod: 'fifo' },
    assets: [{ id: 'S', accountId: 'A', name: '股票', type: 'stock', currency: 'CNY', price: 30 }],
    events: [
      { assetId: 'S', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fx: 1 },
      { assetId: 'S', date: '2026-02-05', side: 'buy', qty: 100, price: 20, fx: 1 },
      { assetId: 'S', date: '2026-03-05', side: 'sell', qty: 100, price: 30, fx: 1 },
    ],
  });
  assert.equal(C.costBasisAt(fifo, '2026-12-31'), 2000);
  assert.equal(C.calcAsset(fifo.assets[0], fifo).costCNY, 2000);
});

test('P1-5 分红税按批次份额分摊：长持 10% + 短持 20% = 30', () => {
  const S = base({
    assets: [{ id: 'S', accountId: 'A', name: 'A股', type: 'stock', currency: 'CNY', market: 'CN', price: 10 }],
    events: [
      { assetId: 'S', date: '2026-01-01', side: 'buy', qty: 100, price: 10, fx: 1 },
      { assetId: 'S', date: '2026-06-01', side: 'buy', qty: 100, price: 10, fx: 1 },
      { assetId: 'S', date: '2026-06-15', side: 'div', amount: 200, fx: 1 },
    ],
  });
  const t = C.taxEstimate(S);
  assert.equal(t.divTax, 30); // 100×10% + 100×20%
});

test('P1-6 清仓资产不触发止盈止损', () => {
  const S = base({
    assets: [{ id: 'W', accountId: 'A', name: '理财', type: 'wealth', currency: 'CNY', unitPrice: 1,
      alerts: { stopLossPrice: 100, stopLossRate: 0.1 } }],
    events: [
      { assetId: 'W', date: '2026-01-05', kind: 'invest', qty: 5000, price: 1, amount: 5000, fx: 1 },
      { assetId: 'W', date: '2026-02-05', kind: 'redeem', qty: 5000, price: 1, amount: 5000, fx: 1 },
    ],
  });
  assert.deepEqual(C.checkAlerts(S), []);
});

test('恒等式：profit = mv + cash − margin − invest（融资/分红/手续费/汇率）', () => {
  const cases = [
    base({
      assets: [{ id: 'S', accountId: 'A', name: 'A', type: 'stock', currency: 'CNY', price: 12 }],
      events: [
        { assetId: 'S', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fee: 5, fx: 1 },
        { assetId: 'S', date: '2026-06-05', side: 'div', amount: 50, fx: 1 },
        { assetId: 'S', date: '2026-09-05', side: 'sell', qty: 40, price: 11, fee: 3, fx: 1 },
      ],
      cashFlows: [{ accountId: 'A', date: '2026-01-05', kind: 'deposit', amount: 1000, fx: 1 }],
    }),
    base({
      assets: [{ id: 'S', accountId: 'A', name: 'B', type: 'stock', currency: 'CNY', price: 10 }],
      events: [{ assetId: 'S', date: '2026-01-05', side: 'buy', qty: 200, price: 10, marginCNY: 100, fx: 1 }],
      cashFlows: [{ accountId: 'A', date: '2026-01-05', kind: 'deposit', amount: 100, fx: 1 }],
    }),
    base({
      assets: [{ id: 'S', accountId: 'A', name: 'C', type: 'stock', currency: 'CNY', price: 12 }],
      events: [{ assetId: 'S', date: '2026-01-05', side: 'opening', qty: 100, price: 10, fx: 1 }],
    }),
    base({
      fx: [{ date: '2026-01-01', rate: 7 }, { date: '2026-06-01', rate: 7.3 }],
      assets: [{ id: 'S', accountId: 'A', name: 'D', type: 'stock', currency: 'USD', price: 12 }],
      events: [{ assetId: 'S', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fx: 7 }],
      cashFlows: [{ accountId: 'A', date: '2026-01-05', kind: 'deposit', amount: 1000, fx: 1 }],
    }),
  ];
  for (const S of cases) {
    const s = C.summary(S);
    assert.ok(Math.abs(s.identityDiff) < 0.01, `恒等式偏差 ${s.identityDiff}`);
  }
});

test('P1-8 非法股票代码不会让整批行情同步抛异常', async () => {
  const Q = require('../src/services/quotes.js');
  const rows = [
    { id: 1, type: 'stock', market: 'CN', code: 'ABC', name: '非法代码', price: 10, unit_price: 0, price_source: null, price_date: null },
    { id: 2, type: 'stock', market: 'CN', code: '600519', name: '茅台', price: 10, unit_price: 0, price_source: null, price_date: null },
  ];
  const db = { prepare: () => ({ all: () => rows, run: () => {} }) };
  const r = await Q.syncUserQuotes(db, 1, {
    force: true,
    fetchText: async () => 'v_sh600519="1~贵州茅台~600519~1263.00";',
  });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'ABC');
  assert.equal(r.updated.length, 1);
});

test('P1-7 定投到期判断：未开始/已结束/非扣款日都不生成', () => {
  const { planDue } = require('../src/services/scheduler');
  const plan = { day: 15, start_month: '2026-01', months: 3 };
  assert.equal(planDue(plan, { y: 2026, m: 1, day: 15 }), true);
  assert.equal(planDue(plan, { y: 2026, m: 3, day: 15 }), true);   // 第 3 期
  assert.equal(planDue(plan, { y: 2026, m: 4, day: 15 }), false);  // 已结束
  assert.equal(planDue(plan, { y: 2025, m: 12, day: 15 }), false);// 未开始
  assert.equal(planDue(plan, { y: 2026, m: 2, day: 14 }), false); // 非扣款日
});

test('时区：本地 00:30 的日期不回退到前一天', () => {
  const d = new Date(2026, 9, 20, 0, 30, 0); // 2026-10-20 00:30 本地
  assert.equal(localDate(d), '2026-10-20');
});

test('P1-9 现金账本：内部划转与现金校准不改变投入，且恒等式成立', () => {
  const S = base({
    accounts: [
      { id: 'A', currency: 'CNY', kind: 'bank' },
      { id: 'B', currency: 'USD', kind: 'bank' },
    ],
    cashFlows: [
      { accountId: 'A', date: '2026-01-05', kind: 'deposit', amount: 1000, fx: 1 },
      { accountId: 'A', toAccountId: 'B', date: '2026-02-05', kind: 'transfer',
        amount: 700, fx: 1, toAmount: 100, toCurrency: 'USD', toFx: 7 },
      { accountId: 'A', date: '2026-03-05', kind: 'adjust', amount: 50, fx: 1 },
    ],
  });
  const cf = C.accountCash(S);
  assert.equal(cf.cash, 1050);                 // 1000 − 700 + 700 + 50
  assert.equal(cf.netDeposit, 1000);           // 划转/校准不计入净入金
  assert.equal(cf.effectiveInvest, 1000);
  assert.equal(cf.adjustCNY, 50);
  assert.equal(cf.cashByCcy.CNY, 350);
  assert.equal(cf.cashByCcy.USD, 100);

  const a = C.accountCash(S, { accountId: 'A' });
  const b = C.accountCash(S, { accountId: 'B' });
  assert.equal(a.cash, 350);                   // 1000 − 700 + 50
  assert.equal(b.cash, 700);                   // 100 USD × 7

  const s = C.summary(S);
  assert.equal(s.real, 50);                    // 现金校准计入其他损益
  assert.equal(s.profit, 50);
  assert.equal(s.identityDiff, 0);
});
