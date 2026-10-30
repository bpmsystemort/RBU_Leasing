import { describe, it, expect } from "vitest";
import { STAFF_NAV, OWNER_NAV, TENANT_NAV, visibleNav, navItems } from "../src/lib/nav.js";

describe("nav model", () => {
  it("shows ADMIN-only items only to ADMIN", () => {
    const admin = navItems(visibleNav("ADMIN", true)).map((i) => i.to);
    const officer = navItems(visibleNav("LEASING_OFFICER", true)).map((i) => i.to);
    expect(admin).toContain("/app/users");
    expect(admin).toContain("/app/import");
    expect(officer).not.toContain("/app/users");
    expect(officer).not.toContain("/app/import");
  });

  it("shows write items to officers but not viewers, keeping plain staff items", () => {
    const officer = navItems(visibleNav("LEASING_OFFICER", true)).map((i) => i.to);
    const viewer = navItems(visibleNav("VIEWER", false)).map((i) => i.to);
    expect(officer).toContain("/app/approvals");
    expect(viewer).not.toContain("/app/approvals");
    expect(viewer).toContain("/app/units");
  });

  it("gives owners and tenants their own nav", () => {
    expect(navItems(visibleNav("UNIT_OWNER", false)).map((i) => i.to)).toContain("/app/my-units");
    const tenant = navItems(visibleNav("TENANT", false)).map((i) => i.to);
    expect(tenant).toContain("/app/my-lease");
    expect(tenant).not.toContain("/app/owners");
  });

  it("drops groups left empty after filtering", () => {
    const viewer = visibleNav("VIEWER", false);
    expect(viewer.find((g) => g.label === "Communication")).toBeUndefined(); // email config is admin-only
    expect(viewer.find((g) => g.label === "Administration")).toBeUndefined();
    expect(viewer.find((g) => g.label === "Overview")).toBeTruthy();
  });

  it("every shipped item has a non-empty route and label", () => {
    for (const nav of [STAFF_NAV, OWNER_NAV, TENANT_NAV]) {
      for (const i of navItems(nav)) {
        expect(typeof i.to).toBe("string");
        expect(i.to.length).toBeGreaterThan(0);
        expect(i.label.length).toBeGreaterThan(0);
      }
    }
  });
});
