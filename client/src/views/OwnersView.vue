<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { owners, assignOwner, listUsers, ownerInvites } from "../lib/resource.js";
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

// Invite-to-portal dialog — officers and admins send an owner the accept-invite
// link. Whether the owner already has an account isn't known client-side, so
// the action always shows; a 409 from the server surfaces as the dialog error.
const inviteOwner = ref(null); // the row being invited, or null when the dialog is closed
const inviteEmail = ref("");
const inviteError = ref("");
const inviteResult = ref(null); // { acceptUrl, delivered, email, ownerName } once sent
const inviteSubmitting = ref(false);
const inviteCopied = ref(false);

function openInvite(row) {
  inviteOwner.value = row;
  inviteEmail.value = row.email || "";
  inviteError.value = "";
  inviteResult.value = null;
  inviteCopied.value = false;
}
function closeInvite() {
  if (inviteSubmitting.value) return;
  inviteOwner.value = null;
}
async function sendInvite() {
  inviteError.value = "";
  inviteSubmitting.value = true;
  try {
    inviteResult.value = await ownerInvites.create(inviteOwner.value.id, inviteEmail.value);
  } catch (e) {
    inviteError.value = e.response?.data?.error || "Could not send the invitation.";
  } finally {
    inviteSubmitting.value = false;
  }
}
async function copyInviteUrl() {
  try {
    await navigator.clipboard.writeText(inviteResult.value.acceptUrl);
    inviteCopied.value = true;
  } catch { /* clipboard unavailable — the field below is still selectable */ }
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
          <th>Name</th><th>Email</th><th>Phone</th><th>Leasing Officer</th><th>Review</th><th v-if="auth.canWrite">Actions</th>
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
          <td v-if="auth.canWrite">
            <template v-if="isAdmin">
              <button type="button" class="edit" @click="router.push(`/app/owners/${r.id}`)">Edit</button>
              <button type="button" class="delete" @click="remove(r)">Delete</button>
            </template>
            <button type="button" class="invite" @click="openInvite(r)">Invite to portal</button>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="auth.canWrite ? 6 : 5" class="muted">No owners.</td>
        </tr>
      </tbody>
    </table>

    <div v-if="inviteOwner" class="modal-backdrop" @click.self="closeInvite">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Invite to portal">
        <h2>Invite {{ inviteOwner.name }} to the portal</h2>

        <form v-if="!inviteResult" @submit.prevent="sendInvite">
          <div class="field">
            <label for="invite-email">Email</label>
            <input id="invite-email" type="email" v-model="inviteEmail" />
          </div>
          <p v-if="inviteError" class="error">{{ inviteError }}</p>
          <div class="modal-actions">
            <button type="button" class="ghost" @click="closeInvite" :disabled="inviteSubmitting">Cancel</button>
            <button type="submit" :disabled="inviteSubmitting">{{ inviteSubmitting ? "Sending…" : "Send invite" }}</button>
          </div>
        </form>

        <div v-else class="invite-done">
          <p class="invite-done__msg">
            <template v-if="inviteResult.delivered">Invitation emailed to {{ inviteResult.email }}.</template>
            <template v-else>Invitation created. Email delivery isn't configured — share the link below directly.</template>
          </p>
          <div class="field">
            <label for="invite-url">Accept link</label>
            <div class="copy-row">
              <input id="invite-url" type="text" readonly :value="inviteResult.acceptUrl" @click="$event.target.select()" />
              <button type="button" class="ghost" @click="copyInviteUrl">{{ inviteCopied ? "Copied" : "Copy" }}</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="primary" @click="closeInvite">Done</button>
          </div>
        </div>
      </div>
    </div>
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
.invite-done__msg { color: var(--text); font-size: 0.9rem; line-height: 1.5; margin: 0 0 1rem; }
.copy-row { display: flex; gap: 0.5rem; }
.copy-row input { font-family: ui-monospace, "Cascadia Code", "Consolas", monospace; font-size: 0.82rem; }
.copy-row button { flex-shrink: 0; margin: 0; }
</style>
