<template>
  <div>
    <div class="page-head">
      <div>
        <h2>绩效分析</h2>
        <div class="sub">XIRR 资金加权、TWR 时间加权与基准对比；月末快照是 TWR 与基准曲线的输入（在「数据」页录入）</div>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi"><div class="label">XIRR 年化</div><div class="val num" :class="signClass(perf.xirr)">{{ signedPct(perf.xirr) }}</div><div class="sub">资金加权，含每笔投入时点</div></div>
      <div class="kpi"><div class="label">TWR 时间加权</div><div class="val num" :class="signClass(perf.twr)">{{ signedPct(perf.twr) }}</div><div class="sub">证券子组合，剔除资金进出影响</div></div>
      <div class="kpi"><div class="label">简单年化</div><div class="val num" :class="signClass(perf.simpleAnnualized)">{{ signedPct(perf.simpleAnnualized) }}</div><div class="sub">累计收益率按持有天数折算年化（复利/几何）</div></div>
      <div class="kpi"><div class="label">累计收益率</div><div class="val num" :class="signClass(perf.cumulativeRate)">{{ signedPct(perf.cumulativeRate) }}</div><div class="sub">持有 {{ perf.holdingDays || 0 }} 天</div></div>
      <div class="kpi"><div class="label">基准 α</div><div class="val num" :class="signClass(alpha)">{{ signedPct(alpha) }}</div><div class="sub">组合 TWR − 基准涨跌</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>TWR vs 基准（{{ store.settings?.benchmarkCode || 'CSI300' }}，证券子组合月度累计）</h3>
        <EChart :option="twrOption" height="320px" />
        <p class="form-tip" style="margin-top:8px">
          基准点位在「数据」页按月录入；缺快照月份曲线断点，不做插值。
        </p>
      </div>
      <div class="card">
        <h3>XIRR 现金流（出入金，CNY；期初建仓另计）</h3>
        <EChart :option="cashOption" height="320px" />
        <p class="form-tip" style="margin-top:8px">
          柱体为实际出入金（蓝=入金，灰=出金），红点为 <b>XIRR 的期末价值＝持仓市值 + 账户现金 − 融资</b>（真实可变现净值）；买入证券属于内部资产形态转换，不计入现金流；融资借款与偿还属于负债变动，同样不计入外部现金流。<b>期初建仓作为记账前的初始流出计入 XIRR，图中不单独画柱。</b>
        </p>
      </div>
    </div>

    <div class="card">
      <h3>月度收益率对比</h3>
      <el-table :data="monthRows" size="small" empty-text="暂无快照/基准数据">
        <el-table-column prop="month" label="月份" width="110" />
        <el-table-column label="组合 TWR（累计）" align="right">
          <template #default="{ row }"><span :class="signClass(row.port)">{{ signedPct(row.port) }}</span></template>
        </el-table-column>
        <el-table-column label="基准涨跌（累计）" align="right">
          <template #default="{ row }"><span :class="signClass(row.bench)">{{ signedPct(row.bench) }}</span></template>
        </el-table-column>
        <el-table-column label="月度超额 α" align="right">
          <template #default="{ row }"><span :class="signClass(row.alpha)">{{ signedPct(row.alpha) }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <h3>口径说明</h3>
      <div class="tbl-wrap is-text">
        <table class="tbl">
          <thead><tr><th style="width:120px">指标</th><th>含义与口径</th></tr></thead>
          <tbody>
            <tr><td><b>XIRR</b></td><td>资金加权内部收益率，把每笔出入金（及<b>期初建仓本金</b>）与<b>期末可变现净值（持仓市值 + 现金 − 融资）</b>作为现金流，按天精确年化，适合评估“我这笔钱赚得怎么样”。融资借款不构成外部投入，故不计入现金流</td></tr>
            <tr><td><b>TWR</b></td><td>时间加权收益率，按月末快照链式连乘，剔除<b>证券净投入</b>的时点影响；快照只含持仓市值，因此衡量的是证券子组合（不含现金）</td></tr>
            <tr><td><b>α</b></td><td>组合 TWR 减去同期基准涨跌幅，正值表示跑赢基准</td></tr>
            <tr><td><b>简单年化</b></td><td>把累计收益率按持有天数折算为<b>复利（几何）年化</b>，未考虑资金进出时点，仅作粗略参考。注意与 XIRR（考虑时点、资金加权）不同</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePortfolioStore } from '../stores/portfolio';
import { signedPct, signClass, money } from '../utils/format';
import EChart from '../components/EChart.vue';

const store = usePortfolioStore();
const perf = computed(() => store.d?.performance || {});
const bench = computed(() => store.benchmark || { series: [] });
const alpha = computed(() => bench.value.alpha ?? null);

const monthRows = computed(() => {
  const series = bench.value.series || [];
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const cur = series[i];
    const prevPort = i === 0 ? null : series[i - 1].port;
    const prevBench = i === 0 ? null : series[i - 1].bench;
    out.push({
      month: cur.month,
      port: cur.port,
      bench: cur.bench,
      /* 基准缺失时不能把 null 当 0 相减，否则 α 会显示为组合收益 */
      alpha: (cur.port == null || cur.bench == null) ? null : cur.port - cur.bench,
      monthPort: (cur.port == null || prevPort == null) ? null : cur.port - prevPort,
      monthBench: (cur.bench == null || prevBench == null) ? null : cur.bench - prevBench,
    });
  }
  return out;
});

const twrOption = computed(() => {
  const s = bench.value.series || [];
  return {
    tooltip: { trigger: 'axis', valueFormatter: v => (v * 100).toFixed(2) + '%' },
    legend: { data: ['组合 TWR', '基准'], top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: s.map(r => r.month) },
    yAxis: { type: 'value', axisLabel: { formatter: v => (v * 100).toFixed(0) + '%' } },
    series: [
      { name: '组合 TWR', type: 'line', smooth: true, data: s.map(r => r.port), itemStyle: { color: '#e0463e' } },
      { name: '基准', type: 'line', smooth: true, data: s.map(r => r.bench), itemStyle: { color: '#2b6cb0' } },
    ],
  };
});

const cashOption = computed(() => {
  // 注意：/api/state 的 cashFlow 为 {amount(账户币种), fx}，CNY 口径需 amount × fx；
  // （早期版本误读不存在的 f.amountCNY，导致柱子全为无效值）
  const flows = [...store.cashFlows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const points = flows.map(f => {
    const cny = Number(f.amount || 0) * (Number(f.fx) || 1);
    return {
      date: f.date,
      value: f.kind === 'deposit' ? cny : -cny,
      itemStyle: { color: f.kind === 'deposit' ? '#2b6cb0' : '#9aa6b2' },
    };
  });
  /* 与引擎口径一致：XIRR 期末可变现净值 = 持仓市值 + 账户现金 − 融资 */
  const total = (store.kpis.mv || 0) + (store.kpis.cash || 0) - (store.kpis.marginTotal || 0);
  if (total) {
    points.push({ date: '当前', value: total, itemStyle: { color: '#e0463e' } });
  }
  return {
    tooltip: {
      trigger: 'axis',
      formatter: p => `${p[0].name}<br/>¥${money(p[0].value)}`,
    },
    grid: { left: 70, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: points.map(p => p.date), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { formatter: v => (v / 1000) + 'k' } },
    series: [{ type: 'bar', data: points }],
  };
});
</script>
