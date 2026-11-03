<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useRouter, RouterLink } from "vue-router";
import { units, estates } from "../lib/resource.js";
import { formatPHP } from "../lib/formatters.js";
import { useAuthStore } from "../stores/auth.js";
import ResourceTable from "../components/ResourceTable.vue";
import MultiSelect from "../components/MultiSelect.vue";
import UnitStatusBadge from "../components/UnitStatusBadge.vue";

const router = useRouter();
// Only the Super Admin can edit or delete records; everyone else sees a read-only view.
const auth = useAuthStore();
const canWrite = computed(() => auth.role === "ADMIN");
// Availability actions (set unavailable / restore / release a block) are open to
// every write role (ADMIN and LEASING_OFFICER); reassigning an owner is ADMIN-only.
const canManageAvailability = computed(() => auth.canWrite);

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "VACANT", label: "Vacant" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "OCCUPIED", label: "Occupied" },
  { value: "UNAVAILABLE", label: "Unavailable" },
];
const APPROVAL_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const allUnits = ref([]); // every unit, filtered client-side
const estateList = ref([]); // [{ id, name, towers:[{id,name}] }]
const selectedEstateIds = ref([]);
const selectedTowerIds = ref([]);
// Import v2 flags a unit whose leases have all ended instead of guessing a
// new status — this toggle surfaces those rows so staff can resolve them.
const onlyFlagged = ref(false);
const search = ref("");
const statusFilter = ref("ALL");
const approvalFilter = ref("ALL");
const sortKey = ref("");
const sortDir = ref("asc");
const page = ref(1);
const loading = ref(true);
const loadError = ref("");
const actionError = ref("");
const busyId = ref(null);

// The Availability column only exists for roles that can act on it, so a
// read-only viewer never sees an empty actions column.
const columns = computed(() => [
  { key: "unitNumber", label: "Unit #", sortable: true },
  { key: "ownerName", label: "Owner", sortable: true },
  { key: "estateName", label: "Estate" },
  { key: "towerName", label: "Tower", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "baseRent", label: "Monthly Rent", format: formatPHP, sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "approvalStatus", label: "Approval" },
  { key: "flags", label: "Flags" },
  ...(canManageAvailability.value ? [{ key: "availability", label: "Availability" }] : []),
]);

const estateOptions = computed(() => estateList.value.map((e) => ({ value: e.id, label: e.name })));

// Tower options reflect the chosen estates (all towers when no estate is selected).
const towerOptions = computed(() => {
  const shown = selectedEstateIds.value.length
    ? estateList.value.filter((e) => selectedEstateIds.value.includes(e.id))
    : estateList.value;
  return shown.flatMap((e) => e.towers.map((t) => ({ value: t.id, label: `${t.name} · ${e.name}` })));
});

// Drop any selected towers that no longer belong to the chosen estates.
watch(selectedEstateIds, () => {
  const valid = new Set(towerOptions.value.map((o) => o.value));
  selectedTowerIds.value = selectedTowerIds.value.filter((id) => valid.has(id));
});

// Case-insensitive match on unit number, owner name and tower name.
function matchesSearch(u, q) {
  if (!q) return true;
  return [u.unitNumber, u.owner?.name, u.tower?.name].some((v) =>
    String(v ?? "").toLowerCase().includes(q),
  );
}

function compareRows(a, b) {
  const key = sortKey.value;
  let result;
  if (key === "baseRent") {
    result = (Number(a.baseRent) || 0) - (Number(b.baseRent) || 0);
  } else {
    result = String(a[key] ?? "").localeCompare(String(b[key] ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return sortDir.value === "desc" ? -result : result;
}

// Every unit that passes the filters, sorted, across all pages.
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  const mapped = allUnits.value
    .filter((u) => {
      const estateId = u.tower?.estate?.id ?? u.tower?.estateId ?? null;
      const towerId = u.tower?.id ?? null;
      if (selectedEstateIds.value.length && !selectedEstateIds.value.includes(estateId)) return false;
      if (selectedTowerIds.value.length && !selectedTowerIds.value.includes(towerId)) return false;
      if (onlyFlagged.value && !u.needsStatusReview) return false;
      if (statusFilter.value !== "ALL" && u.status !== statusFilter.value) return false;
      if (approvalFilter.value !== "ALL" && u.approvalStatus !== approvalFilter.value) return false;
      return matchesSearch(u, q);
    })
    .map((u) => ({
      ...u,
      ownerName: u.owner?.name || "—",
      estateName: u.tower?.estate?.name || "—",
      towerName: u.tower?.name || "Unassigned",
    }));
  // Array.prototype.sort is stable, so equal keys keep the server's order.
  return sortKey.value ? mapped.sort(compareRows) : mapped;
});

const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
const pagedRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// Any change to what is being shown starts again from the first page.
watch([search, statusFilter, approvalFilter, onlyFlagged, selectedEstateIds, selectedTowerIds], () => {
  page.value = 1;
});
// A reload (or a deleted unit) can leave the current page past the end.
watch(pageCount, (n) => {
  if (page.value > n) page.value = n;
});

function setSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = "asc";
  }
  page.value = 1;
}

async function reload() {
  allUnits.value = await units.list();
}

onMounted(async () => {
  loading.value = true;
  loadError.value = "";
  try {
    const [u, e] = await Promise.all([units.list(), estates.list()]);
    allUnits.value = u;
    estateList.value = e;
  } catch (e) {
    loadError.value = e.response?.data?.error || "Could not load units.";
  } finally {
    loading.value = false;
  }
});

// Run one availability action for a unit, then refresh the list. The server's
// own refusal text (e.g. "unit has an active deal") is shown as-is.
async function runAction(row, call) {
  actionError.value = "";
  busyId.value = row.id;
  try {
    await call();
    await reload();
  } catch (e) {
    actionError.value = e.response?.data?.error || "That action could not be completed.";
  } finally {
    busyId.value = null;
  }
}
const setUnavailable = (row) => runAction(row, () => units.setUnavailable(row.id));
const restore = (row) => runAction(row, () => units.restore(row.id));
const releaseBlock = (row) => runAction(row, () => units.releaseBlock(row.id));
const markReviewed = (row) => runAction(row, () => units.markReviewed(row.id));

function approvalLabel(value) {
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : "—";
}

function remove(row) {
  if (!confirm(`Delete unit "${row.unitNumber}"?`)) return;
  units.remove(row.id).then(reload).catch((e) => alert(e.response?.data?.error || "Delete failed"));
}
</script>

<template>
  <section class="units">
    <header>
      <h1>Units</h1>
      <button v-if="canWrite" type="button" @click="router.push('/app/units/new')">New unit</button>
    </header>

    <div class="filters">
      <MultiSelect label="Estate" :options="estateOptions" v-model="selectedEstateIds" />
      <MultiSelect label="Tower" :options="towerOptions" v-model="selectedTowerIds" />
      <label class="flag-filter">
        <input type="checkbox" v-model="onlyFlagged" />
        Needs status review only
      </label>
      <span class="count">{{ rows.length }} unit{{ rows.length === 1 ? "" : "s" }}</span>
    </div>

    <div class="filters filters--find">
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search unit, owner or tower"
        aria-label="Search units"
      />
      <label class="select-filter">
        <span>Status</span>
        <select v-model="statusFilter" class="status-filter" aria-label="Filter by status">
          <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label class="select-filter">
        <span>Approval</span>
        <select v-model="approvalFilter" class="approval-filter" aria-label="Filter by approval">
          <option v-for="o in APPROVAL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
    </div>

    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <p v-if="actionError" class="error action-error" role="alert">{{ actionError }}</p>
    <p v-if="loading" class="loading">Loading units…</p>

    <template v-else-if="!loadError">
      <ResourceTable
        :columns="columns"
        :rows="pagedRows"
        :can-write="canWrite"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        @sort="setSort"
        @edit="(row) => router.push(`/app/units/${row.id}`)"
        @delete="remove"
      >
        <template #cell-status="{ row }">
          <UnitStatusBadge :status="row.status" />
        </template>
        <template #cell-approvalStatus="{ row }">{{ approvalLabel(row.approvalStatus) }}</template>
        <template #cell-flags="{ row }">
          <span v-if="row.needsStatusReview" class="review-tag">Needs status review</span>
          <span v-else class="muted">—</span>
        </template>
        <template #cell-availability="{ row }">
          <div class="avail">
            <button
              v-if="row.status === 'VACANT'"
              type="button"
              class="avail-set"
              :disabled="busyId === row.id"
              @click="setUnavailable(row)"
            >Set unavailable</button>
            <button
              v-if="row.status === 'UNAVAILABLE'"
              type="button"
              class="avail-restore"
              :disabled="busyId === row.id"
              @click="restore(row)"
            >Restore</button>
            <!-- A block with a holder deal is released from the Blocking page by
                 whoever holds it; only a holderless block is released here. -->
            <button
              v-if="row.status === 'BLOCKED' && !row.blockedByTransactionId"
              type="button"
              class="avail-release"
              :disabled="busyId === row.id"
              @click="releaseBlock(row)"
            >Release block</button>
            <span v-else-if="row.status === 'BLOCKED'" class="avail-held muted">Held by a deal</span>
            <button
              v-if="row.needsStatusReview"
              type="button"
              class="avail-reviewed"
              :disabled="busyId === row.id"
              @click="markReviewed(row)"
            >Mark reviewed</button>
            <RouterLink v-if="canWrite" class="avail-reassign" :to="`/app/unit-assignments?unit=${row.id}`">Reassign owner</RouterLink>
          </div>
        </template>
      </ResourceTable>

      <nav class="pager" aria-label="Pagination">
        <button type="button" class="secondary pager__prev" :disabled="page <= 1" @click="page--">Previous</button>
        <span class="pager__info">Page {{ page }} of {{ pageCount }}</span>
        <button type="button" class="secondary pager__next" :disabled="page >= pageCount" @click="page++">Next</button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.units header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.filters {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem;
  margin: 1rem 0 1.25rem;
}
.count {
  margin-left: auto; font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 999px; padding: 0.18rem 0.6rem;
}
.flag-filter { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text); cursor: pointer; }
.review-tag {
  display: inline-block; font-size: 0.66rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 0.15rem 0.45rem; border-radius: 999px;
  background: var(--paper); border: 1px solid var(--warn); color: var(--warn);
  white-space: nowrap;
}
.muted { color: var(--muted); }
.filters--find { margin-top: 0; }
.search, .select-filter select {
  background: var(--surface); color: var(--text);
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  padding: 0.45rem 0.75rem; font: inherit; font-size: 0.85rem;
}
.search { min-width: 15rem; }
.select-filter { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--muted); }
.error {
  margin: 0 0 1rem; padding: 0.55rem 0.8rem; font-size: 0.85rem;
  color: var(--text); background: var(--danger-050);
  border: 1px solid var(--danger); border-radius: var(--radius-sm);
}
.loading { color: var(--muted); font-size: 0.9rem; }
.avail { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.avail-reassign { font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
.avail-held { font-size: 0.78rem; white-space: nowrap; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }
.pager__info { font-size: 0.85rem; color: var(--muted); }
</style>
