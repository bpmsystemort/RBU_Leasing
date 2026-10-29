import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  portfolioImport: { upload: vi.fn(() => Promise.resolve({ owners: 3, units: 5, tenants: 4, leases: 9, skipped: 2, skips: [] })) },
}));

import PortfolioImportView from "../src/views/PortfolioImportView.vue";
import { portfolioImport } from "../src/lib/resource.js";

const file = new File(["x"], "portfolio.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

describe("PortfolioImportView", () => {
  beforeEach(() => { portfolioImport.upload.mockClear(); });

  it("uploads the chosen file and shows the summary", async () => {
    const w = mount(PortfolioImportView);
    const input = w.find('input[type="file"]');
    Object.defineProperty(input.element, "files", { value: [file] });
    await input.trigger("change");
    await w.findAll("button").find((b) => /import/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(portfolioImport.upload).toHaveBeenCalledWith(file);
    expect(w.text()).toMatch(/5/); // units
    expect(w.text()).toMatch(/9/); // leases
  });

  it("disables import until a file is chosen", async () => {
    const w = mount(PortfolioImportView);
    const btn = w.findAll("button").find((b) => /import/i.test(b.text()));
    expect(btn.attributes("disabled")).toBeDefined();
  });
});
