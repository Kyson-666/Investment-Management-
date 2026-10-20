<template>
  <div>
    <div class="page-head">
      <div>
        <h2>总览</h2>
        <div class="sub">全部资产持仓看板、类型分布、账户统计与排名</div>
      </div>
      <div class="actions">
        <el-button @click="ops.createAccount()">新增账户</el-button>
        <el-button type="primary" @click="ops.createAsset()">新增资产</el-button>
      </div>
    </div>

    <div class="card">
      <h3>持仓看板 <span class="hint">共 {{ store.holdings.length }} 只标的 · 点击卡片可录入流水</span></h3>
      <div v-if="store.holdings.length" class="board">
        <AssetCard v-for="h in store.holdings" :key="h.asset.id" :h="h"
          :account-name="store.accountName(h.asset.accountId)"
          @event="(p) => ops.addEvent(p)"
          @edit="(p) => ops.editAsset(p)"
          @alert="(p) => ops.setAlert(p)"
          @remove="removeAsset" />
      </div>
      <div v-else class="empty">
        <div class="big">📊</div>
        <div>还没有资产，点击右上角「新增资产」开始，或到「数据」页一键载入示例数据</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>类型分布（CNY）</h3>
        <EChart v-if="hasHolding" :option="donutOption" height="300px" />
        <div v-else class="empty">暂无持仓</div>
      </div>
      <div class="card">
        <h3>账户统计</h3>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>账户</th><th>类型</th><th class="num">持仓市值(CNY)</th><th class="num">总收益</th><th class="num">收益率</th></tr></thead>
            <tbody>
              <tr v-for="a in store.accountsAgg" :key="a.id">
                <td>{{ a.name }}</td>
                <td><span class="muted">{{ kindLabel(a.kind) }}</span></td>
                <td class="num">{{ money(a.mvCNY) }}</td>
                <td class="num" :class="signClass(a.total)">{{ signedMoney(a.total) }}</td>
                <td class="num" :class="signClass(a.ret)">{{ signedPct(a.ret) }}</td>
              </tr>
              <tr v-if="!store.accountsAgg.length"><td colspan="5" class="muted" style="text-align:center;padding:20px">暂无账户</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>持仓市值排名</h3>
      <div v-for="(r, i) in ranking" :key="r.asset.id" class="rank-row">
        <span class="muted num rank-idx">{{ i + 1 }}</span>
        <span class="rank-name">{{ r.asset.name }}</span>
        <div class="alloc-bar rank-bar"><div :style="{ width: barPct(r.mvCNY, i) + '%', background: barColor(i) }"></div></div>
        <span class="num rank-mv">¥{{ money(r.mvCNY) }}</span>
        <span class="num muted rank-pct">{{ pct(shareOf(r.mvCNY)) }}</span>
      </div>
      <div v-if="!ranking.length" class="empty">暂无数据</div>
    </div>

    <OpsDialogs ref="ops" />
  </div>
</template>

<style scoped>
.rank-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.rank-idx { width: 20px; flex: none; }
.rank-name { width: 130px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-bar { flex: 1; }
.rank-mv { width: 120px; flex: none; text-align: right; }
.rank-pct { width: 60px; flex: none; text-align: right; }

@media (max-width: 768px) {
  .rank-row { flex-wrap: wrap; gap: 6px 8px; padding-bottom: 8px; border-bottom: 1px dashed #eef1f5; }
  .rank-bar { order: 5; flex: 1 1 100%; }
  .rank-name { width: auto; flex: 1 1 auto; min-width: 0; }
  .rank-idx { width: 16px; }
  .rank-mv { width: auto; flex: none; }
  .rank-pct { width: auto; flex: none; }
}
</style>

<script setup>
import { ref, computed } from 'vue';
import { usePortfolioStore } from '../stores/portfolio';
import { assetsApi } from '../api';
import { money, signedMoney, signedPct, pct, signClass, TYPE_LABEL, TYPE_COLORS, ACCOUNT_KIND_LABEL } from '../utils/format';
import AssetCard from '../components/AssetCard.vue';
import EChart from '../components/EChart.vue';
import OpsDialogs from '../components/OpsDialogs.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const ops = ref(null);

const hasHolding = computed(() => store.holdings.some(h => h.mvCNY > 0));
const ranking = computed(() => [...store.holdings].sort((a, b) => b.mvCNY - a.mvCNY).slice(0, 10));

const donutOption = computed(() => {
  const agg = {};
  for (const h of store.holdings) {
    const t = h.asset.type;
    agg[t] = (agg[t] || 0) + h.mvCNY;
  }
  const data = Object.keys(agg).filter(k => agg[k] > 0).map(k => ({
    name: TYPE_LABEL[k], value: Math.round(agg[k] * 100) / 100, itemStyle: { color: TYPE_COLORS[k] },
  }));
  return {
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>¥${money(p.value)} (${p.percent}%)` },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'],
      label: { formatter: '{b}\n{d}%', fontSize: 12 },
      data,
    }],
  };
});

function barColor(i) {
  return ['#1f3a5f', '#2b6cb0', '#17a2b8', '#3aa6a0', '#7c52b8', '#e8a93b', '#e08a3e', '#9aa6b2'][i % 8];
}
function kindLabel(k) { return ACCOUNT_KIND_LABEL[k] || k; }

/* 防除零：无持仓或市值为 0 时返回 0，避免界面出现 NaN */
function barPct(mv, i) {
  const max = ranking.value[0]?.mvCNY || 0;
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, (mv / max) * 100));
}
function shareOf(mv) {
  const total = Number(store.kpis.mv) || 0;
  return total > 0 ? mv / total : 0;
}

const confirmRemove = useRemoveConfirm();
async function removeAsset(asset) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `确定删除资产「${asset.name}」？其全部流水将一并删除，不可恢复。`,
    request: () => assetsApi.remove(asset.id),
  });
}
</script>
