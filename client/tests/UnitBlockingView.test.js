import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const BLOCKED = [
  { id: "b1", unitNumber: "12A", status: "BLOCKED", blockedByTransactionId: "t-hold", tower: { id: "tw1", name: "Tower One" } },
  { id: "b2", unitNumber: "9C", status: "BLOCKED", blockedByTransactionId: null, tower: { id: "tw2", name: "Tower Two" } },
];
const VACANT = [
  { id: "v1", unitNumber: "5D", status: "VACANT", approvalStatus: "APPROVED", blockedByTransactionId: null, tower: { id: "tw1", name: "Tower One" } },
  { id: "v2", unitNumber: "6E", status: "VACANT", approvalStatus: "APPROVED", blockedByTransactionId: null, tower: { id: "tw2", name: "Tower Two" } },
  // vacant but not approved yet: the console must not offer to block it
  { id: "v3", unitNumber: "7F", status: "VACANT", approvalStatus: "SUBMITTED", blockedByTransactionId: null, tower: { id: "tw1", name: "Tower One" } },
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
  // not eligible: its unit is vacant but still SUBMITTED, so the approved-only vacant list leaves it out
  { id: "t-unapproved", reference: "LT-008", lesseeName: "Dina Uy", unitId: "v3", inquiryId: "q8", tenantId: null, finalStatus: null, unit: { id: "v3", unitNumber: "7F" } },
];

vi.mock("../src/lib/resource.js", () => ({
  units: {
    list: vi.fn((params) => {
      const all = params?.status === "BLOCKED" ? BLOCKED : params?.status === "VACANT" ? VACANT : [...BLOCKED, ...VACANT];
      // like the server, honour the approvalStatus filter when one is sent
      return Promise.resolve(params?.approvalStatus ? all.filter((u) => u.approvalStatus === params.approvalStatus) : all);
    }),
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

  it("says a block is held by a deal outside the officer's view, and offers no Release", async () => {
    // b3 names a holder deal that is not in the loaded deals list. The first
    // units.list call of a load is the BLOCKED one.
    units.list.mockImplementationOnce(() => Promise.resolve([
      ...BLOCKED,
      { id: "b3", unitNumber: "3F", status: "BLOCKED", blockedByTransactionId: "t-other", tower: { id: "tw1", name: "Tower One" } },
    ]));
    const w = await mountView();
    const rows = w.findAll(".blocked-table .blocked-row");
    expect(rows).toHaveLength(3);
    expect(rows[2].text()).toContain("3F");
    expect(rows[2].text()).toContain("Held by a deal outside your view");
    expect(rows[2].text()).not.toContain("No holder");
    expect(rows[2].find(".release-btn").exists()).toBe(false);
    // the other two rows keep their Release buttons
    expect(rows[0].find(".release-btn").exists()).toBe(true);
    expect(rows[1].find(".release-btn").exists()).toBe(true);
    expect(leasingTransactions.unblockUnit).not.toHaveBeenCalled();
    expect(units.releaseBlock).not.toHaveBeenCalled();
  });

  it("asks for approved vacant units only, so an unapproved unit gets no Block button", async () => {
    const w = await mountView();
    expect(units.list).toHaveBeenCalledWith({ status: "VACANT", approvalStatus: "APPROVED" });
    // t-unapproved (LT-008) has an open deal on unit 7F, which is vacant but SUBMITTED
    const text = w.find(".ready-table").text();
    expect(text).not.toContain("LT-008");
    expect(text).not.toContain("7F");
    expect(w.findAll(".ready-row").find((r) => r.text().includes("LT-008"))).toBeUndefined();
    expect(w.findAll(".block-btn")).toHaveLength(2);
  });

  it("shows only the error, not the empty-state text, when the first load fails", async () => {
    units.list.mockImplementationOnce(() => Promise.reject({ response: { data: { error: "Blocking is unavailable" } } }));
    const w = await mountView();
    expect(w.find(".error").text()).toBe("Blocking is unavailable");
    expect(w.text()).not.toContain("No units are blocked.");
    expect(w.text()).not.toContain("No deals are ready to block.");
    expect(w.find("table").exists()).toBe(false);
  });
});
