<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { units, leasingTransactions } from "../lib/resource.js";
// The dead-early rule (a deal that ended before Contract Signing) is the same
// list the server uses, so the console never offers to block for such a deal.
import { isDeadEarly } from "../../../shared/leasingStages.js";

// The reservation console. A deal with a prospect can hold (block) its unit so
// nobody else can take it; this page lists what is currently held and which
// deals could hold their unit now.
const ENDED = ["Signed", "Declined"];

const blockedUnits = ref([]); // units with status BLOCKED
const vacantUnits = ref([]); // units with status VACANT (to qualify deals)
const deals = ref([]); // every leasing transaction
const loading = ref(true);
const loadError = ref("");
const actionError = ref("");
const busy = reactive({}); // "release:<unitId>" / "block:<dealId>" -> true while in flight

function prospectName(t) {
  return t.lesseeName || t.tenant?.name || t.inquiry?.fullName || "—";
}

// A BLOCKED unit's holder is the deal named by blockedByTransactionId. Three
// cases: the deal is in the loaded list (show it; releasing goes through the
// deal); the pointer is set but that deal is not in the list (it belongs to
// another officer, or the list is stale: say so and offer no release, since a
// unit-level release would free someone else's reservation); no pointer at all
// (a holderless block, released at unit level).
const blockedRows = computed(() =>
  blockedUnits.value.map((u) => {
    const pointer = u.blockedByTransactionId || null;
    const holder = pointer
      ? deals.value.find((t) => t.id === pointer) || null
      : null;
    return {
      id: u.id,
      unitNumber: u.unitNumber,
      towerName: u.tower?.name || "Unassigned",
      outsideView: Boolean(pointer && !holder),
      holderId: holder ? holder.id : null,
      holderReference: holder ? holder.reference : "",
      holderName: holder ? prospectName(holder) : "",
    };
  }),
);

// A deal can block only when it has a unit and a prospect, has not ended (signed,
// declined, or dead early) and its unit is vacant right now.
const readyRows = computed(() => {
  const vacant = new Map(vacantUnits.value.map((u) => [u.id, u]));
  return deals.value
    .filter((t) => t.unitId
      && (t.inquiryId || t.tenantId)
      && !ENDED.includes(t.finalStatus)
      && !isDeadEarly(t)
      && vacant.has(t.unitId))
    .map((t) => ({
      id: t.id,
      reference: t.reference,
      prospect: prospectName(t),
      unitNumber: t.unit?.unitNumber || vacant.get(t.unitId).unitNumber,
      towerName: vacant.get(t.unitId).tower?.name || "Unassigned",
    }));
});

// Fetches all three lists and only then replaces them; throws when any request fails.
async function fetchAll() {
  const [b, v, t] = await Promise.all([
    units.list({ status: "BLOCKED" }),
    // only approved units can be reserved for a deal
    units.list({ status: "VACANT", approvalStatus: "APPROVED" }),
    leasingTransactions.list(),
  ]);
  blockedUnits.value = b;
  vacantUnits.value = v;
  deals.value = t;
  loadError.value = "";
}

// The first load: a failure leaves nothing to show, so it hides the tables.
async function load() {
  try {
    await fetchAll();
  } catch (e) {
    loadError.value = e.response?.data?.error || "Could not load unit blocking.";
  }
}

onMounted(async () => {
  await load();
  loading.value = false;
});

// Run one action, then refresh both tables whether it worked or not (a refused
// block usually means the unit was taken meanwhile). The server's own refusal
// text is shown as-is. A failed refresh never hides the tables (loadError is for
// the first load only): after a saved action it says so, after a refused one the
// refusal stays the message.
async function run(key, call) {
  if (busy[key]) return;
  actionError.value = "";
  busy[key] = true;
  try {
    let saved = true;
    try {
      await call();
    } catch (e) {
      saved = false;
      actionError.value = e.response?.data?.error || "That action could not be completed.";
    }
    try {
      await fetchAll();
    } catch {
      if (saved) actionError.value = "Saved, but the list could not be refreshed. Reload the page.";
    }
  } finally {
    busy[key] = false;
  }
}

const release = (row) => {
  if (row.outsideView) return; // not ours to release; the row offers no button either
  return run(
    `release:${row.id}`,
    () => (row.holderId ? leasingTransactions.unblockUnit(row.holderId) : units.releaseBlock(row.id)),
  );
};
const block = (row) => run(`block:${row.id}`, () => leasingTransactions.blockUnit(row.id));
</script>

<template>
  <section class="blocking">
    <header>
      <h1>Unit Blocking</h1>
      <p class="muted">Hold a unit for a prospect's deal, or release a hold, so no one else can take it meanwhile.</p>
    </header>

    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <p v-if="actionError" class="error action-error" role="alert">{{ actionError }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-else-if="!loadError">
      <h2>Blocked units</h2>
      <table v-if="blockedRows.length" class="blocked-table">
        <thead>
          <tr><th>Unit</th><th>Tower</th><th>Held by</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in blockedRows" :key="r.id" class="blocked-row">
            <td>{{ r.unitNumber }}</td>
            <td>{{ r.towerName }}</td>
            <td class="holder">
              <template v-if="r.holderId">
                <code class="ref">{{ r.holderReference }}</code> {{ r.holderName }}
              </template>
              <span v-else-if="r.outsideView" class="muted outside-view">Held by a deal outside your view</span>
              <span v-else class="muted">No holder</span>
            </td>
            <td class="actions">
              <button v-if="!r.outsideView" type="button" class="release-btn" :disabled="busy[`release:${r.id}`]" @click="release(r)">Release</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">No units are blocked.</p>

      <h2>Deals ready to block</h2>
      <table v-if="readyRows.length" class="ready-table">
        <thead>
          <tr><th>Reference</th><th>Prospect</th><th>Unit</th><th>Tower</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in readyRows" :key="r.id" class="ready-row">
            <td><code class="ref">{{ r.reference }}</code></td>
            <td>{{ r.prospect }}</td>
            <td>{{ r.unitNumber }}</td>
            <td>{{ r.towerName }}</td>
            <td class="actions">
              <button type="button" class="primary block-btn" :disabled="busy[`block:${r.id}`]" @click="block(r)">Block</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">No deals are ready to block.</p>
    </template>
  </section>
</template>

<style scoped>
.blocking h2 { margin: 1.75rem 0 0.75rem; font-size: 1.05rem; }
.muted { color: var(--muted); }
.empty { padding: 0.5rem 0 1rem; }
.error {
  margin: 0 0 1rem; padding: 0.55rem 0.8rem; font-size: 0.85rem;
  color: var(--text); background: var(--danger-050);
  border: 1px solid var(--danger); border-radius: var(--radius-sm);
}
.ref {
  font-family: ui-monospace, "Consolas", monospace; font-size: 0.8rem;
  background: var(--accent-050); color: var(--accent-text);
  padding: 0.1rem 0.4rem; border-radius: var(--radius-sm);
}
.holder { min-width: 14rem; }
.actions { text-align: right; white-space: nowrap; }
</style>
