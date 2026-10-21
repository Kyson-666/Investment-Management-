<template>
  <div class="layout">
    <header class="topbar">
      <!-- 移动端：左侧汉堡按钮 -->
      <button
        class="hamburger"
        type="button"
        aria-label="打开导航菜单"
        :aria-expanded="drawer ? 'true' : 'false'"
        @click="drawer = true"
      >
        <el-icon :size="20"><Menu /></el-icon>
      </button>

      <div class="logo">
        投资管家
        <span class="ver">v{{ APP_VERSION }}</span>
      </div>

      <!-- 桌面端：横向胶囊导航 -->
      <nav class="nav-pills">
        <router-link v-for="n in navs" :key="n.to" :to="n.to">{{ n.label }}</router-link>
        <router-link v-if="auth.isAdmin" to="/admin">管理后台</router-link>
      </nav>

      <div class="top-actions">
        <el-select
          v-model="store.selectedAccount"
          size="small"
          class="acct-select"
          style="width: 150px"
          placeholder="全部账户"
          @change="onAccountChange"
        >
          <el-option label="全部账户" value="" />
          <el-option v-for="a in store.accounts" :key="a.id" :label="a.name" :value="a.id" />
        </el-select>
        <NotificationBell />
        <el-dropdown trigger="click" @command="onUserCmd">
          <span class="user-name" style="cursor:pointer;display:flex;align-items:center;gap:5px">
            <el-icon><UserFilled /></el-icon>
            <span class="uname-text">{{ auth.username }}</span>
            <span v-if="auth.isAdmin" class="badge badge-warn">管理员</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="settings">系统设置</el-dropdown-item>
              <el-dropdown-item command="data">数据管理</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- 移动端抽屉导航：PC 端不渲染内容（由 CSS 控制可见性，避免重复 DOM 交互歧义） -->
    <el-drawer
      v-model="drawer"
      direction="ltr"
      size="72%"
      :with-header="false"
      class="nav-drawer"
    >
      <div class="drawer-inner">
        <div class="drawer-head">
          <div class="logo">
            投资管家
            <span class="ver">v{{ APP_VERSION }}</span>
          </div>
          <div class="drawer-user">
            <el-icon><UserFilled /></el-icon>
            {{ auth.username }}
            <span v-if="auth.isAdmin" class="badge badge-warn">管理员</span>
          </div>
        </div>

        <div class="drawer-acct">
          <div class="drawer-acct-label">账户视角</div>
          <el-select
            v-model="store.selectedAccount"
            size="large"
            style="width: 100%"
            placeholder="全部账户"
            @change="onAccountChange"
          >
            <el-option label="全部账户" value="" />
            <el-option v-for="a in store.accounts" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </div>

        <nav class="drawer-nav">
          <router-link
            v-for="n in navs"
            :key="n.to"
            :to="n.to"
            class="drawer-nav-item"
            @click="drawer = false"
          >
            <el-icon :size="17"><component :is="n.icon" /></el-icon>
            <span>{{ n.label }}</span>
          </router-link>
          <router-link
            v-if="auth.isAdmin"
            to="/admin"
            class="drawer-nav-item"
            @click="drawer = false"
          >
            <el-icon :size="17"><Setting /></el-icon>
            <span>管理后台</span>
          </router-link>
        </nav>

        <div class="drawer-foot">
          <el-button @click="onUserCmd('settings')">系统设置</el-button>
          <el-button @click="onUserCmd('data')">数据管理</el-button>
          <el-button type="danger" plain @click="onUserCmd('logout')">退出登录</el-button>
        </div>
      </div>
    </el-drawer>

    <main class="page-body">
      <KpiCards v-if="store.ready" />
      <el-skeleton v-else :rows="3" animated style="margin-bottom:14px" />
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup>

/** 应用版本号：单一来源 = web/package.json 的 version（构建时由 Vite 内联该 JSON） */
import pkg from '../../package.json';
const APP_VERSION = pkg.version;
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  UserFilled, Menu, Setting, Odometer, Wallet, CreditCard, Tickets, TrendCharts,
  PieChart, Warning, Coin, Calendar, Money, Document, Refresh, Operation,
} from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { usePortfolioStore } from '../stores/portfolio';
import KpiCards from '../components/KpiCards.vue';
import NotificationBell from '../components/NotificationBell.vue';

const auth = useAuthStore();
const store = usePortfolioStore();
const router = useRouter();

const drawer = ref(false);

const navs = [
  { to: '/dashboard', label: '总览', icon: Odometer },
  { to: '/holdings', label: '持仓', icon: Wallet },
  { to: '/accounts', label: '账户', icon: CreditCard },
  { to: '/transactions', label: '交易流水', icon: Tickets },
  { to: '/performance', label: '绩效', icon: TrendCharts },
  { to: '/allocation', label: '配置', icon: PieChart },
  { to: '/risk', label: '风险', icon: Warning },
  { to: '/tax', label: '税务', icon: Coin },
  { to: '/dca', label: '定投', icon: Calendar },
  { to: '/cashflows', label: '出入金', icon: Money },
  { to: '/reports', label: '收益报表', icon: Document },
  { to: '/fx', label: '汇率', icon: Refresh },
  { to: '/settings', label: '设置', icon: Operation },
  { to: '/data', label: '数据', icon: Tickets },
];

onMounted(async () => {
  await auth.fetchMe();
  await store.refreshAll(false);
});

async function onAccountChange() {
  await store.setAccount(store.selectedAccount);
}

async function onUserCmd(cmd) {
  if (cmd === 'logout') {
    try {
      await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' });
    } catch { return; }
    drawer.value = false;
    await auth.logout();
    router.replace('/login');
  } else if (cmd === 'settings') {
    drawer.value = false;
    router.push('/settings');
  } else if (cmd === 'data') {
    drawer.value = false;
    router.push('/data');
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .12s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ---------- 汉堡按钮（默认隐藏，仅移动端显示） ---------- */
.hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, .14);
  color: #fff;
  cursor: pointer;
  flex: none;
}
.hamburger:hover { background: rgba(255, 255, 255, .24); }

/* ---------- 抽屉导航 ---------- */
.drawer-inner { display: flex; flex-direction: column; height: 100%; gap: 14px; }
.drawer-head { display: flex; flex-direction: column; gap: 6px; }
.drawer-head .logo { color: var(--navy); font-size: 18px; }
.drawer-head .logo .ver { font-size: 11px; opacity: .6; }
.drawer-user {
  display: flex; align-items: center; gap: 6px;
  color: var(--muted); font-size: 12px;
}
.drawer-acct { border-top: 1px solid var(--border); padding-top: 12px; }
.drawer-acct-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.drawer-nav { display: flex; flex-direction: column; overflow-y: auto; flex: 1; gap: 2px; }
.drawer-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 12px;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  font-size: 14px;
  transition: background .15s;
}
.drawer-nav-item:active { background: #eef2f8; }
.drawer-nav-item.router-link-active { background: var(--navy); color: #fff; font-weight: 600; }
/* 底部操作：三个 4 字按钮**一行等分**（放得下就不换行），尺寸与位置完全对齐。
   注意 Element Plus 会给相邻 .el-button 加 margin-left:12px，必须显式归零，
   否则第 2、3 个按钮会被右推并溢出（曾导致错位）。 */
.drawer-foot {
  display: flex;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.drawer-foot .el-button {
  flex: 1 1 0;
  min-width: 0;
  margin-left: 0;
  padding-left: 2px;
  padding-right: 2px;
  white-space: nowrap;
  overflow: hidden;
}

/* ============================================================
   移动端适配（≤ 768px）：抽屉导航 + 紧凑顶栏
   ============================================================ */
@media (max-width: 768px) {
  .hamburger { display: inline-flex; }
  .nav-pills { display: none; }
  .logo { font-size: 16px; }
  .logo .ver { display: none; }
  .acct-select { display: none; }
  .uname-text { display: none; }
  .top-actions { gap: 8px; }
}
/* 窄屏（≤ 380px）：隐藏管理员标签，仅保留图标 */
@media (max-width: 380px) {
  .topbar .user-name .el-tag { display: none; }
}
</style>
