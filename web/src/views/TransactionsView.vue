<template>
  <div>
    <div class="page-head">
      <div>
        <h2>交易流水</h2>
        <div class="sub">全部交易与现金流事件，成本/盈亏的唯一数据源（USD 事件显示锁定汇率）；买入 / 卖出 / 申购 / 赎回 / 分红可录手续费，券商账户可录本次融资</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="openAdd">+ 录入流水</el-button>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <el-select v-model="assetFilter" placeholder="全部标的" clearable size="small" style="width:200px" filterable>
          <el-option v-for="a in store.assets" :key="a.id" :label="a.name" :value="a.id" />
        </el-select>
        <el-select v-model="kindFilter" placeholder="全部类型" clearable size="small" style="width:140px">
          <el-option v-for="(label, key) in EVENT_LABEL" :key="key" :label="label" :value="key" />
        </el-select>
        <el-date-picker v-model="dateRange" type="daterange" size="small" range-separator="至"
          start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width:240px" />
        <span class="spacer"></span>
        <span class="muted">共 {{ rows.length }} 条</span>
      </div>

      <!-- 移动端：卡片列表（12 列宽表在窄屏横向滚动体验差，改为纵向卡片，字段与桌面表格一一对应） -->
      <div v-if="isMobile" class="tx-cards">
        <div v-for="row in rows" :key="row.id" class="tx-card">
          <div class="tx-top">
            <span class="tx-date num">{{ row.date }}</span>
            <span class="badge" :class="kindBadge(row.kind)">{{ EVENT_LABEL[row.kind] }}</span>
            <span v-if="row.isT" class="badge badge-warn">T</span>
            <span class="spacer"></span>
            <b class="num">{{ cnyAmount(row) }}</b>
          </div>
          <div class="tx-line">
            <span class="k">标的</span>
            <span>{{ assetOf(row.assetId)?.name || '—' }}</span>
          </div>
          <div class="tx-line">
            <span class="k">账户</span>
            <span class="muted">{{ store.accountName(assetOf(row.assetId)?.accountId) }}</span>
          </div>
          <div class="tx-line" v-if="row.qty != null || row.price != null">
            <span class="k">数量 / 价格</span>
            <span class="num">
              {{ row.qty != null ? money(row.qty, 0) : '—' }} × {{ row.price != null ? money(row.price, 3) : '—' }}
            </span>
          </div>
          <div class="tx-line" v-if="row.amount != null || row.ratio != null">
            <span class="k">金额</span>
            <span class="num">{{ row.amount != null ? money(row.amount) + ' ' + ccyName(assetOf(row.assetId)?.currency) : '比例 ' + row.ratio }}</span>
          </div>
          <div class="tx-line" v-if="(row.fx && row.fx !== 1) || row.fee">
            <span class="k">汇率 / 手续费</span>
            <span class="num muted">
              {{ row.fx && row.fx !== 1 ? Number(row.fx).toFixed(4) : '—' }}
              <template v-if="row.fee"> / {{ money(row.fee) }}</template>
            </span>
          </div>
          <div class="tx-line" v-if="row.note">
            <span class="k">备注</span>
            <span class="muted">{{ row.note }}</span>
          </div>
          <div class="tx-actions">
            <el-button size="small" @click="edit(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
          </div>
        </div>
        <div v-if="!rows.length" class="empty">暂无流水</div>
      </div>

      <el-table v-else :data="rows" stripe size="small" empty-text="暂无流水">
        <el-table-column prop="date" label="日期" width="105" />
        <el-table-column label="账户" width="110">
          <template #default="{ row }">{{ store.accountName(assetOf(row.assetId)?.accountId) }}</template>
        </el-table-column>
        <el-table-column label="标的" min-width="130">
          <template #default="{ row }">
            {{ assetOf(row.assetId)?.name || '—' }}
            <span v-if="row.isT" class="badge badge-warn" style="margin-left:4px">T</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }"><span class="badge" :class="kindBadge(row.kind)">{{ EVENT_LABEL[row.kind] }}</span></template>
        </el-table-column>
        <el-table-column label="数量" width="90" align="right">
          <template #default="{ row }">{{ row.qty != null ? money(row.qty, 0) : '—' }}</template>
        </el-table-column>
        <el-table-column label="价格" width="90" align="right">
          <template #default="{ row }">{{ row.price != null ? money(row.price, 3) : '—' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="150" align="right">
          <template #default="{ row }">
            {{ row.amount != null ? money(row.amount) + ' ' + ccyName(assetOf(row.assetId)?.currency) : (row.ratio != null ? '比例 ' + row.ratio : '—') }}
          </template>
        </el-table-column>
        <el-table-column label="汇率" width="80" align="right">
          <template #default="{ row }">{{ row.fx && row.fx !== 1 ? Number(row.fx).toFixed(4) : '—' }}</template>
        </el-table-column>
        <el-table-column label="手续费" width="80" align="right">
          <template #default="{ row }">{{ row.fee ? money(row.fee) : '—' }}</template>
        </el-table-column>
        <el-table-column label="CNY 金额" width="130" align="right">
          <template #default="{ row }">
            <span class="num">{{ cnyAmount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="110" show-overflow-tooltip>
          <template #default="{ row }"><span class="muted">{{ row.note || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 选择标的后录入 -->
    <el-dialog v-model="pickDlg" title="选择标的" width="420px">
      <el-select v-model="pickAsset" placeholder="选择要录入流水的标的" filterable style="width:100%">
        <el-option v-for="a in store.assets" :key="a.id"
          :label="`${a.name}（${TYPE_LABEL[a.type] || a.type}·${a.currency}）`" :value="a.id" />
      </el-select>
      <template #footer>
        <el-button @click="pickDlg = false">取消</el-button>
        <el-button type="primary" @click="confirmPick">下一步</el-button>
      </template>
    </el-dialog>

    <EventDialog v-if="eventAsset" v-model="eventDlg" :asset="eventAsset" :event="editingEvent" @saved="afterChange" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { eventsApi } from '../api';
import { money, EVENT_LABEL, TYPE_LABEL, ccyName } from '../utils/format';
import EventDialog from '../components/EventDialog.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const assetFilter = ref('');
const kindFilter = ref('');
const dateRange = ref(null);

/* 视口判定：≤768px 用卡片列表替代宽表格，字段完全一致、仅呈现方式不同 */
const isMobile = ref(false);
function syncMobile() {
  isMobile.value = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}
onMounted(() => {
  syncMobile();
  window.addEventListener('resize', syncMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', syncMobile));

const pickDlg = ref(false);
const pickAsset = ref('');
const eventDlg = ref(false);
const eventAsset = ref(null);
const editingEvent = ref(null);

const rows = computed(() => store.events.filter(e => {
  if (assetFilter.value && e.assetId !== assetFilter.value) return false;
  if (kindFilter.value && e.kind !== kindFilter.value) return false;
  if (dateRange.value && dateRange.value.length === 2) {
    if (e.date < dateRange.value[0] || e.date > dateRange.value[1]) return false;
  }
  return true;
}));

function assetOf(id) { return store.assetById(id); }

function cnyAmount(r) {
  const fx = r.fx || 1;
  let v = null;
  if (r.kind === 'buy') v = (r.qty * r.price + (r.fee || 0)) * fx;
  else if (r.kind === 'sell') v = (r.qty * r.price - (r.fee || 0)) * fx;
  else if (r.amount != null) v = r.amount * fx;
  return v == null ? '—' : money(v);
}
function kindBadge(k) {
  return { buy: 'badge-cn', sell: 'badge-us', div: 'badge-warn', bonus: 'badge-fund', split: 'badge-gray',
    invest: 'badge-stock', redeem: 'badge-bond', income: 'badge-ok' }[k] || 'badge-gray';
}

function openAdd() {
  if (!store.assets.length) return ElMessage.warning('请先在「持仓」页新增资产');
  pickAsset.value = assetFilter.value || '';
  pickDlg.value = true;
}
function confirmPick() {
  if (!pickAsset.value) return ElMessage.warning('请选择标的');
  pickDlg.value = false;
  editingEvent.value = null;
  eventAsset.value = store.assetById(pickAsset.value);
  eventDlg.value = true;
}
function edit(row) {
  editingEvent.value = row;
  eventAsset.value = store.assetById(row.assetId);
  eventDlg.value = true;
}
async function afterChange() {
  eventDlg.value = false;
  await store.refreshAll();
}
const confirmRemove = useRemoveConfirm();
async function remove(row) {
  const a = assetOf(row.assetId);
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `确定删除 ${row.date}「${a?.name || ''}」的${EVENT_LABEL[row.kind]}记录？`,
    request: () => eventsApi.remove(row.id),
  });
}
</script>

<style scoped>
/* ---------- 移动端流水卡片（字段与桌面表格一一对应） ---------- */
.tx-cards { display: flex; flex-direction: column; gap: 10px; }
.tx-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 11px 12px;
  background: #fff;
}
.tx-top {
  display: flex; align-items: center; gap: 6px;
  padding-bottom: 8px; margin-bottom: 8px;
  border-bottom: 1px solid #f0f2f5;
}
.tx-top .spacer { flex: 1; }
.tx-top .tx-date { font-size: 12.5px; color: var(--muted); }
.tx-line {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 12.5px; line-height: 1.7;
}
.tx-line .k { color: var(--muted); flex: none; }
.tx-line > span:last-child { text-align: right; word-break: break-all; }
.tx-actions { display: flex; gap: 8px; margin-top: 10px; }
.tx-actions .el-button { flex: 1; margin-left: 0; }
</style>
