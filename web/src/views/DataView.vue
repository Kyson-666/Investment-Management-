<template>
  <div>
    <div class="page-head">
      <div>
        <h2>数据管理</h2>
        <div class="sub">月末快照、备份导出、导入恢复与示例数据</div>
      </div>
    </div>

    <div class="grid-sidebar">
      <div class="card">
        <h3>月末快照（TWR / 基准曲线 / 含浮动收益的输入）</h3>
        <p class="form-tip" style="margin:0 0 6px">
          💡 补录<b>至少 2 个月</b>的月末持仓市值后，「TWR 时间加权」才会出数；「基准 α」还需<b>至少 2 条基准点位</b>（下方卡片可录入/同步）。每月最后一天 23:50 会自动记录，无需手工维护。
        </p>
        <div class="sub">填<b>月末持仓市值</b>（<b>不含账户现金与融资</b>）：月度纯浮动 = 快照差 − <b>区间</b>证券净投入（连续月份即当月；断档月份会累加区间内全部买卖/申赎）。系统会按事件重放 + 净值历史派生市值用于对账；快照口径与首页「持仓市值」一致，均不含账户现金。</div>
        <div class="toolbar">
          <el-date-picker v-model="snap.month" type="month" value-format="YYYY-MM" placeholder="月份" size="small" style="width:130px" />
          <el-input-number v-model="snap.total" :min="0" :precision="2" size="small" controls-position="right" style="width:180px" placeholder="月末持仓市值" />
          <el-button size="small" @click="fillCurrent">填入当前持仓市值</el-button>
          <el-button size="small" type="primary" @click="saveSnap">保存快照</el-button>
          <el-button size="small" :loading="autofilling" @click="autofillSnaps">回填缺失快照</el-button>
          <el-button size="small" @click="showReport">差异报告</el-button>
        </div>
        <el-table :data="store.snapshots" size="small" max-height="340" empty-text="暂无快照">
          <el-table-column prop="month" label="月份" width="120" />
          <el-table-column label="月末持仓市值 (CNY)" align="right">
            <template #default="{ row }">¥{{ money(row.total) }}</template>
          </el-table-column>
          <el-table-column label="来源" width="80">
            <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="compareSnap(row)">对比派生</el-button>
              <el-button link type="danger" size="small" @click="delSnap(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="card">
        <h3>基准点位（{{ benchCode }}，TWR 对比曲线的输入）</h3>        <div class="toolbar">
          <el-date-picker v-model="bench.date" type="month" value-format="YYYY-MM" placeholder="月份" size="small" style="width:130px" />
          <el-input-number v-model="bench.value" :min="0" :precision="2" size="small" controls-position="right" style="width:180px" placeholder="月末收盘点位" />
          <el-button size="small" type="primary" @click="saveBench">保存点位</el-button>
          <el-button v-if="auth.isAdmin" size="small" :loading="syncing" @click="syncBench">自动同步</el-button>
        </div>
        <p class="form-tip" v-if="auth.isAdmin" style="margin:-2px 0 8px">
          自动同步会按<b>月末最后一个交易日的收盘点位</b>补齐历史（只写已结束的月份，幂等、不覆盖手工录入）；
          每月最后一天 23:55 也会自动同步一次。当前同步基准：<b>{{ benchCode }}</b>（切换请到「设置」页）。
        </p>
        <el-table :data="benchList" size="small" max-height="240" empty-text="暂无基准点位">
          <el-table-column prop="date" label="月份" width="120" />
          <el-table-column label="点位" align="right">
            <template #default="{ row }">{{ money(row.value) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="delBench(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div>
        <div class="card">
          <h3>备份与恢复</h3>
          <p class="form-tip">导出为单个 JSON（账户/资产/流水/快照/基准/出入金/定投/净值历史/设置），可跨设备迁移。导入会<strong>整体替换</strong>当前数据，导入前系统自动备份到服务器 <code>data/backups/</code>。</p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            <el-button type="primary" @click="doExport">导出全部数据 (JSON)</el-button>
            <el-upload :show-file-list="false" accept=".json,application/json" :before-upload="beforeImport" :http-request="doImport">
              <el-button style="width:100%">导入备份文件（覆盖当前数据）</el-button>
            </el-upload>
          </div>
        </div>
        <div class="card">
          <h3>删除归档（可恢复）</h3>
          <p class="form-tip">删除账户 / 资产 / 流水 / 现金记录前会自动归档；恢复时重新分配主键，不覆盖现有数据。</p>
          <el-table :data="archiveList" size="small" max-height="240" empty-text="暂无归档">
            <el-table-column label="类型" width="80">
              <template #default="{ row }">{{ archiveKindLabel(row.kind) }}</template>
            </el-table-column>
            <el-table-column prop="label" label="内容" min-width="140" show-overflow-tooltip />
            <el-table-column prop="createdAt" label="归档时间" width="170" show-overflow-tooltip />
            <el-table-column label="操作" width="130" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="restoreArchive(row)">恢复</el-button>
                <el-button link type="danger" size="small" @click="purgeArchive(row)">清理</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="card">
          <h3>示例数据</h3>
          <p class="form-tip">一键载入与设计原型一致的演示数据（3 个账户、5 只标的、13 笔流水、8 期快照与基准），会覆盖当前数据并自动备份。</p>
          <el-button style="width:100%" @click="loadDemo">载入示例数据</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="reportVisible" title="快照差异报告（已存快照 vs 事件重放派生）" width="760px">
      <p class="form-tip" v-if="reportData" style="margin-top:0">
        共 <b>{{ reportData.summary.months }}</b> 个月：已存 <b>{{ reportData.summary.saved }}</b>、
        缺失 <b>{{ reportData.summary.missing }}</b>、
        与派生不一致 <b>{{ reportData.summary.mismatch }}</b>、
        缺净值（按当前价估算）<b>{{ reportData.summary.incomplete }}</b>；
        最大差异 ¥{{ money(reportData.summary.maxAbsDiff) }}（{{ (reportData.summary.maxAbsDiffPct * 100).toFixed(2) }}%）。
        差异「—」表示该月派生不完整（缺历史净值），不参与对账。
      </p>
      <el-table :data="reportData?.rows || []" size="small" max-height="420" empty-text="暂无数据">
        <el-table-column prop="month" label="月份" width="96" />
        <el-table-column prop="saved" label="已存快照" align="right" width="118" class-name="num">
          <template #default="{ row }">{{ row.saved == null ? '—' : `¥${money(row.saved)}` }}</template>
        </el-table-column>
        <el-table-column prop="savedSource" label="来源" align="left" width="76">
          <template #default="{ row }">{{ row.savedSource ? sourceLabel(row.savedSource) : '—' }}</template>
        </el-table-column>
        <el-table-column prop="derived" label="派生值" align="right" width="118" class-name="num">
          <template #default="{ row }">¥{{ money(row.derived) }}</template>
        </el-table-column>
        <el-table-column prop="diff" label="差异" align="right" width="110" class-name="num">
          <template #default="{ row }">{{ row.diff == null ? '—' : signedMoney(row.diff) }}</template>
        </el-table-column>
        <el-table-column prop="diffPct" label="差异率" align="right" width="94" class-name="num">
          <template #default="{ row }">{{ row.diffPct == null ? '—' : `${(row.diffPct * 100).toFixed(2)}%` }}</template>
        </el-table-column>
        <el-table-column prop="complete" label="派生质量" width="112">
          <template #default="{ row }">
            <span v-if="row.complete" class="badge badge-ok">完整</span>
            <span v-else class="badge badge-warn">估算 {{ row.estimatedPrice || 0 }} 项</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { useAuthStore } from '../stores/auth';
import { snapshotsApi, benchmarksApi, dataApi, archiveApi, getToken } from '../api';
import { money, signedMoney, currentMonth, todayStr } from '../utils/format';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const snap = reactive({ month: currentMonth(), total: null });

/* 基准点位（带 id，独立加载以便删除） */
const auth = useAuthStore();
const syncing = ref(false);
const benchCode = computed(() => store.settings?.benchmarkCode || 'CSI300');
const benchList = ref([]);
const bench = reactive({ date: currentMonth(), value: null });
const archiveList = ref([]);
async function loadBench() {
  try { benchList.value = await benchmarksApi.list(benchCode.value); } catch { benchList.value = []; }
}
onMounted(() => { loadBench(); loadArchive(); });
async function loadArchive() {
  try { archiveList.value = await archiveApi.list(); } catch { archiveList.value = []; }
}
function archiveKindLabel(k) { return { account: '账户', asset: '资产', event: '流水', cashflow: '现金' }[k] || k; }
async function restoreArchive(row) {
  try {
    const r = await archiveApi.restore(row.id);
    const c = r.counts || {};
    ElMessage.success(`已恢复：账户 ${c.accounts || 0}、资产 ${c.assets || 0}、流水 ${c.events || 0}、现金 ${c.cashFlows || 0}`);
    await store.refreshAll();
    await loadArchive();
  } catch (e) { ElMessage.error(e.message); }
}
async function purgeArchive(row) {
  await confirmRemove({ text: `永久清理归档「${row.label || row.kind}」？清理后不可恢复。`, request: () => archiveApi.purge(row.id) });
  await loadArchive();
}
async function syncBench() {
  syncing.value = true;
  try {
    const r = await benchmarksApi.sync({ code: benchCode.value });
    const parts = [];
    if (r.added) parts.push(`新增 ${r.added} 个月`);
    if (r.updated) parts.push(`更新 ${r.updated} 个月`);
    if (r.skipped) parts.push(`跳过 ${r.skipped} 个已存在`);
    ElMessage.success(`${r.name || benchCode.value} 同步完成：${parts.length ? parts.join('、') : '无变化'}` +
      (r.latest ? `（最新 ${r.latest.date} 收 ${r.latest.value}）` : ''));
    await loadBench();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    syncing.value = false;
  }
}

async function saveBench() {
  if (!bench.date || !(bench.value > 0)) return ElMessage.warning('请选择月份并填写点位');
  await benchmarksApi.save({ code: benchCode.value, date: bench.date, value: bench.value });
  ElMessage.success('基准点位已保存');
  bench.value = null;
  await loadBench();
  await store.refreshAll();
}
const confirmRemove = useRemoveConfirm();
async function delBench(row) {
  /* 删除确认统一走 useRemoveConfirm；基准列表为本页私有数据，刷新前先重载 */
  await confirmRemove({
    text: `删除 ${row.date} 基准点位？`,
    request: () => benchmarksApi.remove(row.id),
    beforeRefresh: loadBench,
  });
}

function fillCurrent() {
  snap.total = Math.round((store.kpis.mv || 0) * 100) / 100;
}
function sourceLabel(s) {
  return s === 'auto' ? '自动' : (s === 'derived' ? '派生' : '手工');
}
async function saveSnap() {
  if (!snap.month || !(snap.total >= 0)) return ElMessage.warning('请选择月份并填写月末持仓市值');
  const r = await snapshotsApi.save({ ...snap });
  const d = r.derived || {};
  if (d.complete && d.diffPct != null && Math.abs(d.diffPct) > 0.01) {
    ElMessage({
      message: `快照已保存，但与派生值差异 ${(d.diffPct * 100).toFixed(2)}%（派生 ¥${money(d.total)}）。请核对事件或净值历史。`,
      type: 'warning', duration: 6000,
    });
  } else if (!d.complete && d.missingPrice + (d.estimatedPrice || 0) > 0) {
    ElMessage({ message: `快照已保存；派生不完整（缺单价 ${d.missingPrice || 0} 个、按当前价估算 ${d.estimatedPrice || 0} 个），暂不计算差异。`, type: 'warning', duration: 6000 });
  } else {
    ElMessage.success(`快照已保存；派生值 ¥${money(d.total)}，差异 ${d.diff == null ? '—' : signedMoney(d.diff)}`);
  }
  snap.total = null;
  await store.refreshAll();
}
async function compareSnap(row) {
  try {
    const d = await snapshotsApi.derive(row.month);
    if (!d.complete) {
      return ElMessage.warning(`派生不完整：缺单价 ${d.missingPrice || 0} 个、按当前价估算 ${d.estimatedPrice || 0} 个（历史月份需净值历史）；已派生 ¥${money(d.total)}`);
    }
    const pct = d.diffPct == null ? '—' : `${(d.diffPct * 100).toFixed(2)}%`;
    ElMessage({
      message: `派生 ¥${money(d.total)}；快照 ¥${money(d.saved)}；差异 ${signedMoney(d.diff)}（${pct}）`,
      type: d.diffPct != null && Math.abs(d.diffPct) > 0.01 ? 'warning' : 'success',
      duration: 6000,
    });
  } catch (e) { ElMessage.error(e.message); }
}
async function delSnap(row) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `删除 ${row.month} 快照？`,
    request: () => snapshotsApi.remove(row.month),
  });
}

/* 批量回填历史缺失快照：按「事件重放 + 净值历史」派生，绝不覆盖已有快照 */
const autofilling = ref(false);
async function autofillSnaps() {
  try {
    await ElMessageBox.confirm(
      '将按「事件重放 + 净值历史」派生历史月末持仓市值，回填所有缺失快照。'
      + '已有快照（手工/自动/派生）一律跳过、绝不覆盖；缺净值历史、无法确定单价的资产不在该月派生。继续？',
      '回填缺失快照', { type: 'info', confirmButtonText: '回填', cancelButtonText: '取消' });
  } catch { return; }
  autofilling.value = true;
  try {
    const r = await snapshotsApi.autofill({});
    const parts = [];
    if (r.filled.length) parts.push(`补齐 ${r.filled.length} 个月`);
    if (r.incomplete.length) parts.push(`${r.incomplete.length} 个月缺净值、按当前价估算`);
    if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 个已有`);
    if (r.empty.length) parts.push(`${r.empty.length} 个无持仓月不落快照`);
    ElMessage.success(`回填完成：${parts.length ? parts.join('、') : '没有需要回填的月份'}`);
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); }
  finally { autofilling.value = false; }
}

/* 差异报告：全月份 saved vs 派生对账 */
const reportVisible = ref(false);
const reportData = ref(null);
async function showReport() {
  try {
    reportData.value = await snapshotsApi.report();
    reportVisible.value = true;
  } catch (e) { ElMessage.error(e.message); }
}

async function doExport() {
  const res = await fetch(dataApi.exportUrl, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return ElMessage.error('导出失败');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invest-manager-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success('已导出');
}

function beforeImport(file) {
  const isJson = file.name.endsWith('.json') || file.type === 'application/json';
  if (!isJson) ElMessage.error('请选择 JSON 备份文件');
  return isJson;
}
async function doImport(opt) {
  try {
    await ElMessageBox.confirm('导入将整体替换当前全部业务数据（已自动备份），确定继续？', '导入确认', {
      type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消',
    });
  } catch { opt.onError(new Error('cancel')); return; }
  try {
    const text = await opt.file.text();
    const payload = JSON.parse(text);
    const r = await dataApi.import(payload);
    ElMessage.success(`导入完成：账户 ${r.counts.accounts}、资产 ${r.counts.assets}、流水 ${r.counts.events}；自动备份 ${r.backupFile}`);
    await store.refreshAll();
    await loadBench();
    opt.onSuccess(r);
  } catch (e) {
    ElMessage.error('导入失败：' + e.message);
    opt.onError(e);
  }
}

async function loadDemo() {
  try {
    await ElMessageBox.confirm('将覆盖当前业务数据并自动备份，确定载入示例数据？', '确认', { type: 'warning' });
  } catch { return; }
  const r = await dataApi.loadDemo();
  ElMessage.success(`示例数据已载入（自动备份 ${r.backupFile}）`);
  await store.refreshAll();
}
</script>
