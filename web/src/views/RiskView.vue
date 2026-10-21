<template>
  <div>
    <div class="page-head">
      <div>
        <h2>风险监控</h2>
        <div class="sub">证券持仓的集中度监控（单标的 / 前5大 / 股票类占比，不含现金）、止损止盈预警与阈值设置</div>
      </div>
      <div class="actions">
        <el-button type="primary" :loading="saving" @click="saveThresholds">保存阈值</el-button>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="label">第一大持仓占比</div>
        <div class="val num" :class="conc.top1 > conc.warnSingle ? 'up' : ''">{{ pct(conc.top1) }}</div>
        <div class="sub">阈值 {{ pct(conc.warnSingle) }}</div></div>
      <div class="kpi"><div class="label">前 5 大合计</div>
        <div class="val num" :class="conc.top5 > conc.warnTop5 ? 'down' : ''">{{ pct(conc.top5) }}</div>
        <div class="sub">阈值 {{ pct(conc.warnTop5) }}</div></div>
      <div class="kpi"><div class="label">股票类占比</div>
        <div class="val num">{{ pct(stockPct) }}</div>
        <div class="sub">权益资产风险敞口</div></div>
      <div class="kpi"><div class="label">预警数</div>
        <div class="val num" :class="priceAlerts.length ? 'down' : ''">{{ priceAlerts.length }}</div>
        <div class="sub">止盈/止损（价格或持仓浮盈率）</div></div>
    </div>

    <div class="grid-sidebar">
      <div>
        <div class="card">
          <h3>持仓集中度明细</h3>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th style="width:50px">#</th><th>标的</th><th>类型</th><th class="num">市值(CNY)</th><th class="num">占比</th><th style="width:120px">可视化</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in conc.list || []" :key="r.name">
                  <td class="muted num">{{ i + 1 }}</td>
                  <td class="bold">{{ r.name }}</td>
                  <td><span :class="'badge ' + TYPE_BADGE[r.type]">{{ TYPE_LABEL[r.type] }}</span></td>
                  <td class="num">¥{{ money(r.mv) }}</td>
                  <td class="num bold" :class="r.pct > conc.warnSingle ? 'up' : ''">{{ pct(r.pct) }}</td>
                  <td><div class="alloc-bar"><div :style="{ width: (r.pct * 100) + '%', background: r.pct > conc.warnSingle ? theme.up() : theme.primary() }"></div></div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>止损 / 止盈监控</h3>
          <el-table :data="priceWatch" size="small" empty-text="尚未设置止损止盈价（在持仓卡片「预警」中设置）">
            <el-table-column label="标的" min-width="140">
              <template #default="{ row }">{{ row.name }}</template>
            </el-table-column>
            <el-table-column label="现价" width="130" align="right">
              <template #default="{ row }">{{ money(row.current, 4) }} {{ ccyName(row.ccy) }}</template>
            </el-table-column>
            <el-table-column label="止盈价" width="100" align="right">
              <template #default="{ row }">{{ row.tp ? money(row.tp, 4) : '—' }}</template>
            </el-table-column>
            <el-table-column label="止损价" width="100" align="right">
              <template #default="{ row }">{{ row.sl ? money(row.sl, 4) : '—' }}</template>
            </el-table-column>
            <el-table-column label="持仓浮盈率" width="110" align="right">
              <template #default="{ row }"><span :class="signClass(row.rate)">{{ row.rate == null ? '—' : signedPct(row.rate) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" min-width="160">
              <template #default="{ row }">
                <span v-if="(row.tp && row.current >= row.tp) || (row.tpRate && row.rate != null && row.rate >= row.tpRate)" class="badge badge-danger">已达止盈，可止盈</span>
                <span v-else-if="(row.sl && row.current <= row.sl) || (row.slRate && row.rate != null && row.rate <= -row.slRate)" class="badge badge-warn">已破止损，建议止损</span>
                <span v-else class="badge badge-ok">正常持有</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div>
        <div class="card">
          <h3>集中度预警</h3>
          <div v-if="!concAlerts.length && !priceAlerts.length" class="empty" style="padding:20px">暂无预警</div>
          <ul v-else class="alert-list">
            <li v-for="(m, i) in concAlerts" :key="'c'+i" class="alert-warn">⚠ {{ m }}</li>
            <li v-for="(a, i) in priceAlerts" :key="'p'+i" class="alert-danger">
              ● {{ alertText(a) }}
            </li>
          </ul>
        </div>

        <div class="card">
          <h3>预警阈值</h3>
          <el-form label-width="130px" size="small">
            <el-form-item label="单标的预警线">
              <el-slider v-model="th.single" :min="5" :max="60" :step="1" :format-tooltip="v => v + '%'" />
            </el-form-item>
            <el-form-item label="前5大合计预警线">
              <el-slider v-model="th.top5" :min="30" :max="100" :step="1" :format-tooltip="v => v + '%'" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveThresholds">保存</el-button>
            </el-form-item>
          </el-form>
          <p class="form-tip">单标的超过预警线、前5大合计超过阈值、股票类占比超过 70%，或止盈/止损价、持仓浮盈率触发时，每日 16:00 扫描并生成站内通知。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { alertsApi, authApi } from '../api';
import { money, pct, signedPct, signClass, TYPE_LABEL, TYPE_BADGE, ccyName } from '../utils/format';
import * as theme from '../utils/theme';

const store = usePortfolioStore();
const conc = computed(() => store.d?.concentration || { list: [], top1: 0, top5: 0, byType: {}, warnSingle: 0.2, warnTop5: 0.6, alerts: [] });
const stockPct = computed(() => conc.value.byType?.stock || 0);
const concAlerts = computed(() => conc.value.alerts || []);
const priceAlerts = ref([]);

const th = reactive({ single: 20, top5: 60 });
if (store.settings?.warnSingle != null) th.single = Math.round(store.settings.warnSingle * 100);
if (store.settings?.warnTop5 != null) th.top5 = Math.round(store.settings.warnTop5 * 100);

async function loadAlerts() {
  try {
    const r = await alertsApi.list();
    priceAlerts.value = r.priceAlerts || [];
  } catch { /* 忽略，保留空列表 */ }
}

/**
 * /api/alerts 的 priceAlerts 为对象数组 {asset, level, msg}，而集中度预警为纯字符串。
 * 此处统一渲染为可读文本，避免直接插值对象导致界面出现 "[object Object]"。
 */
function alertText(a) {
  if (a == null) return '';
  if (typeof a === 'string') return a;
  if (typeof a === 'object') {
    if (a.msg) return a.level ? `[${a.level}] ${a.msg}` : a.msg;
    return a.asset ? `${a.asset}：${a.level || '预警'}` : JSON.stringify(a);
  }
  return String(a);
}
onMounted(loadAlerts);

// 持仓中设置了止盈/止损价或收益率阈值的标的；股票用最新价，其他用单位净值
const priceWatch = computed(() => {
  const out = [];
  for (const h of store.holdings) {
    const a = h.asset;
    const tp = a.alerts?.takeProfitPrice || 0;
    const sl = a.alerts?.stopLossPrice || 0;
    const tpRate = a.alerts?.takeProfitRate || 0;
    const slRate = a.alerts?.stopLossRate || 0;
    if (!tp && !sl && !tpRate && !slRate) continue;
    if (!(h.qty > 0)) continue;                 // 已清仓不监控
    let current = 0;
    if (a.type === 'stock') current = Number(a.price) || 0;
    else current = h.qty > 0 ? (h.mvLocal || 0) / h.qty : 0;
    const rate = h.costCNY > 0 ? h.unrealCNY / h.costCNY : null;
    out.push({ name: a.name, current, ccy: a.currency, tp: tp || null, sl: sl || null,
      tpRate: tpRate || null, slRate: slRate || null, rate });
  }
  return out;
});

async function saveThresholds() {
  try {
    await authApi.putSettings({ warnSingle: th.single / 100, warnTop5: th.top5 / 100 });
    ElMessage.success('阈值已保存');
    await store.refreshAll();
    await loadAlerts();
  } catch (e) { ElMessage.error(e.message); }
}
</script>
