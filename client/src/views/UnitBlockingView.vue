<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { units, leasingTransactions } from "../lib/resource.js";

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

// A BLOCKED unit's holder is the deal named by blockedByTransactionId. When that
// deal is gone (deleted, so the pointer was cleared) the unit has no holder and
// is released at unit level instead.
const blockedRows = computed(() =>
  blockedUnits.value.map((u) => {
    const holder = u.blockedByTransactionId
      ? deals.value.find((t) => t.id === u.blockedByTransactionId) || null
      : null;
    return {
      id: u.id,
      unitNumber: u.unitNumber,
      towerName: u.tower?.name || "Unassigned",
      holderId: holder ? holder.id : null,
      holderReference: holder ? holder.reference : "",
      holderName: holder ? prospectName(holder) : "",
    };
  }),
);

// A deal can block only when it has a unit and a prospect, has not ended and its
// unit is vacant right now.
const readyRows = computed(() => {
  const vacant = new Map(vacantUnits.value.map((u) => [u.id, u]));
  return deals.value
    .filter((t) => t.unitId
      && (t.inquiryId || t.tenantId)
      && !ENDED.includes(t.finalStatus)
      && vacant.has(t.unitId))
    .map((t) => ({
      id: t.id,
      reference: t.reference,
      prospect: prospectName(t),
      unitNumber: t.unit?.unitNumber || vacant.get(t.unitId).unitNumber,
      towerName: vacant.get(t.unitId).tower?.name || "Unassigned",
    }));
});

async function load() {
  try {
    const [b, v, t] = await Promise.all([
      units.list({ status: "BLOCKED" }),
      units.list({ status: "VACANT" }),
      leasingTransactions.list(),
    ]);
    blockedUnits.value = b;
    vacantUnits.value = v;
    deals.value = t;
    loadError.value = "";
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
// text is shown as-is.
async function run(key, call) {
  if (busy[key]) return;
  actionError.value = "";
  busy[key] = true;
  try {
    await call();
  } catch (e) {
    actionError.value = e.response?.data?.error || "That action could not be completed.";
  }
  await load();
  busy[key] = false;
}

const release = (row) => run(
  `release:${row.id}`,
  () => (row.holderId ? leasingTransactions.unblockUnit(row.holderId) : units.releaseBlock(row.id)),
);
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

    <template v-else>
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
              <span v-else class="muted">No holder</span>
            </td>
            <td class="actions">
              <button type="button" class="release-btn" :disabled="busy[`release:${r.id}`]" @click="release(r)">Release</button>
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
