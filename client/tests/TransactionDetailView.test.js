import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";

const baseTxn = {
  id: "t1", reference: "RBU-2026-000001", stage: "SEND_REQUIREMENTS", status: "Pending",
  finalStatus: null, stageData: { SEND_REQUIREMENTS: { status: "Pending", startedAt: "2026-08-24T00:00:00Z" } },
  lesseeName: "Maria Santos", unit: null, tenant: null, unitOwner: null,
  assignedOfficer: { id: "o1", name: "Officer Jane" }, inquiry: { fullName: "Maria Santos", inquiryType: "Unit Availability" },
  createdAt: "2026-08-24T00:00:00Z", updatedAt: "2026-08-24T00:00:00Z", events: [{ id: "e1", message: "Inquiry accepted", createdAt: "2026-08-24T00:00:00Z", actorName: "Officer Jane" }],
};

vi.mock("../src/lib/resource.js", () => ({
  leasingTransactions: {
    get: vi.fn(() => Promise.resolve(baseTxn)),
    advance: vi.fn(() => Promise.resolve({ ...baseTxn, stage: "APPROVAL", status: "Pending Submission", stageData: { ...baseTxn.stageData, APPROVAL: { status: "Pending Submission" } } })),
    setStatus: vi.fn(() => Promise.resolve(baseTxn)),
    returnStage: vi.fn(() => Promise.resolve(baseTxn)),
    link: vi.fn(() => Promise.resolve(baseTxn)),
  },
  units: { list: vi.fn(() => Promise.resolve([])) },
  tenants: { list: vi.fn(() => Promise.resolve([])) },
  owners: { list: vi.fn(() => Promise.resolve([])) },
  appointments: {
    forTransaction: vi.fn(() => Promise.resolve([])),
    schedule: vi.fn(() => Promise.resolve({})),
    reschedule: vi.fn(() => Promise.resolve({})),
    complete: vi.fn(() => Promise.resolve({})),
    cancel: vi.fn(() => Promise.resolve({})),
  },
}));

import TransactionDetailView from "../src/views/TransactionDetailView.vue";
import { leasingTransactions } from "../src/lib/resource.js";

const stub = { template: "<div/>" };
async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/app/transactions", component: stub },
    { path: "/app/transactions/:id", component: TransactionDetailView },
  ]});
  router.push("/app/transactions/t1");
  await router.isReady();
  const w = mount(TransactionDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

// mountView() always serves baseTxn; these cases need to vary it.
async function mountWith(over) {
  leasingTransactions.get.mockResolvedValue({ ...baseTxn, ...over });
  return mountView();
}

describe("TransactionDetailView", () => {
  beforeEach(() => {
    leasingTransactions.get.mockClear(); leasingTransactions.advance.mockClear();
    leasingTransactions.setStatus.mockClear(); leasingTransactions.link.mockClear();
  });

  // `busy` is a string ("" at rest). Vue treats "" as TRUE for a boolean attribute,
  // so a bare :disabled="busy" left these two buttons permanently greyed out and
  // no Lessee could ever be linked to a deal on screen.
  const button = (w, label) => w.findAll("button").find((b) => b.text() === label);

  it("leaves Save status and Save links usable when nothing is running", async () => {
    const w = await mountWith({});
    expect(button(w, "Save status").attributes("disabled")).toBeUndefined();
    expect(button(w, "Save links").attributes("disabled")).toBeUndefined();
    expect(button(w, "Save status").element.disabled).toBe(false);
    expect(button(w, "Save links").element.disabled).toBe(false);
  });

  it("saves the links when Save links is pressed", async () => {
    const w = await mountWith({});
    await button(w, "Save links").trigger("click");
    await flushPromises();
    expect(leasingTransactions.link).toHaveBeenCalledWith("t1", { unitId: null, tenantId: null, unitOwnerId: null });
  });

  it("saves the status when Save status is pressed", async () => {
    const w = await mountWith({});
    await button(w, "Save status").trigger("click");
    await flushPromises();
    expect(leasingTransactions.setStatus).toHaveBeenCalledWith("t1", { status: "Pending", remarks: "" });
  });

  it("locks every action button while one request is running, then frees them", async () => {
    let finish;
    leasingTransactions.advance.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const w = await mountWith({});
    await w.findAll("button").find((b) => b.text().includes("Advance to")).trigger("click");
    expect(button(w, "Save links").element.disabled).toBe(true);
    expect(button(w, "Save status").element.disabled).toBe(true);
    finish({ ...baseTxn, stage: "APPROVAL", status: "Pending Submission", stageData: { ...baseTxn.stageData, APPROVAL: { status: "Pending Submission" } } });
    await flushPromises();
    expect(button(w, "Save links").element.disabled).toBe(false);
    expect(button(w, "Save status").element.disabled).toBe(false);
  });

  it("renders the tracker, reference, current stage and activity", async () => {
    const w = await mountView();
    expect(w.text()).toContain("RBU-2026-000001");
    expect(w.find(".stage-name").text()).toBe("Send Requirements");
    expect(w.findAll(".ms")).toHaveLength(7); // delivery-tracker milestones
    expect(w.text()).toContain("Inquiry accepted");
  });

  it("advances to the next stage and reflects it", async () => {
    const w = await mountView();
    const advBtn = w.findAll("button").find((b) => b.text().includes("Advance to"));
    expect(advBtn.text()).toContain("Approval");
    await advBtn.trigger("click");
    await flushPromises();
    expect(leasingTransactions.advance).toHaveBeenCalledWith("t1", { remarks: "" });
    expect(w.find(".stage-name").text()).toBe("Approval");
  });

  // Reaching Contract Signing needs a prospect and an LOI. Say which is missing
  // rather than letting the officer click Advance into a 409.
  it("names what is blocking the advance out of Photoshoot", async () => {
    const w = await mountWith({ stage: "PHOTOSHOOT", status: "Awaiting Prospect", tenantId: null, documents: [] });
    expect(w.find(".blockers").text()).toContain("Link a prospect tenant");
    expect(w.find(".blockers").text()).toContain("Upload the Letter of Intent");
  });

  it("drops a blocker once it is satisfied", async () => {
    const w = await mountWith({ stage: "PHOTOSHOOT", status: "Completed", tenantId: "t1", documents: [] });
    expect(w.find(".blockers").text()).not.toContain("Link a prospect tenant");
    expect(w.find(".blockers").text()).toContain("Upload the Letter of Intent");
  });

  it("shows no blockers once both are in place", async () => {
    const w = await mountWith({
      stage: "PHOTOSHOOT", status: "Completed", tenantId: "t1",
      documents: [{ id: "d1", filename: "loi.pdf", size: 10, docType: "LETTER_OF_INTENT" }],
    });
    expect(w.find(".blockers").exists()).toBe(false);
  });

  it("shows no blockers at any other stage", async () => {
    const w = await mountWith({ stage: "APPROVAL", status: "Submitted", tenantId: null, documents: [] });
    expect(w.find(".blockers").exists()).toBe(false);
  });
});
