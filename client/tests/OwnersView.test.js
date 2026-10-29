import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../src/lib/resource.js", () => ({
  owners: {
    list: vi.fn(() => Promise.resolve([
      { id: "1", name: "Ayala", email: "a@x.com", phone: "1", needsReview: false },
      { id: "2", name: "Unverified Co.", email: null, phone: null, needsReview: true },
    ])),
    remove: vi.fn(() => Promise.resolve()),
  },
}));

import OwnersView from "../src/views/OwnersView.vue";
import { useAuthStore } from "../src/stores/auth.js";

const stub = { template: "<div/>" };
function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [
    { path: "/owners", component: OwnersView },
    { path: "/owners/new", component: stub },
    { path: "/owners/:id", component: stub },
    { path: "/app/lessor-profile/:id", component: stub },
  ]});
}

async function mountView(role) {
  setActivePinia(createPinia());
  if (role) useAuthStore().setSession({ token: "t", user: { role } });
  const router = makeRouter(); router.push("/owners"); await router.isReady();
  const w = mount(OwnersView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("OwnersView", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("lists owners from the API", async () => {
    const w = await mountView("VIEWER");
    expect(w.text()).toContain("Ayala");
  });
  it("shows write controls for the Super Admin", async () => {
    const w = await mountView("ADMIN");
    expect(w.text()).toContain("New owner");
  });
  it("is read-only for a non-admin (even a write role)", async () => {
    const w = await mountView("LEASING_OFFICER");
    expect(w.text()).not.toContain("New owner");
  });
  it("links the owner name to their lessor profile", async () => {
    const w = await mountView("VIEWER");
    const nameLink = w.find("button.name-link");
    expect(nameLink.exists()).toBe(true);
    expect(nameLink.text()).toBe("Ayala");
    await nameLink.trigger("click");
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.fullPath).toBe("/app/lessor-profile/1");
  });

  it("shows a Needs review badge only on the flagged owner", async () => {
    const w = await mountView("VIEWER");
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].find(".review-tag").exists()).toBe(false); // Ayala — not flagged
    expect(rows[1].find(".review-tag").text()).toBe("Needs review"); // Unverified Co.
  });

  it("narrows the list to flagged owners via the filter checkbox", async () => {
    const w = await mountView("VIEWER");
    expect(w.findAll("tbody tr")).toHaveLength(2);
    await w.find(".flag-filter input").setValue(true);
    await flushPromises();
    const bodyText = w.find("tbody").text();
    expect(bodyText).not.toContain("Ayala");
    expect(bodyText).toContain("Unverified Co.");
  });
});
