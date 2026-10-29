import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import { resetCrudTables } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { importWorkbook } from "../src/services/portfolioImportService.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

beforeEach(async () => { await resetCrudTables(); });

// Build an .xlsx buffer. Cells are placed by explicit column number to match the
// importer's fixed map (col 2..19); row 1 is a header the importer skips.
function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  ws.addRow(["#"]); // row 1 header — importer starts at row 2
  for (const o of rows) {
    const row = ws.addRow([]);
    const cells = {
      2: o.managedBy ?? "O-LEASE", 3: o.building, 4: o.unitNumber, 5: o.type,
      6: o.floor, 7: o.slot, 8: o.lessor, 9: o.lessee, 10: o.start, 11: o.end,
      12: o.renewal, 13: o.rent, 14: o.advance, 15: o.security, 16: o.mode,
      17: o.serviceFee, 18: o.source, 19: o.remarks,
    };
    for (const [c, val] of Object.entries(cells)) if (val != null) row.getCell(Number(c)).value = val;
  }
}
async function workbook(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) addSheet(wb, name, rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const L = (over = {}) => ({ building: "CV Ibiza Tower", unitNumber: "6D", lessor: "Owner A",
  lessee: "Lessee X", start: new Date("2024-01-01"), end: new Date("2024-12-31"), rent: 25000, ...over });

describe("portfolio import — idempotent", () => {
  it("imports owners/units/tenants/leases and creates NO user", async () => {
    const buf = await workbook({ "2024": [L(), L({ unitNumber: "7D" })] }); // one owner, two units
    const res = await importWorkbook(buf);
    expect(res.owners).toBe(1);
    expect(res.units).toBe(2);
    expect(res.leases).toBe(2);
    expect(await prisma.unitOwner.count()).toBe(1);
    expect(await prisma.unit.count()).toBe(2);
    expect(await prisma.user.count({ where: { role: "UNIT_OWNER" } })).toBe(0);
  });

  it("re-importing the same workbook creates no duplicates", async () => {
    const buf = await workbook({ "2024": [L(), L({ unitNumber: "7D" })] });
    await importWorkbook(buf);
    await importWorkbook(buf);
    expect(await prisma.unitOwner.count()).toBe(1);
    expect(await prisma.unit.count()).toBe(2);
    expect(await prisma.lease.count()).toBe(2);
  });

  it("keeps historical leases: same unit across two year sheets -> 1 unit, 2 leases", async () => {
    const buf = await workbook({
      "2023": [L({ start: new Date("2023-01-01"), end: new Date("2023-12-31") })],
      "2024": [L()],
    });
    const res = await importWorkbook(buf);
    expect(res.units).toBe(1);
    expect(res.leases).toBe(2);
    expect(await prisma.unit.count()).toBe(1);
    expect(await prisma.lease.count()).toBe(2);
  });

  it("skips incomplete rows (missing lessee/dates/rent)", async () => {
    const buf = await workbook({ "2024": [L(), { building: "X", unitNumber: "1A" }] });
    const res = await importWorkbook(buf);
    expect(res.leases).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it("dedupes owner across units and tenant across leases by normalized name", async () => {
    const buf = await workbook({ "2024": [
      L({ lessor: "Owner A", unitNumber: "6D", lessee: "Lessee X" }),
      L({ lessor: " owner a ", unitNumber: "7D", lessee: "LESSEE x" }),
    ] });
    await importWorkbook(buf);
    expect(await prisma.unitOwner.count()).toBe(1);
    expect(await prisma.tenant.count()).toBe(1);
  });
});
