import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const BLOCKED = [
  { id: "b1", unitNumber: "12A", status: "BLOCKED", blockedByTransactionId: "t-hold", tower: { id: "tw1", name: "Tower One" } },
  { id: "b2", unitNumber: "9C", status: "BLOCKED", blockedByTransactionId: null, tower: { id: "tw2", name: "Tower Two" } },
];
const VACANT = [
  { id: "v1", unitNumber: "5D", status: "VACANT", blockedByTransactionId: null, tower: { id: "tw1", name: "Tower One" } },
  { id: "v2", unitNumber: "6E", status: "VACANT", blockedByTransactionId: null, tower: { id: "tw2", name: "Tower Two" } },
];
const DEALS = [
  // holds the blocked unit 12A
  { id: "t-hold", reference: "LT-001", lesseeName: "Ana Reyes", unitId: "b1", inquiryId: "q1", tenantId: null, finalStatus: null, unit: { id: "b1", unitNumber: "12A" } },
  // eligible: unit, prospect (inquiry), open, unit vacant
  { id: "t-ready", reference: "LT-002", lesseeName: "Ben Cruz", unitId: "v1", inquiryId: "q2", tenantId: null, finalStatus: null, unit: { id: "v1", unitNumber: "5D" } },
  // not eligible: no unit
  { id: "t-nounit", reference: "LT-003", lesseeName: "No Unit Person", unitId: null, inquiryId: "q3", tenantId: null, finalStatus: null, unit: null },
  // not eligible: no prospect
  { id: "t-noprospect", reference: "LT-004", lesseeName: "No Prospect", unitId: "v2", inquiryId: null, tenantId: null, finalStatus: null, unit: { id: "v2", unitNumber: "6E" } },
  // not eligible: deal has ended
  { id: "t-ended", reference: "LT-005", lesseeName: "Ended Deal", unitId: "v1", inquiryId: "q5", tenantId: null, finalStatus: "Declined", unit: { id: "v1", unitNumber: "5D" } },
  // not eligible: its unit is not vacant
  { id: "t-notvacant", reference: "LT-006", lesseeName: "Occupied Unit", unitId: "o1", inquiryId: "q6", tenantId: null, finalStatus: null, unit: { id: "o1", unitNumber: "1Z" } },
  // eligible: prospect is a tenant, name comes from the tenant
  { id: "t-tenant", reference: "LT-007", lesseeName: null, unitId: "v2", inquiryId: null, tenantId: "tn1", finalStatus: null, tenant: { id: "tn1", name: "Cora Lim" }, unit: { id: "v2", unitNumber: "6E" } },
];

vi.mock("../src/lib/resource.js", () => ({
  units: {
    list: vi.fn((params) => Promise.resolve(
      params?.status === "BLOCKED" ? BLOCKED : params?.status === "VACANT" ? VACANT : [...BLOCKED, ...VACANT],
    )),
    releaseBlock: vi.fn(() => Promise.resolve({})),
  },
  leasingTransactions: {
    list: vi.fn(() => Promise.resolve(DEALS)),
    blockUnit: vi.fn(() => Promise.resolve({})),
    unblockUnit: vi.fn(() => Promise.resolve({})),
  },
}));

import UnitBlockingView from "../src/views/UnitBlockingView.vue";
import { units, leasingTransactions } from "../src/lib/resource.js";
import { useAuthStore } from "../src/stores/auth.js";

async function mountView() {
  const w = mount(UnitBlockingView);
  await flushPromises();
  return w;
}

describe("UnitBlockingView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().setSession({ token: "t", user: { role: "LEASING_OFFICER" } });
    units.list.mockClear();
    units.releaseBlock.mockClear();
    leasingTransactions.list.mockClear();
    leasingTransactions.blockUnit.mockClear();
    leasingTransactions.unblockUnit.mockClear();
  });

  it("lists blocked units with the holding deal, or No holder", async () => {
    const w = await mountView();
    expect(units.list).toHaveBeenCalledWith({ status: "BLOCKED" });
    const rows = w.findAll(".blocked-table .blocked-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("12A");
    expect(rows[0].text()).toContain("Tower One");
    expect(rows[0].text()).toContain("LT-001");
    expect(rows[0].text()).toContain("Ana Reyes");
    expect(rows[0].text()).not.toContain("No holder");
    expect(rows[1].text()).toContain("9C");
    expect(rows[1].text()).toContain("Tower Two");
    expect(rows[1].text()).toContain("No holder");
  });

  it("releases through the holding deal when there is one", async () => {
    const w = await mountView();
    await w.findAll(".blocked-row")[0].find(".release-btn").trigger("click");
    await flushPromises();
    expect(leasingTransactions.unblockUnit).toHaveBeenCalledWith("t-hold");
    expect(units.releaseBlock).not.toHaveBeenCalled();
    // both tables reloaded: one load on mount, one after the action
    expect(leasingTransactions.list).toHaveBeenCalledTimes(2);
    expect(units.list).toHaveBeenCalledTimes(4);
  });

  it("releases at unit level when the block has no holder", async () => {
    const w = await mountView();
    await w.findAll(".blocked-row")[1].find(".release-btn").trigger("click");
    await flushPromises();
    expect(units.releaseBlock).toHaveBeenCalledWith("b2");
    expect(leasingTransactions.unblockUnit).not.toHaveBeenCalled();
    expect(leasingTransactions.list).toHaveBeenCalledTimes(2);
  });

  it("lists only deals that can block their unit right now", async () => {
    const w = await mountView();
    const rows = w.findAll(".ready-table .ready-row");
    expect(rows).toHaveLength(2);
    const text = w.find(".ready-table").text();
    expect(text).toContain("LT-002");
    expect(text).toContain("Ben Cruz");
    expect(text).toContain("5D");
    expect(text).toContain("LT-007");
    expect(text).toContain("Cora Lim");
    for (const excluded of ["LT-001", "LT-003", "LT-004", "LT-005", "LT-006"]) {
      expect(text).not.toContain(excluded);
    }
  });

  it("blocks a deal's unit and then reloads both tables", async () => {
    const w = await mountView();
    const row = w.findAll(".ready-row").find((r) => r.text().includes("LT-002"));
    await row.find(".block-btn").trigger("click");
    await flushPromises();
    expect(leasingTransactions.blockUnit).toHaveBeenCalledWith("t-ready");
    expect(leasingTransactions.list).toHaveBeenCalledTimes(2);
    expect(units.list).toHaveBeenCalledWith({ status: "BLOCKED" });
    expect(units.list).toHaveBeenCalledTimes(4);
  });

  it("shows the server's error when blocking is refused, and still reloads", async () => {
    leasingTransactions.blockUnit.mockRejectedValueOnce({
      response: { data: { error: "Unit 5D is blocked, not vacant" } },
    });
    const w = await mountView();
    const row = w.findAll(".ready-row").find((r) => r.text().includes("LT-002"));
    await row.find(".block-btn").trigger("click");
    await flushPromises();
    expect(w.find(".action-error").text()).toContain("Unit 5D is blocked, not vacant");
    expect(leasingTransactions.list).toHaveBeenCalledTimes(2);
  });

  it("shows the server's error when a release is refused", async () => {
    leasingTransactions.unblockUnit.mockRejectedValueOnce({
      response: { data: { error: "This deal is not blocking a unit" } },
    });
    const w = await mountView();
    await w.findAll(".blocked-row")[0].find(".release-btn").trigger("click");
    await flushPromises();
    expect(w.find(".action-error").text()).toContain("This deal is not blocking a unit");
  });
});
