<script setup>
import { ref, watch, onMounted } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ownerInvites } from "../lib/resource.js";
import { useAuthStore } from "../stores/auth.js";
import PublicShell from "../components/PublicShell.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const token = typeof route.query.token === "string" ? route.query.token : "";

// Whether the invite itself could be loaded. There is no password-reset flow,
// so a token that is missing, already used, or expired must stop the owner
// before the form ever shows — not fail later on submit.
const loading = ref(true);
const loadError = ref("");
const ownerName = ref("");
const email = ref("");

const password = ref("");
const confirm = ref("");
const showPassword = ref(false);
const showConfirm = ref(false);
const submitting = ref(false);
const formError = ref("");
const errors = ref({});

onMounted(async () => {
  if (!token) {
    loadError.value = "This invitation is invalid or has expired.";
    loading.value = false;
    return;
  }
  try {
    const invite = await ownerInvites.get(token);
    ownerName.value = invite.ownerName;
    email.value = invite.email;
  } catch {
    // Covers a bad token (404) and a used/expired one (410) alike — the
    // owner cannot act on either, so one plain message is clearer than
    // repeating the server's wording for each case.
    loadError.value = "This invitation is invalid or has expired.";
  } finally {
    loading.value = false;
  }
});

watch(password, () => { delete errors.value.password; delete errors.value.confirm; });
watch(confirm, () => delete errors.value.confirm);

function validate() {
  const e = {};
  if (password.value.length < 8) e.password = "Password must be at least 8 characters.";
  if (confirm.value !== password.value) e.confirm = "Passwords do not match.";
  errors.value = e;
  return Object.keys(e).length === 0;
}

async function submit() {
  formError.value = "";
  if (!validate()) return;
  submitting.value = true;
  try {
    const session = await ownerInvites.accept(token, password.value);
    // Same store action LoginView uses on a successful sign-in — this invite
    // acceptance *is* the owner's first sign-in.
    auth.setSession(session);
    router.push("/app/my-units");
  } catch (e) {
    // e.g. the invite was used or expired between load and submit (410).
    formError.value = e.response?.data?.error || "Could not set your password.";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <PublicShell main-label="Accept your invitation" skip-label="Skip to the form" narrow footer="slim">
    <template #nav-actions>
      <RouterLink to="/login" class="nav__signin">Sign in</RouterLink>
    </template>

    <div class="auth">
      <div class="auth__card">
        <p v-if="loading" class="muted">Loading your invitation…</p>

        <template v-else-if="loadError">
          <h1>Invitation not found</h1>
          <p class="done__body">{{ loadError }}</p>
          <RouterLink class="done__link" to="/login">Back to sign in</RouterLink>
        </template>

        <template v-else>
          <h1>Set up your portal access</h1>
          <div class="who">
            <p class="who__label">Invitation for</p>
            <p class="who__name">{{ ownerName }}</p>
            <p class="who__email">{{ email }}</p>
          </div>

          <form @submit.prevent="submit" novalidate>
            <div class="fld">
              <div class="pw-wrap">
                <input
                  id="password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Password (8+ characters)"
                  autocomplete="new-password"
                />
                <button
                  type="button" class="pw-toggle"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                >
                  <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </button>
              </div>
              <p v-if="errors.password" class="fld__err">{{ errors.password }}</p>
            </div>

            <div class="fld">
              <div class="pw-wrap">
                <input
                  id="confirm"
                  v-model="confirm"
                  :type="showConfirm ? 'text' : 'password'"
                  placeholder="Confirm password"
                  autocomplete="new-password"
                />
                <button
                  type="button" class="pw-toggle"
                  :aria-label="showConfirm ? 'Hide password' : 'Show password'"
                  :aria-pressed="showConfirm"
                  @click="showConfirm = !showConfirm"
                >
                  <svg v-if="!showConfirm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </button>
              </div>
              <p v-if="errors.confirm" class="fld__err">{{ errors.confirm }}</p>
            </div>

            <button type="submit" :disabled="submitting">{{ submitting ? "Saving…" : "Set password and sign in" }}</button>
            <p v-if="formError" class="error">{{ formError }}</p>
          </form>
        </template>
      </div>
    </div>
  </PublicShell>
</template>

<style scoped>
.muted { color: var(--muted); }
.who {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 0.65rem 0.8rem; margin: 0.25rem 0 1.1rem;
}
.who__label { margin: 0; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); }
.who__name { margin: 0.2rem 0 0; font-weight: 600; color: var(--text); }
.who__email { margin: 0.1rem 0 0; font-size: 0.85rem; color: var(--muted); }

.fld { display: flex; flex-direction: column; gap: 0.25rem; }
.fld__err { margin: 0; font-size: 0.76rem; color: var(--danger); }

.pw-wrap { position: relative; display: flex; }
.pw-wrap input { padding-right: 2.9rem; }
.pw-toggle {
  position: absolute; top: 50%; right: 0.5rem; transform: translateY(-50%);
  width: auto; margin: 0; box-shadow: none;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.35rem; border: none; background: none; color: var(--muted);
  cursor: pointer; border-radius: var(--radius-sm);
}
.pw-toggle:hover, .pw-toggle:active, .pw-toggle:focus {
  background: none; box-shadow: none; transform: translateY(-50%); color: var(--muted);
}
.pw-toggle:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 1px; box-shadow: none; transform: translateY(-50%); }
.pw-toggle svg { width: 18px; height: 18px; display: block; }

.done__body { color: var(--muted); font-size: 0.9rem; line-height: 1.6; margin: 0.5rem 0 1.1rem; }
.done__link { color: var(--accent-text); font-weight: 600; font-size: 0.88rem; text-decoration: none; }
.done__link:hover { text-decoration: underline; }
</style>
