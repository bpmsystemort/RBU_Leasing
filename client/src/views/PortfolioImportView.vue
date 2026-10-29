<script setup>
import { ref, computed } from "vue";
import { portfolioImport } from "../lib/resource.js";

const file = ref(null);
const busy = ref(false);
const error = ref("");
const result = ref(null);

const canImport = computed(() => !!file.value && !busy.value);

function onPick(e) { file.value = e.target.files?.[0] || null; result.value = null; error.value = ""; }

async function run() {
  if (!file.value) return;
  busy.value = true; error.value = ""; result.value = null;
  try { result.value = await portfolioImport.upload(file.value); }
  catch (e) { error.value = e.response?.data?.error || "Import failed."; }
  finally { busy.value = false; }
}
</script>

<template>
  <section>
    <header>
      <h1>Import Portfolio</h1>
      <p class="muted">Upload the monitoring workbook (.xlsx). Re-importing the same file is safe — nothing is duplicated or deleted, and no login accounts are created.</p>
    </header>

    <div class="panel">
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onPick" />
      <p v-if="file" class="muted small">Selected: {{ file.name }}</p>
      <div class="actions">
        <button type="button" class="primary" :disabled="!canImport" @click="run">{{ busy ? "Importing…" : "Import" }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-if="result" class="panel summary">
      <div class="panel__label">Import summary</div>
      <ul class="stats">
        <li><strong>{{ result.owners }}</strong> owners</li>
        <li><strong>{{ result.units }}</strong> units</li>
        <li><strong>{{ result.tenants }}</strong> tenants</li>
        <li><strong>{{ result.leases }}</strong> leases</li>
        <li><strong>{{ result.skipped }}</strong> rows skipped</li>
      </ul>
      <details v-if="result.skips?.length">
        <summary>First skipped rows</summary>
        <ul><li v-for="(s, i) in result.skips.slice(0, 8)" :key="i">sheet {{ s.sheet }}, row {{ s.row }} — {{ s.lessee || '—' }} / {{ s.unitNumber || '—' }}</li></ul>
      </details>
    </div>
  </section>
</template>

<style scoped>
.muted { color: var(--muted); }
.small { font-size: 0.82rem; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); margin-top: 1rem; }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.6rem; }
.actions { margin-top: 0.8rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: var(--danger); margin-top: 0.6rem; }
.stats { list-style: none; display: flex; flex-wrap: wrap; gap: 1.2rem; padding: 0; margin: 0; }
.stats strong { font-size: 1.3rem; color: var(--ink-800); display: block; }
</style>
