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
  it("disables Preview until a file is chosen", () => {
    const w = mount(PortfolioImportView);
    expect(btn(w, /preview/i).attributes("disabled")).toBeDefined();
  });
});
