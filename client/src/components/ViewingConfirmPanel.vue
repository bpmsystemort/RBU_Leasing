<script setup>
// Lessor-facing panel in Leasing Progress: when the officer has proposed a
// viewing time for the owner's unit, confirm it or propose another.
import { ref, computed, onMounted, watch } from "vue";
import { appointments } from "../lib/resource.js";
import { formatDate } from "../lib/formatters.js";

const props = defineProps({ transaction: { type: Object, required: true } });
const emit = defineEmits(["changed"]);

const appt = ref(null);
const error = ref("");
const busy = ref(false);
const proposing = ref(false);
const scheduledAt = ref("");

const atViewing = computed(() => props.transaction?.stage === "UNIT_VIEWING");
// A proposal from staff is awaiting the lessor's decision.
const awaitingLessor = computed(() => appt.value?.status === "Proposed" && appt.value?.proposedByRole !== "UNIT_OWNER");
const awaitingOfficer = computed(() => appt.value?.status === "Proposed" && appt.value?.proposedByRole === "UNIT_OWNER");
const confirmed = computed(() => appt.value?.status === "Confirmed");

async function load() {
  error.value = "";
  if (!atViewing.value || !props.transaction?.id) { appt.value = null; return; }
  try {
    const rows = await appointments.forTransaction(props.transaction.id);
    appt.value = rows.find((a) => a.stage === "UNIT_VIEWING") || null;
  } catch (e) { error.value = e.response?.data?.error || "Could not load the viewing"; }
}
onMounted(load);
watch(() => props.transaction, load);

async function confirm() {
  error.value = ""; busy.value = true;
  try { await appointments.confirm(appt.value.id); await load(); emit("changed"); }
  catch (e) { error.value = e.response?.data?.error || "Could not confirm"; }
  finally { busy.value = false; }
}
async function sendProposal() {
  if (!scheduledAt.value) return;
  error.value = ""; busy.value = true;
  try {
    await appointments.propose(appt.value.id, { scheduledAt: new Date(scheduledAt.value).toISOString() });
    proposing.value = false; scheduledAt.value = ""; await load(); emit("changed");
  } catch (e) { error.value = e.response?.data?.error || "Could not propose a time"; }
  finally { busy.value = false; }
}
function cancelProposing() { proposing.value = false; scheduledAt.value = ""; }
function timeOf(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; }
</script>

<template>
  <div v-if="atViewing && (appt || error)" class="panel viewing">
    <div class="panel__label">Unit viewing</div>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="appt">
      <p class="when">{{ formatDate(appt.scheduledAt) }} · {{ timeOf(appt.scheduledAt) }}</p>
      <p v-if="appt.location" class="muted">{{ appt.location }}</p>

      <template v-if="confirmed">
        <p class="ok">Confirmed — we'll see you then.</p>
      </template>
      <template v-else-if="awaitingOfficer">
        <p class="muted">Your proposed time was sent — awaiting the leasing officer's confirmation.</p>
      </template>
      <template v-else-if="awaitingLessor">
        <p class="ask">The leasing officer proposed this time. Confirm it, or propose another.</p>
        <div v-if="!proposing" class="actions">
          <button type="button" class="primary" :disabled="busy" @click="confirm">Confirm</button>
          <button type="button" class="ghost" :disabled="busy" @click="proposing = true">Propose another time</button>
        </div>
        <div v-else class="form">
          <label>New date &amp; time</label>
          <input type="datetime-local" v-model="scheduledAt" />
          <div class="actions">
            <button type="button" class="ghost" :disabled="busy" @click="cancelProposing">Cancel</button>
            <button type="button" class="primary" :disabled="busy || !scheduledAt" @click="sendProposal">Send</button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.75rem; }
.when { font-weight: 600; font-size: 1rem; margin: 0 0 0.2rem; }
.muted { color: var(--muted); margin: 0.2rem 0; font-size: 0.88rem; }
.ask { color: var(--text); margin: 0.5rem 0 0.8rem; }
.ok { color: var(--good); font-weight: 600; }
.error { color: var(--danger); }
.actions { display: flex; gap: 0.55rem; flex-wrap: wrap; margin-top: 0.4rem; }
.form { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; }
.form label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--muted); }
.form input { font: inherit; padding: 0.55rem 0.65rem; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.5rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost { background: var(--surface); color: var(--ink-700); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.5rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
