import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../src/lib/api.js", () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: { token: "t", user: { name: "A", role: "ADMIN" } } })) },
}));

import LoginView from "../src/views/LoginView.vue";

const stub = { template: "<div/>" };

async function mountLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: stub }],
  });
  router.push("/login");
  await router.isReady();
  return mount(LoginView, { global: { plugins: [router] } });
}

const pwInput = (w) => w.find("#password");
const toggle = (w) => w.find(".pw-toggle");

// Like mountLogin(), but hands back the router too so a test can assert on
// where sign-in actually navigated.
async function mountLoginWithRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: stub }],
  });
  router.push("/login");
  await router.isReady();
  const wrapper = mount(LoginView, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe("LoginView — password visibility", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("masks the password by default", async () => {
    const w = await mountLogin();
    expect(pwInput(w).attributes("type")).toBe("password");
  });

  it("offers a control to reveal it", async () => {
    const w = await mountLogin();
    expect(toggle(w).exists()).toBe(true);
    expect(toggle(w).attributes("type")).toBe("button"); // must not submit the form
  });

  it("reveals and re-masks on click", async () => {
    const w = await mountLogin();
    await toggle(w).trigger("click");
    expect(pwInput(w).attributes("type")).toBe("text");
    await toggle(w).trigger("click");
    expect(pwInput(w).attributes("type")).toBe("password");
  });

  it("keeps what was typed when toggling", async () => {
    const w = await mountLogin();
    await pwInput(w).setValue("Ortigas-Capitol-53#");
    await toggle(w).trigger("click");
    expect(pwInput(w).element.value).toBe("Ortigas-Capitol-53#");
  });

  it("announces its state to screen readers", async () => {
    const w = await mountLogin();
    expect(toggle(w).attributes("aria-label")).toBe("Show password");
    expect(toggle(w).attributes("aria-pressed")).toBe("false");
    await toggle(w).trigger("click");
    expect(toggle(w).attributes("aria-label")).toBe("Hide password");
    expect(toggle(w).attributes("aria-pressed")).toBe("true");
  });

  it("still submits the credentials normally while revealed", async () => {
    const { api } = await import("../src/lib/api.js");
    api.post.mockClear();
    const w = await mountLogin();
    await w.find("#username").setValue("admin@rbu.local");
    await pwInput(w).setValue("secret123");
    await toggle(w).trigger("click");
    await w.find("form").trigger("submit.prevent");
    expect(api.post).toHaveBeenCalledWith("/auth/login", { email: "admin@rbu.local", password: "secret123" });
  });
});

describe("LoginView — where sign-in lands you", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("sends a non-approved account straight to the application page", async () => {
    const { api } = await import("../src/lib/api.js");
    api.post.mockResolvedValueOnce({ data: { token: "t", user: { role: "UNIT_OWNER", status: "PENDING" } } });
    const { wrapper: w, router } = await mountLoginWithRouter();
    await w.find("#username").setValue("jane");
    await w.find("#password").setValue("secret12345");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/app/application");
  });

  it("still sends an approved owner to their units", async () => {
    const { api } = await import("../src/lib/api.js");
    api.post.mockResolvedValueOnce({ data: { token: "t", user: { role: "UNIT_OWNER", status: "APPROVED" } } });
    const { wrapper: w, router } = await mountLoginWithRouter();
    await w.find("#username").setValue("jane");
    await w.find("#password").setValue("secret12345");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/app/my-units");
  });
});

describe("LoginView — when sign-in is refused", () => {
  beforeEach(() => setActivePinia(createPinia()));

  async function submitWith(rejection) {
    const { api } = await import("../src/lib/api.js");
    api.post.mockRejectedValueOnce(rejection);
    const { wrapper: w } = await mountLoginWithRouter();
    await w.find("#username").setValue("jane");
    await w.find("#password").setValue("secret12345");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    return w;
  }

  // Too many failed attempts answers 429 before the password is even checked, so
  // a correct password is refused too. Saying "we couldn't find an account" then
  // sends the person round in circles; they need to be told to wait.
  it("tells a throttled person to wait, not that their account was not found", async () => {
    const w = await submitWith({ response: { status: 429, data: { error: "Too many failed sign-in attempts. Please wait a few minutes and try again." } } });
    expect(w.text()).toContain("Too many failed sign-in attempts");
    expect(w.text()).not.toContain("couldn't find an account");
  });

  it("still says the account was not found when the credentials are wrong", async () => {
    const w = await submitWith({ response: { status: 401, data: { error: "Invalid credentials" } } });
    expect(w.text()).toContain("couldn't find an account");
  });
});
