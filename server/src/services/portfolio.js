'use strict';
/**
 * 组合计算服务：把 calc 引擎的纯函数能力组装成接口需要的派生数据。
 * 所有结果实时计算、不入库，保证口径可切换、数据可追溯。
 */
const Calc = require('../calc');
const { buildState } = require('../state');
const cache = require('./cache');

function round2(n) { return Math.round((+n || 0) * 100) / 100; }

/** 账户维度过滤（供不支持 opts 的引擎函数使用） */
function scope(S, accountId) {
  if (!accountId) return S;
  const id = String(accountId);
  return {
    ...S,
    accounts: S.accounts.filter(a => a.id === id),
    assets: S.assets.filter(a => a.accountId === id),
    cashFlows: S.cashFlows.filter(c => c.accountId === id),
  };
}


/**
 * 一次性返回前端所需的派生数据。
 * @param {number} userId
 * @param {string} [accountId]
 * @param {object} [options] {sections?: string[]} 只计算指定域；缺省=全量。
 *   可用域：kpis / performance / benchmark / allocation / concentration /
 *           alerts / tax / reports / accounts / aggregation
 */
function computeAll(userId, accountId, options) {
  const sections = options && Array.isArray(options.sections) ? new Set(options.sections) : null;
  const want = k => !sections || sections.has(k);
  /* 结果缓存：同一数据版本 + 相同参数直接复用（路由层只读，不修改返回对象） */
  const cacheKey = `C|${cache.vOf(userId)}|${userId}|${accountId || ''}|`
    + `${(options && options.asOf) || ''}|${sections ? [...sections].sort().join(',') : 'ALL'}`;
  const cached = cache.getCache(cacheKey);
  if (cached) return cached;

  const S = buildState(userId);
  const settings = S.fullSettings;
  const id = accountId ? String(accountId) : null;
  const opts = {};
  if (id) opts.accountId = id;
  if (options && options.asOf) opts.asOf = String(options.asOf).slice(0, 10);
  const S2 = scope(S, id);

  /* summary / cash / days 是多数模块的公共输入，始终计算 */
  const s = Calc.summary(S, opts);
  const cash = Calc.accountCash(S, opts);
  const days = Calc.holdingDays(S, opts);

  const needPerf = want('performance') || want('kpis');
  const xirr = needPerf ? Calc.portfolioXirr(S, opts) : null;
  const twr = needPerf ? Calc.twr(S, opts) : null;
  const simpleAnn = needPerf ? Calc.annualized(s.rate, days) : null;
  const bm = (want('benchmark') || want('performance') || want('kpis'))
    ? Calc.benchmark(S, S.benchSeries, opts) : null;
  const alloc = want('allocation') ? Calc.allocation(S, settings.allocTargets, opts) : null;
  const concentration = (want('concentration') || want('alerts') || want('kpis'))
    ? Calc.concentration(S, { ...opts, warnSingle: settings.warnSingle, warnTop5: settings.warnTop5 })
    : null;
  const alerts = (want('alerts') || want('kpis')) ? Calc.checkAlerts(S2, opts) : [];
  const tax = want('tax') ? Calc.taxEstimate(S, settings.taxRules, opts) : null;
  const months = (want('reports') || want('kpis')) ? Calc.monthRows(S, opts) : [];
  const years = (want('reports') || want('kpis')) ? Calc.yearRows(S, opts) : [];
  const accounts = want('accounts') ? Calc.accountSummary(S2, opts) : null;
  const aggregation = want('aggregation') ? Calc.securityAggregation(S2, opts) : [];

  // 税务：按市场按年度的资本利得明细
  const gainsByYear = want('tax') ? Calc.realizedGainsByYear(S, opts) : null;
  const capGainRows = gainsByYear
    ? ['CN', 'US'].flatMap(mk => Object.keys(gainsByYear[mk]).sort().map(y => {
      const gain = gainsByYear[mk][y];
      const rate = mk === 'US' ? settings.taxRules.usCapGain : settings.taxRules.cnCapGain;
      return { market: mk, year: y, gain, tax: round2(Math.max(0, gain) * rate) };
    }))
    : [];

  /* ---------- 本年收益（1/1 ~ 12/31）----------
   * 实际实现（与下方代码一致，别再按“净资产法”理解）：
   *   本年已实现 = 当年 已实现 + 分红 + 利息（按月汇总）
   *   年初浮动   = 上年 12/31 的（持仓市值 − 剩余持仓成本）；无快照/无成本时按 0
   *   本年浮动   = 累计浮动 − 年初浮动
   *   本年收益   = 本年已实现 + 本年浮动
   *   年投入本金 = 上年 12/31 的（持仓市值 − 融资）；缺失时退化为「本年净入金」
   *   年收益率   = 本年收益 ÷ 年投入本金
   * 依赖：monthRows 的已实现、costBasisAt 的期初成本（已支持 FIFO/分红冲减）。
   */
  const nowYear = Calc.TODAY().slice(0, 4);
  const yRow = want('kpis') ? years.find(y => y.year === nowYear) : null;
  const yearReal = yRow ? yRow.real : 0;
  const yearDeposit = yRow ? yRow.netDeposit : 0;

  const prevYear = String(Number(nowYear) - 1);
  const prevDecSnap = want('kpis') ? (S.snapshots || []).find(x => x.month === `${prevYear}-12`) : null;

  /* 年初（上年 12/31）的累计浮动 = 上年末快照市值 − 上年末剩余持仓成本。
     成本重放已按当前成本法（wavg/FIFO）与分红冲减设置执行，避免与累计浮动不同源。 */
  const startCost = (want('kpis') && prevDecSnap) ? Calc.costBasisAt(S, `${prevYear}-12-31`, opts) : 0;
  /* 守卫：仅当上年末**确实存在持仓成本**时才认可「年初浮动」。
     否则说明该快照与持仓记录不一致（例如持仓是今年才录入的期初建仓），
     此时把年初浮动视为 0，避免本年浮动被算成负数巨值。 */
  const yearStartFloat = (prevDecSnap && startCost > 1e-9)
    ? round2((prevDecSnap.total || 0) - startCost)
    : 0;

  const yearFloat = want('kpis') ? round2(s.unreal - yearStartFloat) : 0;
  const yearProfit = round2(yearReal + yearFloat);

  let yearBaseInvest = null, yearBaseSource = null;
  /* 与年初浮动同一守卫：快照须与持仓记录一致（上年末确有持仓成本）才作为本金 */
  if (prevDecSnap && startCost > 1e-9) {
    yearBaseInvest = round2((prevDecSnap.total || 0) - Calc.marginBalanceAt(S, `${prevYear}-12-31`, opts));
    yearBaseSource = 'prev-year-end';
  }
  if ((yearBaseInvest === null || yearBaseInvest <= 1e-9) && Math.abs(yearDeposit) > 1e-9) {
    yearBaseInvest = round2(yearDeposit);
    yearBaseSource = 'current-year-deposit';
  }
  if (yearBaseInvest !== null && yearBaseInvest <= 1e-9) yearBaseInvest = null;
  const yearRate = yearBaseInvest ? yearProfit / yearBaseInvest : null;

  const holdings = want('kpis')
    ? s.rows.map(({ a, r, mv, profit }) => ({ asset: a, calc: r, mvCNY: mv, profitCNY: profit }))
    : [];

  /* ---------- 数据一致性检测 ----------
   * 「期初建仓本金」与「入金」常是同一笔钱的两种表达：
   *   · 期初建仓 = 这笔钱在**开始记账前**就已投入（系统外）
   *   · 入金     = 这笔钱在**记账期内**转入账户（系统内）
   * 若两者同时存在且金额接近，极可能是同一笔钱被记了两次：
   *   账户现金会因「假现金」虚增（累计投入自 v1.0.10 起按净入金计，
   *   不再把期初建仓重复相加，故收益率分母不受影响）。
   * 这里只做**提示**（不自动改数），并给出两条修正路径。
   */
  const warnings = [];
  if (!want('kpis')) { /* 非 KPI 请求不做一致性提示，避免无谓计算 */ }
  else if (s.openingCost > 0 && s.netDeposit > 0) {
    const dup = round2(Math.min(s.openingCost, s.netDeposit));
    warnings.push({
      code: 'duplicate_opening_deposit',
      level: 'warn',
      title: '期初建仓与入金可能是同一笔钱',
      openingCost: s.openingCost,
      netDeposit: s.netDeposit,
      mightDup: dup,
      /* 累计投入自 v1.0.10 起按净入金计（期初建仓不再重复相加），
         删除入金会让分母下降；入金仍是 XIRR 的外部现金流。 */
      msg: `同时存在「期初建仓本金 ¥${s.openingCost}」与「净入金 ¥${s.netDeposit}」。`
        + `累计投入按净入金计（¥${s.netDeposit}），期初建仓不再重复相加；`
        + `但**账户现金**会出现并不存在的余额（约 ¥${dup}，这笔钱其实已变成持仓）。`
        + `若是同一笔钱：请把该笔「期初建仓」改为等额的**买入/申购**事件（保留入金），`
        + `这样现金与持仓才对得上。`
        + `若入金是另外新转入的钱，可点「不再提示」。`,
    });
  }
  /* 现金为负：需排除「融资买入」造成的正常负现金 —— 融资本质上就是这笔负现金 */
  if (want('kpis') && s.cash < -0.01 && s.cash < -(s.marginTotal || 0) - 1) {
    warnings.push({
      code: 'negative_cash',
      level: 'warn',
      title: '账户现金为负',
      cash: s.cash, marginTotal: s.marginTotal,
      msg: `账户现金为 ¥${s.cash}，已超出融资（¥${s.marginTotal}）可解释的范围，`
        + `说明有**漏记的入金**。请到「出入金」页补录，否则账户现金会偏低。`
        + `（提示：买入/申购不要再记入金——同一笔钱只在「入金」时算一次外部流入。）`,
    });
  }
  if (want('kpis') && s.openingCost > 0 && s.netDeposit <= 0) {
    warnings.push({
      code: 'opening_without_deposit',
      level: 'warn',
      title: '期初建仓未体现在账户现金',
      openingCost: s.openingCost,
      msg: `检测到期初建仓本金 ¥${s.openingCost}。`
        + `该本金**已计入累计投入**，因此累计收益率不受影响；`
        + `但它发生在记账开始前，账户现金不会包含这笔钱，属正常现象。`
        + `若你希望账户现金也体现这笔本金，请补录一笔等额入金，并把期初建仓改为买入/申购。`,
    });
  }
  /* 超卖：引擎已钳制，不产生负市值；这里提示用户修正历史流水 */
  if (want('kpis')) {
    const bad = s.rows.filter(x => x.r.oversold).map(x => x.a.name);
    if (bad.length) {
      warnings.push({
        code: 'oversold_events', level: 'warn', title: '存在超卖/超额赎回记录',
        msg: `以下资产的历史流水卖出/赎回份额超过当时持仓，引擎已按可用份额钳制：${bad.join('、')}。`
          + `请检查并修正对应流水，否则已实现收益与成本可能偏差。`,
      });
    }
    if (Math.abs(s.identityDiff || 0) > 0.01) {
      warnings.push({
        code: 'identity_mismatch', level: 'warn', title: '收益恒等式不一致',
        msg: `累计收益与「持仓市值 + 现金 − 融资 − 累计投入」相差 ¥${s.identityDiff}。`
          + `通常意味着存在未记录的期初持仓或异常流水，请核对资产与出入金。`,
      });
    }
  }

  const kpis = !want('kpis') ? null : {
    /* ── 单一口径三件套 ── */
    invest: s.invest,                    // 累计投入 = 净入金（无出入金记录时退回期初建仓）
    profit: s.profit,                    // 累计收益（唯一口径）
    rate: s.rate,                        // 收益率 = 累计收益 / 累计投入（分母<=0 时为 null）
    /* ── 持仓构成（用于卡片副标题）── */
    mv: s.mv,
    real: s.real,                        // 已实现（含分红、利息、现金校准）
    cashAdjust: s.cashAdjust,             // 现金校准（正=盘盈，负=盘亏）
    unreal: s.unreal,                    // 浮动
    cashIncome: s.cashIncome,
    /* ── 手续费与融资 ── */
    feeTotal: s.feeTotal,                // 累计手续费（含税，所有类型）
    marginTotal: s.marginTotal,          // 融资合计（欠券商）
    netValueTotal: s.netValueTotal,      // 实际净值合计 = 持仓市值 − 融资
    selfCostTotal: s.selfCostTotal,      // 自付本金合计 = 持仓成本 − 融资
    /* ── 诊断 / 出入金页 ── */
    cash: s.cash,                        // 账户现金（发生日汇率；融资买入时会为负，属正常）
    cashCurrent: s.cashCurrent,          // 账户现金按当前汇率重估（仅展示）
    cashFxGain: s.cashFxGain,            // 现金汇兑差额（未计入累计收益）
    netWorth: s.netWorth,                // 持仓市值 + 现金 − 融资
    identityDiff: s.identityDiff,        // 恒等式校验：profit − (netWorth − invest)
    netDeposit: s.netDeposit,
    openingCost: s.openingCost,
    netInvest: s.netInvest,
    buyTotal: s.buyTotal,
    /* ── 绩效 ── */
    xirr: xirr,
    holdingDays: days,
    twr: twr,
    alpha: bm && bm.alpha != null ? bm.alpha : null,
    benchmarkCode: settings.benchmarkCode,
    yearProfit,
    yearReal,
    yearFloat,                            // 本年浮动 = 累计浮动 − 年初浮动（无快照时等于累计浮动）
    yearBaseInvest,                       // 年投入本金 = 上年 12/31 的（持仓市值 − 融资）
    yearBaseSource,                       // 'prev-year-end' | 'current-year-deposit'
    yearRate,                             // 年收益率 = 本年收益 ÷ 年投入本金
    fxCurrent: Calc.currentFx(S),
  };

  return cache.setCache(cacheKey, {
    kpis,
    warnings,
    settings,
    holdings,
    accounts,
    aggregation,
    performance: (want('performance') || want('kpis')) ? {
      xirr: xirr, twr: twr, simpleAnnualized: simpleAnn,
      cumulativeRate: s.rate, holdingDays: days,
      invest: s.invest, profit: s.profit,
      real: s.real, unreal: s.unreal, mv: s.mv, cash: s.cash,
      cashCurrent: s.cashCurrent, cashFxGain: s.cashFxGain,
      netDeposit: s.netDeposit, openingCost: s.openingCost,
      netInvest: s.netInvest, buyTotal: s.buyTotal,
    } : null,
    benchmark: bm,
    allocation: alloc,
    concentration,
    alerts,
    tax: tax ? { ...tax, capGainRows } : null,
    reports: { months, years },
    cash,
  });
}

/** 仅返回原始状态（/api/state 一次性拉取），按数据版本缓存 */
function rawState(userId) {
  const key = `R|${cache.vOf(userId)}|${userId}`;
  const cached = cache.getCache(key);
  if (cached) return cached;
  const S = buildState(userId);
  const value = {
    settings: S.fullSettings,
    fx: S.fx,
    accounts: S.accounts,
    assets: S.assets,
    events: S.events,
    snapshots: S.snapshots,
    benchmarks: S.benchSeries,
    cashFlows: S.cashFlows,
    dcaPlans: S.dcaPlans,
  };
  return cache.setCache(key, value);
}

/* scope 仅 computeAll 内部使用，不对外导出 */
module.exports = { computeAll, rawState };
