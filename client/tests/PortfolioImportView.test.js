import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
vi.mock("../src/lib/resource.js", () => ({
  portfolioImport: {
    preview: vi.fn(() => Promise.resolve({ totals: { willCreate: 5, willUpdate: 2, skipped: 1, failed: 1 }, sheets: [{ name: "2026", ok: true }], failures: [{ sheet: "2026", row: 9, reasons: ["missing Lessee"] }], ownersNeedingReview: 3, unitsNeedingStatusReview: 4 })),
    commit: vi.fn(() => Promise.resolve({ created: 5, updated: 2, skipped: 1, failed: 1, ownersFlagged: 3, unitsFlagged: 4, failures: [] })),
  },
}));
import PortfolioImportView from "../src/views/PortfolioImportView.vue";
import { portfolioImport } from "../src/lib/resource.js";
const file = new File(["x"], "p.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
async function pick(w) { const i = w.find('input[type="file"]'); Object.defineProperty(i.element, "files", { value: [file] }); await i.trigger("change"); }
const btn = (w, re) => w.findAll("button").find((b) => re.test(b.text()));

describe("PortfolioImportView", () => {
  beforeEach(() => { portfolioImport.preview.mockClear(); portfolioImport.commit.mockClear(); });
  it("previews then shows totals and a failure, then commits", async () => {
    const w = mount(PortfolioImportView);
    await pick(w);
    await btn(w, /preview/i).trigger("click");
    await flushPromises();
    expect(portfolioImport.preview).toHaveBeenCalledWith(file);
    expect(w.text()).toMatch(/missing Lessee/);
    expect(w.text()).toMatch(/5/);
    await btn(w, /confirm/i).trigger("click");
    await flushPromises();
    expect(portfolioImport.commit).toHaveBeenCalledWith(file);
    expect(w.text()).toMatch(/import complete|created/i);
  });
  const withReviews = () => Promise.resolve({
    totals: { willCreate: 3, willUpdate: 0, skipped: 0, failed: 0 }, sheets: [{ name: "2026", ok: true }], failures: [],
    ownersNeedingReview: 1, unitsNeedingStatusReview: 2,
    ownerReviews: [{ owner: "Spouses Juan and Maria Cruz", reason: "Joint or multiple owners in one name", units: 2, sheet: "2026", row: 4 }],
    unitReviews: [
      { property: "CV Ibiza Tower", unitNumber: "6D", owner: "Owner A", lastLessee: "Newer Tenant", lastEnd: "2024-12-31", leases: 2, sheet: "2026", row: 8, existing: false },
      { property: "Royalton", unitNumber: "20B", owner: "Owner B", lastLessee: "Old Tenant", lastEnd: "2022-03-01", leases: 1, sheet: "2025", row: 12, existing: true },
    ],
  });
  const cells = (tr) => tr.findAll("td").map((td) => td.text());

  it("lists the units flagged for status review, oldest last lease first", async () => {
    portfolioImport.preview.mockImplementationOnce(withReviews);
    const w = mount(PortfolioImportView);
    await pick(w);
    await btn(w, /preview/i).trigger("click");
    await flushPromises();
    const rows = w.findAll("table.unit-reviews tbody tr");
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toEqual(["Royalton", "20B", "Owner B", "Old Tenant", "March 1, 2022", "1", "2025 · row 12"]);
    expect(cells(rows[1])).toEqual(["CV Ibiza Tower", "6D", "Owner A", "Newer Tenant", "December 31, 2024", "2", "2026 · row 8"]);
  });

  it("lists the owners flagged for review with the reason", async () => {
    portfolioImport.preview.mockImplementationOnce(withReviews);
    const w = mount(PortfolioImportView);
    await pick(w);
    await btn(w, /preview/i).trigger("click");
    await flushPromises();
    const rows = w.findAll("table.owner-reviews tbody tr");
    expect(rows).toHaveLength(1);
    expect(cells(rows[0])).toEqual(["Spouses Juan and Maria Cruz", "Joint or multiple owners in one name", "2", "2026 · row 4"]);
  });

  it("shows no review tables when nothing is flagged (or an older server sends no lists)", async () => {
    const w = mount(PortfolioImportView);
    await pick(w);
    await btn(w, /preview/i).trigger("click");
    await flushPromises();
    expect(w.find("table.unit-reviews").exists()).toBe(false);
    expect(w.find("table.owner-reviews").exists()).toBe(false);
  });

  it("disables Preview until a file is chosen", () => {
    const w = mount(PortfolioImportView);
    expect(btn(w, /preview/i).attributes("disabled")).toBeDefined();
  });
});
