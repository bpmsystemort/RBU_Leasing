import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import AppLayout from "../src/components/AppLayout.vue";
import { useAuthStore } from "../src/stores/auth.js";
import { useActionCenter } from "../src/stores/actionCenter.js";

const stub = { template: "<div/>" };
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: stub }],
  });
}
function mountAs(role) {
  const auth = useAuthStore();
  if (role) auth.setSession({ token: "t", user: { name: "Test User", role } });
  const router = makeRouter(); router.push("/app"); router.isReady();
  return mount(AppLayout, { global: { plugins: [router] } });
}

describe("AppLayout (sidebar shell)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  // The theme control now lives in ThemeToggle, mounted once at the app root so
  // it appears on public pages too — see tests/ThemeToggle.test.js and App.test.js.
  it("no longer carries a theme picker in the user menu", async () => {
    const w = mountAs("LEASING_OFFICER");
    await w.find(".userchip").trigger("click");
    expect(w.find(".themepick").exists()).toBe(false);
  });

  it("lists the staff functions in the sidebar", async () => {
    const nav = mountAs("LEASING_OFFICER").find(".sidebar__nav").text();
    for (const label of ["Dashboard", "Inquiry List", "Owner Directory", "Unit List", "Tenant Records", "Leases & Contracts", "Approvals", "Lessor Sheets", "Lessee Sheets"]) {
      expect(nav).toContain(label);
    }
  });

  it("groups the sidebar and shows a group's section labels", () => {
    const nav = mountAs("ADMIN").find(".sidebar__nav").text();
    expect(nav).toContain("Leasing Operations"); // group header
    expect(nav).toContain("Requirements & Documents"); // section sub-label
    expect(nav).toContain("Communication");
  });

  it("collapses a group on click and remembers it", async () => {
    // isVisible() reads computed style, which happy-dom only resolves for
    // nodes attached to the document — see InquiryView.test.js for the same pattern.
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "Test User", role: "ADMIN" } });
    const router = makeRouter(); router.push("/app"); await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] }, attachTo: document.body });
    try {
      const group = w.findAll(".navgroup").find((g) => g.text().includes("Leasing Operations"));
      const toggle = group.find(".navgroup__toggle");
      expect(toggle.attributes("aria-expanded")).toBe("true");
      await toggle.trigger("click");
      expect(toggle.attributes("aria-expanded")).toBe("false");
      expect(group.find(".navgroup__items").isVisible()).toBe(false);
      expect(JSON.parse(localStorage.getItem("rbu.nav.collapsedGroups"))).toContain("Leasing Operations");
    } finally {
      w.unmount();
    }
  });

  it("keeps the active group expanded even if stored collapsed", async () => {
    localStorage.setItem("rbu.nav.collapsedGroups", JSON.stringify(["Leasing Operations"]));
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "T", role: "ADMIN" } });
    const router = makeRouter(); router.push("/app/units"); await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] }, attachTo: document.body });
    try {
      const group = w.findAll(".navgroup").find((g) => g.text().includes("Leasing Operations"));
      expect(group.find(".navgroup__items").isVisible()).toBe(true);
    } finally {
      w.unmount();
    }
  });

  it("shows a group › page breadcrumb", async () => {
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "T", role: "ADMIN" } });
    const router = makeRouter(); router.push("/app/units"); await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find(".crumbs__group").text()).toBe("Leasing Operations");
    expect(w.find(".crumbs__here").text()).toBe("Unit List");
  });

  it("shows System Users and Audit Trail only to the super admin", () => {
    expect(mountAs("LEASING_OFFICER").find(".sidebar__nav").text()).not.toContain("Audit Trail");
    const adminNav = mountAs("ADMIN").find(".sidebar__nav").text();
    expect(adminNav).toContain("System Users");
    expect(adminNav).toContain("Audit Trail");
  });

  describe("action needed indicator", () => {
    // The badge/bell must reflect outstanding work without visiting the page.
    function withPending(role, n) {
      const store = useActionCenter();
      store.accountApprovals = n;
      return mountAs(role);
    }

    it("shows a count on the Account Approvals nav item when work is waiting", () => {
      const w = withPending("ADMIN", 3);
      const link = w.findAll("a").find((a) => a.attributes("href") === "/app/account-approvals");
      expect(link.find(".navlink__badge").text()).toBe("3");
    });

    it("shows no badge when nothing is waiting", () => {
      const w = withPending("ADMIN", 0);
      const link = w.findAll("a").find((a) => a.attributes("href") === "/app/account-approvals");
      expect(link.find(".navlink__badge").exists()).toBe(false);
    });

    it("puts a bell in the top bar carrying the same count", () => {
      const w = withPending("LEASING_OFFICER", 2);
      const bell = w.find(".bell");
      expect(bell.exists()).toBe(true);
      expect(bell.find(".bell__count").text()).toBe("2");
      expect(bell.attributes("aria-label")).toContain("2");
    });

    it("marks the bell quiet when there is nothing to do", () => {
      const w = withPending("ADMIN", 0);
      expect(w.find(".bell__count").exists()).toBe(false);
      expect(w.find(".bell").attributes("aria-label")).toBe("No actions needed");
    });

    it("opens a panel naming the outstanding work", async () => {
      const w = withPending("ADMIN", 4);
      await w.find(".bell").trigger("click");
      const panel = w.find(".actions-panel");
      expect(panel.exists()).toBe(true);
      expect(panel.text()).toContain("Account Approvals");
      expect(panel.text()).toContain("4");
      const link = panel.findAll("a").find((a) => a.attributes("href") === "/app/account-approvals");
      expect(link).toBeTruthy();
    });

    it("says so when the panel is opened with nothing pending", async () => {
      const w = withPending("ADMIN", 0);
      await w.find(".bell").trigger("click");
      expect(w.find(".actions-panel").text()).toContain("Nothing needs your attention");
    });

    // Roles that cannot approve must not see the indicator at all.
    it.each(["VIEWER", "TENANT", "UNIT_OWNER"])("hides the bell from %s", (role) => {
      const w = withPending(role, 5);
      expect(w.find(".bell").exists()).toBe(false);
    });

    it("clears the count on sign-out so the next user sees nothing stale", async () => {
      const store = useActionCenter();
      store.accountApprovals = 6;
      const w = mountAs("ADMIN");
      await w.find(".userchip").trigger("click");
      await w.findAll("button").find((b) => b.text().includes("Log out")).trigger("click");
      expect(store.total).toBe(0);
    });

    it("caps a large count so it cannot break the layout", () => {
      const w = withPending("ADMIN", 130);
      expect(w.find(".bell__count").text()).toBe("99+");
    });
  });

  it("lists the unit blocking and assignment pages by role", () => {
    const adminNav = mountAs("ADMIN").find(".sidebar__nav").text();
    expect(adminNav).toContain("Unit Blocking");
    expect(adminNav).toContain("Unit-Owner Assignments");
    const officerNav = mountAs("LEASING_OFFICER").find(".sidebar__nav").text();
    expect(officerNav).toContain("Unit Blocking");
    expect(officerNav).not.toContain("Unit-Owner Assignments");
    const viewerNav = mountAs("VIEWER").find(".sidebar__nav").text();
    expect(viewerNav).not.toContain("Unit Blocking");
    expect(viewerNav).not.toContain("Unit-Owner Assignments");
  });

  it("names the CMS section Content Manager, not Forms", () => {
    const nav = mountAs("ADMIN").find(".sidebar__nav");
    expect(nav.text()).toContain("Content Manager");
    const link = nav.findAll("a").find((a) => a.attributes("href") === "/app/content");
    expect(link.text()).toBe("Content Manager");
  });

  // The breadcrumb reads from the same nav label, so it must follow the rename.
  it("shows the renamed label in the breadcrumb", async () => {
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "Test User", role: "ADMIN" } });
    const router = makeRouter();
    router.push("/app/content");
    await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find(".crumbs__here").text()).toBe("Content Manager");
  });

  it("gives owners and tenants their own sidebar", () => {
    expect(mountAs("UNIT_OWNER").find(".sidebar__nav").text()).toContain("My Units");
    const tenantNav = mountAs("TENANT").find(".sidebar__nav").text();
    expect(tenantNav).toContain("My Lease");
    expect(tenantNav).not.toContain("Owners");
  });

  it("logout clears the auth store", async () => {
    const auth = useAuthStore();
    const w = mountAs("ADMIN");
    await w.find("button.logout").trigger("click");
    expect(auth.isAuthenticated).toBe(false);
  });
});
