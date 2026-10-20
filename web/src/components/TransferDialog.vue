<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="账户间划转" width="500px">
    <el-form label-width="96px">
      <el-form-item label="转出账户" required>
        <el-select v-model="form.fromAccountId" style="width:100%" placeholder="选择转出账户">
          <el-option v-for="a in accounts" :key="a.id" :label="`${a.name}（${a.currency}）`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="转入账户" required>
        <el-select v-model="form.toAccountId" style="width:100%" placeholder="选择转入账户">
          <el-option v-for="a in accounts.filter(x => x.id !== form.fromAccountId)" :key="a.id"
            :label="`${a.name}（${a.currency}）`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>
      <el-form-item :label="`转出金额(${fromCur})`" required>
        <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:220px" />
      </el-form-item>
      <el-form-item :label="`转入金额(${toCur})`" required>
        <el-input-number v-model="form.toAmount" :min="0" :precision="2" controls-position="right" style="width:220px" />
        <span class="form-tip" style="margin-left:8px" v-if="sameCurrency">同币种，自动等于转出金额</span>
      </el-form-item>
      <el-form-item label="汇率" v-if="fromCur === 'USD' || toCur === 'USD'">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div v-if="fromCur === 'USD'">
            <span class="form-tip">USD→CNY</span>
            <el-input-number v-model="form.fx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:130px" />
          </div>
          <div v-if="toCur === 'USD'">
            <span class="form-tip">USD→CNY（转入）</span>
            <el-input-number v-model="form.toFx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:130px" />
          </div>
        </div>
      </el-form-item>
      <el-form-item label=" ">
        <div class="form-tip">
          内部划转是账户之间的资金搬运，<b>不计入净入金/累计投入</b>（组合视角）；两边账户现金同时变化。
          <template v-if="!sameCurrency">跨币种划转的差额属于换汇成本，不单独计入投资收益。</template>
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：券商入金 / 换汇" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存划转</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { cashflowsApi, fxApi } from '../api';
import { todayStr } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({
  fromAccountId: '', toAccountId: '', date: todayStr(),
  amount: null, toAmount: null, fx: 7.1, toFx: 7.1, note: '',
});

const fromCur = computed(() => props.accounts.find(a => a.id === form.fromAccountId)?.currency || 'CNY');
const toCur = computed(() => props.accounts.find(a => a.id === form.toAccountId)?.currency || 'CNY');
const sameCurrency = computed(() => fromCur.value === toCur.value);

watch(() => props.modelValue, async v => {
  if (!v) return;
  const from = props.defaultAccountId || props.accounts[0]?.id || '';
  const to = props.accounts.find(a => a.id !== from)?.id || '';
  Object.assign(form, {
    fromAccountId: from, toAccountId: to, date: todayStr(),
    amount: null, toAmount: null, fx: 7.1, toFx: 7.1, note: '',
  });
  try {
    const c = await fxApi.current();
    if (c && +c.rate > 0) { form.fx = +c.rate; form.toFx = +c.rate; }
  } catch { /* 保留兜底 */ }
}, { immediate: true });

/* 同币种时转入金额自动跟随转出金额 */
watch([() => form.amount, () => form.fromAccountId, () => form.toAccountId], () => {
  if (sameCurrency.value && form.amount > 0) form.toAmount = form.amount;
});

async function save() {
  if (!form.fromAccountId || !form.toAccountId) return ElMessage.warning('请选择转出/转入账户');
  if (form.fromAccountId === form.toAccountId) return ElMessage.warning('转出与转入账户不能相同');
  if (!(form.amount > 0)) return ElMessage.warning('转出金额需大于 0');
  if (!(form.toAmount > 0)) return ElMessage.warning('转入金额需大于 0');
  if (fromCur.value === 'USD' && !(form.fx > 0)) return ElMessage.warning('请填写有效的 USD→CNY 汇率');
  if (toCur.value === 'USD' && !(form.toFx > 0)) return ElMessage.warning('请填写有效的转入 USD→CNY 汇率');
  saving.value = true;
  try {
    await cashflowsApi.create({
      kind: 'transfer', accountId: form.fromAccountId, toAccountId: form.toAccountId,
      date: form.date, amount: form.amount, toAmount: form.toAmount,
      fx: form.fx, toFx: form.toFx, note: form.note,
    });
    ElMessage.success('划转已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
