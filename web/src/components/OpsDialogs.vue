<template>
  <AssetDialog v-if="assetDlg" v-model="assetDlg" :asset="editingAsset" :accounts="store.accounts" @saved="changed" />
  <EventDialog v-if="eventAsset" v-model="eventDlg" :asset="eventAsset" :event="editingEvent" @saved="changed" />
  <AlertDialog v-if="alertAsset" v-model="alertDlg" :asset="alertAsset" @saved="changed" />
  <AccountDialog v-if="accountDlg" v-model="accountDlg" :account="editingAccount" @saved="changed" />
  <CashFlowDialog v-if="cashDlg" v-model="cashDlg" :accounts="store.accounts" :default-account-id="defaultCashAccount" @saved="changed" />
  <DcaPlanDialog v-if="dcaDlg" v-model="dcaDlg" :assets="store.assets" @saved="changed" />
  <TransferDialog v-if="transferDlg" v-model="transferDlg" :accounts="store.accounts" :default-account-id="defaultTransferAccount" @saved="changed" />
  <AdjustDialog v-if="adjustDlg" v-model="adjustDlg" :accounts="store.accounts" :default-account-id="defaultAdjustAccount" @saved="changed" />
  <FxDialog v-if="fxDlg" v-model="fxDlg" @saved="changed" />
</template>

<script setup>
import { ref } from 'vue';
import AssetDialog from './AssetDialog.vue';
import EventDialog from './EventDialog.vue';
import AlertDialog from './AlertDialog.vue';
import AccountDialog from './AccountDialog.vue';
import CashFlowDialog from './CashFlowDialog.vue';
import DcaPlanDialog from './DcaPlanDialog.vue';
import FxDialog from './FxDialog.vue';
import TransferDialog from './TransferDialog.vue';
import AdjustDialog from './AdjustDialog.vue';
import { usePortfolioStore } from '../stores/portfolio';

const store = usePortfolioStore();
const emit = defineEmits(['changed']);

const assetDlg = ref(false);
const eventDlg = ref(false);
const alertDlg = ref(false);
const accountDlg = ref(false);
const cashDlg = ref(false);
const dcaDlg = ref(false);
const fxDlg = ref(false);
const transferDlg = ref(false);
const adjustDlg = ref(false);

const editingAsset = ref(null);
const eventAsset = ref(null);
const editingEvent = ref(null);
const alertAsset = ref(null);
const editingAccount = ref(null);
const defaultCashAccount = ref('');
const defaultTransferAccount = ref('');
const defaultAdjustAccount = ref('');

async function changed() {
  await store.refreshAll();
  emit('changed');
}

defineExpose({
  createAsset: () => { editingAsset.value = null; assetDlg.value = true; },
  editAsset: (a) => { editingAsset.value = a; assetDlg.value = true; },
  addEvent: (a) => { eventAsset.value = a; editingEvent.value = null; eventDlg.value = true; },
  editEvent: (a, e) => { eventAsset.value = a; editingEvent.value = e; eventDlg.value = true; },
  setAlert: (a) => { alertAsset.value = a; alertDlg.value = true; },
  createAccount: () => { editingAccount.value = null; accountDlg.value = true; },
  editAccount: (a) => { editingAccount.value = a; accountDlg.value = true; },
  addCash: (accountId = '') => { defaultCashAccount.value = accountId; cashDlg.value = true; },
  addTransfer: (accountId = '') => { defaultTransferAccount.value = accountId; transferDlg.value = true; },
  addAdjust: (accountId = '') => { defaultAdjustAccount.value = accountId; adjustDlg.value = true; },
  createDca: () => { dcaDlg.value = true; },
  addFx: () => { fxDlg.value = true; },
});
</script>
