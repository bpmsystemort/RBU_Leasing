<script setup>
// Staff scheduling panel for the current stage's site visit (Unit Inspection,
// Photoshoot). Shows a schedule form when no appointment exists
// yet for the stage, or the appointment's status + actions when one does.
import { ref, computed, onMounted } from "vue";
import { appointments } from "../lib/resource.js";
import { SCHEDULABLE_STAGES, SCHEDULABLE_STAGE_KEYS, stageByKey } from "../../../shared/leasingStages.js";
import { formatDate } from "../lib/formatters.js";

const props = defineProps({
  transaction: { type: Object, required: true },
});
const emit = defineEmits(["changed"]);

const rows = ref([]);
const error = ref("");
const busy = ref(false);

// Schedule form fields
const scheduledAt = ref("");
const location = ref("");
const notes = ref("");
const rescheduling = ref(false);

// Cancel/no-show fields
const cancelling = ref(false);
const cancelStatus = ref("Cancelled");
const cancelReason = ref("");

// Complete fields
const outcome = ref("");

const targetStage = computed(() =>
  props.transaction?.stage && SCHEDULABLE_STAGE_KEYS.includes(props.transaction.stage) ? props.transaction.stage : null,
);
const stageCfg = computed(() => (targetStage.value ? SCHEDULABLE_STAGES[targetStage.value] : null));
const current = computed(() => rows.value.find((a) => a.stage === targetStage.value) || null);
// An appointment that was Cancelled or marked No-show is no longer "active" --
// it should be treated like there's no appointment yet, so the schedule form
// reopens and staff can rebook the stage. Completed stays terminal.
const active = computed(() => current.value && !["Cancelled", "No-show"].includes(current.value.status));
const isDone = computed(() => current.value && current.value.status === "Completed");

const isViewing = computed(() => targetStage.value === "UNIT_VIEWING");
// For a viewing, "active" must include a Proposed/Confirmed row (not just Scheduled).
const hasOutcomeSelect = computed(() => ["UNIT_INSPECTION", "UNIT_VIEWING"].includes(targetStage.value));
// The lessor proposed the current time → staff may confirm it.
const canConfirm = computed(() => isViewing.value && current.value?.status === "Proposed" && current.value?.proposedByRole === "UNIT_OWNER");
// We proposed and are waiting on the lessor.
const awaitingLessor = computed(() => isViewing.value && current.value?.status === "Proposed" && current.value?.proposedByRole !== "UNIT_OWNER");

async function load() {
  if (!props.transaction?.id) return;
  try {
    rows.value = await appointments.forTransaction(props.transaction.id);
  } catch (e) {
    error.value = e.response?.data?.error || "Could not load appointments";
  }
  if (hasOutcomeSelect.value && !outcome.value) {
    outcome.value = stageCfg.value?.outcomeOptions?.[0] || "";
  }
}
onMounted(load);

function resetFormFields() {
  scheduledAt.value = "";
  location.value = "";
  notes.value = "";
}

async function schedule() {
  if (!scheduledAt.value) return;
  error.value = "";
  busy.value = true;
  try {
    await appointments.schedule(props.transaction.id, targetStage.value, {
      scheduledAt: new Date(scheduledAt.value).toISOString(),
      location: location.value || null,
      notes: notes.value || null,
    });
    resetFormFields();
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.response?.data?.error || "Could not schedule the appointment";
  } finally {
    busy.value = false;
  }
}

function openReschedule() {
  rescheduling.value = true;
  scheduledAt.value = "";
  location.value = current.value?.location || "";
  notes.value = current.value?.notes || "";
}
function cancelReschedule() {
  rescheduling.value = false;
  resetFormFields();
}
async function reschedule() {
  if (!scheduledAt.value) return;
  error.value = "";
  busy.value = true;
  try {
    const body = {
      scheduledAt: new Date(scheduledAt.value).toISOString(),
      location: location.value || null,
      notes: notes.value || null,
    };
    if (isViewing.value) await appointments.propose(current.value.id, body);
    else await appointments.reschedule(current.value.id, body);
    rescheduling.value = false;
    resetFormFields();
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.response?.data?.error || "Could not update the appointment";
  } finally {
    busy.value = false;
  }
}

async function confirmViewing() {
  error.value = "";
  busy.value = true;
  try {
    await appointments.confirm(current.value.id);
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.response?.data?.error || "Could not confirm the viewing";
  } finally {
    busy.value = false;
  }
}

async function complete() {
  error.value = "";
  busy.value = true;
  try {
    const body = hasOutcomeSelect.value ? { outcome: outcome.value } : {};
    await appointments.complete(current.value.id, body);
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.response?.data?.error || "Could not complete the appointment";
  } finally {
    busy.value = false;
  }
}

function openCancel() {
  cancelling.value = true;
  cancelStatus.value = "Cancelled";
  cancelReason.value = "";
}
function cancelCancel() {
  cancelling.value = false;
  cancelReason.value = "";
}
async function doCancel() {
  error.value = "";
  busy.value = true;
  try {
    await appointments.cancel(current.value.id, { status: cancelStatus.value, reason: cancelReason.value || undefined });
    cancelling.value = false;
    cancelReason.value = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.response?.data?.error || "Could not cancel the appointment";
  } finally {
    busy.value = false;
  }
}

function statusClass(s) {
  if (s === "Completed") return "ok";
  if (s === "Cancelled" || s === "No-show") return "bad";
  if (s === "Rescheduled") return "warn";
  return "pending";
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="scheduling">
    <p v-if="!targetStage" class="muted">No visit to schedule at this stage.</p>

    <template v-else>
      <p v-if="error" class="error">{{ error }}</p>

      <!-- No active appointment (none yet, or the prior one was Cancelled/No-show): schedule form -->
      <div v-if="!active" class="form">
        <div class="field">
          <label>Date &amp; time</label>
          <input type="datetime-local" v-model="scheduledAt" />
        </div>
        <div class="field">
          <label>Location</label>
          <input type="text" v-model="location" placeholder="Where will this take place?" />
        </div>
        <div class="field">
          <label>Notes <span class="muted">(optional)</span></label>
          <textarea rows="2" v-model="notes"></textarea>
        </div>
        <div class="actions">
          <button type="button" class="primary" :disabled="busy || !scheduledAt" @click="schedule">{{ isViewing ? "Propose time" : "Schedule" }}</button>
        </div>
      </div>

      <!-- Prior appointment was Cancelled/No-show: keep a small record of it -->
      <p v-if="current && !active" class="muted prev-status">
        Previous: {{ current.status }}<span v-if="current.reason"> — {{ current.reason }}</span>
      </p>

      <!-- Existing, active or completed appointment -->
      <div v-if="active" class="appt">
        <div class="appt__top">
          <span class="badge" :class="statusClass(current.status)">{{ current.status }}</span>
          <span class="appt__when">{{ formatDate(current.scheduledAt) }} · {{ formatTime(current.scheduledAt) }}</span>
        </div>
        <dl class="meta">
          <div v-if="current.location"><dt>Location</dt><dd>{{ current.location }}</dd></div>
          <div v-if="current.notes"><dt>Notes</dt><dd>{{ current.notes }}</dd></div>
          <div v-if="current.outcome"><dt>Outcome</dt><dd>{{ current.outcome }}</dd></div>
        </dl>

        <template v-if="!isDone">
          <div v-if="hasOutcomeSelect" class="field">
            <label>Outcome</label>
            <select v-model="outcome">
              <option v-for="o in stageCfg.outcomeOptions" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>
          <p v-if="awaitingLessor" class="muted">Awaiting the lessor's confirmation of this time.</p>
          <div v-if="canConfirm" class="actions">
            <button type="button" class="primary" :disabled="busy" @click="confirmViewing">Confirm</button>
          </div>
          <div class="actions">
            <button type="button" class="ghost" :disabled="busy" @click="openReschedule">{{ isViewing ? "Propose another time" : "Reschedule" }}</button>
            <button type="button" class="primary" v-if="!isViewing || current.status === 'Confirmed'" :disabled="busy" @click="complete">Complete</button>
            <button type="button" class="danger" :disabled="busy" @click="openCancel">Cancel / No-show</button>
          </div>
        </template>

        <div v-if="rescheduling" class="form sub">
          <div class="field">
            <label>New date &amp; time</label>
            <input type="datetime-local" v-model="scheduledAt" />
          </div>
          <div class="field">
            <label>Location</label>
            <input type="text" v-model="location" />
          </div>
          <div class="field">
            <label>Notes <span class="muted">(optional)</span></label>
            <textarea rows="2" v-model="notes"></textarea>
          </div>
          <div class="actions">
            <button type="button" class="ghost" :disabled="busy" @click="cancelReschedule">Cancel</button>
            <button type="button" class="primary" :disabled="busy || !scheduledAt" @click="reschedule">{{ isViewing ? "Send proposal" : "Save reschedule" }}</button>
          </div>
        </div>

        <div v-if="cancelling" class="form sub">
          <div class="field">
            <label>Status</label>
            <select v-model="cancelStatus">
              <option value="Cancelled">Cancelled</option>
              <option value="No-show">No-show</option>
            </select>
          </div>
          <div class="field">
            <label>Reason <span class="muted">(optional)</span></label>
            <textarea rows="2" v-model="cancelReason"></textarea>
          </div>
          <div class="actions">
            <button type="button" class="ghost" :disabled="busy" @click="cancelCancel">Back</button>
            <button type="button" class="danger" :disabled="busy" @click="doCancel">Confirm</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.muted { color: var(--muted); }
.error { color: var(--danger); }
.field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.8rem; }
.field label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--muted); }
.field input, .field select, .field textarea {
  font: inherit; font-size: 0.95rem; color: var(--text); background: var(--surface);
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.55rem 0.65rem; width: 100%;
}
.field textarea { resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--accent-text); box-shadow: var(--ring); }

.actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.3rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; box-shadow: var(--shadow-sm); border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.primary:hover:not(:disabled) { background: var(--accent-600); }
.ghost { background: var(--surface); color: var(--ink-700); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost:hover:not(:disabled) { background: var(--paper); border-color: var(--muted); }
.danger { background: var(--surface); color: var(--danger); border: 1px solid var(--danger); border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.danger:hover:not(:disabled) { background: var(--danger-050); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.appt__top { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
.appt__when { font-weight: 600; font-size: 0.95rem; }
.badge { font-size: 0.66rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; background: var(--paper); color: var(--muted); border: 1px solid var(--line); }
.badge.ok { background: var(--good-050); color: var(--good); border-color: var(--good); }
.badge.bad { background: var(--danger-050); color: var(--danger); border-color: var(--danger); }
.badge.warn { background: var(--warn-050); color: var(--warn); border-color: var(--warn); }
.badge.pending { background: var(--accent-050); color: var(--accent-text); border-color: var(--accent-text); }

.meta { margin: 0 0 0.7rem; display: flex; flex-direction: column; gap: 0.3rem; }
.meta > div { display: grid; grid-template-columns: 6rem 1fr; gap: 0.5rem; }
.meta dt { color: var(--muted); font-size: 0.82rem; }
.meta dd { margin: 0; font-size: 0.9rem; }

.form.sub { margin-top: 0.85rem; padding-top: 0.85rem; border-top: 1px solid var(--line); }
</style>
