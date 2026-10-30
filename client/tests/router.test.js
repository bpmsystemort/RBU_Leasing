import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import router from "../src/router/index.js";
import InquiryView from "../src/views/InquiryView.vue";
import AvailableUnitsView from "../src/views/AvailableUnitsView.vue";
import LandingView from "../src/views/LandingView.vue";
import { useAuthStore } from "../src/stores/auth.js";
import { STAFF_NAV, OWNER_NAV, TENANT_NAV, navItems } from "../src/lib/nav.js";

describe("router", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("serves the landing page at /, available units at /available-units, and the Inquiry form at /inquiry", () => {
    expect(router.resolve("/").matched[0].components.default).toBe(LandingView);
    expect(router.resolve("/available-units").matched[0].components.default).toBe(AvailableUnitsView);
    expect(router.resolve("/inquiry").matched[0].components.default).toBe(InquiryView);
  });

  it("redirects the old /units-for-lease list path to the browse page", async () => {
    await router.push("/units-for-lease");
    expect(router.currentRoute.value.path).toBe("/available-units");
  });

  // /inquire was the "I am a…" picker. The landing page asks that question
  // now, and the form itself owns the role, so old bookmarks/links redirect
  // rather than rendering a blank page.
  it("redirects the old /inquire picker path to the Inquiry form", async () => {
    await router.push("/inquire");
    expect(router.currentRoute.value.path).toBe("/inquiry");
  });

  it("sends an unauthenticated visitor from the app to /login", async () => {
    await router.push("/app/owners");
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("redirects a unit owner away from staff routes to My Units", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "UNIT_OWNER", unitOwnerId: "o1" } });
    await router.push("/app/owners");
    expect(router.currentRoute.value.path).toBe("/app/my-units");
    await router.push("/app/my-leases"); // its own route is allowed
    expect(router.currentRoute.value.path).toBe("/app/my-leases");
  });

  it("redirects a tenant away from staff/owner routes to My Lease", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "TENANT", tenantId: "t1" } });
    await router.push("/app/leases");
    expect(router.currentRoute.value.path).toBe("/app/my-lease");
    await router.push("/app/my-units");
    expect(router.currentRoute.value.path).toBe("/app/my-lease");
  });

  it("redirects the old lessor signup link to the wizard", async () => {
    await router.push("/signup?as=LESSOR");
    expect(router.currentRoute.value.path).toBe("/register-unit");
  });

  it("leaves the lessee signup path alone", async () => {
    await router.push("/signup");
    expect(router.currentRoute.value.path).toBe("/signup");
  });

  it("lets staff reach staff routes", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "VIEWER" } });
    await router.push("/app/owners");
    expect(router.currentRoute.value.path).toBe("/app/owners");
  });

  it("restricts Users and Audit to the super admin", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "LEASING_OFFICER" } });
    await router.push("/app/audit");
    expect(router.currentRoute.value.path).toBe("/app"); // officer redirected home

    useAuthStore().setSession({ token: "t", user: { role: "ADMIN" } });
    await router.push("/app/audit");
    expect(router.currentRoute.value.path).toBe("/app/audit");
  });

  it("sends a non-approved account to the application page from any portal route", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "UNIT_OWNER", status: "PENDING" } });
    await router.push("/app/my-units");
    expect(router.currentRoute.value.path).toBe("/app/application");
  });

  it("leaves an approved account alone", async () => {
    useAuthStore().setSession({ token: "t", user: { role: "UNIT_OWNER", status: "APPROVED" } });
    await router.push("/app/my-units");
    expect(router.currentRoute.value.path).toBe("/app/my-units");
  });

  it("every sidebar destination resolves to a real, role-gated app route", () => {
    for (const nav of [STAFF_NAV, OWNER_NAV, TENANT_NAV]) {
      for (const item of navItems(nav)) {
        const r = router.resolve(item.to);
        expect(r.matched.length, `${item.to} should match a route`).toBeGreaterThan(0);
        expect(r.meta.roles, `${item.to} should be role-gated`).toBeTruthy();
      }
    }
  });

  it("admin/write sidebar items point at correctly-gated routes", () => {
    for (const item of navItems(STAFF_NAV)) {
      const roles = router.resolve(item.to).meta.roles;
      if (item.admin) {
        expect(roles, item.to).toContain("ADMIN");
        expect(roles, item.to).not.toContain("LEASING_OFFICER");
        expect(roles, item.to).not.toContain("VIEWER");
      } else if (item.write) {
        expect(roles, item.to).toContain("ADMIN");
        expect(roles, item.to).toContain("LEASING_OFFICER");
      }
    }
  });
});
