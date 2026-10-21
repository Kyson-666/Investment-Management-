<template>
  <el-popover placement="bottom-end" :width="popWidth" trigger="click" @show="load">
    <template #reference>
      <el-badge :value="unread" :hidden="unread === 0" :max="99" class="bell-badge">
        <el-button circle size="small" :icon="Bell" />
      </el-badge>
    </template>
    <div class="notify-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>站内通知</b>
        <el-button link type="primary" size="small" @click="readAll">全部已读</el-button>
      </div>
      <div v-if="!items.length" class="muted" style="padding:24px 0;text-align:center">暂无通知</div>
      <div v-for="n in items" :key="n.id" class="notify-item" :class="{ unread: !n.isRead }" @click="markRead(n)">
        <div class="t">
          <span class="badge" :class="n.kind === 'price' ? 'badge-danger' : 'badge-warn'">
            {{ n.kind === 'price' ? '价格预警' : '集中度' }}
          </span>
          <span class="muted time">{{ fmt(n.createdAt) }}</span>
        </div>
        <div class="title">{{ n.title }}</div>
        <div class="body muted">{{ n.body }}</div>
      </div>
    </div>
  </el-popover>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Bell } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { notifyApi } from '../api';

const items = ref([]);
const unread = ref(0);

/* 移动端气泡宽度自适应：窄屏铺满可用宽度，避免 380px 固定宽度溢出视口 */
const popWidth = ref(380);
function syncWidth() {
  const w = typeof window === 'undefined' ? 380 : window.innerWidth;
  popWidth.value = Math.max(240, Math.min(380, w - 40));
}
onMounted(() => {
  syncWidth();
  window.addEventListener('resize', syncWidth);
});
onBeforeUnmount(() => window.removeEventListener('resize', syncWidth));

async function load() {
  try {
    const r = await notifyApi.list();
    items.value = r.notifications;
    unread.value = r.unread;
  } catch (e) { ElMessage.error(e.message); }
}
async function markRead(n) {
  if (n.isRead) return;
  await notifyApi.read(n.id);
  n.isRead = true;
  unread.value = Math.max(0, unread.value - 1);
}
async function readAll() {
  await notifyApi.readAll();
  items.value.forEach(n => { n.isRead = true; });
  unread.value = 0;
}
function fmt(ts) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}
</script>

<style scoped>
.notify-item { padding: 9px 6px; border-bottom: 1px solid #f0f2f5; cursor: pointer; border-radius: 6px; }
.notify-item:hover { background: #fafbfd; }
.notify-item.unread { background: #f6f9ff; }
.notify-item .t { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.notify-item .time { font-size: 11px; }
.notify-item .title { font-weight: 600; font-size: 13px; margin: 3px 0; }
.notify-item .body { font-size: 12px; line-height: 1.5; }
/* 通知面板高度自适应小屏，避免超出视口 */
.notify-panel { max-height: min(420px, 60vh); overflow-y: auto; }
</style>
