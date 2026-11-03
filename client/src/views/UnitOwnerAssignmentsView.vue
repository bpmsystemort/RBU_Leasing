<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { units, owners } from "../lib/resource.js";
import { formatDate } from "../lib/formatters.js";
import SearchableSelect from "../components/SearchableSelect.vue";

// ADMIN console for moving a unit to another owner. Reassigning only changes the
// unit's owner and records who did it and why; logins, open deals and leases
// keep pointing at whoever they pointed at.
const route = useRoute();

const rows = ref([]);
const ownerList = ref([]);
const loading = ref(true);
const loadError = ref("");

// Reassign dialog
const reassigning = ref(null); // the unit row being reassigned
const toOwnerId = ref(null);
const reason = ref("");
const saving = ref(false);
const reassignError = ref("");

// History panel
const historyUnit = ref(null); // the unit row whose history is open
const history = ref([]);
const historyLoading = ref(false);
const historyError = ref("");

const unitRows = computed(() =>
  rows.value.map((u) => ({
    ...u,
    towerName: u.tower?.name || "Unassigned",
    ownerName: u.owner?.name || "—",
  })),
);

// The owner the unit already has is not a valid target.
const ownerOptions = computed(() =>
  ownerList.value
    .filter((o) => o.id !== reassigning.value?.owner?.id)
    .map((o) => ({ value: o.id, label: o.name })),
);

function approvalLabel(value) {
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : "—";
}

async function reload() {
  rows.value = await units.list();
}

onMounted(async () => {
  try {
    const [u, o] = await Promise.all([units.list(), owners.linkable()]);
    rows.value = u;
    ownerList.value = o;
  } catch (e) {
    loadError.value = e.response?.data?.error || "Could not load units.";
  } finally {
    loading.value = false;
  }
  // Arriving from the Units page ("Reassign owner") opens that unit's dialog.
  const wanted = route.query.unit ? String(route.query.unit) : "";
  const target = wanted && unitRows.value.find((u) => u.id === wanted);
  if (target) openReassign(target);
});

function openReassign(row) {
  reassigning.value = row;
  toOwnerId.value = null;
  reason.value = "";
  reassignError.value = "";
}
function closeReassign() {
  reassigning.value = null;
}

async function confirmReassign() {
  if (!toOwnerId.value || saving.value) return;
  saving.value = true;
  reassignError.value = "";
  const unitId = reassigning.value.id;
  try {
    await units.assignOwner(unitId, { toOwnerId: toOwnerId.value, reason: reason.value.trim() || null });
    reassigning.value = null;
  } catch (e) {
    reassignError.value = e.response?.data?.error || "Could not reassign this unit.";
    saving.value = false;
    return;
  }
  saving.value = false;
  try {
    await reload();
    // A history panel already open for this unit now has a new row.
    if (historyUnit.value?.id === unitId) await loadHistory(historyUnit.value);
  } catch (e) {
    loadError.value = e.response?.data?.error || "Could not refresh the units.";
  }
}

async function loadHistory(row) {
  historyLoading.value = true;
  historyError.value = "";
  try {
    history.value = await units.assignments(row.id);
  } catch (e) {
    history.value = [];
    historyError.value = e.response?.data?.error || "Could not load the assignment history.";
  } finally {
    historyLoading.value = false;
  }
}
async function toggleHistory(row) {
  if (historyUnit.value?.id === row.id) {
    historyUnit.value = null;
    return;
  }
  historyUnit.value = row;
  history.value = [];
  await loadHistory(row);
}
</script>

<template>
  <section class="assignments">
    <header>
      <h1>Unit-Owner Assignments</h1>
      <p class="muted">Move a unit to another owner. Each change is recorded with who made it and why.</p>
    </header>

    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <p v-if="loading" class="muted">Loading units…</p>

    <template v-else>
      <table v-if="unitRows.length" class="assign-table">
        <thead>
          <tr><th>Unit</th><th>Tower</th><th>Current owner</th><th>Verification</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in unitRows" :key="u.id" class="unit-row">
            <td>{{ u.unitNumber }}</td>
            <td>{{ u.towerName }}</td>
            <td>{{ u.ownerName }}</td>
            <td class="verification">
              <span v-if="u.owner?.needsReview" class="tag tag--warn owner-review">Owner needs review</span>
              <span class="tag approval" :data-approval="u.approvalStatus">{{ approvalLabel(u.approvalStatus) }}</span>
            </td>
            <td class="actions">
              <button type="button" class="reassign-btn" @click="openReassign(u)">Reassign owner</button>
              <button type="button" class="ghost history-btn" :aria-expanded="historyUnit?.id === u.id" @click="toggleHistory(u)">History</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loadError" class="muted empty">No units yet.</p>

      <div v-if="historyUnit" class="history" aria-label="Assignment history">
        <h2>Assignment history · {{ historyUnit.unitNumber }}</h2>
        <p v-if="historyError" class="error" role="alert">{{ historyError }}</p>
        <p v-else-if="historyLoading" class="muted">Loading…</p>
        <p v-else-if="!history.length" class="muted history-empty">No assignments yet.</p>
        <table v-else class="history-table">
          <thead>
            <tr><th>When</th><th>Change</th><th>By</th><th>Reason</th></tr>
          </thead>
          <tbody>
            <tr v-for="h in history" :key="h.id" class="history-row">
              <td>{{ formatDate(h.createdAt) }}</td>
              <td>{{ h.fromOwner?.name || "—" }} → {{ h.toOwner?.name || "—" }}</td>
              <td>{{ h.actorName || "—" }}</td>
              <td>{{ h.reason || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="reassigning" class="modal-backdrop" @click.self="closeReassign">
      <div class="modal reassign-dialog" role="dialog" aria-modal="true" aria-label="Reassign owner">
        <h2>Reassign unit {{ reassigning.unitNumber }}</h2>
        <p class="muted small">Currently owned by {{ reassigning.ownerName }}. Existing logins, deals and leases are not changed.</p>
        <div class="field">
          <label>New owner</label>
          <SearchableSelect
            v-model="toOwnerId"
            :options="ownerOptions"
            placeholder="Select an owner…"
            search-placeholder="Search owners…"
          />
        </div>
        <div class="field">
          <label for="reassign-reason">Reason (optional)</label>
          <textarea id="reassign-reason" v-model="reason" rows="3" maxlength="500" placeholder="e.g. Ownership transferred"></textarea>
        </div>
        <p v-if="reassignError" class="error" role="alert">{{ reassignError }}</p>
        <div class="modal-actions">
          <button type="button" class="ghost cancel-btn" @click="closeReassign">Cancel</button>
          <button type="button" class="primary confirm-btn" :disabled="!toOwnerId || saving" @click="confirmReassign">Confirm</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.muted { color: var(--muted); }
.small { font-size: 0.82rem; }
.empty { padding: 0.5rem 0 1rem; }
.error {
  margin: 0 0 1rem; padding: 0.55rem 0.8rem; font-size: 0.85rem;
  color: var(--text); background: var(--danger-050);
  border: 1px solid var(--danger); border-radius: var(--radius-sm);
}
.verification { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.tag {
  display: inline-block; font-size: 0.66rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  color: var(--text); background: var(--paper); border: 1px solid var(--line-strong);
}
.tag--warn { background: var(--warn-050); border-color: var(--warn); }
.tag[data-approval="APPROVED"] { background: var(--good-050); border-color: var(--good); }
.tag[data-approval="REJECTED"] { background: var(--danger-050); border-color: var(--danger); }
.tag[data-approval="SUBMITTED"] { background: var(--warn-050); border-color: var(--warn); }
.actions { white-space: nowrap; }
.actions button + button { margin-left: 0.4rem; }
.history { margin-top: 1.75rem; }
.history h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
.field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.9rem; }
.field label { font-size: 0.75rem; font-weight: 600; color: var(--muted); }
.field textarea {
  font: inherit; font-size: 0.9rem; padding: 0.6rem 0.7rem; resize: vertical;
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--text);
}
.field textarea:focus { outline: none; border-color: var(--accent-text); box-shadow: var(--ring); }
</style>
