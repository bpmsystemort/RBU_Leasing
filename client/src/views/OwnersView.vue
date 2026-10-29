<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { owners, assignOwner, listUsers } from "../lib/resource.js";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const router = useRouter();
const isAdmin = computed(() => auth.role === "ADMIN");
const isOfficer = computed(() => auth.role === "LEASING_OFFICER");

const allOwners = ref([]);
const officers = ref([]);
const error = ref("");
// Import v2 flags an owner whose name came in joint/blank/ambiguous — this
// toggle surfaces those rows so staff can verify who the owner actually is.
const onlyFlagged = ref(false);
const rows = computed(() => allOwners.value.filter((o) => !onlyFlagged.value || o.needsReview));

async function load() {
  error.value = "";
  try { allOwners.value = await owners.list(); }
  catch (e) { error.value = e.response?.data?.error || "Could not load owners"; }
}
onMounted(async () => {
  await load();
  if (isAdmin.value) {
    try { officers.value = (await listUsers()).filter((u) => u.role === "LEASING_OFFICER"); }
    catch { /* ignore — assignment options just stay empty */ }
  }
});

async function assign(row, value) {
  try {
    const updated = await assignOwner(row.id, value || null);
    row.assignedOfficerId = updated.assignedOfficerId;
    row.assignedOfficer = updated.assignedOfficer;
  } catch (e) { error.value = e.response?.data?.error || "Could not assign owner"; }
}

function remove(row) {
  if (!confirm(`Delete owner "${row.name}"?`)) return;
  owners.remove(row.id).then(load).catch((e) => alert(e.response?.data?.error || "Delete failed"));
}
</script>

<template>
  <section>
    <header>
      <h1>Owners</h1>
      <button v-if="isAdmin" type="button" @click="router.push('/app/owners/new')">New owner</button>
    </header>
    <p v-if="isOfficer" class="hint">Owners assigned to you. You can view their units, tenants and leases.</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="filters">
      <label class="flag-filter">
        <input type="checkbox" v-model="onlyFlagged" />
        Needs review only
      </label>
      <span class="count">{{ rows.length }} owner{{ rows.length === 1 ? "" : "s" }}</span>
    </div>

    <table>
      <thead>
        <tr>
          <th>Name</th><th>Email</th><th>Phone</th><th>Leasing Officer</th><th>Review</th><th v-if="isAdmin">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td><button type="button" class="name-link" @click="router.push(`/app/lessor-profile/${r.id}`)">{{ r.name }}</button></td>
          <td>{{ r.email || "—" }}</td>
          <td>{{ r.phone || "—" }}</td>
          <td class="officer-cell">
            <select v-if="isAdmin" :value="r.assignedOfficerId || ''" @change="(e) => assign(r, e.target.value)">
              <option value="">— Unassigned —</option>
              <option v-for="o in officers" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
            <span v-else :class="{ muted: !r.assignedOfficer }">{{ r.assignedOfficer?.name || "Unassigned" }}</span>
          </td>
          <td>
            <span v-if="r.needsReview" class="review-tag">Needs review</span>
            <span v-else class="muted">—</span>
          </td>
          <td v-if="isAdmin">
            <button type="button" class="edit" @click="router.push(`/app/owners/${r.id}`)">Edit</button>
            <button type="button" class="delete" @click="remove(r)">Delete</button>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="isAdmin ? 6 : 5" class="muted">No owners.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.hint { color: var(--muted); font-size: 0.9rem; margin-bottom: 0.6rem; }
.error { color: var(--danger); }
.muted { color: var(--muted); }
.officer-cell { min-width: 200px; }
.officer-cell select { padding: 0.35rem 0.5rem; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.name-link { background: none; border: none; color: var(--accent-text); cursor: pointer; font: inherit; padding: 0; text-align: left; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin: 0 0 0.9rem; }
.flag-filter { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text); cursor: pointer; }
.count {
  margin-left: auto; font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 999px; padding: 0.18rem 0.6rem;
}
.review-tag {
  display: inline-block; font-size: 0.66rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 0.15rem 0.45rem; border-radius: 999px;
  background: var(--paper); border: 1px solid var(--warn); color: var(--warn);
  white-space: nowrap;
}
</style>
