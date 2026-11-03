import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../src/lib/resource.js", () => ({
  units: {
    list: vi.fn(() => Promise.resolve([
      { id: "u1", unitNumber: "12A", baseRent: "45000", status: "VACANT", needsStatusReview: true,
        tower: { id: "t1", name: "Tower One", estate: { id: "e1", name: "Estate Alpha" } } },
      { id: "u2", unitNumber: "7B", baseRent: "30000", status: "OCCUPIED", needsStatusReview: false,
        tower: { id: "t2", name: "Tower Two", estate: { id: "e2", name: "Estate Beta" } } },
    ])),
    remove: vi.fn(() => Promise.resolve()),
    setUnavailable: vi.fn(() => Promise.resolve()),
    restore: vi.fn(() => Promise.resolve()),
    releaseBlock: vi.fn(() => Promise.resolve()),
    markReviewed: vi.fn(() => Promise.resolve({})),
  },
  estates: {
    list: vi.fn(() => Promise.resolve([
      { id: "e1", name: "Estate Alpha", towers: [{ id: "t1", name: "Tower One" }] },
      { id: "e2", name: "Estate Beta", towers: [{ id: "t2", name: "Tower Two" }] },
    ])),
  },
}));

import UnitsView from "../src/views/UnitsView.vue";
import { units } from "../src/lib/resource.js";
import { useAuthStore } from "../src/stores/auth.js";

const stub = { template: "<div/>" };
function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [
    { path: "/units", component: UnitsView },
    { path: "/units/new", component: stub },
    { path: "/units/:id", component: stub },
    { path: "/app/unit-assignments", component: stub },
  ]});
}
async function mountView(role) {
  setActivePinia(createPinia());
  if (role) useAuthStore().setSession({ token: "t", user: { role } });
  const router = makeRouter(); router.push("/units"); await router.isReady();
  const w = mount(UnitsView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("UnitsView", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows a single table with Estate and Tower columns", async () => {
    const w = await mountView("VIEWER");
    const headers = w.findAll("th").map((h) => h.text());
    expect(headers).toContain("Estate");
    expect(headers).toContain("Tower");
    // both estates' units are consolidated into one table
    expect(w.findAll("table").length).toBe(1);
    expect(w.text()).toContain("12A");
    expect(w.text()).toContain("Estate Alpha");
    expect(w.text()).toContain("Tower One");
    expect(w.text()).toContain("7B");
    expect(w.text()).toContain("Estate Beta");
  });

  it("formats rent as PHP", async () => {
    const w = await mountView("VIEWER");
    expect(w.text()).toContain("45,000");
  });

  it("filters the table by a selected estate (multi-select)", async () => {
    const w = await mountView("VIEWER");
    const estateBtn = w.findAll(".ms__btn").find((b) => b.text().includes("Estate:"));
    await estateBtn.trigger("click");
    const alpha = w.findAll(".ms__opt").find((l) => l.text() === "Estate Alpha");
    await alpha.find("input").setValue(true);
    await flushPromises();
    const bodyText = w.find("tbody").text();
    expect(bodyText).toContain("12A");
    expect(bodyText).not.toContain("7B");
  });

  it("shows a Needs status review badge only on the flagged unit", async () => {
    const w = await mountView("VIEWER");
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].find(".review-tag").text()).toBe("Needs status review"); // 12A
    expect(rows[1].find(".review-tag").exists()).toBe(false); // 7B — not flagged
  });

  it("narrows the table to flagged units via the filter checkbox", async () => {
    const w = await mountView("VIEWER");
    expect(w.findAll("tbody tr")).toHaveLength(2);
    await w.find(".flag-filter input").setValue(true);
    await flushPromises();
    const bodyText = w.find("tbody").text();
    expect(bodyText).toContain("12A");
    expect(bodyText).not.toContain("7B");
  });

  it("shows write controls for the Super Admin", async () => {
    const w = await mountView("ADMIN");
    expect(w.text()).toContain("New unit");
  });
  it("is read-only for a non-admin (even a write role)", async () => {
    const w = await mountView("LEASING_OFFICER");
    expect(w.text()).not.toContain("New unit");
  });
});

// ---- Units console: search, filters, sorting, paging, badges, availability ----
function mkUnit(i, over = {}) {
  return {
    id: `p${i}`,
    unitNumber: `U${String(i).padStart(2, "0")}`,
    baseRent: String(1000 * i),
    type: "Studio",
    status: "VACANT",
    approvalStatus: "APPROVED",
    needsStatusReview: false,
    owner: { id: "o1", name: "Owner One" },
    tower: { id: "t1", name: "Tower One", estate: { id: "e1", name: "Estate Alpha" } },
    ...over,
  };
}
// 30 units: U01-U27 VACANT, U28-U30 BLOCKED.
const thirty = () => Array.from({ length: 30 }, (_, k) => mkUnit(k + 1, k >= 27 ? { status: "BLOCKED" } : {}));

async function mountWith(role, rows) {
  units.list.mockImplementationOnce(() => Promise.resolve(rows));
  return mountView(role);
}
// First cell of each body row is the unit number.
const unitOrder = (w) => w.findAll("tbody tr").map((r) => r.findAll("td")[0].text());
const headerButton = (w, label) => w.findAll("th .th-sort").find((b) => b.text().startsWith(label));

describe("UnitsView console", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    units.setUnavailable.mockClear();
    units.restore.mockClear();
    units.releaseBlock.mockClear();
    units.markReviewed.mockClear();
  });

  it("search narrows rows by unit number, owner name and tower name, case-insensitively", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { unitNumber: "101", owner: { id: "o1", name: "Maria Santos" }, tower: { id: "t1", name: "Alpha Tower", estate: { id: "e1", name: "Estate Alpha" } } }),
      mkUnit(2, { unitNumber: "202", owner: { id: "o2", name: "Juan Cruz" }, tower: { id: "t2", name: "Beta Tower", estate: { id: "e2", name: "Estate Beta" } } }),
      mkUnit(3, { unitNumber: "303", owner: { id: "o3", name: "Ana Reyes" }, tower: { id: "t2", name: "Beta Tower", estate: { id: "e2", name: "Estate Beta" } } }),
    ]);
    expect(unitOrder(w)).toEqual(["101", "202", "303"]);

    await w.find(".search").setValue("MARIA");
    expect(unitOrder(w)).toEqual(["101"]);

    await w.find(".search").setValue("beta");
    expect(unitOrder(w)).toEqual(["202", "303"]);

    await w.find(".search").setValue("202");
    expect(unitOrder(w)).toEqual(["202"]);

    await w.find(".search").setValue("no such thing");
    expect(w.find("tbody").text()).toContain("No records.");
  });

  it("filters by unit status and by approval status", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { unitNumber: "V1", status: "VACANT", approvalStatus: "APPROVED" }),
      mkUnit(2, { unitNumber: "B1", status: "BLOCKED", approvalStatus: "DRAFT" }),
      mkUnit(3, { unitNumber: "O1", status: "OCCUPIED", approvalStatus: "SUBMITTED" }),
      mkUnit(4, { unitNumber: "N1", status: "UNAVAILABLE", approvalStatus: "REJECTED" }),
    ]);
    expect(unitOrder(w)).toEqual(["V1", "B1", "O1", "N1"]);

    await w.find(".status-filter").setValue("BLOCKED");
    expect(unitOrder(w)).toEqual(["B1"]);
    await w.find(".status-filter").setValue("UNAVAILABLE");
    expect(unitOrder(w)).toEqual(["N1"]);
    await w.find(".status-filter").setValue("ALL");
    expect(unitOrder(w)).toEqual(["V1", "B1", "O1", "N1"]);

    await w.find(".approval-filter").setValue("SUBMITTED");
    expect(unitOrder(w)).toEqual(["O1"]);
    await w.find(".approval-filter").setValue("REJECTED");
    expect(unitOrder(w)).toEqual(["N1"]);

    // the two filters combine
    await w.find(".approval-filter").setValue("DRAFT");
    await w.find(".status-filter").setValue("VACANT");
    expect(w.find("tbody").text()).toContain("No records.");
  });

  it("renders a status badge with the right text for each state", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { status: "VACANT" }),
      mkUnit(2, { status: "BLOCKED" }),
      mkUnit(3, { status: "OCCUPIED" }),
      mkUnit(4, { status: "UNAVAILABLE" }),
    ]);
    const badges = w.findAll("tbody .unit-status");
    expect(badges.map((b) => b.text())).toEqual(["Vacant", "Blocked", "Occupied", "Unavailable"]);
    expect(badges.map((b) => b.attributes("data-status"))).toEqual(["VACANT", "BLOCKED", "OCCUPIED", "UNAVAILABLE"]);
  });

  it("toggles sort order when a sortable header is clicked", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { unitNumber: "20", baseRent: "900" }),
      mkUnit(2, { unitNumber: "3", baseRent: "15000" }),
      mkUnit(3, { unitNumber: "100", baseRent: "2500" }),
    ]);
    expect(unitOrder(w)).toEqual(["20", "3", "100"]); // server order until a sort is chosen

    await headerButton(w, "Unit #").trigger("click");
    expect(unitOrder(w)).toEqual(["3", "20", "100"]); // natural (numeric-aware) ascending
    expect(w.find("th .sort-arrow").text()).toBe("▲");
    expect(headerButton(w, "Unit #").element.closest("th").getAttribute("aria-sort")).toBe("ascending");

    await headerButton(w, "Unit #").trigger("click");
    expect(unitOrder(w)).toEqual(["100", "20", "3"]);
    expect(w.find("th .sort-arrow").text()).toBe("▼");
    expect(headerButton(w, "Unit #").element.closest("th").getAttribute("aria-sort")).toBe("descending");

    // rent sorts numerically (a text sort would put 15000 first), and a new key starts ascending
    await headerButton(w, "Monthly Rent").trigger("click");
    expect(unitOrder(w)).toEqual(["20", "100", "3"]);
    expect(w.findAll("th .sort-arrow")).toHaveLength(1);
    await headerButton(w, "Monthly Rent").trigger("click");
    expect(unitOrder(w)).toEqual(["3", "100", "20"]);
  });

  it("sorts by owner, tower, type and status", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { unitNumber: "A", owner: { id: "o1", name: "Zed" }, type: "Studio", status: "VACANT", tower: { id: "t9", name: "Tower C", estate: { id: "e1", name: "Estate Alpha" } } }),
      mkUnit(2, { unitNumber: "B", owner: { id: "o2", name: "amy" }, type: "1BR", status: "OCCUPIED", tower: { id: "t8", name: "Tower A", estate: { id: "e1", name: "Estate Alpha" } } }),
      mkUnit(3, { unitNumber: "C", owner: { id: "o3", name: "Bob" }, type: "2BR", status: "BLOCKED", tower: { id: "t7", name: "Tower B", estate: { id: "e1", name: "Estate Alpha" } } }),
    ]);
    await headerButton(w, "Owner").trigger("click");
    expect(unitOrder(w)).toEqual(["B", "C", "A"]); // amy, Bob, Zed (case-insensitive)
    await headerButton(w, "Tower").trigger("click");
    expect(unitOrder(w)).toEqual(["B", "C", "A"]); // Tower A, B, C
    await headerButton(w, "Type").trigger("click");
    expect(unitOrder(w)).toEqual(["B", "C", "A"]); // 1BR, 2BR, Studio
    await headerButton(w, "Status").trigger("click");
    expect(unitOrder(w)).toEqual(["C", "B", "A"]); // BLOCKED, OCCUPIED, VACANT
  });

  it("paginates 25 per page and resets to page 1 when a filter changes", async () => {
    const w = await mountWith("VIEWER", thirty());
    expect(w.findAll("tbody tr")).toHaveLength(25);
    expect(w.find(".pager__info").text()).toBe("Page 1 of 2");
    expect(w.find(".pager__prev").element.disabled).toBe(true);

    await w.find(".pager__next").trigger("click");
    expect(w.findAll("tbody tr")).toHaveLength(5);
    expect(unitOrder(w)[0]).toBe("U26");
    expect(w.find(".pager__info").text()).toBe("Page 2 of 2");
    expect(w.find(".pager__next").element.disabled).toBe(true);

    await w.find(".pager__prev").trigger("click");
    expect(w.find(".pager__info").text()).toBe("Page 1 of 2");

    // go to page 2, then change a filter that still leaves two pages (27 vacant units)
    await w.find(".pager__next").trigger("click");
    expect(w.find(".pager__info").text()).toBe("Page 2 of 2");
    await w.find(".status-filter").setValue("VACANT");
    expect(w.find(".pager__info").text()).toBe("Page 1 of 2");
    expect(w.findAll("tbody tr")).toHaveLength(25);
    expect(unitOrder(w)[0]).toBe("U01");
  });

  it("shows availability buttons per status to a leasing officer, without Edit/Delete", async () => {
    const w = await mountWith("LEASING_OFFICER", [
      mkUnit(1, { status: "VACANT" }),
      mkUnit(2, { status: "UNAVAILABLE" }),
      mkUnit(3, { status: "BLOCKED" }),
      mkUnit(4, { status: "OCCUPIED" }),
    ]);
    const rows = w.findAll("tbody tr");
    expect(rows[0].findAll("button").map((b) => b.text())).toEqual(["Set unavailable"]);
    expect(rows[1].findAll("button").map((b) => b.text())).toEqual(["Restore"]);
    expect(rows[2].findAll("button").map((b) => b.text())).toEqual(["Release block"]);
    expect(rows[3].findAll("button")).toHaveLength(0);

    const headers = w.findAll("th").map((h) => h.text());
    expect(headers).toContain("Availability");
    expect(headers).not.toContain("Actions");
    expect(w.find("tbody").text()).not.toContain("Edit");
    expect(w.find("tbody").text()).not.toContain("Delete");
    expect(w.find(".avail-reassign").exists()).toBe(false); // reassigning is ADMIN-only
  });

  it("Set unavailable, Restore and Release block call the client with the unit id and reload the list", async () => {
    const rows = [
      mkUnit(1, { status: "VACANT" }),
      mkUnit(2, { status: "UNAVAILABLE" }),
      mkUnit(3, { status: "BLOCKED" }),
    ];
    // Queue the list for the three reloads that follow; mountWith queues the initial load.
    for (let i = 0; i < 3; i++) units.list.mockImplementationOnce(() => Promise.resolve(rows));
    const w = await mountWith("LEASING_OFFICER", rows);
    const clickAction = async (text) => {
      const before = units.list.mock.calls.length;
      await w.findAll("tbody button").find((b) => b.text() === text).trigger("click");
      await flushPromises();
      expect(units.list.mock.calls.length).toBe(before + 1);
    };

    await clickAction("Set unavailable");
    expect(units.setUnavailable).toHaveBeenCalledWith("p1");
    await clickAction("Restore");
    expect(units.restore).toHaveBeenCalledWith("p2");
    await clickAction("Release block");
    expect(units.releaseBlock).toHaveBeenCalledWith("p3");
  });

  it("shows the server's error text when an availability call is rejected", async () => {
    const w = await mountWith("LEASING_OFFICER", [mkUnit(3, { status: "BLOCKED" })]);
    units.releaseBlock.mockImplementationOnce(() =>
      Promise.reject({ response: { data: { error: "Unit is held by an active deal" } } }),
    );
    const before = units.list.mock.calls.length;
    await w.find("tbody button").trigger("click");
    await flushPromises();
    expect(w.find(".action-error").text()).toBe("Unit is held by an active deal");
    expect(units.list.mock.calls.length).toBe(before); // nothing changed, so no reload
  });

  it("shows an inline error when the unit list cannot be loaded", async () => {
    units.list.mockImplementationOnce(() => Promise.reject({ response: { data: { error: "Units are unavailable" } } }));
    const w = await mountView("VIEWER");
    expect(w.find(".error").text()).toBe("Units are unavailable");
  });

  it("gives a read-only viewer no availability buttons or column", async () => {
    const w = await mountWith("VIEWER", [
      mkUnit(1, { status: "VACANT" }),
      mkUnit(2, { status: "UNAVAILABLE" }),
      mkUnit(3, { status: "BLOCKED" }),
    ]);
    expect(w.findAll("tbody button")).toHaveLength(0);
    expect(w.findAll("th").map((h) => h.text())).not.toContain("Availability");
    expect(w.find(".avail-reassign").exists()).toBe(false);
  });

  it("gives the Super Admin Reassign owner links, availability buttons and Edit/Delete", async () => {
    const w = await mountWith("ADMIN", [mkUnit(1, { status: "VACANT" }), mkUnit(2, { status: "OCCUPIED" })]);
    const links = w.findAll(".avail-reassign");
    expect(links).toHaveLength(2);
    expect(links[0].text()).toBe("Reassign owner");
    expect(links[0].attributes("href")).toBe("/app/unit-assignments?unit=p1");
    expect(links[1].attributes("href")).toBe("/app/unit-assignments?unit=p2");

    const firstRowButtons = w.findAll("tbody tr")[0].findAll("button").map((b) => b.text());
    expect(firstRowButtons).toEqual(["Set unavailable", "Edit", "Delete"]);
    expect(w.findAll("th").map((h) => h.text())).toContain("Actions");
  });

  it("offers Release block only for a holderless block; a block held by a deal says so instead", async () => {
    const w = await mountWith("LEASING_OFFICER", [
      mkUnit(1, { status: "BLOCKED", blockedByTransactionId: null }),
      mkUnit(2, { status: "BLOCKED", blockedByTransactionId: "t-1" }),
    ]);
    const rows = w.findAll("tbody tr");
    expect(rows[0].findAll("button").map((b) => b.text())).toEqual(["Release block"]);
    expect(rows[0].find(".avail-held").exists()).toBe(false);
    expect(rows[1].findAll("button")).toHaveLength(0);
    expect(rows[1].find(".avail-held").text()).toBe("Held by a deal");
  });

  it("shows Mark reviewed only on flagged rows, and only to a write role", async () => {
    const data = [
      mkUnit(1, { needsStatusReview: true }),
      mkUnit(2, { needsStatusReview: false }),
      mkUnit(3, { status: "OCCUPIED", needsStatusReview: true }),
    ];
    const w = await mountWith("LEASING_OFFICER", data);
    const rows = w.findAll("tbody tr");
    expect(rows[0].findAll("button").map((b) => b.text())).toEqual(["Set unavailable", "Mark reviewed"]);
    expect(rows[1].findAll("button").map((b) => b.text())).toEqual(["Set unavailable"]);
    expect(rows[2].findAll("button").map((b) => b.text())).toEqual(["Mark reviewed"]);

    const viewer = await mountWith("VIEWER", data);
    expect(viewer.find(".avail-reviewed").exists()).toBe(false);
    expect(viewer.text()).not.toContain("Mark reviewed");
  });

  it("Mark reviewed calls the client with the unit id, then reloads the list", async () => {
    const w = await mountWith("LEASING_OFFICER", [mkUnit(1, { needsStatusReview: true })]);
    expect(w.find(".review-tag").exists()).toBe(true);
    // the reload comes back with the flag cleared
    units.list.mockImplementationOnce(() => Promise.resolve([mkUnit(1, { needsStatusReview: false })]));
    const before = units.list.mock.calls.length;
    await w.find(".avail-reviewed").trigger("click");
    await flushPromises();
    expect(units.markReviewed).toHaveBeenCalledWith("p1");
    expect(units.list.mock.calls.length).toBe(before + 1);
    expect(w.find(".avail-reviewed").exists()).toBe(false);
    expect(w.find(".review-tag").exists()).toBe(false);
  });

  it("shows the server's error when Mark reviewed is refused, without reloading", async () => {
    const w = await mountWith("LEASING_OFFICER", [mkUnit(1, { needsStatusReview: true })]);
    units.markReviewed.mockImplementationOnce(() =>
      Promise.reject({ response: { data: { error: "Unit is not flagged for review" } } }),
    );
    const before = units.list.mock.calls.length;
    await w.find(".avail-reviewed").trigger("click");
    await flushPromises();
    expect(w.find(".action-error").text()).toBe("Unit is not flagged for review");
    expect(units.list.mock.calls.length).toBe(before);
  });

  it("shows only the error, with no empty table or pager, when the first load fails", async () => {
    units.list.mockImplementationOnce(() => Promise.reject({ response: { data: { error: "Units are unavailable" } } }));
    const w = await mountView("VIEWER");
    expect(w.find(".error").text()).toBe("Units are unavailable");
    expect(w.find("table").exists()).toBe(false);
    expect(w.text()).not.toContain("No records.");
    expect(w.find(".pager").exists()).toBe(false);
  });
});
