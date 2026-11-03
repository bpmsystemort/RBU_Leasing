import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  appointments: {
    forTransaction: vi.fn(() => Promise.resolve([])),
    confirm: vi.fn(() => Promise.resolve({})),
    propose: vi.fn(() => Promise.resolve({})),
  },
}));

import ViewingConfirmPanel from "../src/components/ViewingConfirmPanel.vue";
import { appointments } from "../src/lib/resource.js";

const mountFor = (txn) => mount(ViewingConfirmPanel, { props: { transaction: txn } });

describe("ViewingConfirmPanel (lessor)", () => {
  beforeEach(() => { appointments.forTransaction.mockReset(); appointments.confirm.mockClear(); appointments.propose.mockClear(); });

  it("shows Confirm + Propose when the officer proposed a time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    const confirmBtn = w.findAll("button").find((b) => /confirm/i.test(b.text()));
    expect(confirmBtn).toBeTruthy();
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(appointments.confirm).toHaveBeenCalledWith("a1");
  });

  it("lets the lessor propose another time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    await w.findAll("button").find((b) => /propose another/i.test(b.text())).trigger("click");
    await w.find('input[type="datetime-local"]').setValue("2026-10-22T09:00");
    await w.findAll("button").find((b) => /send/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(appointments.propose).toHaveBeenCalledWith("a1", expect.objectContaining({ scheduledAt: expect.any(String) }));
  });

  it("says it's awaiting the officer when the lessor already proposed", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "UNIT_OWNER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    expect(w.text()).toMatch(/awaiting/i);
    expect(w.findAll("button").find((b) => /^confirm$/i.test(b.text()))).toBeFalsy();
  });

  it("shows the confirmed message and no Confirm button when the appointment is confirmed", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Confirmed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    expect(w.text()).toMatch(/confirmed/i);
    expect(w.findAll("button").find((b) => /^confirm$/i.test(b.text()))).toBeFalsy();
  });

  it("renders nothing when the transaction is not at the viewing stage", async () => {
    const w = mountFor({ id: "t1", stage: "APPROVAL" });
    await flushPromises();
    expect(appointments.forTransaction).not.toHaveBeenCalled();
    expect(w.text()).toBe("");
  });
});
