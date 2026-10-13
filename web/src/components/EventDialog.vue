<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="title" width="500px">
    <el-form :model="form" label-width="92px">
      <el-form-item label="资产">
        <el-input :model-value="assetLabel" disabled />
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>

      <!-- 股票 -->
      <template v-if="asset?.type === 'stock'">
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.side">
            <el-radio-button label="buy">买入</el-radio-button>
            <el-radio-button label="sell">卖出</el-radio-button>
            <el-radio-button label="div">分红</el-radio-button>
            <el-radio-button label="bonus">送股</el-radio-button>
            <el-radio-button label="split">拆分</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.side === 'buy' || form.side === 'sell'">
          <el-form-item label="数量(股)" required>
            <el-input-number v-model="form.qty" :min="0" :precision="0" controls-position="right" style="width:200px" />
          </el-form-item>
          <el-form-item label="成交价" required>
            <el-input-number v-model="form.price" :min="0" :precision="3" controls-position="right" style="width:200px" />
            <span class="form-tip" style="margin-left:8px">单位：{{ ccyName(asset?.currency) }}</span>
          </el-form-item>
          <el-form-item label="标记为做T" v-if="form.side === 'buy'">
            <el-switch v-model="form.isT" :active-value="1" :inactive-value="0" />
          </el-form-item>
        </template>
        <template v-else-if="form.side === 'div'">
          <el-form-item label="录入币种">
            <el-radio-group v-model="form.incCurrency">
              <el-radio-button label="CNY">人民币 CNY</el-radio-button>
              <el-radio-button label="USD">美元 USD</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="分红金额" required>
            <el-input-number v-model="form.amount" :precision="2" controls-position="right" style="width:200px" />
            <div class="form-tip" style="margin-left:8px">单位：{{ form.incCurrency === 'USD' ? '美元' : '人民币' }}；可为负数（用于记录融资利息等支出）</div>
          </el-form-item>
        </template>
        <el-form-item label="送股数量" required v-else-if="form.side === 'bonus'">
          <el-input-number v-model="form.qty" :min="0" :precision="0" controls-position="right" style="width:200px" />
        </el-form-item>
        <el-form-item label="拆分比例" required v-else-if="form.side === 'split'">
          <el-input-number v-model="form.ratio" :min="0" :step="0.1" :precision="3" controls-position="right" style="width:200px" />
          <span class="form-tip" style="margin-left:8px">2=1拆2；0.5=合股</span>
        </el-form-item>
      </template>

      <!-- 基金/理财/债券 -->
      <template v-else>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.kind">
            <el-radio-button label="invest">申购/投入</el-radio-button>
            <el-radio-button label="redeem">赎回</el-radio-button>
            <el-radio-button label="income">收益(利息/分红)</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.kind === 'invest' || form.kind === 'redeem'">
          <el-form-item label="份额" required>
            <el-input-number v-model="form.qty" :min="0" :precision="4" controls-position="right" style="width:200px" />
            <span class="form-tip" style="margin-left:8px">当前净值 {{ asset.unitPrice || '—' }}</span>
          </el-form-item>
          <el-form-item label="单位净值" required>
            <el-input-number v-model="form.price" :min="0" :precision="6" controls-position="right" style="width:200px" />
            <span class="form-tip" style="margin-left:8px">{{ ccyName(asset?.currency) }}/份，申购赎回按当时净值</span>
          </el-form-item>
          <el-form-item label="金额合计">
            <span class="form-tip">{{ computedAmount }}（= 份额 × 单位净值，由系统计算）</span>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="录入币种">
            <el-radio-group v-model="form.incCurrency">
              <el-radio-button label="CNY">人民币 CNY</el-radio-button>
              <el-radio-button label="USD">美元 USD</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="金额" required>
            <el-input-number v-model="form.amount" :precision="2" controls-position="right" style="width:240px" />
            <div class="form-tip" style="margin-left:8px">单位：{{ form.incCurrency === 'USD' ? '美元' : '人民币' }}；可为负数（用于记录融资利息等支出）</div>
          </el-form-item>
        </template>
      </template>

      <el-form-item label="手续费" v-if="showFee">
        <el-input-number v-model="form.fee" :min="0" :precision="2" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">{{ ccyName(feeCurrency) }}（含税），可为 0、不能为负</span>
      </el-form-item>

      <template v-if="showMargin">
        <el-form-item label="本次融资">
          <el-radio-group v-model="form.marginCurrency" style="margin-right:8px">
            <el-radio-button label="CNY">CNY</el-radio-button>
            <el-radio-button label="USD">USD</el-radio-button>
          </el-radio-group>
          <el-input-number v-model="form.margin" :min="0" :precision="2" controls-position="right" style="width:150px" />
        </el-form-item>
        <el-form-item label=" ">
          <div class="form-tip" style="line-height:1.7">
            单位为{{ ccyName(form.marginCurrency) }}；留空或 0 表示全部用自有资金。
            <br>
            ⚠️ <b>融资不能超过「成交金额 + 手续费」</b>——成交金额请填「自付 + 融资」的总额（融资是其中借来的部分，手续费也可由融资覆盖）。
            <template v-if="+form.margin > 0">
              <br>
              本次 <b>总额 {{ fmtMoney(grossAmount) }} {{ asset?.currency }}</b> − <b>融资 {{ fmtMoney(+form.margin) }} {{ form.marginCurrency }}</b>
              = <b>你要自付 {{ fmtMoney(selfPaid) }} {{ form.marginCurrency }}</b>
              <span v-if="selfPaid < 0" style="color:#c45656">（融资已超过总额，请检查录入）</span>
            </template>
            <br>
            <b>卖出所得会优先偿还融资</b>，融资需原样还给券商，不计入你的收益。
          </div>
        </el-form-item>
      </template>

      <el-form-item label="锁定汇率" v-if="showFxInput">
        <el-input-number v-model="form.fx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">1 USD = ? CNY，默认当日生效汇率</span>
      </el-form-item>
      <el-form-item label=" " v-if="isBuyLike">
        <span class="form-tip" style="line-height:1.6">
          💡 若这笔钱是从账户外部转入的，请先在「出入金」页登记<b>入金</b>；
          此处只记录账户内部「资金→持仓」的转换，避免同一笔钱被重复计入投入。
        </span>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：建仓 / 补仓 / T出" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { eventsApi, fxApi } from '../api';
import { todayStr, TYPE_LABEL, MARKET_LABEL } from '../utils/format';
import { ccyName } from '../utils/format';
import { usePortfolioStore } from '../stores/portfolio';

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, required: true },
  event: { type: Object, default: null }, // 编辑时传入
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({});

const assetLabel = computed(() =>
  `${props.asset.name}（${TYPE_LABEL[props.asset.type]}${props.asset.market ? '·' + MARKET_LABEL[props.asset.market] : ''}·${props.asset.currency}）`);
const title = computed(() => `${props.event ? '编辑' : '新增'}流水 · ${props.asset.name}`);
/** 买入/申购：提示入金登记，避免重复计入投入 */
const isBuyLike = computed(() =>
  props.asset?.type === 'stock' ? form.side === 'buy'
    : (form.kind === 'invest'));
const isFlowShare = computed(() =>
  props.asset?.type !== 'stock' && (form.kind === 'invest' || form.kind === 'redeem'));
const computedAmount = computed(() => {
  const v = (+form.qty || 0) * (+form.price || 0);
  return v > 0 ? v.toFixed(2) : '—';
});
/** 汇率兜底：优先用已加载组合里的当前汇率，避免写死 */
function rateFallback() {
  const r = +((store.kpis || {}).fxCurrent);
  return isFinite(r) && r > 0 ? r : 7.1;
}
const store = usePortfolioStore();
/** 本次买入/申购的成交总额（资产币种） */
const grossAmount = computed(() => (+form.qty || 0) * (+form.price || 0));
/** 自付 = 成交总额 + 手续费 − 融资额（统一换算到融资录入币种后相减；rate = 1 USD = ? CNY）。
    口径与后端校验、引擎现金公式一致：融资 ≤ 成交金额 + 手续费（自付 ≥ 0，手续费可由融资覆盖）。
    此前把 USD 融资 ×rate 当账户币种金额再相减，方向反了 → 全融资买入显示巨额负数并误报。 */
const selfPaid = computed(() => {
  const m = +form.margin || 0;
  if (!(m > 0)) return 0;
  const rate = +form.fx > 0 ? +form.fx : rateFallback();
  const astCur = props.asset?.currency || 'CNY';
  const toInput = (v, fromCcy) => {
    if (fromCcy === form.marginCurrency) return v;               // 同币种无需换算
    return fromCcy === 'USD' ? v * rate : v / rate;              // USD→CNY 乘，CNY→USD 除
  };
  const fee = +form.fee || 0;
  return +(toInput(grossAmount.value, astCur) + toInput(fee, feeCurrency.value) - m).toFixed(2);
});
const fmtMoney = v => (Math.round((+v || 0) * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 账户是否券商（仅券商可融资） */
const isBroker = computed(() => {
  const acc = store.accounts.find(a => a.id === props.asset?.accountId);
  return acc?.kind === 'broker';
});
/** 手续费：所有类型均可录 */
const showFee = computed(() => {
  if (props.asset?.type === 'stock') return ['buy', 'sell', 'div'].indexOf(form.side) >= 0;
  return ['invest', 'redeem', 'income'].indexOf(form.kind) >= 0;
});
/** 融资：仅券商账户的买入/申购 */
const showMargin = computed(() => isBroker.value && isBuyLike.value);
/** 账户交易币种（手续费按此币种录入；无账户信息时回退资产币种） */
const accountCurrency = computed(() => {
  const acc = store.accounts.find(a => a.id === props.asset?.accountId);
  return acc?.currency || props.asset?.currency || 'CNY';
});
const feeCurrency = computed(() => accountCurrency.value);
/** 手续费需换算：账户币种 ≠ 资产币种时（如 CNY 账户持有 USD 资产） */
const feeNeedsFx = computed(() => accountCurrency.value !== (props.asset?.currency || 'CNY'));

/** 收益类（分红/利息）支持币种与负数 */
const isIncomeLike = computed(() =>
  props.asset?.type === 'stock' ? form.side === 'div' : form.kind === 'income');
/** 需要汇率输入：资产为 USD / 融资或收益按 USD 录入 */
const showFxInput = computed(() =>
  props.asset?.currency === 'USD'
  || (showMargin.value && form.marginCurrency === 'USD')
  || (isIncomeLike.value && form.incCurrency !== (props.asset?.currency || 'CNY'))
  || (showFee.value && feeNeedsFx.value));

async function reset() {
  if (props.event) {
    Object.assign(form, {
      date: props.event.date, side: props.event.side, kind: props.event.kind,
      qty: props.event.qty, price: props.event.price, amount: props.event.amount,
      ratio: props.event.ratio, fee: props.event.fee || 0, fx: props.event.fx || 1,
      isT: props.event.isT || 0, note: props.event.note || '',
      margin: props.event.marginCNY || 0, marginCurrency: 'CNY',
      incCurrency: props.asset?.currency || 'CNY',
    });
  } else {
    Object.assign(form, {
      date: todayStr(), side: 'buy', kind: 'invest',
      qty: null, price: null, amount: null, ratio: null,
      fee: 0, fx: rateFallback(), isT: 0, note: '',
      margin: 0, marginCurrency: 'CNY', incCurrency: props.asset?.currency || 'CNY',
    });
    /* 始终取「接口最新汇率」：除 USD 资产外，融资 / 收益 / 手续费按 USD 录入时也要用 */
    try { const c = await fxApi.current(); if (c && +c.rate > 0) form.fx = +c.rate; } catch { /* 保留兜底 */ }
  }
}
watch(() => props.modelValue, v => { if (v) reset(); }, { immediate: true });

async function save() {
  const payload = { assetId: props.asset.id, ...form };
  if (!payload.date) return ElMessage.warning('请选择日期');
  /* v5：非股票申购/赎回必须填份额与单位净值（金额由后端按 份额×净值 计算） */
  if (isFlowShare.value) {
    if (!(+payload.qty > 0)) return ElMessage.warning('请填写份额（申购/赎回必须填写份额）');
    if (!(+payload.price > 0)) return ElMessage.warning('请填写单位净值');
    payload.amount = undefined;
  }
  /* 手续费：按【账户交易币种】录入，换算为【资产币种】后入库
     （两者一致时无换算；如 CNY 账户持有 USD 资产则需汇率） */
  const feeIn = +form.fee || 0;
  if (feeIn > 0 && feeNeedsFx.value) {
    const rate = +form.fx || 0;
    if (!(rate > 0)) return ElMessage.warning('账户币种与资产币种不同，请填写有效汇率以换算手续费');
    const acct = accountCurrency.value, ast = props.asset?.currency || 'CNY';
    const feeCNY = acct === 'USD' ? feeIn * rate : feeIn;        // 账户币种 → CNY
    payload.fee = +((ast === 'USD' ? feeCNY / rate : feeCNY)).toFixed(4);   // CNY → 资产币种
  } else {
    payload.fee = feeIn;
  }

  /* 融资额：按录入币种换算为 CNY（USD 需汇率） */
  const mg = +form.margin || 0;
  if (mg > 0 && showMargin.value) {
    if (form.marginCurrency === 'USD') {
      const rate = +form.fx || 0;
      if (!(rate > 0)) return ElMessage.warning('按 USD 录入融资时请填写有效汇率');
      payload.marginCNY = +(mg * rate).toFixed(2);
    } else {
      payload.marginCNY = +mg.toFixed(2);
    }
  } else {
    payload.marginCNY = 0;
  }
  delete payload.margin;
  delete payload.marginCurrency;
  /* 收益类：带录入币种（后端按汇率换算为资产币种） */
  if (isIncomeLike.value) payload.inputCurrency = form.incCurrency;
  else delete payload.incCurrency;
  saving.value = true;
  try {
    if (props.event) await eventsApi.update(props.event.id, payload);
    else await eventsApi.create(payload);
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
