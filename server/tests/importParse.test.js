import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { parseFromBuffer } from "../src/lib/importParse.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

// Layout A: optional title row, then header row, then data. Columns:
// 2 Tower,3 Unit,4 Unit Type,5 Level,6 Slot No.,7 Lessor,8 Lessee,9 Start,10 End,11 Renewal,12 Monthly Rent
function sheetA(ws, { title = false } = {}) {
  if (title) ws.addRow(["2023"]);
  const h = ws.addRow([]);
  const hdr = { 2: "Tower", 3: "Unit", 4: "Unit Type", 5: "Level", 6: "Slot No.", 7: "Lessor", 8: "Lessee", 9: "Start Contract Period", 10: "End Contract Period", 11: "Renewal Period", 12: "Monthly Rent", 13: "Advance Rent", 14: "Security Deposit", 15: "Mode of Payment", 16: "Service Fee Paid", 17: "Source", 18: "Remarks" };
  for (const [c, v] of Object.entries(hdr)) h.getCell(Number(c)).value = v;
  return (vals) => { const r = ws.addRow([]); for (const [c, v] of Object.entries(vals)) if (v != null) r.getCell(Number(c)).value = v; };
}
// Layout B: O-LEASE at 2, blank property header at 3, Unit at 4 ...
function sheetB(ws) {
  const h = ws.addRow([]);
  const hdr = { 2: "O-LEASE", 4: "Unit", 5: "Unit Type", 6: "Level", 7: "Slot No.", 8: "Lessor", 9: "Lessee", 10: "Start Contract Period", 11: "End Contract Period", 12: "Renewal Period", 13: "Monthly Rent", 14: "Advance Rent", 15: "Security Deposit", 16: "Mode of Payment", 17: "Service Fee Paid", 18: "Source", 19: "Remarks" };
  for (const [c, v] of Object.entries(hdr)) h.getCell(Number(c)).value = v; // col 3 header intentionally blank
  return (vals) => { const r = ws.addRow([]); for (const [c, v] of Object.entries(vals)) if (v != null) r.getCell(Number(c)).value = v; };
}
async function buf(build) { const wb = new ExcelJS.Workbook(); build(wb); return Buffer.from(await wb.xlsx.writeBuffer()); }

describe("parseWorkbook — header mapping", () => {
  it("maps Layout A (2024, header row 1) by header name", async () => {
    const b = await buf((wb) => {
      const add = sheetA(wb.addWorksheet("2024"));
      add({ 2: "Ibiza", 3: "19A", 4: "1 Bedroom", 7: "Marybeth Monis", 8: "Gian Paolo Martinez", 9: new Date("2023-09-12"), 10: new Date("2024-09-11"), 12: 24000 });
    });
    const { sheets } = await parseFromBuffer(b);
    const s = sheets.find((x) => x.name === "2024");
    expect(s.ok).toBe(true);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ property: "Ibiza", unitNumber: "19A", unitType: "1 Bedroom", lessor: "Marybeth Monis", lessee: "Gian Paolo Martinez", monthlyRent: 24000 });
    expect(s.rows[0].startDate.getTime()).toBe(new Date("2023-09-12").getTime());
  });

  it("handles Layout A 2023 title row above the header", async () => {
    const b = await buf((wb) => {
      const add = sheetA(wb.addWorksheet("2023"), { title: true });
      add({ 2: "Royalton", 3: "18D", 4: "Studio", 7: "Michelle Jarin", 8: "Carmela Labatos", 9: new Date("2023-11-01"), 10: new Date("2025-10-31"), 12: 36000 });
    });
    const s = (await parseFromBuffer(b)).sheets.find((x) => x.name === "2023");
    expect(s.ok).toBe(true);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ property: "Royalton", unitNumber: "18D", lessor: "Michelle Jarin" });
  });

  it("maps Layout B (blank property header → column left of Unit; O-LEASE → managedBy)", async () => {
    const b = await buf((wb) => {
      const add = sheetB(wb.addWorksheet("2026"));
      add({ 2: "AAD", 3: "Viridian in GH", 4: "47I", 5: "1BR", 8: "Renato Vallarta Lorenzo", 9: "Chang Hwan Kim", 10: new Date("2023-04-16"), 11: new Date("2023-10-15"), 12: "16 Oct 2023 to 15 Apr 2024", 13: 60000 });
    });
    const s = (await parseFromBuffer(b)).sheets.find((x) => x.name === "2026");
    expect(s.ok).toBe(true);
    expect(s.rows[0]).toMatchObject({ managedBy: "AAD", property: "Viridian in GH", unitNumber: "47I", unitType: "1BR", lessor: "Renato Vallarta Lorenzo", lessee: "Chang Hwan Kim", monthlyRent: 60000, renewalText: "16 Oct 2023 to 15 Apr 2024" });
  });

  it("reports an unstructured sheet as not ok", async () => {
    const b = await buf((wb) => { const ws = wb.addWorksheet("2025"); ws.addRow(["just", "some", "noise"]); ws.addRow(["more", "noise"]); });
    const s = (await parseFromBuffer(b)).sheets.find((x) => x.name === "2025");
    expect(s.ok).toBe(false);
    expect(s.error).toBeTruthy();
    expect(s.rows).toEqual([]);
  });

  it("ignores non-year sheets", async () => {
    const b = await buf((wb) => { sheetA(wb.addWorksheet("Summary")); });
    expect((await parseFromBuffer(b)).sheets.find((x) => x.name === "Summary")).toBeUndefined();
  });

  it("preserves rawStart/rawEnd distinct from parsed dates: blank cells vs unparseable text", async () => {
    const b = await buf((wb) => {
      const add = sheetA(wb.addWorksheet("2028"));
      // Row P: valid row, Start/End cells left blank (keys omitted entirely).
      add({ 2: "Tower1", 3: "P1", 4: "Studio", 7: "Lessor P", 8: "Lessee P", 12: 10000 });
      // Row Q: valid row, Start/End cells hold unparseable text.
      add({ 2: "Tower1", 3: "Q1", 4: "Studio", 7: "Lessor Q", 8: "Lessee Q", 9: "not a date", 10: "nope", 12: 20000 });
    });
    const s = (await parseFromBuffer(b)).sheets.find((x) => x.name === "2028");
    expect(s.ok).toBe(true);
    expect(s.rows).toHaveLength(2);
    const rowP = s.rows.find((r) => r.unitNumber === "P1");
    const rowQ = s.rows.find((r) => r.unitNumber === "Q1");
    expect(rowP).toBeTruthy();
    expect(rowQ).toBeTruthy();

    // Blank cell: rawStart/rawEnd stay nullish and the parsed date is null.
    expect(rowP.rawStart == null).toBe(true);
    expect(rowP.startDate).toBe(null);
    expect(rowP.rawEnd == null).toBe(true);
    expect(rowP.endDate).toBe(null);

    // Unparseable text: rawStart/rawEnd keep the original string even though the parsed date is null.
    expect(rowQ.rawStart).toBe("not a date");
    expect(rowQ.startDate).toBe(null);
    expect(rowQ.rawEnd).toBe("nope");
    expect(rowQ.endDate).toBe(null);
  });

  it("reports ok:false when the header is found but a required column is missing", async () => {
    const b = await buf((wb) => {
      const ws = wb.addWorksheet("2029");
      const h = ws.addRow([]);
      h.getCell(3).value = "Unit";
      h.getCell(7).value = "Lessor";
      h.getCell(8).value = "Lessee";
      h.getCell(12).value = "Monthly Rent";
      // Start Contract Period / End Contract Period intentionally omitted.
    });
    const s = (await parseFromBuffer(b)).sheets.find((x) => x.name === "2029");
    expect(s.ok).toBe(false);
    expect(s.error).toContain("Missing required");
    expect(typeof s.headerRow).toBe("number");
    expect(s.headerRow).toBeTruthy();
    expect(s.rows).toEqual([]);
  });
});
