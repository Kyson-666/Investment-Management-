<template>
  <div>
    <div class="page-head">
      <div>
        <h2>资产配置</h2>
        <div class="sub">证券持仓的大类 / 市场 / 账户暴露分析（不含账户现金）；设定目标比例并计算再平衡建议；偏离度 = Σ|当前−目标|/2</div>
      </div>
      <div class="actions">
        <el-button type="primary" :loading="saving" @click="save">保存目标比例</el-button>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="label">持仓市值 (CNY)</div><div class="val num">¥{{ money(alloc.total) }}</div><div class="sub">账户现金 ¥{{ money(alloc.cashCurrent != null ? alloc.cashCurrent : alloc.cash) }}（不参与目标比例）</div></div>
      <div class="kpi"><div class="label">单边需调整金额</div><div class="val num" :class="driftLevel.cls">¥{{ money(alloc.drift) }}</div><div class="sub">Σ|当前−目标|/2</div></div>
      <div class="kpi"><div class="label">偏离度</div><div class="val num" :class="driftLevel.cls">{{ pct(alloc.driftPct) }}</div></div>
      <div class="kpi"><div class="label">再平衡建议</div>
        <div class="val" style="font-size:15px;padding-top:6px"><span :class="'badge ' + driftLevel.badge">{{ driftLevel.text }}</span></div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>当前大类配置</h3>
        <EChart :option="donutOption" height="300px" />
      </div>
      <div class="card">
        <h3>市场 / 币种暴露（CNY 折算）</h3>
        <div style="margin:10px 0">
          <div v-for="m in marketRows" :key="m.key" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span>{{ m.label }} <span class="muted">({{ m.ccy }})</span></span>
              <span class="num">¥{{ money(m.mv) }} · {{ pct(m.mv / (alloc.total || 1)) }}</span>
            </div>
            <div class="alloc-bar"><div :style="{ width: (m.mv / (alloc.total || 1) * 100) + '%', background: m.color }"></div></div>
          </div>
        </div>
        <p class="form-tip">境外资产按当前汇率折算，汇率波动会改变人民币口径下的市场暴露。</p>
      </div>
    </div>

    <div class="grid-sidebar">
      <div class="card">
        <h3>目标比例与再平衡</h3>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>
              <th>类型</th><th class="num">当前金额</th><th class="num">当前占比</th>
              <th style="width:190px">目标占比</th><th class="num">目标金额</th><th class="num">应调整</th><th>建议</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in typeRows" :key="r.type">
                <td><span :class="'badge ' + TYPE_BADGE[r.type]">{{ TYPE_LABEL[r.type] }}</span></td>
                <td class="num">¥{{ money(r.cur) }}</td>
                <td class="num">{{ pct(r.curPct) }}</td>
                <td>
                  <el-slider v-model="targets[r.type]" :min="0" :max="100" :step="5" :format-tooltip="v => v + '%'" />
                </td>
                <td class="num">¥{{ money(r.tgtAmt) }}</td>
                <td class="num bold" :class="signClass(r.adjust)">{{ signedMoney(r.adjust) }}</td>
                <td>
                  <el-tag v-if="Math.abs(r.diff) < alloc.total * 0.02" size="small" type="info" effect="plain">基本平衡</el-tag>
                  <el-tag v-else-if="r.diff > 0" size="small" type="danger" effect="plain">超配，建议卖出</el-tag>
                  <el-tag v-else size="small" type="success" effect="plain">低配，建议买入</el-tag>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="form-tip" style="margin-top:10px">
          「应调整」正数 = 需买入金额，负数 = 需卖出金额；目标比例合计当前 <b :class="targetSum === 100 ? 'pos' : 'neg'">{{ targetSum }}%</b>，仅为再平衡参考，不构成投资建议。
        </p>
      </div>

      <div class="card">
        <h3>账户分布</h3>
        <div v-for="a in store.accountsAgg" :key="a.id" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>{{ a.name }} <span class="muted">{{ a.currency }}</span></span>
            <span class="num">¥{{ money(a.mvCNY) }} · {{ pct(a.mvCNY / (alloc.total || 1)) }}</span>
          </div>
          <div class="alloc-bar"><div :style="{ width: (a.mvCNY / (alloc.total || 1) * 100) + '%', background: barColor(a.id) }"></div></div>
        </div>
        <div v-if="!store.accountsAgg.length" class="empty">暂无账户</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, watch, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { authApi } from '../api';
import { money, signedMoney, pct, signClass, TYPE_LABEL, TYPE_BADGE, TYPE_COLORS } from '../utils/format';
import EChart from '../components/EChart.vue';

const store = usePortfolioStore();
const saving = ref(false);
const alloc = computed(() => store.d?.allocation || { total: 0, rows: [], drift: 0, driftPct: 0 });

// 滑块用百分数（0~100），保存时换算为小数
const targets = reactive({ stock: 60, fund: 20, wealth: 15, bond: 5 });
watch(() => store.settings, s => {
  const t = s?.allocTargets || {};
  for (const k of ['stock', 'fund', 'wealth', 'bond']) {
    if (t[k] != null) targets[k] = Math.round(t[k] * 100);
  }
}, { immediate: true });

const typeRows = computed(() => {
  const total = alloc.value.total || 0;
  const map = {};
  for (const r of alloc.value.rows) map[r.type] = r;
  return ['stock', 'fund', 'wealth', 'bond'].map(type => {
    const cur = map[type]?.cur || 0;
    const tgtPct = (targets[type] || 0) / 100;
    const tgtAmt = total * tgtPct;
    const diff = cur - tgtAmt;
    return { type, cur, curPct: total ? cur / total : 0, tgtPct, tgtAmt, diff, adjust: -diff };
  });
});
const targetSum = computed(() => Object.values(targets).reduce((s, v) => s + (v || 0), 0));

const marketRows = computed(() => {
  let cn = 0, us = 0;
  for (const h of store.holdings) {
    if (h.asset.currency === 'USD') us += h.mvCNY || 0;
    else cn += h.mvCNY || 0;
  }
  return [
    { key: 'CN', label: '境内（CNY 计价）', ccy: 'CNY', mv: cn, color: '#e0463e' },
    { key: 'US', label: '境外（USD 计价）', ccy: 'USD', mv: us, color: '#2b6cb0' },
  ];
});

const driftLevel = computed(() => {
  const p = alloc.value.driftPct || 0;
  if (p <= 0.03) return { text: '基本贴合目标', cls: 'pos', badge: 'badge-ok' };
  if (p <= 0.10) return { text: '轻度偏离，可观察', cls: '', badge: 'badge-warn' };
  return { text: '偏离较大，建议再平衡', cls: 'neg', badge: 'badge-danger' };
});

const donutOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>¥${money(p.value)} (${p.percent}%)` },
  legend: { bottom: 0 },
  series: [{
    type: 'pie', radius: ['42%', '70%'], center: ['50%', '45%'],
    label: { formatter: '{b}\n{d}%', fontSize: 12 },
    data: typeRows.value
      .filter(r => r.cur > 0)
      .map(r => ({ name: TYPE_LABEL[r.type], value: Math.round(r.cur * 100) / 100, itemStyle: { color: TYPE_COLORS[r.type] } })),
  }],
}));

function barColor(i) {
  return ['#1f3a5f', '#2b6cb0', '#17a2b8', '#3aa6a0', '#7c52b8'][Number(i) - 1] || '#9aa6b2';
}

async function save() {
  if (targetSum.value !== 100) {
    try {
      await ElMessageBox.confirm(`目标比例合计为 ${targetSum.value}%，仍要保存？`, '提示', {
        confirmButtonText: '保存', cancelButtonText: '返回', type: 'warning',
      });
    } catch { return; }
  }
  saving.value = true;
  try {
    const allocTargets = {};
    for (const k of Object.keys(targets)) allocTargets[k] = (targets[k] || 0) / 100;
    await authApi.putSettings({ allocTargets });
    ElMessage.success('目标比例已保存，再平衡建议已更新');
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
