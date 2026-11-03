import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

const UNITS = [
  { id: "u1", unitNumber: "12A", approvalStatus: "APPROVED", tower: { id: "t1", name: "Tower One" },
    owner: { id: "o1", name: "Ana Owner", needsReview: true } },
  { id: "u2", unitNumber: "7B", approvalStatus: "SUBMITTED", tower: { id: "t2", name: "Tower Two" },
    owner: { id: "o2", name: "Ben Owner", needsReview: false } },
];
const OWNERS = [
  { id: "o1", name: "Ana Owner" },
  { id: "o2", name: "Ben Owner" },
  { id: "o3", name: "Cara Owner" },
];
const HISTORY = [
  { id: "h1", createdAt: "2026-10-15T00:00:00.000Z", reason: "Merged records", actorName: "Admin A",
    fromOwner: { id: "o2", name: "Ben Owner" }, toOwner: { id: "o1", name: "Ana Owner" } },
];

vi.mock("../src/lib/resource.js", () => ({
  units: {
    list: vi.fn(() => Promise.resolve(UNITS)),
    assignOwner: vi.fn(() => Promise.resolve({})),
    assignments: vi.fn((id) => Promise.resolve(id === "u1" ? HISTORY : [])),
  },
  owners: {
    linkable: vi.fn(() => Promise.resolve(OWNERS)),
  },
}));

import UnitOwnerAssignmentsView from "../src/views/UnitOwnerAssignmentsView.vue";
import { units, owners } from "../src/lib/resource.js";
import { useAuthStore } from "../src/stores/auth.js";

async function mountView(query = "") {
  setActivePinia(createPinia());
  useAuthStore().setSession({ token: "t", user: { role: "ADMIN" } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/app/unit-assignments", component: UnitOwnerAssignmentsView }],
  });
  router.push(`/app/unit-assignments${query}`);
  await router.isReady();
  const w = mount(UnitOwnerAssignmentsView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}
const rowFor = (w, unitNumber) => w.findAll(".unit-row").find((r) => r.text().includes(unitNumber));
async function openReassign(w, unitNumber) {
  await rowFor(w, unitNumber).find(".reassign-btn").trigger("click");
  await flushPromises();
}
// SearchableSelect: open the dropdown, then pick an option by its label.
async function pickOwner(w, label) {
  await w.find(".reassign-dialog .ss__btn").trigger("click");
  await w.findAll(".reassign-dialog .ss__opt").find((b) => b.text() === label).trigger("click");
  await flushPromises();
}

describe("UnitOwnerAssignmentsView", () => {
  beforeEach(() => {
    units.list.mockClear();
    units.assignOwner.mockClear();
    units.assignOwner.mockResolvedValue({});
    units.assignments.mockClear();
    owners.linkable.mockClear();
  });

  it("shows each unit with its owner and verification badges", async () => {
    const w = await mountView();
    const rows = w.findAll(".unit-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("12A");
    expect(rows[0].text()).toContain("Tower One");
    expect(rows[0].text()).toContain("Ana Owner");
    expect(rows[0].find(".owner-review").text()).toBe("Owner needs review");
    expect(rows[0].find(".approval").text()).toBe("Approved");
    expect(rows[1].text()).toContain("Ben Owner");
    expect(rows[1].find(".owner-review").exists()).toBe(false);
    expect(rows[1].find(".approval").text()).toBe("Submitted");
  });

  it("needs an owner before the reassignment can be confirmed", async () => {
    const w = await mountView();
    expect(w.find(".reassign-dialog").exists()).toBe(false);
    await openReassign(w, "12A");
    expect(w.find(".reassign-dialog").exists()).toBe(true);
    const confirm = w.find(".confirm-btn");
    expect(confirm.element.disabled).toBe(true);
    await confirm.trigger("click");
    expect(units.assignOwner).not.toHaveBeenCalled();
  });

  it("offers every owner except the unit's current one", async () => {
    const w = await mountView();
    await openReassign(w, "12A");
    await w.find(".reassign-dialog .ss__btn").trigger("click");
    const labels = w.findAll(".reassign-dialog .ss__opt").map((b) => b.text());
    expect(labels).toContain("Ben Owner");
    expect(labels).toContain("Cara Owner");
    expect(labels).not.toContain("Ana Owner");
  });

  it("sends the chosen owner and reason, then reloads the units", async () => {
    const w = await mountView();
    await openReassign(w, "12A");
    await pickOwner(w, "Cara Owner");
    await w.find("#reassign-reason").setValue("  Estate settled  ");
    const confirm = w.find(".confirm-btn");
    expect(confirm.element.disabled).toBe(false);
    await confirm.trigger("click");
    await flushPromises();
    expect(units.assignOwner).toHaveBeenCalledWith("u1", { toOwnerId: "o3", reason: "Estate settled" });
    expect(units.list).toHaveBeenCalledTimes(2); // mount + reload
    expect(w.find(".reassign-dialog").exists()).toBe(false);
  });

  it("sends a null reason when none is given", async () => {
    const w = await mountView();
    await openReassign(w, "7B");
    await pickOwner(w, "Ana Owner");
    await w.find(".confirm-btn").trigger("click");
    await flushPromises();
    expect(units.assignOwner).toHaveBeenCalledWith("u2", { toOwnerId: "o1", reason: null });
  });

  it("shows the server's error and keeps the dialog open when the reassignment is refused", async () => {
    units.assignOwner.mockRejectedValueOnce({ response: { data: { error: "Cara Owner already has a unit with the same unit key" } } });
    const w = await mountView();
    await openReassign(w, "12A");
    await pickOwner(w, "Cara Owner");
    await w.find(".confirm-btn").trigger("click");
    await flushPromises();
    expect(w.find(".reassign-dialog .error").text()).toContain("already has a unit with the same unit key");
    expect(w.find(".reassign-dialog").exists()).toBe(true);
    expect(units.list).toHaveBeenCalledTimes(1); // no reload on failure
  });

  it("closes the dialog on Cancel without changing anything", async () => {
    const w = await mountView();
    await openReassign(w, "12A");
    await w.find(".cancel-btn").trigger("click");
    expect(w.find(".reassign-dialog").exists()).toBe(false);
    expect(units.assignOwner).not.toHaveBeenCalled();
  });

  it("renders a unit's assignment history", async () => {
    const w = await mountView();
    await rowFor(w, "12A").find(".history-btn").trigger("click");
    await flushPromises();
    expect(units.assignments).toHaveBeenCalledWith("u1");
    const rows = w.findAll(".history-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("October 15, 2026");
    expect(rows[0].text()).toContain("Ben Owner → Ana Owner");
    expect(rows[0].text()).toContain("Admin A");
    expect(rows[0].text()).toContain("Merged records");
  });

  it("says so when a unit has no assignments, and toggles the history closed", async () => {
    const w = await mountView();
    await rowFor(w, "7B").find(".history-btn").trigger("click");
    await flushPromises();
    expect(w.find(".history-empty").text()).toBe("No assignments yet.");
    await rowFor(w, "7B").find(".history-btn").trigger("click");
    expect(w.find(".history").exists()).toBe(false);
  });

  it("opens the reassign dialog for the unit named in ?unit=", async () => {
    const w = await mountView("?unit=u2");
    const dialog = w.find(".reassign-dialog");
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain("7B");
    expect(dialog.text()).toContain("Ben Owner");
  });

  it("opens no dialog when ?unit= names an unknown unit", async () => {
    const w = await mountView("?unit=nope");
    expect(w.find(".reassign-dialog").exists()).toBe(false);
  });
});
