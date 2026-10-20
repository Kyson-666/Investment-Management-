<template>
  <div>
    <div class="page-head">
      <div>
        <h2>税务估算</h2>
        <div class="sub">分红税按持有期限定档（A股股票）/ 30%（美股股票）；资本利得按 CNY / USD 资产 × 年度汇总，仅为估算，不构成税务建议</div>
      </div>
      <div class="actions">
        <el-button type="primary" :loading="saving" @click="save">保存税率规则</el-button>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="label">分红税合计 (CNY)</div><div class="val num">¥{{ money(tax.divTax) }}</div><div class="sub">按每笔分红的持有期限定档</div></div>
      <div class="kpi"><div class="label">资本利得税估算 (CNY)</div><div class="val num">¥{{ money(tax.capGainTax) }}</div><div class="sub">CNY 资产暂免 / USD 资产按设定税率</div></div>
      <div class="kpi"><div class="label">应缴税合计 (CNY)</div><div class="val num" style="color:#e08a3e">¥{{ money(tax.totalTax) }}</div><div class="sub">估算值，以实际申报为准</div></div>
    </div>

    <div class="grid-sidebar">
      <div>
        <div class="card">
          <h3>分红明细与代扣估算</h3>
          <el-table :data="tax.dividends || []" size="small" max-height="380" empty-text="暂无分红记录">
            <el-table-column prop="date" label="除息日" width="110" />
            <el-table-column label="市场" width="80">
              <template #default="{ row }">
                <span :class="'badge ' + (row.market === 'CN' ? 'badge-cn' : 'badge-us')">{{ row.market === 'CN' ? 'A股' : '美股' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="asset" label="标的" min-width="120" />
            <el-table-column label="税前分红(CNY)" align="right">
              <template #default="{ row }">¥{{ money(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="税率" width="80" align="right">
              <template #default="{ row }">{{ pct(row.rate, 0) }}</template>
            </el-table-column>
            <el-table-column label="应缴税" width="100" align="right">
              <template #default="{ row }"><b class="num neg">¥{{ money(row.tax) }}</b></template>
            </el-table-column>
            <el-table-column label="税后到手" width="110" align="right">
              <template #default="{ row }">¥{{ money(row.net) }}</template>
            </el-table-column>
          </el-table>
          <p class="form-tip" style="margin-top:8px">
            A股股息红利差别化：持股 ≤1 个月按 20%、1 个月~1 年按 10%、超过 1 年免征；
            持有期限按<b>各批次份额占比分摊</b>后逐批次定档（近似 FIFO），不再统一按最早买入日。
          </p>
        </div>

        <div class="card">
          <h3>资本利得明细（按市场 × 年度）<span class="hint">仅对已实现卖出/赎回收益计税，亏损年度不计税</span></h3>
          <el-table :data="tax.capGainRows || []" size="small" empty-text="暂无已实现资本利得">
            <el-table-column label="市场" width="90">
              <template #default="{ row }">
                <span :class="'badge ' + (row.market === 'CN' ? 'badge-cn' : 'badge-us')">{{ row.market === 'CN' ? 'CNY 资产' : 'USD 资产' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="year" label="年度" width="90" />
            <el-table-column label="已实现利得(CNY)" align="right">
              <template #default="{ row }"><span class="num" :class="signClass(row.gain)">{{ signedMoney(row.gain) }}</span></template>
            </el-table-column>
            <el-table-column label="适用税率" width="100" align="right">
              <template #default="{ row }">{{ pct(row.gain > 0 ? (row.market === 'US' ? rules.usCapGain : rules.cnCapGain) : 0, 0) }}</template>
            </el-table-column>
            <el-table-column label="估算税额(CNY)" width="140" align="right">
              <template #default="{ row }"><b class="num neg">¥{{ money(row.tax) }}</b></template>
            </el-table-column>
          </el-table>
          <p class="form-tip" style="margin-top:8px">
            CNY 资产（A股等）个人投资者资本利得目前暂免征收（税率 0%）；USD 资产资本利得对非美国税务居民通常不代扣，此处仅按设定税率做情景估算。
          </p>
        </div>
      </div>

      <div>
        <div class="card">
          <h3>税率规则</h3>
          <el-form label-width="130px" size="small">
            <el-divider content-position="left">A股分红税</el-divider>
            <el-form-item label="持股 ≤1 个月"><el-input-number v-model="rules.cnDiv.le1m" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /><span class="form-tip">0.20=20%</span></el-form-item>
            <el-form-item label="1 个月 ~ 1 年"><el-input-number v-model="rules.cnDiv.m1to1y" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /></el-form-item>
            <el-form-item label="超过 1 年"><el-input-number v-model="rules.cnDiv.gt1y" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /></el-form-item>
            <el-divider content-position="left">美股 / 资本利得</el-divider>
            <el-form-item label="美股分红税"><el-input-number v-model="rules.usDiv" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /><span class="form-tip">默认30%</span></el-form-item>
            <el-form-item label="CNY 资产资本利得税"><el-input-number v-model="rules.cnCapGain" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /></el-form-item>
            <el-form-item label="USD 资产资本利得税"><el-input-number v-model="rules.usCapGain" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:130px" /></el-form-item>
          </el-form>
        </div>
        <div class="card">
          <h3>口径说明</h3>
          <p class="form-tip" style="line-height:1.9">
            ① 分红税以“每笔分红”为单位，按各批次份额占比分摊后，按批次买入日距除息日的天数定档（≤1 月 20% / 1 月~1 年 10% / 超 1 年免征）；<br>
            ② 资本利得按<b>移动加权平均</b>成本口径计算已实现收益（覆盖股票/基金/理财/债券的卖出与赎回），再按市场与年度汇总（不随「成本核算方法」的 FIFO 设置变化，与主账在 FIFO 口径下可能存在差异）；<br>
            ③ 所有金额均折算为人民币；<br>
            ④ 本页为辅助估算，不构成税务申报或投资建议。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { authApi } from '../api';
import { money, signedMoney, pct, signClass } from '../utils/format';

const store = usePortfolioStore();
const saving = ref(false);

const defaults = { cnDiv: { le1m: 0.2, m1to1y: 0.1, gt1y: 0 }, usDiv: 0.3, cnCapGain: 0, usCapGain: 0 };
const rules = reactive(JSON.parse(JSON.stringify(defaults)));

watch(() => store.settings, s => {
  const t = s?.taxRules;
  if (t) {
    Object.assign(rules, {
      cnDiv: { ...defaults.cnDiv, ...(t.cnDiv || {}) },
      usDiv: t.usDiv ?? defaults.usDiv,
      cnCapGain: t.cnCapGain ?? defaults.cnCapGain,
      usCapGain: t.usCapGain ?? defaults.usCapGain,
    });
  }
}, { immediate: true });

const tax = computed(() => store.d?.tax || {
  dividends: [], capGainRows: [], divTax: 0, capGainTax: 0, totalTax: 0,
});

async function save() {
  saving.value = true;
  try {
    await authApi.putSettings({ taxRules: JSON.parse(JSON.stringify(rules)) });
    ElMessage.success('税率规则已保存，税务结果已重算');
    await store.refreshAll();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>
