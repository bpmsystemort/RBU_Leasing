<script setup>
import { ref, reactive, onMounted } from "vue";
import { pendingAccounts, owners } from "../lib/resource.js";
import { useActionCenter } from "../stores/actionCenter.js";
import { useAuthStore } from "../stores/auth.js";
import { formatDate, roleLabel } from "../lib/formatters.js";

// Keeps the top-bar bell and sidebar badge in step the moment a decision is
// made, rather than leaving a stale count until the next poll.
const actions = useActionCenter();
const auth = useAuthStore();

const rows = ref([]);
const loading = ref(false);
const listError = ref("");
const busy = reactive({}); // id -> true while a decision is in flight

// Owners already in the system (e.g. imported from the legacy portfolio),
// offered as a link target so approving a self-registered lessor doesn't
// have to mint a duplicate owner record.
const allOwners = ref([]);
// row.id -> the existing owner chosen for that row ("" = none, so approving
// keeps the original behavior of creating a brand-new owner).
const ownerPick = reactive({});
// row.id -> that row's free-text filter over allOwners, kept separate from
// the chosen id so a half-typed search never clobbers a prior selection.
const ownerSearch = reactive({});

function filteredOwners(rowId) {
  const q = (ownerSearch[rowId] || "").trim().toLowerCase();
  if (!q) return allOwners.value;
  return allOwners.value.filter((o) => o.name.toLowerCase().includes(q));
}

// Rejecting needs a reason, so it opens a small prompt rather than firing
// straight away — an approval is reversible by other means, a rejection is not.
const rejecting = ref(null);
const reason = ref("");
const rejectError = ref("");

// For Revision sends the application back to the applicant with remarks so
// they can correct and resubmit it. Remarks are required — without them the
// applicant is left guessing at what to fix.
const revising = ref(null);
const remarks = ref("");
const reviseError = ref("");

async function load() {
  loading.value = true;
  listError.value = "";
  try {
    rows.value = await pendingAccounts.list();
    actions.accountApprovals = rows.value.length;
    for (const r of rows.value) {
      // Only set once per row: a later reload (after someone else's decision)
      // must not clobber an officer's in-progress pick on a row still pending.
      if (r.role === "UNIT_OWNER" && ownerPick[r.id] === undefined) {
        ownerPick[r.id] = r.suggestedOwner?.id ?? "";
        ownerSearch[r.id] = "";
      }
    }
  } catch (e) {
    listError.value = e.response?.data?.error || "Could not load pending accounts.";
  } finally {
    loading.value = false;
  }
}
async function loadOwners() {
  try { allOwners.value = await owners.list(); } catch { /* the picker just stays empty */ }
}
onMounted(() => { load(); loadOwners(); });

async function approve(row) {
  if (busy[row.id]) return;
  busy[row.id] = true;
  try {
    // An unset picker ("") keeps the original behavior of approve() creating
    // a brand-new owner — calling with just the id, exactly as before.
    const ownerId = row.role === "UNIT_OWNER" ? ownerPick[row.id] : "";
    if (ownerId) await pendingAccounts.approve(row.id, ownerId);
    else await pendingAccounts.approve(row.id);
    await load();
  } catch (e) {
    listError.value = e.response?.data?.error || "Could not approve this account.";
  } finally {
    busy[row.id] = false;
  }
}

function openReject(row) {
  rejecting.value = row;
  reason.value = "";
  rejectError.value = "";
}

async function confirmReject() {
  if (!reason.value.trim()) { rejectError.value = "A reason is required."; return; }
  const row = rejecting.value;
  busy[row.id] = true;
  try {
    await pendingAccounts.reject(row.id, reason.value.trim());
    rejecting.value = null;
    await load();
  } catch (e) {
    rejectError.value = e.response?.data?.error || "Could not reject this account.";
  } finally {
    busy[row.id] = false;
  }
}

function openRevise(row) {
  revising.value = row;
  remarks.value = "";
  reviseError.value = "";
}

async function confirmRevise() {
  if (!remarks.value.trim()) { reviseError.value = "Remarks are required."; return; }
  const row = revising.value;
  busy[row.id] = true;
  try {
    await pendingAccounts.revise(row.id, remarks.value.trim());
    revising.value = null;
    await load();
  } catch (e) {
    reviseError.value = e.response?.data?.error || "Could not send this account back for revision.";
  } finally {
    busy[row.id] = false;
  }
}
</script>

<template>
  <section>
    <div class="head">
      <div>
        <h1>Account Approvals</h1>
        <p class="muted">
          Lessors and lessees who applied through the portal. Approving creates their
          owner or tenant record and lets them sign in.
        </p>
      </div>
      <span v-if="rows.length" class="count">{{ rows.length }} waiting</span>
    </div>

    <p v-if="listError" class="error">{{ listError }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>

    <p v-else-if="!rows.length" class="muted empty">No accounts are waiting for approval.</p>

    <table v-else class="grid">
      <thead>
        <tr><th>Name</th><th>Username</th><th>Email</th><th>Applying as</th><th>Unit</th><th>Link to owner</th><th>Requested</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.name }}</td>
          <td>{{ r.email }}</td>
          <td><a v-if="r.contactEmail" :href="`mailto:${r.contactEmail}`">{{ r.contactEmail }}</a><span v-else class="muted">—</span></td>
          <td><span class="role-tag">{{ roleLabel(r.role) }}</span></td>
          <td>
            <span v-if="r.pendingUnit" class="pending-unit">
              {{ r.pendingUnit.unitNumber }}
            </span>
            <span v-else class="muted">—</span>
          </td>
          <td class="owner-link">
            <template v-if="auth.canWrite && r.role === 'UNIT_OWNER'">
              <input
                type="text"
                class="owner-search"
                v-model="ownerSearch[r.id]"
                placeholder="Search owners…"
              />
              <select class="owner-select" v-model="ownerPick[r.id]">
                <option value="">Create a new owner</option>
                <option v-for="o in filteredOwners(r.id)" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
              <p v-if="!ownerPick[r.id]" class="muted small">A new owner will be created.</p>
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ formatDate(r.createdAt) }}</td>
          <td class="row-actions">
            <button type="button" class="primary" :disabled="busy[r.id]" @click="approve(r)">Approve</button>
            <!-- Only a UNIT_OWNER application can resubmit without a unit — see
                 resubmitApplication. A TENANT sent back here would have no way
                 to satisfy the resubmission schema and would be stranded. -->
            <button v-if="r.role === 'UNIT_OWNER'" type="button" class="ghost" :disabled="busy[r.id]" @click="openRevise(r)">For Revision</button>
            <button type="button" class="danger" :disabled="busy[r.id]" @click="openReject(r)">Reject</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="rejecting" class="modal-backdrop" @click.self="rejecting = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Reject account">
        <h2>Reject {{ rejecting.name }}</h2>
        <p class="muted small">The application is kept on file with this reason so the applicant can be told why. Their username stays taken — this cannot be undone from here.</p>
        <div class="field">
          <label for="reason">Reason</label>
          <input id="reason" type="text" v-model="reason" placeholder="e.g. Could not verify identity" />
        </div>
        <p v-if="rejectError" class="error">{{ rejectError }}</p>
        <div class="modal-actions">
          <button type="button" class="ghost" @click="rejecting = null">Cancel</button>
          <button type="button" class="primary" :disabled="busy[rejecting.id]" @click="confirmReject">Reject account</button>
        </div>
      </div>
    </div>

    <div v-if="revising" class="modal-backdrop" @click.self="revising = null">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Send back for revision">
        <h2>Send {{ revising.name }} back for revision</h2>
        <p class="muted small">They'll see these remarks and can correct and resubmit their application.</p>
        <div class="field">
          <label for="revise-remarks">Remarks</label>
          <input id="revise-remarks" data-test="revise-remarks" type="text" v-model="remarks" placeholder="e.g. Tower does not match the unit on file" />
        </div>
        <p v-if="reviseError" class="error">{{ reviseError }}</p>
        <div class="modal-actions">
          <button type="button" class="ghost" @click="revising = null">Cancel</button>
          <button type="button" class="primary" data-test="revise-confirm" :disabled="busy[revising.id]" @click="confirmRevise">Send for revision</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.muted { color: var(--muted); }
.empty { padding: 2rem 0; }
.small { font-size: 0.82rem; }
.count {
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
  background: var(--accent-050); color: var(--accent-text);
  padding: 0.25rem 0.6rem; border-radius: 999px; white-space: nowrap;
}
.role-tag {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.15rem 0.45rem; border-radius: var(--radius-sm);
  background: var(--accent-050); color: var(--accent-text);
}
.pending-unit { font-weight: 600; }
.owner-link { display: flex; flex-direction: column; gap: 0.3rem; min-width: 11rem; }
.owner-search, .owner-select {
  font: inherit; font-size: 0.85rem; padding: 0.3rem 0.45rem;
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  background: var(--paper); color: var(--text);
}
.row-actions { white-space: nowrap; }
.approve { color: var(--good); }
</style>
