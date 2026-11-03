<script setup>
import { reactive, ref, computed, onMounted } from "vue";
import { createUser, listUsers, updateUser, deleteUser, accounts as accountActions } from "../lib/resource.js";
import { formatDate, ROLE_OPTIONS, roleLabel } from "../lib/formatters.js";

const SUPER_ADMIN_EMAIL = "admin@rbu.local";

const accounts = ref([]);
const loading = ref(false);
const listError = ref("");


const showForm = ref(false);
const editingId = ref(null);
const error = ref("");
const submitting = ref(false);
const form = reactive({ name: "", email: "", password: "", role: "LEASING_OFFICER" });

const isEditing = computed(() => editingId.value !== null);
const editingSuperAdmin = computed(() => isEditing.value && form.email === SUPER_ADMIN_EMAIL);

async function load() {
  loading.value = true;
  listError.value = "";
  try {
    accounts.value = await listUsers();
  } catch (e) {
    listError.value = e.response?.data?.error || "Could not load accounts";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openCreate() {
  editingId.value = null;
  error.value = "";
  form.name = ""; form.email = ""; form.password = ""; form.role = "LEASING_OFFICER";
  showForm.value = true;
}
function openEdit(u) {
  editingId.value = u.id;
  error.value = "";
  form.name = u.name; form.email = u.email; form.password = ""; form.role = u.role;
  showForm.value = true;
}
function closeForm() {
  if (!submitting.value) showForm.value = false;
}

async function submit() {
  error.value = "";
  submitting.value = true;
  try {
    if (isEditing.value) {
      const payload = { name: form.name, email: form.email, role: form.role };
      if (form.password) payload.password = form.password;
      await updateUser(editingId.value, payload);
    } else {
      await createUser({ name: form.name, email: form.email, password: form.password, role: form.role });
    }
    showForm.value = false;
    await load();
  } catch (e) {
    // A rejected field says why ("at least 6 characters"); the envelope alone
    // only says "Validation failed".
    const data = e.response?.data;
    error.value = data?.details?.[0]?.message || data?.error || "Save failed";
  } finally {
    submitting.value = false;
  }
}

async function remove(u) {
  if (!window.confirm(`Delete the login "${u.email}"? This cannot be undone.`)) return;
  try {
    await deleteUser(u.id);
    await load();
  } catch (e) {
    listError.value = e.response?.data?.error || "Delete failed";
  }
}

// Suspend/restore are reversible — unlike Delete, they don't need a confirm
// prompt — and the list is reloaded so the badge and button swap right away.
async function suspend(u) {
  try {
    await accountActions.suspend(u.id);
    await load();
  } catch (e) {
    listError.value = e.response?.data?.error || "Could not suspend this account.";
  }
}
async function restore(u) {
  try {
    await accountActions.restore(u.id);
    await load();
  } catch (e) {
    listError.value = e.response?.data?.error || "Could not restore this account.";
  }
}
</script>

<template>
  <section>
    <div class="head">
      <div>
        <h1>Users</h1>
        <p class="muted">Login credentials with access to the system.</p>
      </div>
      <button type="button" class="primary" @click="openCreate">New account</button>
    </div>

    <p v-if="listError" class="error">{{ listError }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <div v-else class="panel panel--table">
    <table class="grid">
      <thead>
        <tr><th>Display name</th><th>Username</th><th>Role</th><th>Created</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="u in accounts" :key="u.id">
          <td>{{ u.name }}</td>
          <td>
            {{ u.email }}
            <span v-if="u.email === SUPER_ADMIN_EMAIL" class="super-tag">Super admin</span>
            <span v-else-if="u.status === 'SUSPENDED'" class="suspended-tag">Suspended</span>
          </td>
          <td><span class="role-tag">{{ roleLabel(u.role) }}</span></td>
          <td>{{ formatDate(u.createdAt) }}</td>
          <td class="row-actions">
            <button type="button" class="link" @click="openEdit(u)">Edit</button>
            <button
              v-if="u.status === 'SUSPENDED'"
              type="button"
              class="link"
              @click="restore(u)"
            >Restore</button>
            <button
              v-else
              type="button"
              class="link warn"
              :disabled="u.email === SUPER_ADMIN_EMAIL"
              @click="suspend(u)"
            >Suspend</button>
            <button
              type="button"
              class="link danger"
              :disabled="u.email === SUPER_ADMIN_EMAIL"
              @click="remove(u)"
            >Delete</button>
          </td>
        </tr>
        <tr v-if="!accounts.length"><td colspan="6" class="muted">No accounts yet.</td></tr>
      </tbody>
    </table>
    </div>

    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="isEditing ? 'Edit account' : 'New account'">
        <h2>{{ isEditing ? "Edit account" : "New account" }}</h2>
        <form @submit.prevent="submit">
          <div class="field"><label for="name">Display name</label><input id="name" type="text" v-model="form.name" /></div>
          <div class="field"><label for="email">Username</label><input id="email" type="text" v-model="form.email" autocomplete="off" /></div>
          <div class="field">
            <label for="password">{{ isEditing ? "New password" : "Password" }} <span v-if="isEditing" class="muted">(leave blank to keep the current one)</span></label>
            <input id="password" type="text" v-model="form.password" autocomplete="off" />
            <small class="muted">Once saved it cannot be viewed again — give it to the person now.</small>
          </div>
          <div class="field">
            <label for="role">Role</label>
            <select id="role" v-model="form.role" :disabled="editingSuperAdmin">
              <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
            <small v-if="editingSuperAdmin" class="muted">The super admin must remain an ADMIN.</small>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <div class="modal-actions">
            <button type="button" class="ghost" @click="closeForm" :disabled="submitting">Cancel</button>
            <button type="submit" class="primary" :disabled="submitting">{{ isEditing ? "Save" : "Create account" }}</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.muted { color: var(--muted); }
.role-tag {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.15rem 0.45rem; border-radius: var(--radius-sm);
  background: var(--accent-050); color: var(--accent-text);
}
.super-tag {
  margin-left: 0.4rem; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.12rem 0.4rem; border-radius: var(--radius-sm);
  background: var(--warn-050); color: var(--warn);
}
.suspended-tag {
  margin-left: 0.4rem; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.12rem 0.4rem; border-radius: var(--radius-sm);
  background: var(--danger-050); color: var(--danger);
}
.row-actions { display: flex; gap: 0.75rem; }
.link {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--accent-text); font: inherit; font-weight: 500;
}
.link:hover { text-decoration: underline; }
.link.danger { color: var(--danger); }
.link.warn { color: var(--warn); }
.link:disabled { color: var(--muted); cursor: not-allowed; text-decoration: none; }
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 1.5rem; z-index: 50;
}
.modal {
  background: var(--surface, #fff); border-radius: var(--radius); padding: 1.5rem;
  width: 100%; max-width: 26rem; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}
.modal h2 { margin: 0 0 1rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 0.5rem; }
</style>
