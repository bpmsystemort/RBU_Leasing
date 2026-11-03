<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { units, estates } from "../lib/resource.js";
import { formatPHP } from "../lib/formatters.js";
import { useAuthStore } from "../stores/auth.js";
import ResourceTable from "../components/ResourceTable.vue";
import MultiSelect from "../components/MultiSelect.vue";

const router = useRouter();
// Only the Super Admin can modify records; everyone else sees a read-only view.
const auth = useAuthStore();
const canWrite = computed(() => auth.role === "ADMIN");

const allUnits = ref([]); // every unit, filtered client-side
const estateList = ref([]); // [{ id, name, towers:[{id,name}] }]
const selectedEstateIds = ref([]);
const selectedTowerIds = ref([]);
// Import v2 flags a unit whose leases have all ended instead of guessing a
// new status — this toggle surfaces those rows so staff can resolve them.
const onlyFlagged = ref(false);

const columns = [
  { key: "unitNumber", label: "Unit #" },
  { key: "ownerName", label: "Owner" },
  { key: "estateName", label: "Estate" },
  { key: "towerName", label: "Tower" },
  { key: "type", label: "Type" },
  { key: "baseRent", label: "Monthly Rent", format: formatPHP },
  { key: "status", label: "Status" },
  { key: "flags", label: "Flags" },
];

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

const rows = computed(() =>
  allUnits.value
    .filter((u) => {
      const estateId = u.tower?.estate?.id ?? u.tower?.estateId ?? null;
      const towerId = u.tower?.id ?? null;
      if (selectedEstateIds.value.length && !selectedEstateIds.value.includes(estateId)) return false;
      if (selectedTowerIds.value.length && !selectedTowerIds.value.includes(towerId)) return false;
      if (onlyFlagged.value && !u.needsStatusReview) return false;
      return true;
    })
    .map((u) => ({
      ...u,
      ownerName: u.owner?.name || "—",
      estateName: u.tower?.estate?.name || "—",
      towerName: u.tower?.name || "Unassigned",
    })),
);

async function reload() {
  allUnits.value = await units.list();
}

onMounted(async () => {
  const [u, e] = await Promise.all([units.list(), estates.list()]);
  allUnits.value = u;
  estateList.value = e;
});

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

    <ResourceTable
      :columns="columns"
      :rows="rows"
      :can-write="canWrite"
      @edit="(row) => router.push(`/app/units/${row.id}`)"
      @delete="remove"
    >
      <template #cell-flags="{ row }">
        <span v-if="row.needsStatusReview" class="review-tag">Needs status review</span>
        <span v-else class="muted">—</span>
      </template>
    </ResourceTable>
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
</style>
