<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { units, owners, estates, towers } from "../lib/resource.js";
import { useAuthStore } from "../stores/auth.js";

const route = useRoute();
const router = useRouter();
// Moving a unit to another owner is a recorded reassignment (admins only), not an edit.
const auth = useAuthStore();
const canReassign = computed(() => auth.role === "ADMIN");
const id = route.params.id;
const isEdit = !!id;
const error = ref("");
const submitting = ref(false);

const ownerOptions = ref([]);
const estateOptions = ref([]);
const towerOptions = ref([]);

const form = reactive({
  ownerId: "",
  estateId: "",
  towerId: "",
  unitNumber: "",
  floor: "",
  slotNo: "",
  type: "",
});

async function loadTowers(estateId) {
  towerOptions.value = estateId
    ? (await towers.list({ estateId })).map((t) => ({ value: t.id, label: t.name }))
    : [];
}

async function onEstateChange() {
  form.towerId = ""; // reset tower when the estate changes
  await loadTowers(form.estateId);
}

onMounted(async () => {
  const [os, es] = await Promise.all([owners.list(), estates.list()]);
  ownerOptions.value = os.map((o) => ({ value: o.id, label: o.name }));
  estateOptions.value = es.map((e) => ({ value: e.id, label: e.name }));
  if (isEdit) {
    const u = await units.get(id);
    form.ownerId = u.ownerId || "";
    form.estateId = u.tower?.estateId || "";
    form.towerId = u.towerId || "";
    form.unitNumber = u.unitNumber || "";
    form.floor = u.floor || "";
    form.slotNo = u.slotNo || "";
    form.type = u.type || "";
    if (form.estateId) await loadTowers(form.estateId);
  }
});

async function submit() {
  error.value = "";
  submitting.value = true;
  const payload = {};
  for (const [k, v] of Object.entries(form)) {
    if (k === "estateId") continue; // derived via tower; not a Unit field
    if (v !== "" && v !== null && v !== undefined) payload[k] = v;
  }
  try {
    if (isEdit) await units.update(id, payload);
    else await units.create(payload);
    router.push("/app/units");
  } catch (e) {
    error.value = e.response?.data?.error || "Save failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section>
    <h1>{{ isEdit ? "Edit" : "New" }} unit</h1>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="ownerId">Owner</label>
        <!-- Locked when editing; the unchanged ownerId is still sent (the server drops an unchanged owner). -->
        <select id="ownerId" v-model="form.ownerId" :disabled="isEdit">
          <option value="">— select —</option>
          <option v-for="o in ownerOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <p v-if="isEdit" class="owner-note">
          To change the owner use
          <RouterLink v-if="canReassign" :to="`/app/unit-assignments?unit=${id}`">Unit-Owner Assignments</RouterLink>
          <template v-else>Unit-Owner Assignments</template>
        </p>
      </div>

      <div class="field">
        <label for="estateId">Estate</label>
        <select id="estateId" v-model="form.estateId" @change="onEstateChange">
          <option value="">— select —</option>
          <option v-for="e in estateOptions" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
      </div>

      <div class="field">
        <label for="towerId">Tower</label>
        <select id="towerId" v-model="form.towerId" :disabled="!form.estateId">
          <option value="">{{ form.estateId ? "— select —" : "select an estate first" }}</option>
          <option v-for="t in towerOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>

      <div class="field">
        <label for="unitNumber">Unit number</label>
        <input id="unitNumber" type="text" v-model="form.unitNumber" />
      </div>
      <div class="field">
        <label for="floor">Level</label>
        <input id="floor" type="text" v-model="form.floor" />
      </div>
      <div class="field">
        <label for="slotNo">Slot no.</label>
        <input id="slotNo" type="text" v-model="form.slotNo" />
      </div>
      <div class="field">
        <label for="type">Unit type</label>
        <input id="type" type="text" v-model="form.type" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="form-actions">
        <button type="submit" :disabled="submitting">Save</button>
        <button type="button" class="cancel" @click="router.push('/app/units')">Cancel</button>
        <button v-if="isEdit" type="button" class="secondary" @click="router.push('/app/units/' + id + '/listing')">Manage listing &amp; photos</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.owner-note { margin: 0.3rem 0 0; font-size: 0.8rem; color: var(--muted); }
</style>
