import { describe, it, expect, beforeEach } from "vitest";
import { resetCrudTables, factory } from "./helpers.js";
import { getExpiringLeases, getDashboard } from "../src/services/dashboardService.js";

beforeEach(async () => { await resetCrudTables(); });

async function unitAndTenant() {
  const o = await factory.owner();
  const u = await factory.unit(o.id);
  const t = await factory.tenant();
  return { unitId: u.id, tenantId: t.id };
}

const NOW = new Date("2026-06-15T00:00:00Z");

describe("getExpiringLeases", () => {
  it("buckets ACTIVE leases by end date into 30/60/90-day windows", async () => {
    const { unitId, tenantId } = await unitAndTenant();
    await factory.lease(unitId, tenantId, { status: "ACTIVE", endDate: new Date("2026-06-25T00:00:00Z") }); // +10d -> within30
    await factory.lease(unitId, tenantId, { status: "ACTIVE", endDate: new Date("2026-07-20T00:00:00Z") }); // +35d -> within60
    await factory.lease(unitId, tenantId, { status: "ACTIVE", endDate: new Date("2026-08-20T00:00:00Z") }); // +66d -> within90
    await factory.lease(unitId, tenantId, { status: "ACTIVE", endDate: new Date("2026-10-01T00:00:00Z") }); // beyond 90d
    await factory.lease(unitId, tenantId, { status: "EXPIRED", startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-06-25T00:00:00Z") }); // not ACTIVE
    const exp = await getExpiringLeases(NOW);
    expect(exp).toEqual({ within30: 1, within60: 1, within90: 1 });
  });
});

describe("getDashboard", () => {
  it("aggregates every metric block", async () => {
    const dash = await getDashboard(NOW);
    expect(Object.keys(dash).sort()).toEqual(
      ["counts", "expiring", "newLeasesThisMonth", "occupancy"]
    );
  });
});
