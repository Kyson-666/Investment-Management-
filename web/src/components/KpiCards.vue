<template>
  <div class="kpi-row">
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">持仓市值 (CNY)</div>
      <div class="val num">¥{{ money(k.mv) }}</div>
      <div class="sub num muted" v-if="k.marginTotal > 0">融资 {{ money(k.marginTotal) }}</div>
      <div class="sub num muted" v-if="k.cashCurrent != null">
        现金 {{ money(k.cashCurrent) }}
        <template v-if="Math.abs(k.cashFxGain || 0) >= 0.01"> · 汇兑 {{ signedMoney(k.cashFxGain) }}</template>
      </div>
      <div class="sub num muted" v-else>—</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计投入 (CNY)</div>
      <div class="val num">¥{{ money(k.invest) }}</div>
      <div class="sub num muted">净入金（无出入金记录时期初建仓充当基数）</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计收益 (CNY)</div>
      <div class="val num" :class="signClass(k.profit)">{{ signedMoney(k.profit) }}</div>
      <div class="sub num" :class="signClass(k.rate)">
        收益率 {{ signedPct(k.rate) }} ｜ 已实现 {{ signedMoney(k.real) }} · 浮动 {{ signedMoney(k.unreal) }}
        <template v-if="Math.abs(k.cashAdjust || 0) >= 0.01"> · 现金校准 {{ signedMoney(k.cashAdjust) }}</template>
      </div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">XIRR 年化</div>
      <div class="val num" :class="signClass(k.xirr)">{{ k.xirr == null ? '—' : signedPct(k.xirr) }}</div>
      <div class="sub">按出入金 + 期初建仓现金流 ｜ 持有 {{ k.holdingDays || 0 }} 天</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">TWR 时间加权</div>
      <div class="val num" :class="signClass(k.twr)" :title="k.twr == null ? '需要至少 2 个月的月末快照才能计算（数据页可补录；每月最后一天会自动记录）' : ''">
        {{ k.twr == null ? '—' : signedPct(k.twr) }}
      </div>
      <div class="sub">{{ k.twr == null ? '需 ≥2 个月末快照' : '证券子组合，剔除资金进出影响' }}</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">基准 α ({{ k.benchmarkCode || 'CSI300' }})</div>
      <div class="val num" :class="signClass(k.alpha)" :title="k.alpha == null ? '需要「≥2 个月末快照」+「≥2 条基准点位」才能计算（数据页可补录快照、一键同步基准点位）' : ''">
        {{ k.alpha == null ? '—' : signedPct(k.alpha) }}
      </div>
      <div class="sub">{{ k.alpha == null ? '需快照 + 基准点位' : '证券子组合 TWR − 基准涨跌' }}</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">本年收益 ({{ yearLabel }})</div>
      <div class="val num" :class="signClass(k.yearProfit)">{{ k.yearProfit == null ? '—' : signedMoney(k.yearProfit) }}</div>
      <div class="sub num" :class="signClass(k.yearProfit)">
        已实现 {{ k.yearReal == null ? '—' : signedMoney(k.yearReal) }}
        ＋ 浮动 {{ k.yearFloat == null ? '—' : signedMoney(k.yearFloat) }}
      </div>
      <div class="sub num muted" :title="yearBaseTitle">
        年收益率 <span :class="signClass(k.yearRate)">{{ k.yearRate == null ? '—' : signedPct(k.yearRate) }}</span>
        <template v-if="k.yearBaseInvest != null">（本金 {{ money(k.yearBaseInvest) }}）</template>
      </div>
    </div>
  </div>

  <!-- 数据一致性告警（如：期初建仓本金与入金重复统计） -->
  <div v-if="warnings.length" class="dup-warn">
    <div v-for="w in warnings" :key="w.code" class="dup-item">
      <div class="dup-msg">⚠️ <b>{{ w.title }}</b> —— {{ w.msg }}</div>
      <button class="dup-dismiss" @click="store.dismissWarning(w.code)">不再提示</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePortfolioStore } from '../stores/portfolio';
import { money, signedMoney, signedPct, signClass } from '../utils/format';

const store = usePortfolioStore();
const { kpis: k, warnings, pulse } = storeToRefs(store);

/** 本年收益的统计区间标签 */
const yearLabel = computed(() => `${new Date().getFullYear()}/1/1 – 12/31`);
/** 年收益率的本金来源说明（悬停可见） */
const yearBaseTitle = computed(() => {
  const v = k.value || {};                      // 注意：解构名是 k，不能写 kpis
  const y = new Date().getFullYear();
  if (v.yearRate == null) return '本年收益或投入本金不足，暂不计算年收益率';
  if (v.yearBaseSource === 'prev-year-end') {
    return `年收益率 = 本年收益 ÷ 年投入本金；本金取 ${y - 1}/12/31 的证券净资产（持仓市值 − 融资，¥${v.yearBaseInvest}）`;
  }
  return `年收益率 = 本年收益 ÷ 年投入本金；因缺少 ${y - 1}/12/31 的月末快照，本金退化为本年净入金（¥${v.yearBaseInvest}）`;
});

const flashing = ref(false);
let timer = null;
watch(pulse, () => {
  flashing.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => { flashing.value = false; }, 1100);
});
</script>

<style scoped>
.dup-warn {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  color: #b88230;
  font-size: 13px;
  line-height: 1.75;
}
.dup-warn b { color: #a06a10; }
.dup-item { display: flex; gap: 10px; align-items: flex-start; }
.dup-msg { flex: 1; min-width: 0; }
.dup-dismiss {
  flex: none; margin-top: 1px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
  background: transparent; border: 1px solid #e6c78a; color: #a06a10;
  font-size: 12px; line-height: 1.5; white-space: nowrap;
}
.dup-dismiss:hover { background: #f7ecd8; }
@media (max-width: 768px) {
  .dup-warn { font-size: 12px; line-height: 1.7; padding: 9px 12px; }
}
</style>
