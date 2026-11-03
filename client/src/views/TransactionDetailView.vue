<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { leasingTransactions, units, tenants, owners } from "../lib/resource.js";
import { formatDate } from "../lib/formatters.js";
import { stageByKey, nextStageKey, prevStageKey } from "../../../shared/leasingStages.js";
import DeliveryTracker from "../components/DeliveryTracker.vue";
import ApprovalRouting from "../components/ApprovalRouting.vue";
import TransactionDocuments from "../components/TransactionDocuments.vue";
import SchedulingPanel from "../components/SchedulingPanel.vue";

const route = useRoute();
const router = useRouter();
const id = route.params.id;

const txn = ref(null);
const loading = ref(true);
const error = ref("");
const busy = ref("");

const form = reactive({ status: "", remarks: "" });
const links = reactive({ unitId: "", tenantId: "", unitOwnerId: "" });
const unitOpts = ref([]); const tenantOpts = ref([]); const ownerOpts = ref([]);

const stageCfg = computed(() => (txn.value ? stageByKey(txn.value.stage) : null));
const nextCfg = computed(() => (txn.value ? stageByKey(nextStageKey(txn.value.stage)) : null));
const prevCfg = computed(() => (txn.value ? stageByKey(prevStageKey(txn.value.stage)) : null));

async function load() {
  try {
    txn.value = await leasingTransactions.get(id);
    form.status = txn.value.status;
    form.remarks = txn.value.stageData?.[txn.value.stage]?.remarks || "";
    links.unitId = txn.value.unitId || "";
    links.tenantId = txn.value.tenantId || "";
    links.unitOwnerId = txn.value.unitOwnerId || "";
  } catch (e) {
    error.value = e.response?.data?.error || "Could not load this transaction";
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  try { [unitOpts.value, tenantOpts.value, ownerOpts.value] = await Promise.all([units.list(), tenants.list(), owners.list()]); }
  catch { /* selects stay empty */ }
});

async function run(kind, fn) {
  busy.value = kind; error.value = "";
  try { txn.value = await fn(); form.status = txn.value.status; form.remarks = txn.value.stageData?.[txn.value.stage]?.remarks || ""; }
  catch (e) { error.value = e.response?.data?.error || "Action failed"; }
  finally { busy.value = ""; }
}
const saveStatus = () => run("status", () => leasingTransactions.setStatus(id, { status: form.status, remarks: form.remarks }));
const advance = () => run("advance", () => leasingTransactions.advance(id, { remarks: form.remarks }));
const sendBack = () => run("return", () => leasingTransactions.returnStage(id, { remarks: form.remarks }));
const saveLinks = () => run("links", () => leasingTransactions.link(id, {
  unitId: links.unitId || null, tenantId: links.tenantId || null, unitOwnerId: links.unitOwnerId || null,
}));

// Approval routing returns the full updated transaction; documents just reload.
function applyTxn(t) { txn.value = t; form.status = t.status; form.remarks = t.stageData?.[t.stage]?.remarks || ""; }
async function reloadTxn() { try { txn.value = await leasingTransactions.get(id); } catch { /* keep current */ } }

function eventTime(iso) { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

// The two things Contract Signing needs. Mirrors the server's guard in
// leasingTransactionService.advance — if one changes, change both.
const blockers = computed(() => {
  if (txn.value?.stage !== "PHOTOSHOOT") return [];
  const out = [];
  if (!txn.value.tenantId) out.push("Link a prospect tenant");
  if (!(txn.value.documents || []).some((d) => d.docType === "LETTER_OF_INTENT")) {
    out.push("Upload the Letter of Intent");
  }
  return out;
});
</script>

<template>
  <section>
    <button type="button" class="back" @click="router.push('/app/transactions')">← Leasing Tracker</button>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-else-if="txn">
      <header class="head">
        <div>
          <h1>{{ txn.lesseeName || txn.tenant?.name || "Unnamed lessee" }}</h1>
          <p class="muted">Leasing transaction · {{ stageCfg?.label }}</p>
        </div>
      </header>

      <div class="panel tracker-panel">
        <DeliveryTracker
          :reference="txn.reference" :current-stage="txn.stage" :status="txn.status"
          :final-status="txn.finalStatus" :stage-data="txn.stageData"
        />
      </div>

      <div class="cols">
        <!-- Left: stage controls + links -->
        <div class="col">
          <div class="panel">
            <div class="panel__label">Current stage</div>
            <h2 class="stage-name">{{ stageCfg?.label }}</h2>
            <div class="field">
              <label>Status</label>
              <select v-model="form.status">
                <option v-for="s in stageCfg?.statuses || []" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div class="field">
              <label>Remarks <span class="muted">(optional)</span></label>
              <textarea v-model="form.remarks" rows="2" placeholder="Add a note for this stage…"></textarea>
            </div>
            <ul v-if="blockers.length" class="blockers">
              <li v-for="b in blockers" :key="b">{{ b }}</li>
            </ul>
            <div class="actions">
              <button type="button" class="ghost" :disabled="!!busy" @click="saveStatus">{{ busy === 'status' ? 'Saving…' : 'Save status' }}</button>
              <button type="button" class="ghost warn" :disabled="busy || !prevCfg" @click="sendBack">← Send back<span v-if="prevCfg"> to {{ prevCfg.short }}</span></button>
              <button type="button" class="primary" :disabled="busy || !nextCfg" @click="advance">
                {{ busy === 'advance' ? 'Advancing…' : nextCfg ? `Advance to ${nextCfg.short} →` : 'Final stage' }}
              </button>
            </div>
          </div>

          <div class="panel">
            <div class="panel__label">Scheduling</div>
            <SchedulingPanel :transaction="txn" @changed="reloadTxn" />
          </div>

          <div class="panel">
            <div class="panel__label">Linked records</div>
            <div class="field">
              <label>Unit</label>
              <select v-model="links.unitId">
                <option value="">— none —</option>
                <option v-for="u in unitOpts" :key="u.id" :value="u.id">{{ u.unitNumber }}<span v-if="u.building"> · {{ u.building }}</span></option>
              </select>
            </div>
            <div class="field">
              <label>Lessee (tenant)</label>
              <select v-model="links.tenantId">
                <option value="">— none —</option>
                <option v-for="t in tenantOpts" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
            </div>
            <div class="field">
              <label>Lessor (owner)</label>
              <select v-model="links.unitOwnerId">
                <option value="">— none —</option>
                <option v-for="o in ownerOpts" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>
            <div class="actions">
              <button type="button" class="ghost" :disabled="!!busy" @click="saveLinks">{{ busy === 'links' ? 'Saving…' : 'Save links' }}</button>
            </div>
          </div>
        </div>

        <!-- Right: info + activity -->
        <div class="col">
          <div class="panel">
            <div class="panel__label">Transaction details</div>
            <dl class="info">
              <div><dt>Inquiry</dt><dd>{{ txn.inquiry ? `${txn.inquiry.fullName} · ${txn.inquiry.inquiryType}` : "—" }}</dd></div>
              <div><dt>Lessee</dt><dd>{{ txn.tenant?.name || txn.lesseeName || "—" }}</dd></div>
              <div><dt>Unit</dt><dd>{{ txn.unit ? (txn.unit.unitNumber + (txn.unit.building ? ` · ${txn.unit.building}` : "")) : "—" }}</dd></div>
              <div><dt>Lessor</dt><dd>{{ txn.unitOwner?.name || "—" }}</dd></div>
              <div><dt>Assigned officer</dt><dd>{{ txn.assignedOfficer?.name || "—" }}</dd></div>
              <div><dt>Opened</dt><dd>{{ formatDate(txn.createdAt) }}</dd></div>
              <div><dt>Last updated</dt><dd>{{ formatDate(txn.updatedAt) }}</dd></div>
            </dl>
          </div>

          <div class="panel">
            <div class="panel__label">Approval routing</div>
            <ApprovalRouting v-if="txn.approvalSteps?.length" :transaction-id="txn.id" :steps="txn.approvalSteps" editable @changed="applyTxn" />
            <p v-else class="muted small">The routing chain opens when the transaction reaches the Approval stage.</p>
          </div>

          <div class="panel">
            <div class="panel__label">Supporting documents</div>
            <TransactionDocuments :transaction-id="txn.id" :documents="txn.documents || []" can-upload can-upload-typed can-manage @changed="reloadTxn" />
          </div>

          <div class="panel">
            <div class="panel__label">Activity history</div>
            <ul class="timeline">
              <li v-for="e in txn.events" :key="e.id" class="tl">
                <span class="tl__dot"></span>
                <div class="tl__body">
                  <div class="tl__msg">{{ e.message }}</div>
                  <div class="tl__meta">{{ eventTime(e.createdAt) }}<span v-if="e.actorName"> · {{ e.actorName }}</span></div>
                </div>
              </li>
              <li v-if="!txn.events?.length" class="muted">No activity yet.</li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.back { background: none; border: none; color: var(--accent-text); font: inherit; font-weight: 600; cursor: pointer; padding: 0.35rem 0; margin-bottom: 0.75rem; }
.back:hover { text-decoration: underline; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.head h1 { font-family: var(--display); font-weight: 500; }
.head .muted { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.2rem; }
.fbadge { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; background: var(--accent-050); color: var(--accent-text); padding: 0.15rem 0.55rem; border-radius: 999px; }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.15rem 1.25rem; box-shadow: var(--shadow-sm); }
.tracker-panel { margin: 1.1rem 0; }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.75rem; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; align-items: start; }
.col { display: flex; flex-direction: column; gap: 1.1rem; }
.stage-name { font-family: var(--display); font-weight: 500; font-size: 1.4rem; margin: 0 0 0.9rem; }

.field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.8rem; }
.field label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--muted); }
.field select, .field textarea { font: inherit; font-size: 0.95rem; color: var(--text); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.55rem 0.65rem; width: 100%; }
.field textarea { resize: vertical; }
.field select:focus, .field textarea:focus { outline: none; border-color: var(--accent-text); box-shadow: var(--ring); }

.blockers { list-style: none; margin: 0 0 0.6rem; padding: 0.55rem 0.7rem; display: grid; gap: 0.25rem; border: 1px solid var(--warn, var(--line-strong)); border-radius: var(--radius-sm); background: var(--surface); font-size: 0.83rem; color: var(--muted); }
.blockers li::before { content: "→ "; color: var(--faint); }
.actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.3rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; box-shadow: var(--shadow-sm); border-radius: var(--radius-sm); padding: 0.6rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.primary:hover:not(:disabled) { background: var(--accent-600); }
.ghost { background: var(--surface); color: var(--ink-700); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.6rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost:hover:not(:disabled) { background: var(--paper); border-color: var(--muted); }
.ghost.warn { color: var(--warn); }
.ghost.warn:hover:not(:disabled) { border-color: var(--warn); background: var(--warn-050); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.info { margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.info > div { display: grid; grid-template-columns: 40% 1fr; gap: 0.5rem; }
.info dt { color: var(--muted); font-size: 0.82rem; }
.info dd { margin: 0; font-size: 0.9rem; font-weight: 500; }

.timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
.tl { display: flex; gap: 0.7rem; padding: 0.5rem 0; position: relative; }
.tl:not(:last-child)::before { content: ""; position: absolute; left: 5px; top: 1.1rem; bottom: -0.3rem; width: 2px; background: var(--line); }
.tl__dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent-050); border: 2px solid var(--accent); flex-shrink: 0; margin-top: 0.2rem; position: relative; z-index: 1; }
.tl__msg { font-size: 0.88rem; }
.tl__meta { font-size: 0.75rem; color: var(--faint); margin-top: 0.1rem; }

@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
