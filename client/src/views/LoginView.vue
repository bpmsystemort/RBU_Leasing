<script setup>
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/auth.js";
import PublicShell from "../components/PublicShell.vue";
// The brand lockup lives in the shell's header now, so the card no longer
// repeats it — and it no longer says "RBU Leasing / Residential Business Unit",
// which was a third lockup nobody else used.

const email = ref(""); const password = ref(""); const error = ref("");
// Let people check what they typed before submitting — long or generated
// passwords are easy to mistype, and the error message cannot say which field
// was wrong. Starts masked; never persists across a page load.
const showPassword = ref(false);
const router = useRouter(); const auth = useAuthStore();

async function submit() {
  error.value = "";
  try {
    const { data } = await api.post("/auth/login", { email: email.value, password: password.value });
    auth.setSession(data);
    // A restricted session has exactly one page it may open; sending it to a
    // portal home just to be bounced by the guard shows a flash of the wrong
    // screen.
    const home = !auth.isApproved
      ? "/app/application"
      : auth.isOwner ? "/app/my-units" : auth.isTenant ? "/app/my-lease" : "/app";
    router.push(home);
  } catch (e) {
    // Too many failed attempts is refused with 429 before the password is even
    // checked, so a correct password is refused too. Say so, with the server's
    // own wording — "we couldn't find an account" would send someone round in
    // circles retyping a password that was fine.
    if (e?.response?.status === 429 && e.response.data?.error) {
      error.value = e.response.data.error;
      return;
    }
    // Every account that exists can now sign in, whatever its status, so
    // otherwise the credentials simply do not match.
    error.value = "We couldn't find an account with those details. Check your username and password, or create an account below if you don't have one yet.";
  }
}
</script>

<template>
  <PublicShell main-label="Sign in" skip-label="Skip to sign in" narrow footer="slim">
    <template #nav-actions>
      <RouterLink to="/signup" class="nav__signin">Create an account</RouterLink>
    </template>

    <div class="auth">
      <div class="auth__card">
        <h1>Sign in to your account</h1>
        <form @submit.prevent="submit">
          <input id="username" v-model="email" type="text" placeholder="Username" autocomplete="username" />
          <div class="pw-wrap">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Password"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="pw-toggle"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
          </div>
          <button type="submit">Log in</button>
          <p v-if="error" class="error">{{ error }}</p>
        </form>
        <p class="auth__alt">Lessor or lessee? <RouterLink to="/signup">Create an account</RouterLink></p>
      </div>
    </div>
  </PublicShell>
</template>

<style scoped>
.pw-wrap { position: relative; display: flex; }
/* Room for the eye so long passwords never run under it. */
.pw-wrap input { padding-right: 2.9rem; }
.pw-toggle {
  position: absolute;
  top: 50%;
  right: 0.5rem;
  transform: translateY(-50%);
  /* .auth button in app.css is a full-width submit button; this one is an icon
     inside the field, so width/margin/shadow have to be reset explicitly. */
  width: auto;
  margin: 0;
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
/* Deliberately inert: the icon must not move, tint or lift on hover. It shares
   the .auth button selector with the full-width submit button, which lifts on
   hover (translateY(-1px)) — that overrode the translateY(-50%) centring here
   and threw the icon out of the field. Every property that rule touches is
   pinned back, on hover and active alike. */
.pw-toggle:hover,
.pw-toggle:active,
.pw-toggle:focus {
  background: none;
  box-shadow: none;
  transform: translateY(-50%);
  color: var(--muted);
}
/* Keyboard focus still needs to be visible — that is not a hover effect. */
.pw-toggle:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 1px;
  box-shadow: none;
  transform: translateY(-50%);
}
.pw-toggle svg { width: 18px; height: 18px; display: block; }
</style>
