<template>
  <div>
    <div class="page-head">
      <div>
        <h2>设置</h2>
        <div class="sub">成本口径、分红处理、基准选择与账号安全；所有口径实时重算，历史数据不被改写</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>核算口径</h3>
        <el-form label-width="120px" :model="form">
          <el-form-item label="成本核算方法">
            <el-radio-group v-model="form.costMethod">
              <el-radio label="wavg">移动加权平均（推荐）</el-radio>
              <el-radio label="fifo">先进先出 FIFO</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="现金分红处理">
            <el-switch v-model="form.dividendReducesCost"
              active-text="冲减持仓成本" inactive-text="计入已实现收益（默认）" />
          </el-form-item>
          <el-form-item label="基准指数代码">
            <el-input v-model="form.benchmarkCode" style="width:180px" placeholder="CSI300" />
            <span class="form-tip" style="margin-left:8px">点位在「绩效」页按月录入</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">保存口径设置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="card">
        <h3>修改密码</h3>
        <el-form label-width="100px">
          <el-form-item label="原密码"><el-input v-model="pwd.oldPassword" type="password" show-password /></el-form-item>
          <el-form-item label="新密码"><el-input v-model="pwd.newPassword" type="password" show-password placeholder="至少 8 位" /></el-form-item>
          <el-form-item label="确认新密码"><el-input v-model="pwd.confirm" type="password" show-password /></el-form-item>
          <el-form-item>
            <el-button :loading="changing" @click="changePwd">修改密码</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="card">
      <h3>口径速查</h3>
      <div class="tbl-wrap is-text">
        <table class="tbl">
          <thead><tr><th style="width:160px">项目</th><th>口径说明</th></tr></thead>
          <tbody>
            <tr><td><b>移动加权平均</b></td><td>每次买入后重算平均成本；卖出已实现 = (卖价 − 平均成本) × 数量 − 费用</td></tr>
            <tr><td><b>FIFO</b></td><td>卖出时按最早批次结转成本，同一笔卖出在两种口径下已实现可能不同，但总盈亏一致</td></tr>
            <tr><td><b>现金分红（默认）</b></td><td>计入已实现收益，持仓成本不变</td></tr>
            <tr><td><b>分红冲减成本</b></td><td>分红不计收益，等额冲减持仓成本；两种处理总盈亏相同</td></tr>
            <tr><td><b>送股</b></td><td>股数增加、成本总额不变、均价摊薄</td></tr>
            <tr><td><b>拆分/合股</b></td><td>按比例调整股数与成本价，成本总额不变</td></tr>
            <tr><td><b>多币种</b></td><td>每笔流水锁定当日汇率用于成本；市值按当前汇率折算；历史成本不随后续汇率变化</td></tr>
            <tr><td><b>累计投入</b></td><td>= 净入金（入金 − 出金） + 期初建仓本金；出金即下降，期初建仓不再需要“补录入金”</td></tr>
            <tr><td><b>期初建仓</b></td><td>记账前已持有的仓位；计入份额、成本与累计投入，但<b>不产生现金流</b>（账户现金不含它，属正常）</td></tr>
            <tr><td><b>累计收益</b></td><td>= 已实现（卖出/赎回） + 分红 + 利息 + 现金校准 + 浮动（唯一口径）</td></tr>
            <tr><td><b>收益率</b></td><td>= 累计收益 ÷ 累计投入；分母 ≤ 0 时显示“—”，不再用 0 冒充</td></tr>
            <tr><td><b>持仓市值</b></td><td>= Σ 各资产份额 × 单价（按当前汇率折算为人民币）；账户现金与融资单独展示，不做合成</td></tr>
            <tr><td><b>本年收益</b></td><td>统计区间 <b>1/1 – 12/31</b>；= <b>本年已实现</b>（当年卖出/分红/利息）+ <b>本年浮动</b><br>
              · <b>本年浮动 = 累计浮动 − 年初浮动</b>，其中年初浮动 = 上一年 12/31 的（持仓市值 − 剩余持仓成本）；无上年末快照时为 0<br>
              · <b>年收益率</b> = 本年收益 ÷ <b>年投入本金</b>；本金取上一年 12/31 的<b>证券净资产（持仓市值 − 融资）</b>，缺失上年末快照时退化为「本年净入金」<br>
              · 年初浮动与本金优先取上年 12/31 快照；缺失时按上述退化规则处理</td></tr>
            <tr><td><b>浮动盈亏的来源</b></td><td>浮动盈亏 = <b>股价损益</b> + <b>汇率损益</b>（仅作拆分展示，不改变任何计算口径）<br>
              · 股价损益 =（当前单价 − 成本单价）× 份额 × <b>当前汇率</b><br>
              · 汇率损益 = 浮动盈亏 − 股价损益（取残差，保证两者之和恒等于浮动盈亏）<br>
              · 成本按<b>建仓日汇率</b>折算、市值按<b>当前汇率</b>折算；汇率变动对以人民币记账的投资者属于实际盈亏</td></tr>
            <tr><td><b>交易手续费</b></td><td>股票、基金、理财、债券的买入 / 卖出 / 申购 / 赎回 / 分红均可录入（含税，按账户交易币种）；可填 0，不能为负；每个资产累计展示</td></tr>
            <tr><td><b>融资</b></td><td>仅券商账户可用。<b>融资是成交金额中借来的部分</b>（成交金额请填「自付 + 融资」的总额，手续费也可由融资覆盖）；融资不计入累计投入、不计入收益，需原样偿还券商；卖出所得优先偿还融资；资产会同时显示「实际净值」与「自付本金」</td></tr>
            <tr><td><b>出入金</b></td><td>本金搬运本身不产生盈亏；是<b>累计投入的主要来源</b>（累计投入 = 净入金 + 期初建仓），并作为 XIRR 的外部现金流。仅记<b>外部资金进出</b>，买入/申购属账户内部转移，勿重复登记</td></tr>
            <tr><td><b>内部划转 / 现金校准</b></td><td>内部划转是账户间搬运（支持不同币种），<b>不计入净入金</b>；账户视角会相应增减该账户的投入。现金校准用于对齐对账单，差额计入“其他损益”，不计入投入</td></tr>
            <tr><td><b>XIRR</b></td><td>资金加权年化，考虑每笔投入时点；期末值 = 持仓市值 + 现金 − 融资。TWR 为时间加权，剔除证券净投入影响（证券子组合，不含现金）</td></tr>
            <tr><td><b>账户现金</b></td><td>按发生日汇率记账（与成本锁定一致）；另展示按当前汇率重估的“现金当前价值”，其汇兑差额不计入累计收益</td></tr>
          </tbody>
        </table>
        <div v-if="store.dismissedWarnings.length" style="margin-top:10px;display:flex;align-items:center;gap:10px">
          <span class="sub" style="margin:0">
            已忽略 {{ store.dismissedWarnings.length }} 条数据一致性提示
          </span>
          <el-button size="small" @click="store.restoreWarnings()">恢复已忽略的提示</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { authApi } from '../api';

const store = usePortfolioStore();
const saving = ref(false);
const changing = ref(false);
const form = reactive({ costMethod: 'wavg', dividendReducesCost: false, benchmarkCode: 'CSI300' });
const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' });

watch(() => store.settings, s => {
  if (!s) return;
  form.costMethod = s.costMethod || 'wavg';
  form.dividendReducesCost = !!s.dividendReducesCost;
  form.benchmarkCode = s.benchmarkCode || 'CSI300';
}, { immediate: true });

async function save() {
  saving.value = true;
  try {
    await authApi.putSettings({ ...form });
    ElMessage.success('设置已保存，全量结果已按新口径重算');
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
async function changePwd() {
  if (pwd.newPassword.length < 8) return ElMessage.warning('新密码至少 8 位');
  if (pwd.newPassword !== pwd.confirm) return ElMessage.warning('两次输入的新密码不一致');
  changing.value = true;
  try {
    await authApi.changePassword(pwd.oldPassword, pwd.newPassword);
    ElMessage.success('密码已修改，下次登录请使用新密码');
    pwd.oldPassword = pwd.newPassword = pwd.confirm = '';
  } catch (e) { ElMessage.error(e.message); } finally { changing.value = false; }
}
</script>
