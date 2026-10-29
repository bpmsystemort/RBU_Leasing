<script setup>
import { ref, computed } from "vue";
import { portfolioImport } from "../lib/resource.js";
const file = ref(null); const busy = ref(false); const error = ref("");
const preview = ref(null); const result = ref(null);
const canPreview = computed(() => !!file.value && !busy.value);
function onPick(e) { file.value = e.target.files?.[0] || null; preview.value = null; result.value = null; error.value = ""; }
async function runPreview() {
  if (!file.value) return; busy.value = true; error.value = ""; result.value = null;
  try { preview.value = await portfolioImport.preview(file.value); }
  catch (e) { error.value = e.response?.data?.error || "Preview failed."; }
  finally { busy.value = false; }
}
async function confirm() {
  if (!file.value) return; busy.value = true; error.value = "";
  try { result.value = await portfolioImport.commit(file.value); preview.value = null; }
  catch (e) { error.value = e.response?.data?.error || "Import failed."; }
  finally { busy.value = false; }
}
</script>
<template>
  <section>
    <header><h1>Import Portfolio</h1>
      <p class="muted">Upload the monitoring workbook (.xlsx). You'll see a preview before anything is saved. Re-importing the same file changes nothing, and no login accounts are created. Imported units are recorded as Occupied; units whose leases have all ended are flagged for status review (never auto-set to available).</p>
    </header>
    <div class="panel">
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onPick" />
      <p v-if="file" class="muted small">Selected: {{ file.name }}</p>
      <div class="actions">
        <button type="button" class="primary" :disabled="!canPreview" @click="runPreview">{{ busy && !result ? "Checking…" : "Preview" }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-if="preview" class="panel">
      <div class="panel__label">Preview — nothing saved yet</div>
      <ul class="stats">
        <li><strong>{{ preview.totals.willCreate }}</strong> new</li>
        <li><strong>{{ preview.totals.willUpdate }}</strong> update</li>
        <li><strong>{{ preview.totals.skipped }}</strong> skipped</li>
        <li><strong>{{ preview.totals.failed }}</strong> failed</li>
      </ul>
      <p class="muted small">{{ preview.ownersNeedingReview }} owner(s) flagged for review · {{ preview.unitsNeedingStatusReview }} unit(s) need status review</p>
      <ul v-if="preview.sheets?.some(s => !s.ok)" class="sheets">
        <li v-for="s in preview.sheets.filter(s => !s.ok)" :key="s.name" class="error">Sheet {{ s.name }}: {{ s.error }}</li>
      </ul>
      <details v-if="preview.failures?.length" open><summary>{{ preview.failures.length }} failed row(s)</summary>
        <ul><li v-for="(f,i) in preview.failures.slice(0,50)" :key="i">sheet {{ f.sheet }}, row {{ f.row }} — {{ f.reasons.join("; ") }}</li></ul>
      </details>
      <div class="actions">
        <button type="button" class="primary" :disabled="busy" @click="confirm">{{ busy ? "Importing…" : "Confirm import" }}</button>
        <button type="button" class="ghost" :disabled="busy" @click="file = null; preview = null;">Choose another file</button>
      </div>
    </div>

    <div v-if="result" class="panel summary">
      <div class="panel__label">Import complete</div>
      <ul class="stats">
        <li><strong>{{ result.created }}</strong> created</li>
        <li><strong>{{ result.updated }}</strong> updated</li>
        <li><strong>{{ result.skipped }}</strong> skipped</li>
        <li><strong>{{ result.failed }}</strong> failed</li>
      </ul>
      <p class="muted small">{{ result.ownersFlagged }} owner(s) flagged · {{ result.unitsFlagged }} unit(s) need status review</p>
    </div>
  </section>
</template>
<style scoped>
.muted { color: var(--muted); } .small { font-size: 0.82rem; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); margin-top: 1rem; }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.6rem; }
.actions { margin-top: 0.8rem; display: flex; gap: 0.6rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost { background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: var(--danger); } .stats { list-style: none; display: flex; flex-wrap: wrap; gap: 1.2rem; padding: 0; margin: 0.4rem 0; }
.stats strong { font-size: 1.3rem; color: var(--ink-800); display: block; } .sheets { padding-left: 1rem; }
</style>
