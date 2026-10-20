<template>
  <div>
    <div class="page-head">
      <div>
        <h2>账户</h2>
        <div class="sub">券商 / 银行 / 其他账户的市值、收益与出入金汇总；券商账户另显示融资（欠券商的钱，需原样偿还）</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="ops.createAccount()">新增账户</el-button>
      </div>
    </div>

    <div class="card">
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>账户名称</th><th>类型</th><th>币种</th>
              <th class="num">持仓市值(CNY)</th><th class="num">融资(CNY)</th><th class="num">已实现(含分红/利息/校准)</th><th class="num">浮动</th>
              <th class="num">总收益</th><th class="num">收益率</th><th>备注</th><th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in rows" :key="a.id">
              <td class="bold">{{ a.name }}</td>
              <td><span class="badge badge-gray">{{ kindLabel(a.kind) }}</span></td>
              <td>{{ a.currency }}</td>
              <td class="num">¥{{ money(a.mvCNY) }}</td>
              <td class="num" :class="a.margin > 0 ? 'down' : ''" :title="a.margin > 0 ? '该账户融资（欠券商，需原样偿还）' : ''">
                {{ a.margin > 0 ? '¥' + money(a.margin) : '—' }}
              </td>
              <td class="num" :class="signClass(a.real)">{{ signedMoney(a.real) }}</td>
              <td class="num" :class="signClass(a.unreal)">{{ signedMoney(a.unreal) }}</td>
              <td class="num bold" :class="signClass(a.total)">{{ signedMoney(a.total) }}</td>
              <td class="num" :class="signClass(a.ret)">{{ signedPct(a.ret) }}</td>
              <td class="muted">{{ a.note || '—' }}</td>
              <td class="col-actions">
                <el-button size="small" @click="ops.addCash(a.id)">入/出金</el-button>
                <el-button size="small" @click="ops.editAccount(a)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="remove(a)">删除</el-button>
              </td>
            </tr>
            <tr v-if="!rows.length"><td colspan="11" class="empty">暂无账户，点击右上角新增</td></tr>
          </tbody>
          <tfoot v-if="rows.length">
            <tr style="font-weight:700;background:var(--soft)">
              <td>合计</td><td></td><td></td>
              <td class="num">¥{{ money(total.mv) }}</td>
              <td class="num" :class="total.margin > 0 ? 'down' : ''">
                {{ total.margin > 0 ? '¥' + money(total.margin) : '—' }}
              </td>
              <td class="num" :class="signClass(total.real)">{{ signedMoney(total.real) }}</td>
              <td class="num" :class="signClass(total.unreal)">{{ signedMoney(total.unreal) }}</td>
              <td class="num" :class="signClass(total.total)">{{ signedMoney(total.total) }}</td>
              <td></td><td></td><td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <OpsDialogs ref="ops" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePortfolioStore } from '../stores/portfolio';
import { accountsApi } from '../api';
import { money, signedMoney, signedPct, signClass, ACCOUNT_KIND_LABEL } from '../utils/format';
import OpsDialogs from '../components/OpsDialogs.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const ops = ref(null);

// 以原始账户列表为准（含暂无持仓的账户），合并引擎聚合数据；已实现/浮动由持仓明细加总
const rows = computed(() => store.accounts.map(a => {
  const agg = store.accountsAgg.find(x => String(x.id) === String(a.id));
  const hs = store.holdings.filter(h => String(h.asset.accountId) === String(a.id));
  const real = hs.reduce((s, h) => s + (h.realTotalCNY || 0), 0) + (agg?.cashAdjust || 0);
  const unreal = hs.reduce((s, h) => s + (h.unrealCNY || 0), 0);
  return {
    ...a,
    mvCNY: agg?.mvCNY || 0,
    real,
    unreal,
    total: agg?.total || real + unreal,
    ret: agg?.ret ?? null,
  };
}));
const total = computed(() => rows.value.reduce((s, a) => ({
  mv: s.mv + a.mvCNY, real: s.real + a.real, unreal: s.unreal + a.unreal, total: s.total + a.total,
  margin: s.margin + (a.margin || 0),
}), { mv: 0, real: 0, unreal: 0, total: 0, margin: 0 }));

function kindLabel(k) { return ACCOUNT_KIND_LABEL[k] || k; }

const confirmRemove = useRemoveConfirm();
async function remove(a) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `确定删除账户「${a.name}」？账户下资产与流水将一并删除。`,
    request: () => accountsApi.remove(a.id),
    /* 删除的是当前选中的账户视角时，先切回「全部账户」再刷新 */
    beforeRefresh: async () => { if (store.selectedAccount === a.id) await store.setAccount(''); },
  });
}
</script>
