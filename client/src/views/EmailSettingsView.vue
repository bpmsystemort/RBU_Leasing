<script setup>
import { reactive, ref, onMounted } from "vue";
import { emailSettings } from "../lib/resource.js";

const loading = ref(true);
const loadError = ref("");

const form = reactive({
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  fromAddress: "",
  fromName: "",
});

const credentialsConfigured = ref(false);
const source = ref("none");

const saving = ref(false);
const saveError = ref("");
const saved = ref(false);

const testTo = ref("");
const testing = ref(false);
const testError = ref("");
const testResult = ref(null);

function applyStatus(data) {
  form.enabled = !!data.enabled;
  form.host = data.host || "";
  form.port = data.port ?? 587;
  form.secure = !!data.secure;
  form.fromAddress = data.fromAddress || "";
  form.fromName = data.fromName || "";
  credentialsConfigured.value = !!data.credentialsConfigured;
  source.value = data.source || "none";
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    applyStatus(await emailSettings.get());
  } catch (e) {
    loadError.value = e.response?.data?.error || "Could not load email settings";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function save() {
  saveError.value = "";
  saved.value = false;
  saving.value = true;
  try {
    const payload = {
      enabled: form.enabled,
      host: form.host || null,
      // A cleared port field is "" (v-model.number leaves non-numeric input
      // as-is) — omit it so the server's default (587) applies instead of
      // sending 0, which the server now rejects.
      port: form.port === "" || form.port == null ? undefined : Number(form.port),
      secure: form.secure,
      fromAddress: form.fromAddress || null,
      fromName: form.fromName || null,
    };
    applyStatus(await emailSettings.save(payload));
    saved.value = true;
  } catch (e) {
    saveError.value = e.response?.data?.error || "Save failed";
  } finally {
    saving.value = false;
  }
}

async function sendTest() {
  testError.value = "";
  testResult.value = null;
  testing.value = true;
  try {
    testResult.value = await emailSettings.test(testTo.value);
  } catch (e) {
    testError.value = e.response?.data?.error || "Could not send the test email";
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <section>
    <h1>Email Settings</h1>
    <p class="muted">Configure the SMTP connection the system uses to send emails, and verify it with a test message.</p>

    <p v-if="loadError" class="error">{{ loadError }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>

    <template v-else>
      <div class="panel">
        <h2>Status</h2>
        <dl class="status">
          <div><dt>Credentials configured</dt><dd>{{ credentialsConfigured ? "Yes" : "No" }}</dd></div>
          <div><dt>Source</dt><dd>{{ source }}</dd></div>
        </dl>
        <p v-if="!credentialsConfigured" class="hint">
          No SMTP username is set — the server will connect without authentication (for relays that allow it).
        </p>
      </div>

      <form @submit.prevent="save">
        <div class="checkbox-row">
          <label><input id="enabled" type="checkbox" v-model="form.enabled" /> Enable outgoing email</label>
        </div>
        <div class="field">
          <label for="host">SMTP host</label>
          <input id="host" type="text" v-model="form.host" />
        </div>
        <div class="field">
          <label for="port">Port</label>
          <input id="port" type="number" v-model.number="form.port" />
        </div>
        <div class="checkbox-row">
          <label><input id="secure" type="checkbox" v-model="form.secure" /> Use TLS (secure)</label>
        </div>
        <div class="field">
          <label for="fromAddress">From address</label>
          <input id="fromAddress" type="text" v-model="form.fromAddress" />
          <small class="hint">If your SMTP server requires authentication, this should match the login account.</small>
        </div>
        <div class="field">
          <label for="fromName">From name</label>
          <input id="fromName" type="text" v-model="form.fromName" />
        </div>

        <p v-if="saveError" class="error">{{ saveError }}</p>
        <p v-if="saved && !saveError" class="success">Settings saved.</p>
        <div class="form-actions">
          <button type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
        </div>
      </form>

      <div class="panel">
        <h2>Send a test email</h2>
        <div class="field">
          <label for="testTo">Send to</label>
          <input id="testTo" type="email" v-model="testTo" placeholder="you@example.com" />
        </div>
        <button type="button" class="primary" :disabled="testing || !testTo" @click="sendTest">
          {{ testing ? "Sending…" : "Send test email" }}
        </button>
        <p v-if="testError" class="error">{{ testError }}</p>
        <p v-if="testResult" :class="testResult.ok && testResult.delivered ? 'success' : 'error'">
          <template v-if="testResult.ok && testResult.delivered">Test email delivered.</template>
          <template v-else>{{ testResult.error || "The test email could not be delivered." }}</template>
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.error { color: var(--danger); background: var(--danger-050); border-radius: var(--radius-sm); padding: .6rem .75rem; font-size: .88rem; }
.muted { color: var(--muted); }
.hint { color: var(--muted); font-size: 0.85rem; margin: 0.4rem 0 0; }
.panel, form { margin-bottom: 1.1rem; }
.status { display: flex; flex-wrap: wrap; gap: 2rem; margin: 0; }
.status dt { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
.status dd { margin: 0.2rem 0 0; font-size: 1rem; font-weight: 600; }
.checkbox-row { display: flex; align-items: center; }
.checkbox-row label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: var(--text); cursor: pointer; }
.checkbox-row input { width: auto; }
.success {
  grid-column: 1 / -1;
  margin: 0; color: var(--good); background: var(--good-050);
  border: 1px solid var(--good); border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem; font-size: 0.88rem;
}
</style>
