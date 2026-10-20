<template>
  <div>
    <div class="page-head">
      <div>
        <h2>定投计划</h2>
        <div class="sub">基金/理财/债券按月自动生成投入记录（股票请逐笔录入）；每期汇率按发生日锁定</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="ops.createDca()">+ 新建定投计划</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="plans" size="small" empty-text="暂无定投计划">
        <el-table-column label="定投标的" min-width="160">
          <template #default="{ row }">
            {{ assetName(row.assetId) }}
            <span class="muted" style="margin-left:6px">{{ assetCcy(row.assetId) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="startMonth" label="起始月" width="90" />
        <el-table-column label="期数" width="80" align="right">
          <template #default="{ row }">{{ row.months }} 期</template>
        </el-table-column>
        <el-table-column label="扣款日" width="90" align="right">
          <template #default="{ row }">每月 {{ row.day }} 日</template>
        </el-table-column>
        <el-table-column label="每期金额" width="130" align="right">
          <template #default="{ row }">{{ money(row.amount) }} {{ assetCcy(row.assetId) }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="120" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-switch :model-value="!!row.active" @change="v => toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="generate(row)">生成投入记录</el-button>
            <el-button link type="primary" size="small" @click="editPlan(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <h3>说明</h3>
      <ul class="form-tip" style="padding-left:18px;line-height:1.9">
        <li>「生成投入记录」按起始月起每月扣款日批量写入申购(kind=invest)事件，<b>只生成到今天为止的期次</b>，未来期次由每日 00:10 的任务逐期生成；可重复点击——已存在的日期会自动跳过（幂等）。</li>
        <li>每期份额按<b>发生日最近净值</b>折算；若该日期没有净值历史，会退回当前净值并在返回结果中标记为“估算”，建议先同步行情或补录净值。</li>
        <li>美元标的每期使用该发生日生效的汇率锁定，历史记录不受后续汇率变动影响。</li>
        <li>系统每日 00:10 自动为当天到期且启用中的计划补投；也可随时手动生成。</li>
      </ul>
    </div>

    <OpsDialogs ref="ops" />

    <el-dialog v-model="editDlg" title="编辑定投计划" width="420px">
      <el-form label-width="92px" v-if="editing">
        <el-form-item label="每期金额"><el-input-number v-model="editing.amount" :min="0" :precision="2" controls-position="right" style="width:200px" /></el-form-item>
        <el-form-item label="期数(月)"><el-input-number v-model="editing.months" :min="1" :max="360" controls-position="right" style="width:200px" /></el-form-item>
        <el-form-item label="扣款日"><el-input-number v-model="editing.day" :min="1" :max="28" controls-position="right" style="width:200px" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="editing.note" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDlg = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { dcaApi } from '../api';
import { money } from '../utils/format';
import OpsDialogs from '../components/OpsDialogs.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const ops = ref(null);
const plans = computed(() => store.dcaPlans.map(p => ({ ...p, asset: store.assetById(p.assetId) })));
const assetName = id => store.assetById(id)?.name || '—';
const assetCcy = id => store.assetById(id)?.currency || '';

async function generate(row) {
  try {
    const r = await dcaApi.generate(row.id);
    let msg = `生成完成：新增 ${r.insertedCount} 笔，跳过已存在 ${r.skippedCount} 笔`;
    if (r.estimatedCount) msg += `；其中 ${r.estimatedCount} 笔缺历史净值，已按当前净值估算`;
    ElMessage({ message: msg, type: r.estimatedCount ? 'warning' : 'success', duration: r.estimatedCount ? 6000 : 3000 });
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); }
}
async function toggle(row, v) {
  await dcaApi.update(row.id, { active: v });
  ElMessage.success(v ? '计划已启用' : '计划已暂停');
  await store.refreshAll();
}
const confirmRemove = useRemoveConfirm();
async function remove(row) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `确定删除「${assetName(row.assetId)}」定投计划？已生成的投入记录不会删除。`,
    request: () => dcaApi.remove(row.id),
  });
}

const editDlg = ref(false);
const editing = ref(null);
function editPlan(row) { editing.value = { ...row }; editDlg.value = true; }
async function saveEdit() {
  await dcaApi.update(editing.value.id, {
    amount: editing.value.amount, months: editing.value.months, day: editing.value.day, note: editing.value.note,
  });
  ElMessage.success('已保存');
  editDlg.value = false;
  await store.refreshAll();
}
</script>
