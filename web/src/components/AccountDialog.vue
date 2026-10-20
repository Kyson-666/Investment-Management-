<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="isEdit ? '编辑账户' : '新增账户'" width="460px">
    <el-form :model="form" label-width="84px">
      <el-form-item label="账户名称" required>
        <el-input v-model="form.name" placeholder="如：华泰证券 / 招商银行" />
      </el-form-item>
      <el-form-item label="账户类型">
        <el-radio-group v-model="form.kind">
          <el-radio-button label="broker">券商</el-radio-button>
          <el-radio-button label="bank">银行</el-radio-button>
          <el-radio-button label="other">其他</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="账户币种">
        <el-radio-group v-model="form.currency" :disabled="isEdit && hasFlow">
          <el-radio label="CNY">CNY</el-radio>
          <el-radio label="USD">USD</el-radio>
        </el-radio-group>
        <div v-if="isEdit && hasFlow" class="form-tip" style="margin-left:8px">
          已有资产或出入金，币种不可修改（历史金额按原币种存储）
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { accountsApi } from '../api';
import { usePortfolioStore } from '../stores/portfolio';

const props = defineProps({
  modelValue: Boolean,
  account: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const store = usePortfolioStore();
const isEdit = computed(() => !!props.account);
const saving = ref(false);
const form = reactive({ name: '', kind: 'broker', currency: 'CNY', note: '' });
/** 已有资产或出入金 → 服务端禁止改币种，前端同步禁用 */
const hasFlow = computed(() => {
  if (!props.account) return false;
  const id = String(props.account.id);
  return store.assets.some(a => String(a.accountId) === id)
    || store.cashFlows.some(c => String(c.accountId) === id);
});

/* immediate：配合 v-if 懒挂载（v=false 时直接 return，无副作用） */
watch(() => props.modelValue, v => {
  if (!v) return;
  if (props.account) Object.assign(form, { name: props.account.name, kind: props.account.kind, currency: props.account.currency, note: props.account.note || '' });
  else Object.assign(form, { name: '', kind: 'broker', currency: 'CNY', note: '' });
}, { immediate: true });

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请填写账户名称');
  saving.value = true;
  try {
    if (isEdit.value) await accountsApi.update(props.account.id, { ...form });
    else await accountsApi.create({ ...form });
    ElMessage.success('已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>
