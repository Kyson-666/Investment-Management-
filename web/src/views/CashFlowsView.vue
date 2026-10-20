<template>
  <div>
    <div class="page-head">
      <div>
        <h2>现金流水</h2>
        <div class="sub">现金流水包含：出入金（外部本金）、内部划转（账户间搬运）、现金校准（对账差额）。净入金是累计投入的主要部分；累计投入 = 净入金 + 期初建仓</div>
        <div class="sub" style="margin-top:2px">出入金记录<b>外部资金进出账户</b>；账户间划转用「内部划转」；与对账单的差额用「现金校准」。买入/申购属于账户内部资产转换，请勿重复登记入金。</div>
      </div>
      <div class="actions">
        <el-button @click="ops.addTransfer()">内部划转</el-button>
        <el-button @click="ops.addAdjust()">现金校准</el-button>
        <el-button type="primary" @click="ops.addCash()">+ 登记出入金</el-button>
      </div>
    </div>

    <div v-for="w in store.warnings" :key="w.code" style="margin:0 0 12px;padding:10px 14px;border-radius:8px;
      background:#fdf6ec;border:1px solid #faecd8;color:#b88230;font-size:13px;line-height:1.75;
      display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">⚠️ <b>{{ w.title }}</b> —— {{ w.msg }}</div>
      <button style="flex:none;padding:2px 8px;border-radius:4px;cursor:pointer;background:transparent;
        border:1px solid #e6c78a;color:#a06a10;font-size:12px;white-space:nowrap"
        @click="store.dismissWarning(w.code)">不再提示</button>
    </div>
    

    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="label">累计入金 (CNY)</div><div class="val num up">¥{{ money(cash.deposit) }}</div></div>
      <div class="kpi"><div class="label">累计出金 (CNY)</div><div class="val num down">¥{{ money(cash.withdraw) }}</div></div>
      <div class="kpi"><div class="label">净入金 (CNY)</div><div class="val num">¥{{ money(cash.net) }}</div>
        <div class="sub num muted">累计投入 = 本项 + 期初建仓</div></div>
      <div class="kpi"><div class="label">账户现金 (CNY)</div>
        <div class="val num" :class="cash.cash < 0 ? 'down' : ''">¥{{ money(cash.cash) }}</div>
        <div class="sub num muted">入金 − 出金 ± 内部划转 − 买入/申购自付 + 卖出/赎回净额 + 分红/利息 ± 现金校准<br>（融资买入只扣自付；期初建仓不产生现金流）</div></div>
    </div>

    <div class="card">
      <el-table :data="rows" size="small" empty-text="暂无出入金记录">
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column label="账户" min-width="140">
          <template #default="{ row }">{{ store.accountName(row.accountId) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <span :class="'badge ' + kindBadge(row.kind)">{{ kindLabel(row.kind) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="转出/录入金额" width="160" align="right">
          <template #default="{ row }">
            <span v-if="row.kind === 'adjust'" :class="signClass(row.amount)">{{ signedMoney(row.amount) }} {{ accountCcy(row.accountId) }}</span>
            <span v-else>{{ money(row.kind === 'transfer' ? row.amount : row.inputAmount) }} {{ row.kind === 'transfer' ? accountCcy(row.accountId) : (row.inputCurrency || accountCcy(row.accountId)) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="转入/入账金额" width="170" align="right">
          <template #default="{ row }">
            <template v-if="row.kind === 'transfer'">
              <b class="num">→ {{ money(row.toAmount) }} {{ row.toCurrency }}</b>
              <div class="muted" style="font-size:12px">{{ row.toAccountName || store.accountName(row.toAccountId) }}</div>
            </template>
            <span v-else-if="(row.inputCurrency || accountCcy(row.accountId)) === accountCcy(row.accountId)"
              class="muted">同币种，直接入账</span>
            <b v-else class="num">{{ money(row.amount) }} {{ accountCcy(row.accountId) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="汇率" width="120" align="right">
          <template #default="{ row }">
            <template v-if="row.kind === 'transfer'">
              1 {{ accountCcy(row.accountId) }} → {{ row.amount ? (row.toAmount / row.amount).toFixed(4) : '—' }} {{ row.toCurrency }}
            </template>
            <template v-else>{{ row.fx !== 1 ? Number(row.fx).toFixed(4) : '—' }}</template>
          </template>
        </el-table-column>
        <el-table-column label="折合 CNY" width="170" align="right">
          <template #default="{ row }">
            <template v-if="row.kind === 'transfer'">
              <span class="num">¥{{ money(row.amountCNY) }} → ¥{{ money(row.toAmountCNY) }}</span>
            </template>
            <b v-else class="num" :class="signClass(row.amountCNY)">
              {{ row.kind === 'adjust' ? signedMoney(row.amountCNY) : '¥' + money(row.amountCNY != null ? row.amountCNY : row.amount * (row.fx || 1)) }}
            </b>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <OpsDialogs ref="ops" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePortfolioStore } from '../stores/portfolio';
import { cashflowsApi } from '../api';
import { money, signedMoney, signClass } from '../utils/format';
import OpsDialogs from '../components/OpsDialogs.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const ops = ref(null);
const cash = computed(() => store.d?.cash || { deposit: 0, withdraw: 0, net: 0 });
const rows = computed(() => store.cashFlows);
function accountCcy(id) { return store.accounts.find(a => a.id === id)?.currency || ''; }
function kindLabel(k) { return { deposit: '入金', withdraw: '出金', transfer: '内部划转', adjust: '现金校准' }[k] || k; }
function kindBadge(k) { return k === 'deposit' ? 'badge-ok' : (k === 'transfer' ? 'badge-cn' : 'badge-warn'); }

const confirmRemove = useRemoveConfirm();
async function remove(row) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({ text: '确定删除该出入金记录？', request: () => cashflowsApi.remove(row.id) });
}
</script>
