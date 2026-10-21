/**
 * 投资管家 · 成本与收益引擎（现行口径 v7.1）
 * 纯函数、无依赖，Node 与浏览器通用（刻意保持单文件 UMD，可脱离 DB 单测）。
 *
 * 现行口径（唯一权威，旧 v4/v5 双口径已废弃）：
 *  1. 累计投入 invest = 净入金；若完全没有出入金记录则退回期初建仓本金
 *     （二者并存时期初建仓只作持仓成本基准，不再重复计入，避免同一笔钱双计；
 *       内部口径 effectiveInvest = 净入金 + 期初建仓 − 期初融资 + 账户划转，仅用于恒等式校验
 *       （期初融资是借款，已作负债扣净资产，不能再算作自有投入）
 *  2. 累计收益 profit = 已实现（卖出/赎回） + 分红 + 利息 + 浮动
 *  3. 收益率 rate = profit / invest；invest <= 0 返回 null（前端显示“—”）
 *  4. 恒等式：profit ≡ 持仓市值 + 账户现金 − 融资 − effectiveInvest
 *  5. XIRR 期末值 = 持仓市值 + 账户现金 − 融资（融资是负债，不是期末可变现资产）
 *  6. 月末快照只存持仓市值，故月度/TWR 的外部资金流 = 证券净投入；
 *     断档月必须累加区间内所有净投入，不能只扣当前月。
 *  7. 所有公开函数接受 opts.asOf（YYYY-MM-DD），默认今天；未来事件不计入当前口径。
 *
 * 用法（Node）: const C = require('./calc.js'); C.summary(S, {accountId, asOf});
 * 用法（浏览器）: window.Calc
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 工具 ---------- */
  /** 本地日期 YYYY-MM-DD（不能用 toISOString：东八区 00:00–08:00 会退回前一天） */
  const localDate = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const TODAY = () => localDate();
  const round2 = n => Math.round((+n || 0) * 100) / 100;
  /** as-of 统一取值：调用方未传则按今天（所有当前口径都走这里） */
  const asOfOf = opts => (opts && opts.asOf) || TODAY();

  // 默认设置
  const DEFAULTS = { costMethod: 'wavg', dividendReducesCost: false };

  /** 指定日期的生效汇率（date <= atDate 的最近一条；同日 manual 优先） */
  function fxAtDate(S, atDate) {
    const t = atDate || TODAY();
    const f = (S.fx || []).filter(r => r.date <= t).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.source === 'manual' ? 1 : 0) - (b.source === 'manual' ? 1 : 0)));
    return f.length ? f[f.length - 1].rate : 7.1;
  }

  /** 当前生效汇率（日期 <= 今天 的最近一条）
   *  同一日期：管理员手动(source=manual) 优先于自动源(source=auto)
   */
  function currentFx(S) {
    /* 口径与 services/fx.js 的 currentFx 一致（date<=atDate、同日 manual 优先）。
       引擎侧刻意用内存实现而非查库：calc.js 必须保持纯函数（可脱离 DB 单测）。 */
    return fxAtDate(S, TODAY());
  }
  /** 资产估值汇率：人民币恒为 1，美元用最新汇率 */
  const assetFx = (a, S) => (a.currency === 'USD' ? currentFx(S) : 1);

  /** 取某资产的事件（按日期升序，稳定排序；asOf 过滤未来事件） */
  function eventsOf(S, assetId, asOf) {
    return (S.events || []).filter(e => e.assetId === assetId && (!asOf || e.date <= asOf))
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  }

  /** 事件动作归一化：股票用 side，非股票用 kind，期初建仓用 opening */
  const actionOf = e => e.side || e.kind || '';

  /**
   * 单位价格（账户币种）：
   *  - 股票：a.price（市价）
   *  - 非股票：a.unitPrice（单位净值）；为 0 时回退到 marketValue/qty
   *  注意：股票不得走 unitPrice 分支 —— 数据库里股票的 unit_price 恒为 0，
   *  若用 `unitPrice != null` 判断会把市价误判为 0，导致市值归零。
   */
  function unitPriceOf(a, qty, shareBased) {
    if (a.type === 'stock') return +a.price || 0;
    if (+a.unitPrice > 0) return +a.unitPrice;
    /* 仅在「从未按份额记账」的历史资产上才回退到 market_value；
       已清仓的份额型资产不应回退，否则会残留旧市值（如 ¥0.01）。 */
    if (shareBased) return 0;
    return qty > 0 ? (+a.marketValue || 0) / qty : (+a.marketValue || 0);
  }

  /* =========================================================
   * 单资产核算（全类型统一：份额 + 加权成本）
   * costMethod: 'wavg'(摊薄加权平均, 默认) | 'fifo'(先进先出)
   * dividendReducesCost: false=分红计入已实现(默认) | true=分红冲减成本
   * ========================================================= */
  function calcAsset(a, S, opts) {
    const cfg = Object.assign({}, DEFAULTS, S.settings || {});
    const evs = eventsOf(S, a.id, asOfOf(opts));
    return calcUnified(a, evs, cfg, S);
  }

  function calcUnified(a, evs, cfg, S) {
    const isStock = a.type === 'stock';
    const isFifo = cfg.costMethod === 'fifo';
    const divReduce = !!cfg.dividendReducesCost;

    let qty = 0;                         // 当前持仓份额
    let lots = [];                       // FIFO 批次: {q, price, fee, fx, date}
    let costLocal = 0, costCNY = 0;      // 当前持仓成本
    let shareBased = false;              // 是否按份额记账过（用于区分「金额口径的历史资产」与「已清仓」）
    let openQty = 0, openCostCNY = 0;    // 期初建仓（份额 / 成本 ¥）
    let buyQty = 0, buyAmtCNY = 0, buyAmtLocal = 0;  // 累计买入/申购（**不含**期初建仓）
    let realLocal = 0, realCNY = 0;      // 已实现（卖出/赎回）
    let divLocal = 0, divCNY = 0;        // 现金分红
    let incomeCNY = 0;                   // 非股票利息等现金收益
    let investCNY = 0, redeemCNY = 0;    // 非股票累计申购 / 赎回净额（CNY）
    let sellProceedsCNY = 0;             // 股票累计卖出净额（CNY）
    let feeTotalLocal = 0, feeTotalCNY = 0;   // 累计手续费（含税，所有类型）
    /* 融资（margin）：券商账户借钱投资。
       余额 = 资产创建时录入的当前融资 + 各笔买入使用的融资 − 卖出所得优先偿还部分 */
    let marginBorrowedCNY = 0;           // 累计借入
    let marginRepaidCNY = 0;             // 累计偿还
    let marginBalance = +a.marginCNY > 0 ? +a.marginCNY : 0;   // 创建时的当前融资额
    marginBorrowedCNY += marginBalance;
    let oversold = false;                // 卖出/赎回超过可用份额（历史脏数据或绕过校验）
    const byMonth = {};                  // { 'YYYY-MM': {sell, div, income} }
    const addM = (m, k, v) => { if (!m) return; byMonth[m] = byMonth[m] || { sell: 0, div: 0, income: 0 }; byMonth[m][k] = +(byMonth[m][k] + v).toFixed(2); };

    for (const t of evs) {
      const act = actionOf(t);
      const f = t.fx || 1;
      const tQty = +t.qty || 0;
      const tAmtRaw = t.amount != null ? +t.amount || 0 : 0;
      const tPrice = +t.price || (tQty > 0 ? tAmtRaw / tQty : 0);
      const grossAmt = tQty > 0 ? tQty * tPrice : tAmtRaw;   // 成交金额（账户币种）
      const fee = t.fee || 0;
      feeTotalLocal += fee; feeTotalCNY += fee * f;   // 所有事件类型的手续费均计入
      if (tQty > 0) shareBased = true;                // 出现份额即为份额型资产

      if (act === 'opening') {
        /* 期初建仓：记账开始前已持有的仓位。计入份额/成本/净投入，不产生现金流。 */
        const q = tQty > 0 ? tQty : 1;                    // 份额缺省 1（金额口径）
        const amt = grossAmt || tAmtRaw;
        qty += q; openQty += q;
        costLocal += amt + fee;
        costCNY += (amt + fee) * f;
        openCostCNY += (amt + fee) * f;
        lots.push({ q: q, price: tPrice || (q > 0 ? amt / q : 0), fee: fee, fx: f, date: t.date });
      } else if (act === 'buy' || act === 'invest') {
        qty += tQty;                                       // 买入/申购：份额增加
        costLocal += grossAmt + fee;
        costCNY += (grossAmt + fee) * f;
        lots.push({ q: tQty, price: tPrice, fee: fee, fx: f, date: t.date });
        buyQty += tQty; buyAmtCNY += (grossAmt + fee) * f; buyAmtLocal += grossAmt + fee;
        if (!isStock) investCNY += (grossAmt + fee) * f;
        const mBorrow = +t.marginCNY > 0 ? +t.marginCNY : 0;   // 本次买入使用的融资额（CNY）
        if (mBorrow > 0) { marginBalance += mBorrow; marginBorrowedCNY += mBorrow; }
      } else if (act === 'sell' || act === 'redeem') {
        /* 防御：超卖不产生负份额/负市值。写入侧已校验；此处兜住历史脏数据。 */
        const sellQty = tQty > 0 ? Math.min(tQty, Math.max(0, qty)) : 0;
        if (tQty > qty + 1e-6) oversold = true;
        const proceedsLocal = (sellQty > 0 ? sellQty * tPrice : tAmtRaw) - fee;
        let rl = 0, rc = 0;
        if (sellQty > 0) {
          if (isFifo) {
            let need = sellQty;
            while (need > 1e-9 && lots.length) {
              const lot = lots[0];
              const take = Math.min(need, lot.q);
              const lotUnitLocal = lot.price + (lot.fee || 0) / lot.q;
              const lotUnitCNY = lotUnitLocal * lot.fx;
              rl += tPrice * take - lotUnitLocal * take;
              rc += tPrice * take * f - lotUnitCNY * take;
              lot.q -= take; need -= take;
              if (lot.q <= 1e-9) lots.shift();
            }
            rl -= fee; rc -= fee * f;
            costLocal = lots.reduce((s, l) => s + l.q * (l.price + (l.fee || 0) / l.q), 0);
            costCNY = lots.reduce((s, l) => s + l.q * ((l.price + (l.fee || 0) / l.q) * l.fx), 0);
            qty -= sellQty;
          } else {
            const avgL = qty > 0 ? costLocal / qty : 0;
            const avgC = qty > 0 ? costCNY / qty : 0;
            rl = proceedsLocal - avgL * sellQty;
            rc = proceedsLocal * f - avgC * sellQty;
            costLocal -= avgL * sellQty; costCNY -= avgC * sellQty; qty -= sellQty;
          }
        } else {
          /* 金额口径赎回（兼容旧数据）：按加权成本比例结转已实现 */
          const avgC = qty > 0 ? costCNY / qty : 0;
          const avgL = qty > 0 ? costLocal / qty : 0;
          const ratio = (costCNY > 0) ? Math.min(1, (tAmtRaw * f) / costCNY) : 0;
          const outQty = qty * ratio;
          rl = proceedsLocal - avgL * outQty;
          rc = proceedsLocal * f - avgC * outQty;
          costLocal -= avgL * outQty; costCNY -= avgC * outQty; qty -= outQty;
        }
        realLocal += rl; realCNY += rc;
        if (isStock) sellProceedsCNY += proceedsLocal * f; else redeemCNY += proceedsLocal * f;
        /* 卖出所得优先偿还融资（还清为止，不多还） */
        if (marginBalance > 0) {
          const proceedCNY = proceedsLocal * f;
          const repay = Math.min(proceedCNY > 0 ? proceedCNY : 0, marginBalance);
          if (repay > 0) { marginBalance -= repay; marginRepaidCNY += repay; }
        }
        addM(t.date.slice(0, 7), 'sell', rc);
      } else if (act === 'div') {
        const v = (t.amount || 0) * f;
        if (divReduce) { costLocal -= (t.amount || 0); costCNY -= v; }
        else { divLocal += (t.amount || 0); divCNY += v; addM(t.date.slice(0, 7), 'div', v); }
      } else if (act === 'income') {
        /* 非股票利息 / 理财收益：现金收益，计入已实现 */
        const v = (tAmtRaw || 0) * f;
        incomeCNY += v;
        addM(t.date.slice(0, 7), 'income', v);
      } else if (act === 'bonus') {
        const add = tQty;
        qty += add;
        if (isFifo) { if (lots.length) lots[lots.length - 1].q += add; else lots.push({ q: add, price: 0, fee: 0, fx: f, date: t.date }); }
      } else if (act === 'split') {
        const ratio = t.ratio || 1;
        qty *= ratio;
        if (isFifo) lots.forEach(l => { l.q *= ratio; l.price /= ratio; });
      }
    }

    const fxNow = assetFx(a, S);
    const cnyRate = (a.currency === 'USD' ? fxNow : 1);
    const unitPx = unitPriceOf(a, qty, shareBased);
    /* 清仓（份额为 0）时市值为 0；仅「从未按份额记账」的历史资产才回退到 market_value，
       避免已清仓仓位残留旧市值（实测残留 ¥0.01） */
    const mvLocal = isStock
      ? qty * unitPx
      : (qty > 0 ? qty * unitPx : (shareBased ? 0 : (+a.marketValue || 0)));
    const mvCNY = mvLocal * cnyRate;
    const unrealCNY = mvCNY - costCNY;
    const totalCNY = realCNY + divCNY + incomeCNY + unrealCNY;
    /* 浮动盈亏的来源拆分（仅展示用，不改变任何既有口径）：
         股价损益 = (当前单价 − 成本单价) × 份额 × 当前汇率
         汇率损益 = 浮动盈亏 − 股价损益（取残差，保证与浮动盈亏恒等，无分位误差）
       推导： (P₁−P₀)Q·fx₁ + P₀Q(fx₁−fx₀) = P₁Q·fx₁ − P₀Q·fx₀ = 市值 − 成本 = 浮动盈亏 ✔ */
    const avgLocal = qty > 0 ? costLocal / qty : 0;
    const pricePnlCNY = round2((unitPx - avgLocal) * qty * cnyRate);
    const fxPnlCNY = round2(unrealCNY - pricePnlCNY);

    /* 融资与净值：融资要原样还给券商，故「实际净值 = 市值 − 融资」；
       自付本金 = 持仓成本 − 融资。
       校验：(mv − margin) − (cost − margin) = mv − cost = 浮动 ✔ 口径自洽 */
    const marginCNY = Math.max(0, round2(marginBalance));
    const netValueCNY = round2(mvCNY - marginCNY);
    const selfCostCNY = round2(costCNY - marginCNY);

    /* 净投入（证券口径，可增可减）= 期初建仓 + 买入/申购 − 卖出/赎回净额
       说明：清仓后可能为负（表示已净收回本金），此时不作为收益率分母。 */
    const netInvestCNY = openCostCNY + buyAmtCNY - sellProceedsCNY - redeemCNY;

    return {
      type: a.type, isStock, costMethod: cfg.costMethod,
      qty: +qty.toFixed(6),
      unitPrice: round2(unitPx),
      openingQty: +openQty.toFixed(6), openingCostCNY: round2(openCostCNY),
      costLocal: round2(costLocal), costCNY: round2(costCNY),
      mvLocal: round2(mvLocal), mvCNY: round2(mvCNY),
      realLocal: round2(realLocal), realCNY: round2(realCNY),
      /* 资产级“已实现”合计：卖出/赎回已实现 + 分红 + 利息。
         与 summary.real 同义；解决“资产卡已实现 0、首页已实现 500”的同名不同义。 */
      realTotalCNY: round2(realCNY + divCNY + incomeCNY),
      feeTotalLocal: round2(feeTotalLocal), feeTotalCNY: round2(feeTotalCNY),
      marginBorrowedCNY: round2(marginBorrowedCNY), marginRepaidCNY: round2(marginRepaidCNY),
      marginCNY, netValueCNY, selfCostCNY,
      pricePnlCNY, fxPnlCNY,                // 浮动盈亏的来源拆分（和 = unrealCNY）
      divCNY: round2(divCNY), divLocal: round2(divLocal),
      incomeCNY: round2(incomeCNY),
      investCNY: round2(investCNY), redeemCNY: round2(redeemCNY), sellCNY: round2(sellProceedsCNY),
      unrealCNY: round2(unrealCNY), totalCNY: round2(totalCNY),
      avgLocal: qty > 0 ? costLocal / qty : 0, avgCNY: qty > 0 ? costCNY / qty : 0,
      buyAvgCNY: buyQty > 0 ? buyAmtCNY / buyQty : 0, buyAvgLocal: buyQty > 0 ? buyAmtLocal / buyQty : 0,
      buyQty, buyAmtCNY: round2(buyAmtCNY), buyAmtLocal: round2(buyAmtLocal),
      netInvestCNY: round2(netInvestCNY),
      total: round2(totalCNY),
      /* fxUsed 为当前汇率（兼容旧字段名）；fxCost 为「当前持仓成本的实际折算汇率」，
         即 成本(CNY) ÷ 成本(原币)。USD 资产在历史汇率与当前汇率不同时，两者会不等，
         卡片应展示 fxCost（成本锁定汇率）而非当前汇率。 */
      /* 收益率：优先按证券净投入（可增可减）；本金已收回时退回“总收益/剩余成本”；
         清仓且无成本时返回 null（前端显示“—”），不再用 0 冒充。 */
      rate: netInvestCNY > 0 ? totalCNY / netInvestCNY
        : (costCNY > 1e-9 ? totalCNY / costCNY : null),
      oversold,
      fxUsed: fxNow,
      fxCost: costLocal > 1e-9 ? round2(costCNY / costLocal * 10000) / 10000 : fxNow, byMonth
    };
  }

    const assetTotal = r => (r.totalCNY !== undefined ? r.totalCNY : r.total);

  /* =========================================================
   * 账户现金 & 本金（外部现金流）
   * ========================================================= */
  /**
   * 账户现金余额（账户币种折算 CNY）
   *  现金 = 入金 − 出金
   *       − 买入(含费) − 申购(含费)
   *       + 卖出(扣费) + 赎回
   *       + 分红 + 利息/理财收益
   * 期初建仓(opening)不产生现金流：其本金在记账开始前已投入。
   */
  function accountCash(S, opts) {
    const accId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const inAcc = x => !accId || x.accountId === accId;
    const accCurOf = id => {
      const a = (S.accounts || []).find(x => x.id === id);
      return a && a.currency === 'USD' ? 'USD' : 'CNY';
    };
    let cash = 0, dep = 0, wd = 0, openCost = 0, marginBal = 0, adjust = 0, openingMargin = 0;
    let transferIn = 0, transferOut = 0;
    const byCcy = { CNY: 0, USD: 0 };
    /* 现金流水：deposit/withdraw 是外部现金流；transfer 是内部划转（两条腿）；
       adjust 是现金校准（正=盘盈，负=盘亏，计入已实现的其他损益）。 */
    (S.cashFlows || []).filter(c => String(c.date) <= asOf &&
      (!accId || c.accountId === accId || c.toAccountId === accId)).forEach(c => {
      const f = c.fx || 1;
      const srcCur = accCurOf(c.accountId);
      const dstCur = c.toAccountId ? accCurOf(c.toAccountId) : null;
      const srcIn = !accId || c.accountId === accId;
      const dstIn = !accId || c.toAccountId === accId;
      if (c.kind === 'deposit') {
        const v = (c.amount || 0) * f;
        dep += v; cash += v; byCcy[srcCur] += (c.amount || 0);
      } else if (c.kind === 'withdraw') {
        const v = (c.amount || 0) * f;
        wd += v; cash -= v; byCcy[srcCur] -= (c.amount || 0);
      } else if (c.kind === 'transfer') {
        if (srcIn) {
          const v = (c.amount || 0) * f;
          transferOut += v;
          cash -= v;
          byCcy[srcCur] -= (c.amount || 0);
        }
        if (dstIn && c.toAccountId) {
          const tf = c.toFx || 1;
          const v = (c.toAmount || 0) * tf;
          transferIn += v;
          cash += v;
          byCcy[dstCur] += (c.toAmount || 0);
        }
      } else if (c.kind === 'adjust') {
        const v = (c.amount || 0) * f;
        cash += v; adjust += v; byCcy[srcCur] += (c.amount || 0);
      }
    });
    (S.assets || []).filter(inAcc).forEach(a => {
      const accCur = accCurOf(a.accountId);
      /* 融资时序演进（与 calcUnified 一致）：
         期初融资 + 各笔买入融资 − 卖出所得优先偿还部分 */
      let mBal = +a.marginCNY > 0 ? +a.marginCNY : 0;
      openingMargin += mBal;                     // 期初融资：记账前已存在的融资余额（属借款，非自有投入）
      eventsOf(S, a.id, asOf).forEach(e => {
        const act = actionOf(e);
        const f = e.fx || 1;
        const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
        const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt;
        const fee = e.fee || 0;
        /* 账户币种口径的金额：资产币种 → CNY（事件汇率）→ 账户币种（当日汇率） */
        const accFx = accCur === 'USD' ? fxAtDate(S, e.date) : 1;
        const toAcc = amtCcy => (a.currency === accCur ? amtCcy : (amtCcy * f) / accFx);
        switch (act) {
          case 'opening': openCost += (gross + fee) * f; break;       // 不产生现金流
          case 'buy': case 'invest': {
            /* 融资部分由券商直接支付，不占用账户现金 → 现金只扣「自付」 */
            const mb = +e.marginCNY > 0 ? +e.marginCNY : 0;
            mBal += mb;
            const selfPayCNY = (gross + fee) * f - mb;
            cash -= selfPayCNY;
            byCcy[accCur] -= (a.currency === accCur ? (gross + fee) : ((gross + fee) * f) / accFx) - mb / accFx;
            break;
          }
          case 'sell': case 'redeem': {
            /* 卖出所得优先偿还融资，只有剩余部分回到现金 */
            const proceeds = (gross - fee) * f;
            const repay = Math.min(proceeds > 0 ? proceeds : 0, mBal);
            if (repay > 0) mBal -= repay;
            cash += proceeds - repay;
            byCcy[accCur] += toAcc(gross - fee) - repay / accFx;
            break;
          }
          case 'div': case 'income':
            cash += tAmt * f;
            byCcy[accCur] += toAcc(tAmt);
            break;
          default: break;                                            // bonus / split 不影响现金
        }
      });
      marginBal += mBal;
    });
    const fxNow = fxAtDate(S, asOf);
    const cashCurrent = round2(byCcy.CNY + byCcy.USD * fxNow);
    return {
      cash: round2(cash), deposit: round2(dep), withdraw: round2(wd),
      netDeposit: round2(dep - wd),          // 净入金（仅出入金）
      net: round2(dep - wd),                 // ★ 兼容旧字段名（= 净入金）
      openingCost: round2(openCost),         // 期初建仓本金
      marginBalance: round2(marginBal),      // 融资合计（欠券商，尚未偿还）
      /* 账户视角：内部划转是“资金进出该账户”，需计入该账户的有效投入；
         组合视角：划转两边抵消，不计入累计投入。 */
      transferInCNY: round2(transferIn),
      transferOutCNY: round2(transferOut),
      /* 有效投入（内部口径，用于恒等式校验）= 净入金 + 期初建仓 − 期初融资 + 划转。
         期初融资是**借来的钱**：它已作为负债扣减净资产（marginTotal），
         若再全额计入投入就会双重计入，使恒等式相差「期初融资」（用户实测 31107.41）。
         买入融资不在此扣减——那部分成本通过买入事件进入持仓，未计入 openCost。 */
      openingMargin: round2(openingMargin),
      effectiveInvest: round2(dep - wd + openCost - openingMargin + (accId ? transferIn - transferOut : 0)),
      /* 现金的“当前价值”与汇兑差额：仅展示，不改变累计收益口径。
         账户现金按发生日汇率记账（与成本锁定一致），cashCurrent 按当前汇率重估。 */
      cashByCcy: { CNY: round2(byCcy.CNY), USD: round2(byCcy.USD) },
      cashCurrent,
      cashFxGain: round2(cashCurrent - cash),
      adjustCNY: round2(adjust)
    };
  }
  /**
   * 指定日期的融资合计（按时序重放到 asOfDate 含当日）。
   * 用于「年初投入本金 = 上年 12/31 的净资产」：需要当时的融资。
   * 口径与 calcUnified 的融资演进一致：期初融资 + 各笔买入融资 − 卖出所得优先偿还。
   */
  function marginBalanceAt(S, asOfDate, opts) {
    const accId = opts && opts.accountId;
    const inAcc = x => !accId || x.accountId === accId;
    let total = 0;
    (S.assets || []).filter(inAcc).forEach(a => {
      let bal = +a.marginCNY > 0 ? +a.marginCNY : 0;
      eventsOf(S, a.id).forEach(e => {
        if (e.date > asOfDate) return;
        const act = actionOf(e);
        const f = e.fx || 1;
        const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
        const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt;
        if (act === 'buy' || act === 'invest') {
          const mb = +e.marginCNY > 0 ? +e.marginCNY : 0;
          if (mb > 0) bal += mb;
        } else if (act === 'sell' || act === 'redeem') {
          const proceeds = (gross - (e.fee || 0)) * f;
          if (bal > 0) {
            const repay = Math.min(proceeds > 0 ? proceeds : 0, bal);
            if (repay > 0) bal -= repay;
          }
        }
      });
      total += Math.max(0, bal);
    });
    return round2(total);
  }

  /**
   * 指定日期的**剩余持仓成本**合计（CNY，重放到 asOfDate 含当日）。
   * 直接复用 calcUnified，因此自动继承当前设置的成本法（wavg/FIFO）与分红冲减口径。
   * 用于「年初浮动 = 上年末快照市值 − 上年末剩余成本」。
   */
  function costBasisAt(S, asOfDate, opts) {
    const accId = opts && opts.accountId;
    const cfg = Object.assign({}, DEFAULTS, S.settings || {});
    const inAcc = x => !accId || x.accountId === accId;
    let total = 0;
    (S.assets || []).filter(inAcc).forEach(a => {
      const evs = eventsOf(S, a.id, asOfDate);
      total += calcUnified(a, evs, cfg, S).costCNY;
    });
    return round2(total);
  }

  /** 兼容旧名：仅出入金汇总 */
  function cashFlowSummary(S, opts) {
    const c = accountCash(S, opts);
    return { deposit: c.deposit, withdraw: c.withdraw, net: c.netDeposit };
  }

  /* =========================================================
   * 账户维度
   * ========================================================= */
  function accountSummary(S, opts) {
    const out = (S.accounts || []).map(acc => {
      const assets = S.assets.filter(a => a.accountId === acc.id);
      let mv = 0, netInvest = 0, profitInvest = 0, accFee = 0, accMargin = 0;
      assets.forEach(a => {
        const r = calcAsset(a, S, opts);
        mv += r.mvCNY; profitInvest += assetTotal(r);
        netInvest += r.netInvestCNY;
        accFee += r.feeTotalCNY || 0;                 // 该账户累计手续费
        accMargin += r.marginCNY || 0;                // 该账户融资（欠券商）
      });
      const cf = accountCash(S, Object.assign({}, opts, { accountId: acc.id }));
      const profit = round2(profitInvest + (cf.adjustCNY || 0));  // 含现金校准（其他损益）
      /* 账户视角累计投入：口径同组合（净入金优先，无出入金记录时退回期初建仓），
         并叠加内部划转净额（划转是资金进出该账户，组合视角两边抵消） */
      const transferNet = round2((cf.transferInCNY || 0) - (cf.transferOutCNY || 0));
      const invest = round2((Math.abs(cf.netDeposit) > 1e-9 ? cf.netDeposit : cf.openingCost) + transferNet);
      return {
        account: acc, count: assets.length,
        mv: round2(mv), cash: cf.cash, cashCurrent: cf.cashCurrent,
        netDeposit: cf.netDeposit, openingCost: cf.openingCost, effectiveInvest: cf.effectiveInvest,
        netInvest: round2(netInvest),
        cashAdjust: round2(cf.adjustCNY || 0),
        feeTotal: round2(accFee),             // 该账户累计手续费
        margin: round2(accMargin),            // 该账户融资（欠券商）
        profit,
        invest,
        rate: invest > 0 ? profit / invest : null
      };
    });
    const all = out.reduce((s, x) => ({
      mv: s.mv + x.mv, cash: s.cash + x.cash,
      invest: s.invest + x.invest, netInvest: s.netInvest + x.netInvest,
      profit: s.profit + x.profit
    }), { mv: 0, cash: 0, invest: 0, netInvest: 0, profit: 0 });
    return {
      byAccount: out,
      total: {
        mv: round2(all.mv), cash: round2(all.cash),
        invest: round2(all.invest), netInvest: round2(all.netInvest),
        profit: round2(all.profit),
        rate: all.invest > 0 ? all.profit / all.invest : null
      }
    };
  }

  /** 同一证券跨账户合并（按 market+code，无代码则按名称） */
  function securityAggregation(S, opts) {
    const key = a => (a.market || '') + '|' + (a.code || a.name);
    const map = {};
    S.assets.forEach(a => {
      const r = calcAsset(a, S, opts), k = key(a);
      map[k] = map[k] || { name: a.name, code: a.code, market: a.market, type: a.type, currency: a.currency,
        qty: 0, costCNY: 0, mvCNY: 0, totalCNY: 0, accounts: [] };
      const m = map[k];
      m.qty += r.qty; m.costCNY += r.costCNY;                 // ★ 全类型都用真实份额
      m.mvCNY += r.mvCNY; m.totalCNY += assetTotal(r);
      m.accounts.push({ accountId: a.accountId, assetId: a.id, qty: r.qty, mvCNY: r.mvCNY });
    });
    return Object.values(map).map(m => ({
      ...m, qty: +m.qty.toFixed(6), costCNY: round2(m.costCNY), mvCNY: round2(m.mvCNY), totalCNY: round2(m.totalCNY),
      avgCNY: m.qty > 0 ? m.costCNY / m.qty : 0,
      unrealCNY: round2(m.mvCNY - m.costCNY),
      rate: m.costCNY > 0 ? m.totalCNY / m.costCNY : null
    }));
  }

  /* =========================================================
   * 全局汇总 & 报表（双口径）
   * ========================================================= */
  function summary(S, opts) {
    const accountId = opts && opts.accountId;
    const assets = accountId ? S.assets.filter(a => a.accountId === accountId) : S.assets;
    let mv = 0, real = 0, unreal = 0, cashIncome = 0, netInvest = 0, buyTotal = 0;
    let feeTotal = 0, marginTotal = 0, netValueTotal = 0, selfCostTotal = 0;
    const rows = assets.map(a => {
      const r = calcAsset(a, S, opts);
      mv += r.mvCNY || 0;
      feeTotal += r.feeTotalCNY || 0;
      marginTotal += r.marginCNY || 0;
      netValueTotal += r.netValueCNY || 0;
      selfCostTotal += r.selfCostCNY || 0;
      real += r.realCNY + r.divCNY + r.incomeCNY;   // 已实现 = 卖出/赎回已实现 + 分红 + 利息/理财收益
      cashIncome += r.incomeCNY;                     // 仅作明细拆分（已含在 real 内，不再重复累计）
      unreal += r.unrealCNY;
      netInvest += r.netInvestCNY;
      buyTotal += r.buyAmtCNY;
      return { a, r, mv: r.mvCNY || 0, profit: assetTotal(r) };
    });
    const cf = accountCash(S, opts);
    /* 单一口径（v1.0.10 修正）：
     *   累计投入 = 净入金；若**完全没有出入金记录**则退回期初建仓本金
     *   累计收益 = 已实现 + 分红 + 利息 + 浮动
     *   收益率   = 累计收益 ÷ 累计投入（<=0 时 null，前端显示“—”）
     *
     * 为什么不是「净入金 + 期初建仓」（v1.0.7–v1.0.9 口径）：
     *   期初建仓与入金常是**同一笔钱的两种表达**（记账前的持仓成本 + 记账期内转入的钱），
     *   两者相加会让累计投入翻倍、收益率腰斩。二者并存时，期初建仓只作为持仓成本基准，
     *   不再重复计入投入；只有当完全没有出入金记录时，才用期初建仓本金充当投入基数，
     *   保证「仅期初建仓」场景仍能计算收益率。
     *   恒等式校验仍使用内部口径 effectiveInvest（净入金 + 期初建仓 + 划转），保证数学自洽。
     */
    const cashAdjust = cf.adjustCNY || 0;
    const totalReal = round2(real + cashAdjust);       // 已实现 + 现金校准（其他损益）
    const profit = round2(totalReal + unreal);
    const transferNet = accountId ? round2((cf.transferInCNY || 0) - (cf.transferOutCNY || 0)) : 0;
    const invest = round2((Math.abs(cf.netDeposit) > 1e-9 ? cf.netDeposit : cf.openingCost) + transferNet);
    const netWorth = round2(mv + cf.cash - marginTotal);
    return {
      /* 持仓构成 */
      total: round2(mv),                    // 兼容旧字段名（= 持仓市值）
      mv: round2(mv),
      real: totalReal, unreal: round2(unreal), cashIncome: round2(cashIncome),
      cashAdjust: round2(cashAdjust),
      /* 单一口径三件套 */
      invest,                               // 累计投入 = 净入金（无出入金记录时退回期初建仓）
      profit,                               // 累计收益（唯一口径）
      rate: invest > 0 ? profit / invest : null,
      /* 诊断用（管理页/告警） */
      netDeposit: cf.netDeposit, openingCost: cf.openingCost, openingMargin: cf.openingMargin,
      effectiveInvest: cf.effectiveInvest,
      netInvest: round2(netInvest),         // 证券净投入（可增可减）
      buyTotal: round2(buyTotal),           // 累计买入/申购（仅展示）
      /* 手续费与融资（v7） */
      feeTotal: round2(feeTotal),           // 累计手续费（含税，所有类型）
      marginTotal: round2(marginTotal),     // 融资合计（欠券商）
      netValueTotal: round2(netValueTotal), // 实际净值合计 = 持仓市值 − 融资
      selfCostTotal: round2(selfCostTotal), // 自付本金合计 = 持仓成本 − 融资
      cash: cf.cash,
      cashCurrent: cf.cashCurrent,
      cashByCcy: cf.cashByCcy,
      cashFxGain: cf.cashFxGain,
      realizableTotal: round2(mv + cf.cash),
      netWorth,
      /* 恒等式校验：profit 应等于 netWorth − 有效投入
         （校验用内部口径 effectiveInvest：净入金 + 期初建仓 + 划转；
         展示口径 invest 在「期初建仓与入金重复表达」时小于它，属预期） */
      identityDiff: round2(profit - (netWorth - cf.effectiveInvest)),
      rows
    };
  }

  /** 月度已实现收益（口径统一：赎回本金不计入） */
  function realizedByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const r = calcAsset(a, S, opts);
      for (const mm in r.byMonth) add(mm, r.byMonth[mm].sell + r.byMonth[mm].div + (r.byMonth[mm].income || 0));
    });
    /* 现金校准计入“其他损益”，否则现金变了但收益不变，恒等式会失衡 */
    (S.cashFlows || []).filter(c => c.kind === 'adjust' && String(c.date) <= asOf &&
      (!accountId || c.accountId === accountId)).forEach(c => {
      add(String(c.date).slice(0, 7), (c.amount || 0) * (c.fx || 1));
    });
    return m;
  }
  /** 月度外部现金流：仅出入金（快照为「持仓市值」，故买卖/申赎属账户内部转移） */
  function netDepositByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    (S.cashFlows || []).filter(c => (!accountId || c.accountId === accountId) && String(c.date) <= asOf)
      .forEach(c => {
        add(String(c.date).slice(0, 7), (c.kind === 'deposit' ? 1 : -1) * (c.amount || 0) * (c.fx || 1));
      });
    return m;
  }
  /** 月度证券净投入（买入−卖出 / 申购−赎回，含期初建仓）：仅用于展示 */
  function netInvestByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      eventsOf(S, a.id, asOf).forEach(t => {
        const act = actionOf(t), f = t.fx || 1;
        const tQty = +t.qty || 0, tAmt = t.amount != null ? +t.amount || 0 : 0;
        const px = +t.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt, fee = t.fee || 0;
        if (act === 'opening') add(String(t.date).slice(0, 7), (gross + fee) * f);
        else if (act === 'buy' || act === 'invest') add(String(t.date).slice(0, 7), (gross + fee) * f);
        else if (act === 'sell' || act === 'redeem') add(String(t.date).slice(0, 7), -(gross - fee) * f);
      });
    });
    return m;
  }
  function monthRows(S, opts) {
    const asOf = asOfOf(opts);
    const real = realizedByMonth(S, opts);
    const net = netInvestByMonth(S, opts);        // ★ 月末快照为「持仓市值」，故外部资金流 = 证券净投入
    const netDep = netDepositByMonth(S, opts);    // 出入金（独立展示，不参与浮动收益）
    const snap = {}; (S.snapshots || []).forEach(s => {
      if (String(s.month) <= asOf.slice(0, 7)) snap[s.month] = s.total;
    });
    const months = [...new Set([...Object.keys(real), ...Object.keys(snap), ...Object.keys(net), ...Object.keys(netDep)])].sort();
    /* 断档月的资金流必须累加：prevSnap 与当前快照之间可能隔了多个月，
       那些月份里的买入/申购会改变持仓市值，若不扣减会被误算成浮动收益。 */
    const flowBetween = (fromExclusive, toInclusive) => {
      let sum = 0;
      for (const k of months) if (k > fromExclusive && k <= toInclusive) sum += (net[k] || 0);
      return round2(sum);
    };
    const out = []; let prev = null, prevMonth = null;
    for (const mm of months) {
      const s = snap[mm];
      let pureFloat = null, floatTotal = null, flow = 0;
      if (s !== undefined && prev !== null) {
        flow = flowBetween(prevMonth, mm);
        /* 纯浮动 = 快照差 − 区间证券净投入（快照为「持仓市值」，买卖/申赎不计入浮动） */
        pureFloat = round2((s - prev) - flow);
        /* 含浮动 = 当月已实现 + 纯浮动。卖出/分红不改变持仓市值，不构成重复计算。 */
        floatTotal = round2((real[mm] || 0) + pureFloat);
      }
      out.push({ month: mm, real: round2(real[mm] || 0),
        net: round2(net[mm] || 0),              // 证券净投入（保持原名，向后兼容）
        netDeposit: round2(netDep[mm] || 0),    // 出入金（独立展示）
        flow, snap: s, pureFloat, floatTotal,
        total: floatTotal });                   // 当月总收益 = 含浮动
      if (s !== undefined) { prev = s; prevMonth = mm; }
    }
    return out;
  }
  function yearRows(S, opts) {
    const y = {};
    monthRows(S, opts).forEach(r => {
      const k = r.month.slice(0, 4); y[k] = y[k] || { year: k, real: 0, net: 0, netDeposit: 0, pureFloat: 0, floatTotal: 0, total: 0, hasF: false };
      y[k].real += r.real; y[k].net += r.net; y[k].netDeposit += r.netDeposit;
      if (r.floatTotal !== null) {
        y[k].pureFloat += (r.pureFloat || 0);
        y[k].floatTotal += r.floatTotal; y[k].hasF = true;
      }
    });
    return Object.values(y).sort((a, b) => (a.year < b.year ? -1 : 1))
      .map(x => ({ ...x, real: round2(x.real), net: round2(x.net), netDeposit: round2(x.netDeposit),
        pureFloat: round2(x.pureFloat), floatTotal: round2(x.floatTotal),
        total: round2(x.floatTotal) }));
  }

  /* =========================================================
   * 绩效指标 / 决策辅助 / 税务 / 预警 / 定投
   * ========================================================= */

  /* ---------- XIRR：资金加权内部收益率（年化） ---------- */
  function xirr(flows, guess) {
    if (!flows || flows.length < 2) return null;
    const t0 = new Date(flows[0].date).getTime();
    const yrs = d => (new Date(d).getTime() - t0) / 31536000000;
    const npv = r => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, yrs(f.date)), 0);
    let r = guess == null ? 0.1 : guess;
    for (let i = 0; i < 100; i++) {
      const f = npv(r);
      if (Math.abs(f) < 1e-6) return r;
      const df = (npv(r + 1e-7) - f) / 1e-7;
      if (!isFinite(df) || Math.abs(df) < 1e-12) break;
      const next = r - f / df;
      if (!isFinite(next)) break;
      if (Math.abs(next - r) < 1e-10) return next;
      r = Math.max(-0.9999, Math.min(100, next));
    }
    let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-6 || (hi - lo) < 1e-12) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /**
   * 组合现金流（CNY，投资者视角）：
   *  引入「账户现金」后，**买入/卖出/申购/赎回/分红都是账户内部转移，不构成外部现金流**。
   *  真正的外部现金流只有两类：
   *    ① 出入金（入金=流出为负，出金=流入为正）
   *    ② 期初建仓本金（记账开始前已投入 → 视为初始流出）
   *  期末流入 = 持仓市值 + 账户现金 − 融资（真实可变现净值）。
   *  兼容：若用户完全没有记录出入金与期初建仓（数据不完整），退回「证券流水口径」近似，
   *  以免 XIRR 因缺少初始流出而失真。
   */
  function portfolioFlows(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = (opts && opts.asOf) || TODAY();
    const inAcc = x => !accountId || x.accountId === accountId;
    const flows = [];

    const cf = accountCash(S, opts);
    const hasCashRecords = (cf.deposit + cf.withdraw) > 1e-9 || cf.openingCost > 1e-9
      || (accountId && (cf.transferInCNY + cf.transferOutCNY) > 1e-9);
    const s = summary(S, opts);

    if (hasCashRecords) {
      /* ── 现金口径（推荐，数据完整时）── */
      (S.cashFlows || []).filter(c => String(c.date) <= asOf &&
        (!accountId || c.accountId === accountId || c.toAccountId === accountId)).forEach(c => {
        const f = c.fx || 1;
        if (c.kind === 'deposit') {
          flows.push({ date: c.date, amount: -(c.amount || 0) * f, assetId: null, kind: c.kind });
        } else if (c.kind === 'withdraw') {
          flows.push({ date: c.date, amount: (c.amount || 0) * f, assetId: null, kind: c.kind });
        } else if (c.kind === 'transfer' && accountId) {
          /* 组合视角内部划转不构成外部现金流；账户视角则是该账户的资金进出 */
          if (c.accountId === accountId && c.toAccountId !== accountId) {
            flows.push({ date: c.date, amount: -(c.amount || 0) * f, assetId: null, kind: 'transfer_out' });
          }
          if (c.toAccountId === accountId && c.accountId !== accountId) {
            flows.push({ date: c.date, amount: (c.toAmount || 0) * (c.toFx || 1), assetId: null, kind: 'transfer_in' });
          }
        }
        /* adjust 是现金校准，不是外部投入；期末现金已包含它 */
      });
      (S.assets || []).filter(inAcc).forEach(a => {
        eventsOf(S, a.id, asOf).forEach(e => {
          if (actionOf(e) !== 'opening') return;
          const f = e.fx || 1, tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
          const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
          const gross = tQty > 0 ? tQty * px : tAmt;
          flows.push({ date: e.date, amount: -((gross + (e.fee || 0)) * f), assetId: a.id, kind: 'opening' });
        });
      });
      flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      /* 期末流入必须取**真实可变现总值**（持仓市值 + 账户现金 − 融资），
         也不能用任何「投入 + 收益」的合成口径 —— 存在期初建仓时它会少算本金，
         导致 XIRR 严重失真（实测：仅期初建仓 1 万→现值 1.2 万，用合成口径得 −80%，实际应为 +20%）。
         融资是负债：期末若持有 200 市值、欠券商 100，真实可变现只有 100。 */
      const realizable = round2(s.mv + s.cash - s.marginTotal);
      if (Math.abs(realizable) > 1e-9) flows.push({ date: asOf, amount: realizable, assetId: null, terminal: true, kind: 'realizable' });
    } else {
      /* ── 兼容口径：未记录出入金时，按证券流水近似 ── */
      (S.assets || []).filter(inAcc).forEach(a => {
        eventsOf(S, a.id, asOf).forEach(e => {
          const f = e.fx || 1, act = actionOf(e);
          const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
          const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
          const gross = tQty > 0 ? tQty * px : tAmt, fee = e.fee || 0;
          let amt = 0;
          if (act === 'opening' || act === 'buy' || act === 'invest') amt = -(gross + fee) * f;
          else if (act === 'sell' || act === 'redeem') amt = (gross - fee) * f;
          else if (act === 'div' || act === 'income') amt = tAmt * f;
          if (Math.abs(amt) > 1e-9) flows.push({ date: e.date, amount: amt, assetId: a.id, act });
        });
      });
      flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      if (s.mv > 1e-9) flows.push({ date: asOf, amount: s.mv, assetId: null, terminal: true, kind: 'mv' });
    }
    return flows;
  }
  function portfolioXirr(S, opts) {
    const flows = portfolioFlows(S, opts);
    if (flows.length < 2) return null;
    if (flows[0].amount >= 0) flows.unshift({ date: flows[0].date, amount: -1e-6 });
    return xirr(flows);
  }
  /** 简单年化：（1+累计收益率）^(365/持有天数) - 1；收益率为 null 时返回 null */
  function annualized(total, days) {
    if (total == null || !(days > 0) || 1 + total <= 0) return null;
    return Math.pow(1 + total, 365 / days) - 1;
  }
  /** 组合持有天数（首笔事件或期初建仓 → asOf） */
  function holdingDays(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    let first = null;
    (S.assets || []).filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const e = eventsOf(S, a.id, asOf)[0]; if (e && (!first || e.date < first)) first = e.date;
    });
    if (!first) return 0;
    return Math.max(1, Math.round((new Date(asOf) - new Date(first)) / 86400000));
  }

  /* ---------- TWR：时间加权收益率（月末快照序列，外部现金流=证券净投入） ---------- */
  function twr(S, opts) {
    const rows = monthRows(S, opts).filter(r => r.snap !== undefined);
    if (rows.length < 2) return null;
    let factor = 1;
    for (let i = 1; i < rows.length; i++) {
      /* flow 已包含断档月区间内的累计净投入，不能只用当前月 net */
      const denom = rows[i - 1].snap + (rows[i].flow || 0);
      if (denom > 0) factor *= rows[i].snap / denom;
    }
    return factor - 1;
  }

  /* ---------- 资产配置 & 再平衡 ---------- */
  const ALLOC_DEFAULT = { stock: 0.6, fund: 0.2, wealth: 0.15, bond: 0.05 };
  function allocation(S, targets, opts) {
    const s = summary(S, opts);
    const tg = Object.assign({}, ALLOC_DEFAULT, targets || {});
    const byType = {};
    s.rows.forEach(r => { byType[r.a.type] = (byType[r.a.type] || 0) + r.mv; });
    const total = s.total || 0;
    const rows = ['stock', 'fund', 'wealth', 'bond'].map(t => {
      const cur = byType[t] || 0;
      return { type: t, cur: round2(cur), curPct: total > 0 ? cur / total : 0, tgtPct: tg[t] || 0,
        tgtAmt: round2(total * (tg[t] || 0)), diff: round2(total * (tg[t] || 0) - cur) };
    });
    const drift = rows.reduce((a, r) => a + Math.abs(r.diff), 0) / 2;
    return {
      scope: 'securities',                 // 仅证券持仓；账户现金不参与目标比例
      total: round2(total), cash: s.cash, cashCurrent: s.cashCurrent,
      rows, drift: round2(drift), driftPct: total > 0 ? drift / total : 0
    };
  }

  /* ---------- 集中度 & 风险 ---------- */
  function concentration(S, opts) {
    const warnSingle = (opts && opts.warnSingle) || 0.2;
    const warnTop5 = (opts && opts.warnTop5) || 0.6;
    const s = summary(S, opts);
    const total = s.total || 1;
    const list = [...s.rows].sort((a, b) => b.mv - a.mv)
      .map(r => ({ name: r.a.name, type: r.a.type, mv: r.mv, pct: r.mv / total }));
    const top5 = list.slice(0, 5).reduce((x, r) => x + r.pct, 0);
    const byType = {};
    s.rows.forEach(r => { byType[r.a.type] = (byType[r.a.type] || 0) + r.mv / total; });
    const alerts = [];
    if (list[0] && list[0].pct > warnSingle) alerts.push(`单标的集中：${list[0].name} 占 ${(list[0].pct * 100).toFixed(1)}%（阈值 ${(warnSingle * 100)}%）`);
    if (top5 > warnTop5) alerts.push(`前5大持仓合计 ${(top5 * 100).toFixed(1)}%（阈值 ${(warnTop5 * 100)}%）`);
    if (byType.stock > 0.7) alerts.push(`股票类占比 ${(byType.stock * 100).toFixed(1)}%，权益风险偏高`);
    return { scope: 'securities', list, top1: list[0] ? list[0].pct : 0, top5, byType, warnSingle, warnTop5, alerts };
  }

  /* ---------- 基准对比 ---------- */
  function benchmark(S, benchSeries, opts) {
    const snaps = monthRows(S, opts).filter(r => r.snap !== undefined);
    if (snaps.length < 2 || !benchSeries || benchSeries.length < 2) return null;
    const first = snaps[0], last = snaps[snaps.length - 1];
    const bAt = m => { const x = benchSeries.filter(b => b.date.slice(0, 7) <= m).pop(); return x ? x.value : null; };
    const b0 = bAt(first.month), b1 = bAt(last.month);
    let nav = 1; const series = [];
    snaps.forEach((r, i) => {
      if (i > 0) { const denom = snaps[i - 1].snap + (r.flow || 0); if (denom > 0) nav *= r.snap / denom; }
      series.push({ month: r.month, port: nav - 1, bench: b0 && bAt(r.month) ? bAt(r.month) / b0 - 1 : null });
    });
    const portRet = nav - 1;
    const benchRet = b0 && b1 ? b1 / b0 - 1 : null;
    return { portRet, benchRet, alpha: (portRet != null && benchRet != null) ? portRet - benchRet : null, series };
  }

  /* ---------- 税务估算 ---------- */
  const TAX_DEFAULT = { cnDiv: { le1m: 0.20, m1to1y: 0.10, gt1y: 0 }, cnCapGain: 0, usDiv: 0.30, usCapGain: 0 };
  /** 按市场汇总已实现资本利得（均价法，逐年；覆盖股票/基金/理财/债券的卖出与赎回） */
  function realizedGainsByYear(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const out = { CN: {}, US: {} };
    (S.assets || []).filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const mk = (a.market === 'US' || a.currency === 'USD') ? 'US' : 'CN';
      let qty = 0, costCNY = 0;
      eventsOf(S, a.id, asOf).forEach(e => {
        const f = e.fx || 1;
        const act = actionOf(e);
        const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
        const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt;
        const fee = e.fee || 0;
        if (act === 'opening' || act === 'buy' || act === 'invest') {
          qty += tQty; costCNY += (gross + fee) * f;
        } else if (act === 'sell' || act === 'redeem') {
          const proceedsCNY = (gross - fee) * f;
          let gain = 0;
          if (tQty > 0 && qty > 1e-9) {
            const avg = costCNY / qty;
            const take = Math.min(tQty, qty);
            gain = proceedsCNY - avg * take;
            costCNY -= avg * take; qty -= take;
          } else if (costCNY > 0) {
            const ratio = Math.min(1, proceedsCNY / costCNY);
            gain = proceedsCNY - costCNY * ratio;
            costCNY -= costCNY * ratio; qty = 0;
          }
          const y = String(e.date).slice(0, 4);
          out[mk][y] = round2((out[mk][y] || 0) + gain);
        } else if (act === 'bonus') qty += tQty;
        else if (act === 'split') qty *= (e.ratio || 1);
      });
    });
    return out;
  }

  /**
   * 指定日期的持仓批次（FIFO 口径），仅用于分红税按批次分摊。
   * 金额口径（无 qty）的赎回无法精确拆分批次，按“全部赎回”处理。
   */
  function lotsAt(a, S, asOfDate) {
    const lots = [];
    eventsOf(S, a.id, asOfDate).forEach(e => {
      const act = actionOf(e);
      const q = +e.qty || 0;
      if (act === 'opening' || act === 'buy' || act === 'invest') {
        if (q > 0) lots.push({ q, date: e.date });
      } else if (act === 'sell' || act === 'redeem') {
        if (q > 0) {
          let need = q;
          while (need > 1e-9 && lots.length) {
            const lot = lots[0];
            const take = Math.min(need, lot.q);
            lot.q -= take; need -= take;
            if (lot.q <= 1e-9) lots.shift();
          }
        } else {
          lots.length = 0;              // 金额口径赎回：视同全部赎回
        }
      } else if (act === 'bonus') {
        if (q > 0) {
          if (lots.length) lots[lots.length - 1].q += q;
          else lots.push({ q, date: e.date });
        }
      } else if (act === 'split') {
        lots.forEach(l => { l.q *= (e.ratio || 1); });
      }
    });
    return lots.filter(l => l.q > 1e-9);
  }

  function taxEstimate(S, rules, opts) {
    const R = Object.assign({}, TAX_DEFAULT, rules || {}, {
      cnDiv: Object.assign({}, TAX_DEFAULT.cnDiv, (rules || {}).cnDiv || {}),
    });
    const accountId = opts && opts.accountId;
    const asOf = asOfOf(opts);
    const dividends = [];
    (S.assets || []).filter(a => a.type === 'stock' && (!accountId || a.accountId === accountId)).forEach(a => {
      const isUS = a.market === 'US';
      eventsOf(S, a.id, asOf).filter(e => actionOf(e) === 'div').forEach(e => {
        const amtCNY = (e.amount || 0) * (e.fx || 1);
        let rate, tax;
        if (isUS) {
          rate = R.usDiv; tax = amtCNY * rate;
        } else {
          const lots = lotsAt(a, S, e.date);
          const totalQty = lots.reduce((s, l) => s + l.q, 0);
          if (totalQty > 0) {
            /* 按各批次份额占比分摊分红，再按批次买入日定档 —— 这是对
               “先进先出”规则的逐批次近似，比“统一按最早买入日”更接近实际。 */
            tax = 0;
            lots.forEach(l => {
              const days = (new Date(e.date) - new Date(l.date)) / 86400000;
              const r = days <= 30 ? R.cnDiv.le1m : days <= 365 ? R.cnDiv.m1to1y : R.cnDiv.gt1y;
              tax += amtCNY * (l.q / totalQty) * r;
            });
            rate = amtCNY > 0 ? tax / amtCNY : 0;
          } else {
            /* 兜底：无批次信息（历史脏数据）→ 按最早买入日 */
            const buys = eventsOf(S, a.id, e.date).filter(x => {
              const k = actionOf(x); return k === 'buy' || k === 'opening';
            });
            const firstBuy = buys[0] ? buys[0].date : null;
            const days = firstBuy ? (new Date(e.date) - new Date(firstBuy)) / 86400000 : 9999;
            rate = days <= 30 ? R.cnDiv.le1m : days <= 365 ? R.cnDiv.m1to1y : R.cnDiv.gt1y;
            tax = amtCNY * rate;
          }
        }
        dividends.push({ asset: a.name, market: isUS ? 'US' : 'CN', date: e.date, amount: round2(amtCNY),
          rate, tax: round2(tax), net: round2(amtCNY - tax) });
      });
    });
    const gains = realizedGainsByYear(S, opts);
    const capGain = { CN: { gain: 0, tax: 0 }, US: { gain: 0, tax: 0 } };
    Object.keys(gains).forEach(mk => {
      Object.keys(gains[mk]).forEach(y => {
        const g = gains[mk][y];
        capGain[mk].gain = round2(capGain[mk].gain + g);
        if (g > 0) capGain[mk].tax = round2(capGain[mk].tax + g * (mk === 'US' ? R.usCapGain : R.cnCapGain));
      });
    });
    const divTax = round2(dividends.reduce((s, d) => s + d.tax, 0));
    return { dividends, capGain, divTax, capGainTax: round2(capGain.CN.tax + capGain.US.tax),
      totalTax: round2(divTax + capGain.CN.tax + capGain.US.tax), rules: R };
  }

  /* ---------- 定投计划：按期生成投入事件 ---------- */
  /**
   * @param {object} plan  {startMonth, months, day, amount, note}
   * @param {object} [opts] {until: 'YYYY-MM-DD'} 只生成不晚于该日期的期次（默认不限制）
   */
  function dcaGenerate(plan, opts) {
    const out = [];
    const until = opts && opts.until;
    const [y0, m0] = String(plan.startMonth || '2026-01').split('-').map(Number);
    for (let i = 0; i < (plan.months || 12); i++) {
      const m = (m0 - 1) + i;
      const y = y0 + Math.floor(m / 12), mm = (m % 12) + 1;
      /* 扣款日不得超过当月最后一天（1~28 由接口校验，历史数据可能更大） */
      const lastDay = new Date(y, mm, 0).getDate();
      const day = Math.min(Math.max(1, plan.day || 1), lastDay);
      const date = `${y}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (until && date > until) break;
      out.push({ date,
        kind: 'invest', side: null, qty: plan.qty || null, price: plan.price || null,
        amount: plan.amount, fee: 0, fx: plan.fx || 1, note: plan.note || '定投' });
    }
    return out;
  }

  /* ---------- 止盈止损预警 ---------- */
  function checkAlerts(S, opts) {
    const out = [];
    (S.assets || []).forEach(a => {
      const al = a.alerts; if (!al) return;
      const r = calcAsset(a, S, opts);
      /* 已清仓不再预警：否则会用过期单价/市值触发假信号 */
      if (!(r.qty > 0)) return;
      const price = unitPriceOf(a, r.qty, true);
      /* 收益率阈值用「当前持仓浮盈率」= 浮动 / 剩余成本；
         不能用「累计收益 / 证券净投入」——本金收回后分母趋近 0，阈值会失真。 */
      const posRate = r.costCNY > 0 ? r.unrealCNY / r.costCNY : null;
      if (al.takeProfitPrice && price >= al.takeProfitPrice) out.push({ asset: a.name, level: '止盈', msg: `现价 ${price} 达到止盈线 ${al.takeProfitPrice}` });
      if (al.stopLossPrice && price <= al.stopLossPrice) out.push({ asset: a.name, level: '止损', msg: `现价 ${price} 跌破止损线 ${al.stopLossPrice}` });
      if (al.takeProfitRate && posRate != null && posRate >= al.takeProfitRate) out.push({ asset: a.name, level: '止盈', msg: `持仓浮盈 ${(posRate * 100).toFixed(1)}% 达 ${(al.takeProfitRate * 100)}%` });
      if (al.stopLossRate && posRate != null && posRate <= -al.stopLossRate) out.push({ asset: a.name, level: '止损', msg: `持仓浮亏 ${(posRate * 100).toFixed(1)}% 触 ${(-al.stopLossRate * 100)}%` });
    });
    return out;
  }

  /* 导出面：仅保留被 routes / services / tests 实际消费的符号；
     DEFAULTS / assetFx / eventsOf / actionOf / unitPriceOf / assetTotal /
     netDepositByMonth / netInvestByMonth 为内部实现细节，不再对外导出（实现仍在，行为不变） */
  return { TAX_DEFAULT, ALLOC_DEFAULT, TODAY, currentFx,
    calcAsset, accountCash, cashFlowSummary, marginBalanceAt, costBasisAt,
    accountSummary, securityAggregation, summary, realizedByMonth, monthRows, yearRows,
    xirr, portfolioFlows, portfolioXirr, annualized, holdingDays, twr, allocation, concentration, benchmark,
    realizedGainsByYear, taxEstimate, dcaGenerate, checkAlerts };
});
