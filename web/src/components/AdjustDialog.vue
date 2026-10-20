<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="现金校准" width="480px">
    <el-form label-width="96px">
      <el-form-item label="账户" required>
        <el-select v-model="form.accountId" style="width:100%" placeholder="选择账户">
          <el-option v-for="a in accounts" :key="a.id" :label="`${a.name}（${a.currency}）`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>
      <el-form-item :label="`校准金额(${acctCur})`" required>
        <el-input-number v-model="form.amount" :precision="2" controls-position="right" style="width:220px" />
        <div class="form-tip" style="margin-left:8px">正数=盘盈，负数=盘亏</div>
      </el-form-item>
      <el-form-item label=" ">
        <div class="form-tip">
          用于把系统现金校准到券商/银行对账单：<b>不计入净入金/累计投入</b>，
          差额计入“其他损益”（已实现），不改变 XIRR 外部现金流。
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：按对账单校准" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存校准</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { cashflowsApi } from '../api';
import { todayStr } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({ accountId: '', date: todayStr(), amount: null, note: '' });
const acctCur = computed(() => props.accounts.find(a => a.id === form.accountId)?.currency || 'CNY');

watch(() => props.modelValue, v => {
  if (!v) return;
  Object.assign(form, {
    accountId: props.defaultAccountId || props.accounts[0]?.id || '',
    date: todayStr(), amount: null, note: '',
  });
}, { immediate: true });

async function save() {
  if (!form.accountId) return ElMessage.warning('请选择账户');
  if (!form.amount) return ElMessage.warning('校准金额不能为 0');
  saving.value = true;
  try {
    await cashflowsApi.create({
      kind: 'adjust', accountId: form.accountId, date: form.date,
      amount: form.amount, note: form.note,
    });
    ElMessage.success('现金校准已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
