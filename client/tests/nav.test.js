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

  it("shows Unit Blocking to write roles and Unit-Owner Assignments to ADMIN only", () => {
    const admin = navItems(visibleNav("ADMIN", true)).map((i) => i.to);
    const officer = navItems(visibleNav("LEASING_OFFICER", true)).map((i) => i.to);
    const viewer = navItems(visibleNav("VIEWER", false)).map((i) => i.to);
    expect(admin).toContain("/app/unit-blocking");
    expect(officer).toContain("/app/unit-blocking");
    expect(viewer).not.toContain("/app/unit-blocking");
    expect(admin).toContain("/app/unit-assignments");
    expect(officer).not.toContain("/app/unit-assignments");
    expect(viewer).not.toContain("/app/unit-assignments");
  });

  it("files the unit pages under Leasing Operations in the Leasing Management and Units sections", () => {
    const ops = visibleNav("ADMIN", true).find((g) => g.label === "Leasing Operations");
    const section = (label) => ops.sections.find((s) => s.label === label);
    const blocking = section("Leasing Management").items.find((i) => i.to === "/app/unit-blocking");
    expect(blocking).toMatchObject({ label: "Unit Blocking", icon: "activity", write: true });
    const assignments = section("Units").items.find((i) => i.to === "/app/unit-assignments");
    expect(assignments).toMatchObject({ label: "Unit-Owner Assignments", icon: "users", admin: true });
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
