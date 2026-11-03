import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
vi.mock("../src/lib/resource.js", () => ({
  appointments: {
    forTransaction: vi.fn(() => Promise.resolve([])),
    schedule: vi.fn(() => Promise.resolve({ id: "a1", stage: "UNIT_INSPECTION", status: "Scheduled", scheduledAt: "2026-09-01T09:00:00.000Z" })),
    confirm: vi.fn(() => Promise.resolve({})),
    propose: vi.fn(() => Promise.resolve({})),
    reschedule: vi.fn(), complete: vi.fn(() => Promise.resolve({})), cancel: vi.fn(),
  },
}));
import SchedulingPanel from "../src/components/SchedulingPanel.vue";
import { appointments } from "../src/lib/resource.js";

const txn = { id: "t1", stage: "UNIT_INSPECTION", status: "Pending" };

describe("SchedulingPanel", () => {
  it("shows a schedule form for the current schedulable stage and schedules", async () => {
    const w = mount(SchedulingPanel, { props: { transaction: txn } });
    await flushPromises();
    const dt = w.find('input[type="datetime-local"]');
    expect(dt.exists()).toBe(true);
    await dt.setValue("2026-09-01T09:00");
    await w.findAll("button").find((b) => /schedule/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(appointments.schedule).toHaveBeenCalledWith("t1", "UNIT_INSPECTION", expect.objectContaining({ scheduledAt: expect.any(String) }));
  });

  it("renders an existing appointment with Complete showing inspection outcomes", async () => {
    appointments.forTransaction.mockResolvedValueOnce([{ id: "a1", stage: "UNIT_INSPECTION", status: "Scheduled", scheduledAt: "2026-09-01T09:00:00.000Z" }]);
    const w = mount(SchedulingPanel, { props: { transaction: txn } });
    await flushPromises();
    expect(w.text()).toContain("Scheduled");
    // outcome select present for inspection
    expect(w.find("select").exists()).toBe(true);
  });

  it("reopens the schedule form after a Cancelled appointment, while noting the prior status", async () => {
    appointments.forTransaction.mockResolvedValueOnce([
      { id: "a1", stage: "UNIT_INSPECTION", status: "Cancelled", scheduledAt: "2026-09-01T09:00:00.000Z", reason: "x" },
    ]);
    const w = mount(SchedulingPanel, { props: { transaction: txn } });
    await flushPromises();
    expect(w.find('input[type="datetime-local"]').exists()).toBe(true);
    expect(w.text()).toContain("Cancelled");
  });
});

describe("SchedulingPanel — Unit Viewing", () => {
  // Shadows the outer file's plain-object `txn` for this block only, so
  // neither existing test block needs to change.
  const txn = (over = {}) => ({ id: "t1", stage: "UNIT_VIEWING", status: "Pending", ...over });

  beforeEach(() => { Object.values(appointments).forEach((f) => f.mockClear?.()); appointments.forTransaction.mockResolvedValue([]); });

  it("proposes a viewing time (not 'schedule')", async () => {
    const w = mount(SchedulingPanel, { props: { transaction: txn() } });
    await flushPromises();
    await w.find('input[type="datetime-local"]').setValue("2026-10-20T12:00");
    await w.findAll("button").find((b) => /propose/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(appointments.schedule).toHaveBeenCalledWith("t1", "UNIT_VIEWING", expect.objectContaining({ scheduledAt: expect.any(String) }));
  });

  it("shows a Confirm action when the lessor proposed a time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "UNIT_OWNER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mount(SchedulingPanel, { props: { transaction: txn({ status: "Proposed" }) } });
    await flushPromises();
    const confirmBtn = w.findAll("button").find((b) => /^confirm$/i.test(b.text()));
    expect(confirmBtn).toBeTruthy();
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(appointments.confirm).toHaveBeenCalledWith("a1");
  });

  it("offers the viewing outcomes when confirmed", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Confirmed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mount(SchedulingPanel, { props: { transaction: txn({ status: "Confirmed" }) } });
    await flushPromises();
    const opts = w.find("select").findAll("option").map((o) => o.text());
    expect(opts).toEqual(expect.arrayContaining(["Interested", "Not Interested", "No-show"]));
  });
});
