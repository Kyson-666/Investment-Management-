<template>
  <div>
    <div class="page-head">
      <div>
        <h2>收益报表</h2>
        <div class="sub">月度/年度已实现（含分红/利息/现金校准）与含浮动收益（月末快照在「数据」页录入；无快照月份仅统计已实现）</div>
      </div>
      <div class="actions">
        <el-select v-model="year" size="small" style="width:120px">
          <el-option v-for="y in years" :key="y.year" :label="y.year + ' 年'" :value="y.year" />
        </el-select>
      </div>
    </div>

    <div class="card">
      <h3>{{ year }} 年月度收益（CNY）</h3>
      <EChart :option="barOption" height="300px" />
    </div>

    <div class="grid-sidebar">
      <div class="card">
        <h3>月度明细</h3>
        <el-table :data="monthsOfYear" size="small" empty-text="该年暂无数据">
          <el-table-column prop="month" label="月份" width="90" />
          <el-table-column label="证券净投入" align="right">
            <template #default="{ row }">{{ money(row.net) }}</template>
          </el-table-column>
          <el-table-column label="月末持仓市值" align="right">
            <template #default="{ row }">{{ row.snap != null ? money(row.snap) : '—' }}</template>
          </el-table-column>
          <el-table-column label="已实现" align="right">
            <template #default="{ row }"><span :class="signClass(row.real)">{{ signedMoney(row.real) }}</span></template>
          </el-table-column>
          <el-table-column label="含浮动" align="right">
            <template #default="{ row }">
              <span v-if="row.floatTotal != null" :class="signClass(row.floatTotal)">{{ signedMoney(row.floatTotal) }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="card">
        <h3>年度汇总</h3>
        <el-table :data="years" size="small">
          <el-table-column prop="year" label="年度" width="80" />
          <el-table-column label="已实现" align="right">
            <template #default="{ row }"><span :class="signClass(row.real)">{{ signedMoney(row.real) }}</span></template>
          </el-table-column>
          <el-table-column label="含浮动" align="right">
            <template #default="{ row }">
              <span v-if="row.floatTotal != null" :class="signClass(row.floatTotal)">{{ signedMoney(row.floatTotal) }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <p class="form-tip" style="margin-top:10px">
          纯浮动 = 本月末持仓市值 − 上次快照市值 − <b>区间</b>证券净投入；含浮动 = 当月已实现 + 纯浮动。
          断档月份会累加区间内全部买卖/申赎，仍建议连续录入月末快照。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { usePortfolioStore } from '../stores/portfolio';
import { money, signedMoney, signClass } from '../utils/format';
import * as theme from '../utils/theme';
import EChart from '../components/EChart.vue';

const store = usePortfolioStore();
const months = computed(() => store.d?.reports?.months || []);
const years = computed(() => store.d?.reports?.years || []);
const year = ref('');

watch(years, list => {
  if (list.length && !list.find(y => y.year === year.value)) year.value = list[list.length - 1].year;
}, { immediate: true });

/* 表格按时间倒序（最新月份在前）便于阅读；
   图表必须按时间正序 —— 早期两处共用同一个已 reverse 的数组，
   导致柱状图 X 轴出现 12月→1月 的倒序，时间序列被读反。 */
const monthsAsc = computed(() => months.value.filter(m => m.month.startsWith(year.value)));
const monthsOfYear = computed(() => [...monthsAsc.value].reverse());

const barOption = computed(() => {
  const rows = monthsAsc.value;
  return {
    tooltip: { trigger: 'axis', valueFormatter: v => v == null ? '—' : '¥' + money(v) },
    legend: { data: ['已实现', '含浮动'], top: 0 },
    grid: { left: 70, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: rows.map(r => r.month.slice(5)) },
    yAxis: { type: 'value', axisLabel: { formatter: v => (v / 1000) + 'k' } },
    series: [
      { name: '已实现', type: 'bar', data: rows.map(r => Math.round(r.real * 100) / 100), itemStyle: { color: theme.primary() } },
      { name: '含浮动', type: 'bar', data: rows.map(r => r.floatTotal != null ? Math.round(r.floatTotal * 100) / 100 : null), itemStyle: { color: theme.warn() } },
    ],
  };
});
</script>
