import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../src/lib/resource.js", () => ({
  ownerInvites: {
    get: vi.fn(() => Promise.resolve({ ownerName: "Jane", email: "j@x.com" })),
    accept: vi.fn(() => Promise.resolve({ token: "t", user: { id: "u1", name: "Jane", email: "j@x.com", role: "UNIT_OWNER", unitOwnerId: "o1", status: "APPROVED" } })),
  },
}));

import AcceptInviteView from "../src/views/AcceptInviteView.vue";
import { ownerInvites } from "../src/lib/resource.js";
import { useAuthStore } from "../src/stores/auth.js";

const stub = { template: "<div/>" };

// Mirrors LoginView.test.js's mountLoginWithRouter: the router supplies
// useRoute()/useRouter() context (so the query string and later push() are
// real), but the component under test is mounted directly rather than via
// <router-view>.
async function mountAccept(token = "abc123") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: stub }],
  });
  const query = token === null ? "" : `?token=${token}`;
  router.push(`/accept-invite${query}`);
  await router.isReady();
  const wrapper = mount(AcceptInviteView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe("AcceptInviteView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ownerInvites.get.mockReset();
    ownerInvites.accept.mockReset();
    ownerInvites.get.mockResolvedValue({ ownerName: "Jane", email: "j@x.com" });
    ownerInvites.accept.mockResolvedValue({
      token: "t",
      user: { id: "u1", name: "Jane", email: "j@x.com", role: "UNIT_OWNER", unitOwnerId: "o1", status: "APPROVED" },
    });
  });

  it("loads the invite by the token in the route query and shows the owner's name and email", async () => {
    const { wrapper: w } = await mountAccept("abc123");
    expect(ownerInvites.get).toHaveBeenCalledWith("abc123");
    expect(w.text()).toContain("Jane");
    expect(w.text()).toContain("j@x.com");
    expect(w.find("form").exists()).toBe(true);
  });

  it("accepts with a matching password, stores the session via the auth store, and redirects to the owner home", async () => {
    const { wrapper: w, router } = await mountAccept("abc123");
    await w.find("#password").setValue("longenough1");
    await w.find("#confirm").setValue("longenough1");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(ownerInvites.accept).toHaveBeenCalledWith("abc123", "longenough1");

    const auth = useAuthStore();
    expect(auth.token).toBe("t");
    expect(auth.isOwner).toBe(true);
    expect(auth.isApproved).toBe(true);
    expect(router.currentRoute.value.path).toBe("/app/my-units");
  });

  it("refuses mismatched passwords without calling accept", async () => {
    const { wrapper: w } = await mountAccept("abc123");
    await w.find("#password").setValue("longenough1");
    await w.find("#confirm").setValue("different-one");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(ownerInvites.accept).not.toHaveBeenCalled();
    expect(w.text()).toContain("Passwords do not match");
  });

  it("requires 8+ characters", async () => {
    const { wrapper: w } = await mountAccept("abc123");
    await w.find("#password").setValue("short1");
    await w.find("#confirm").setValue("short1");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(ownerInvites.accept).not.toHaveBeenCalled();
    expect(w.text()).toContain("at least 8 characters");
  });

  it("surfaces the server's error if accept fails, e.g. the invite was used between load and submit (410)", async () => {
    ownerInvites.accept.mockRejectedValue({ response: { status: 410, data: { error: "this invitation has expired or was already used" } } });
    const { wrapper: w } = await mountAccept("abc123");
    await w.find("#password").setValue("longenough1");
    await w.find("#confirm").setValue("longenough1");
    await w.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(w.text()).toContain("expired or was already used");
  });

  it("shows an invalid/expired message and no password form when the invite can't be loaded (404/410)", async () => {
    ownerInvites.get.mockRejectedValue({ response: { status: 410, data: { error: "this invitation has expired or was already used" } } });
    const { wrapper: w } = await mountAccept("abc123");
    expect(w.text()).toContain("invalid or has expired");
    expect(w.find("form").exists()).toBe(false);
  });

  it("shows the same invalid/expired message when there is no token at all, without calling the API", async () => {
    const { wrapper: w } = await mountAccept(null);
    expect(ownerInvites.get).not.toHaveBeenCalled();
    expect(w.text()).toContain("invalid or has expired");
    expect(w.find("form").exists()).toBe(false);
  });
});
