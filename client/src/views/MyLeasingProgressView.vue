<script setup>
import { ref, computed, onMounted } from "vue";
import { leasingTransactions } from "../lib/resource.js";
import { formatDate } from "../lib/formatters.js";
import { stageByKey, nextStageKey } from "../../../shared/leasingStages.js";
import DeliveryTracker from "../components/DeliveryTracker.vue";
import ApprovalRouting from "../components/ApprovalRouting.vue";
import TransactionDocuments from "../components/TransactionDocuments.vue";
import UpcomingAppointment from "../components/UpcomingAppointment.vue";
import ViewingConfirmPanel from "../components/ViewingConfirmPanel.vue";

const list = ref([]);
const active = ref(null);
const loading = ref(true);
const error = ref("");

async function select(id) {
  try { active.value = await leasingTransactions.getMine(id); }
  catch (e) { error.value = e.response?.data?.error || "Could not load your progress"; }
}

onMounted(async () => {
  try {
    list.value = await leasingTransactions.mine();
    if (list.value.length) await select(list.value[0].id);
  } catch (e) {
    error.value = e.response?.data?.error || "Could not load your progress";
  } finally {
    loading.value = false;
  }
});

const stageCfg = computed(() => (active.value ? stageByKey(active.value.stage) : null));
const nextCfg = computed(() => (active.value ? stageByKey(nextStageKey(active.value.stage)) : null));
const remarks = computed(() => active.value?.stageData?.[active.value.stage]?.remarks || "");
const inApproval = computed(() => active.value?.stage === "APPROVAL");
async function reloadActive() { if (active.value) await select(active.value.id); }
function eventTime(iso) { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
</script>

<template>
  <section>
    <header><h1>Leasing Progress</h1><p class="muted">Track your leasing transaction from inquiry to contract.</p></header>

    <UpcomingAppointment />

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>

    <div v-else-if="!list.length" class="empty panel">
      <div class="empty__icon">📋</div>
      <h2>No active leasing transaction yet</h2>
      <p class="muted">Once your inquiry is accepted or your unit is approved, your progress will appear here.</p>
    </div>

    <template v-else-if="active">
      <div v-if="list.length > 1" class="switcher">
        <button v-for="t in list" :key="t.id" type="button" class="chip" :class="{ on: t.id === active.id }" @click="select(t.id)">{{ t.reference }}</button>
      </div>

      <div class="cols">
        <div class="col">
          <div class="panel tracker-panel">
            <DeliveryTracker
              :reference="active.reference" :current-stage="active.stage" :status="active.status"
              :final-status="active.finalStatus" :stage-data="active.stageData" :note="remarks"
            />
          </div>
        </div>

        <div class="col">
          <div v-if="active.assignedOfficer" class="panel rep-panel">
            <div class="panel__label">Your leasing representative</div>
            <div class="rep__name">{{ active.assignedOfficer.name }}</div>
            <div v-if="nextCfg" class="rep__next">Next step: <strong>{{ nextCfg.label }}</strong></div>
          </div>

          <ViewingConfirmPanel :transaction="active" @changed="reloadActive" />

          <div class="panel">
            <div class="panel__label">Your documents</div>
            <p v-if="inApproval" class="doc-hint">Please upload the requirements the leasing team asked for.</p>
            <TransactionDocuments :transaction-id="active.id" :documents="active.documents || []" can-upload @changed="reloadActive" />
          </div>

          <div v-if="active.approvalSteps?.length" class="panel">
            <div class="panel__label">Approval routing</div>
            <ApprovalRouting :transaction-id="active.id" :steps="active.approvalSteps" />
          </div>

          <div class="panel">
            <div class="panel__label">Activity history</div>
            <ul class="timeline">
              <li v-for="e in active.events" :key="e.id" class="tl">
                <span class="tl__dot"></span>
                <div class="tl__body">
                  <div class="tl__msg">{{ e.message }}</div>
                  <div class="tl__meta">{{ eventTime(e.createdAt) }}</div>
                </div>
              </li>
              <li v-if="!active.events?.length" class="muted">No activity yet.</li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.muted { color: var(--muted); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.75rem; }

.empty { text-align: center; padding: 3rem 1.5rem; }
.empty__icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
.empty h2 { font-family: var(--display); font-weight: 500; margin-bottom: 0.35rem; }

.switcher { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.chip { font: inherit; font-size: 0.8rem; font-weight: 600; padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--muted); cursor: pointer; }
.chip.on { background: var(--accent-050); border-color: transparent; color: var(--accent-text); }

.head-panel { margin: 0.5rem 0 1.1rem; }
.head-panel__top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
.ref { font-family: ui-monospace, "Consolas", monospace; font-size: 0.85rem; background: var(--accent-050); color: var(--accent-text); padding: 0.15rem 0.5rem; border-radius: var(--radius-sm); }
.fbadge { margin-left: 0.5rem; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; background: var(--good-050); color: var(--good); padding: 0.15rem 0.55rem; border-radius: 999px; }
.rep { text-align: right; }
.rep__label { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
.rep__name { font-weight: 600; }

.cols { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1.1rem; align-items: start; }
.col { display: flex; flex-direction: column; gap: 1.1rem; }
.tracker-panel { padding: 1.25rem; }
.rep-panel .rep__name { font-weight: 700; font-size: 1.05rem; color: var(--text); }
.rep-panel .rep__next { margin-top: 0.4rem; font-size: 0.85rem; color: var(--muted); }
.doc-hint { font-size: 0.85rem; color: var(--accent-text); background: var(--accent-050); border-radius: var(--radius-sm); padding: 0.5rem 0.7rem; margin: 0 0 0.75rem; }
.current { border-left: 3px solid var(--accent); }
.stage-name { font-family: var(--display); font-weight: 500; font-size: 1.5rem; margin: 0 0 0.5rem; }
.status-line { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--accent-text); margin: 0 0 0.75rem; }
.status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-050); }
.action { color: var(--text); margin: 0 0 1rem; line-height: 1.5; }
.remarks { background: var(--paper); border-radius: var(--radius-sm); padding: 0.65rem 0.8rem; font-size: 0.88rem; color: var(--muted); margin: 0 0 1rem; }
.next { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 0.8rem; }
.next__label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
.next__val { font-weight: 700; color: var(--ink-800); }

.timeline { list-style: none; margin: 0; padding: 0; }
.tl { display: flex; gap: 0.7rem; padding: 0.5rem 0; position: relative; }
.tl:not(:last-child)::before { content: ""; position: absolute; left: 5px; top: 1.1rem; bottom: -0.3rem; width: 2px; background: var(--line); }
.tl__dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent-050); border: 2px solid var(--accent); flex-shrink: 0; margin-top: 0.2rem; position: relative; z-index: 1; }
.tl__msg { font-size: 0.88rem; }
.tl__meta { font-size: 0.75rem; color: var(--faint); margin-top: 0.1rem; }

@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
