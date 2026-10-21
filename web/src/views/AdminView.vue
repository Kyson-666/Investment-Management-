<template>
  <div>
    <div class="page-head">
      <div>
        <h2>管理后台</h2>
        <div class="sub">用户管理、汇率管理、邮箱服务器配置（仅管理员可见）</div>
      </div>
    </div>

    <el-tabs v-model="tab" type="border-card">
      <!-- 概览 -->
      <el-tab-pane label="系统概览" name="stats">
        <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi"><div class="label">注册用户</div><div class="val num">{{ stats.users ?? '—' }}</div></div>
          <div class="kpi"><div class="label">活跃用户</div><div class="val num">{{ stats.activeUsers ?? '—' }}</div></div>
          <div class="kpi"><div class="label">汇率记录</div><div class="val num">{{ stats.fxRows ?? '—' }}</div></div>
          <div class="kpi"><div class="label">SMTP</div>
            <div class="val" style="font-size:16px;padding-top:5px">
              <span :class="'badge ' + (stats.mailConfigured ? 'badge-ok' : 'badge-gray')">
                {{ stats.mailConfigured ? '已配置' : '未配置' }}
              </span>
            </div></div>
        </div>
      </el-tab-pane>

      <!-- 用户管理 -->
      <el-tab-pane label="用户管理" name="users">
        <el-table :data="users" size="small" empty-text="加载中...">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="username" label="用户名" min-width="120" />
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column label="角色" width="90">
            <template #default="{ row }">
              <span class="badge" :class="row.role === 'admin' ? 'badge-warn' : 'badge-gray'">
                {{ row.role === 'admin' ? '管理员' : '普通用户' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <span :class="'badge ' + (row.status === 'active' ? 'badge-ok' : 'badge-danger')">
                {{ row.status === 'active' ? '正常' : '已禁用' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="注册时间" width="180">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="lastLoginAt" label="最近登录" width="180">
            <template #default="{ row }">{{ row.lastLoginAt ? fmt(row.lastLoginAt) : '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="toggleStatus(row)">
                {{ row.status === 'active' ? '禁用' : '启用' }}
              </el-button>
              <el-button link type="warning" size="small" @click="resetPwd(row)">重置密码</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 汇率管理 -->
      <el-tab-pane label="汇率管理" name="fx">
        <div class="toolbar">
          <el-button type="primary" size="small" @click="fxAdd = true">手动录入</el-button>
          <el-button size="small" @click="syncFx" :loading="fxSyncing">立即同步自动源</el-button>
          <span class="form-tip">主源 Frankfurter（ECB），失败自动降级 open.er-api.com；自动记录不可删，同日手动优先。</span>
        </div>
        <el-table :data="fxList" size="small" max-height="420">
          <el-table-column prop="date" label="日期" width="130" />
          <el-table-column label="汇率" align="right" width="120">
            <template #default="{ row }"><b class="num">{{ Number(row.rate).toFixed(4) }}</b></template>
          </el-table-column>
          <el-table-column label="来源" width="100">
            <template #default="{ row }">
              <span :class="'badge ' + (row.source === 'manual' ? 'badge-manual' : 'badge-auto')">
                {{ row.source === 'manual' ? '手动' : '自动' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button v-if="row.source === 'manual'" link type="danger" size="small" @click="delFx(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <FxDialog v-model="fxAdd" @saved="onFxChanged" />
      </el-tab-pane>

      <!-- 邮箱配置 -->
      <el-tab-pane label="邮箱（SMTP）" name="mail">
        <el-form label-width="120px" style="max-width:560px">
          <el-form-item label="SMTP 主机">
            <el-input v-model="mail.host" placeholder="如 smtp.qq.com / smtp.163.com" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="mail.port" :min="1" :max="65535" controls-position="right" style="width:160px" />
          </el-form-item>
          <el-form-item label="SSL/TLS">
            <el-switch v-model="mail.secure" active-text="加密连接（465 通常为 true，587 为 false）" />
          </el-form-item>
          <el-form-item label="账号">
            <el-input v-model="mail.user" placeholder="发件邮箱账号" />
          </el-form-item>
          <el-form-item label="密码/授权码">
            <el-input v-model="mail.password" type="password" show-password
              :placeholder="mail.hasPassword ? '已保存（' + mail.passwordMask + '），留空不修改' : '邮箱密码或 SMTP 授权码'" />
          </el-form-item>
          <el-form-item label="发件人地址">
            <el-input v-model="mail.from" placeholder="默认同账号" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="mailSaving" @click="saveMail">保存配置</el-button>
            <el-button @click="testMail(false)">测试连接</el-button>
            <el-button @click="testMail(true)">发送测试邮件</el-button>
          </el-form-item>
          <el-form-item v-if="testToVisible" label="收件邮箱">
            <el-input v-model="testRecipient" placeholder="接收测试邮件的邮箱" />
          </el-form-item>
        </el-form>
        <p class="form-tip" style="max-width:640px">
          密码使用 AES-256-GCM 加密后存入数据库，接口仅回显打码结果。邮箱验证码登录依赖此配置；
          未配置时，开发环境会在「发送验证码」接口直接回显验证码以便调试，生产环境不会返回。
        </p>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { usePortfolioStore } from '../stores/portfolio';
import { adminApi, fxApi } from '../api';
import FxDialog from '../components/FxDialog.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const auth = useAuthStore();
const store = usePortfolioStore();
const tab = ref('stats');
const stats = ref({});
const users = ref([]);

async function loadStats() { stats.value = await adminApi.stats(); }
async function loadUsers() { users.value = await adminApi.users(); }
onMounted(async () => {
  await loadStats();
  await loadUsers();
});

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

async function toggleStatus(row) {
  const next = row.status === 'active' ? 'disabled' : 'active';
  if (next === 'disabled') {
    try {
      await ElMessageBox.confirm(`确定禁用用户「${row.username}」？禁用后其登录态立即失效。`, '确认', { type: 'warning' });
    } catch { return; }
  }
  await adminApi.setStatus(row.id, next);
  ElMessage.success('已更新');
  await loadUsers();
  await loadStats();
}
async function resetPwd(row) {
  try {
    await ElMessageBox.confirm(`确定为「${row.username}」生成新的临时密码？`, '确认', { type: 'warning' });
  } catch { return; }
  const r = await adminApi.resetPassword(row.id);
  await ElMessageBox.alert(`临时密码：${r.tempPassword}，请转交用户并提示其登录后尽快修改。`, '重置成功');
}

/* 汇率 */
const fxAdd = ref(false);
const fxSyncing = ref(false);
const fxList = ref([]);
async function loadFx() { fxList.value = await fxApi.list(); }
onMounted(loadFx);
async function onFxChanged() { await loadFx(); await store.refreshAll(false); }
async function syncFx() {
  fxSyncing.value = true;
  try {
    const r = await fxApi.sync();
    ElMessage.success(`同步成功：${r.rate}${r.usedFallback ? '（备用源）' : ''}`);
    await loadFx();
    await store.refreshAll(false);
    await loadStats();
  } catch (e) { ElMessage.error(e.message); } finally { fxSyncing.value = false; }
}
const confirmRemove = useRemoveConfirm();
async function delFx(row) {
  /* 删除确认统一走 useRemoveConfirm；汇率列表为本页私有数据，刷新前先重载 */
  await confirmRemove({
    text: `删除 ${row.date} 手动汇率？`,
    request: () => fxApi.remove(row.id),
    beforeRefresh: loadFx,
    animate: false,          // 与本页其它写操作一致，不触发 KPI 闪烁
  });
}

/* 邮箱 */
const mail = reactive({ host: '', port: 465, secure: true, user: '', password: '', from: '', hasPassword: false, passwordMask: '' });
const mailSaving = ref(false);
const testToVisible = ref(false);
const testRecipient = ref('');

async function loadMail() {
  const r = await adminApi.getMail();
  Object.assign(mail, { password: '', ...r });
}
onMounted(loadMail);

async function saveMail() {
  mailSaving.value = true;
  try {
    await adminApi.putMail({
      host: mail.host, port: mail.port, secure: mail.secure,
      user: mail.user, from: mail.from,
      ...(mail.password ? { password: mail.password } : {}),
    });
    ElMessage.success('SMTP 配置已保存');
    mail.password = '';
    await loadMail();
    await loadStats();
  } catch (e) { ElMessage.error(e.message); } finally { mailSaving.value = false; }
}
async function testMail(withSend) {
  try {
    let to;
    if (withSend) {
      const { value } = await ElMessageBox.prompt('请输入接收测试邮件的邮箱', '发送测试邮件', {
        confirmButtonText: '发送', cancelButtonText: '取消', inputPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, inputErrorMessage: '邮箱格式不正确',
      });
      to = value;
    }
    const r = await adminApi.testMail(to);
    ElMessage.success(to ? '测试邮件发送成功' : '连接验证成功');
  } catch (e) {
    if (e === 'cancel' || e?.message?.includes('cancel')) return;
    ElMessage.error(e.message || '测试失败');
  }
}
</script>
