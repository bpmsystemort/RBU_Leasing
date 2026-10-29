import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import request from "supertest";
import { resetCrudTables, tokens } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createApp } from "../src/app.js";
import { analyzeWorkbook, commitWorkbook } from "../src/services/portfolioImportService.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

beforeEach(async () => { await resetCrudTables(); });

// Build a Layout-B 2026 sheet (header row 1; O-LEASE@2, property@3, Unit@4 ...).
function add2026(ws) {
  const h = ws.addRow([]);
  const hdr = { 2: "O-LEASE", 4: "Unit", 5: "Unit Type", 6: "Level", 7: "Slot No.", 8: "Lessor", 9: "Lessee", 10: "Start Contract Period", 11: "End Contract Period", 12: "Renewal Period", 13: "Monthly Rent", 14: "Advance Rent", 15: "Security Deposit", 16: "Mode of Payment", 17: "Service Fee Paid", 18: "Source", 19: "Remarks" };
  for (const [c, v] of Object.entries(hdr)) h.getCell(Number(c)).value = v;
  return (o) => {
    const r = ws.addRow([]);
    const cells = { 3: o.property ?? "CV Ibiza Tower", 4: o.unit, 5: o.type ?? "1BR", 6: o.floor, 7: o.slot, 8: o.lessor, 9: o.lessee, 10: o.start, 11: o.end, 13: o.rent };
    for (const [c, v] of Object.entries(cells)) if (v != null) r.getCell(Number(c)).value = v;
  };
}
async function wbuf(rows, sheet = "2026") {
  const wb = new ExcelJS.Workbook();
  const add = add2026(wb.addWorksheet(sheet));
  rows.forEach(add);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const R = (o = {}) => ({ unit: "6D", lessor: "Owner A", lessee: "Lessee X", start: new Date("2024-01-01"), end: new Date("2024-12-31"), rent: 25000, ...o });
const PAST = { start: new Date("2022-01-01"), end: new Date("2022-12-31") };
const ACTIVE = { start: new Date("2026-01-01"), end: new Date("2027-01-01") };

describe("analyzeWorkbook (preview — no writes)", () => {
  it("returns dispositions and writes nothing", async () => {
    const buf = await wbuf([R(), R({ unit: "7D" })]);
    const res = await analyzeWorkbook(buf);
    expect(res.totals.willCreate).toBe(2);
    expect(res.totals.failed).toBe(0);
    expect(await prisma.unitOwner.count()).toBe(0); // nothing written
    expect(await prisma.unit.count()).toBe(0);
    expect(await prisma.lease.count()).toBe(0);
  });
  it("flags failed rows with reasons (bad date, missing field, start>end)", async () => {
    const buf = await wbuf([
      R(),
      R({ unit: "8D", end: null }),             // missing end
      R({ unit: "9D", start: new Date("2024-12-31"), end: new Date("2024-01-01") }), // start>end
    ]);
    const res = await analyzeWorkbook(buf);
    expect(res.totals.willCreate).toBe(1);
    expect(res.totals.failed).toBe(2);
    expect(res.failures.map((f) => f.row).length).toBe(2);
  });
  it("flags an unparseable Start date (rawStart present, startDate unparseable)", async () => {
    const buf = await wbuf([R({ unit: "6D", start: "not a date" })]);
    const res = await analyzeWorkbook(buf);
    expect(res.totals.failed).toBe(1);
    expect(res.failures[0].reasons.some((r) => /unparseable/i.test(r))).toBe(true);
  });
  it("flags an in-file duplicate row (same unit/lessee/start/end)", async () => {
    const dup = R({ unit: "6D" });
    const buf = await wbuf([dup, { ...dup }]);
    const res = await analyzeWorkbook(buf);
    expect(res.totals.willCreate).toBe(1);
    expect(res.totals.failed).toBe(1);
    expect(res.failures[0].reasons.some((r) => /duplicate/i.test(r))).toBe(true);
  });
});

describe("analyzeWorkbook (preview parity with commit)", () => {
  it("willCreate/willUpdate match commit's owner-scoped lookup (not a global unitKey match)", async () => {
    const ownerA = await wbuf([R({ unit: "6D", lessor: "Owner A" })]);
    await commitWorkbook(ownerA);
    const ownerB = await wbuf([R({ unit: "6D", lessor: "Owner B" })]);
    const res = await analyzeWorkbook(ownerB);
    expect(res.totals.willCreate).toBe(1);
    expect(res.totals.willUpdate).toBe(0);
  });
  it("unitsNeedingStatusReview unions in-file rows with the unit's existing DB leases", async () => {
    const active = await wbuf([R({ unit: "9Z", lessor: "Owner A", ...ACTIVE })]);
    await commitWorkbook(active);
    const onlyPast = await wbuf([R({ unit: "9Z", lessor: "Owner A", ...PAST })]);
    const res = await analyzeWorkbook(onlyPast);
    expect(res.unitsNeedingStatusReview).toBe(0);
  });
});

describe("commitWorkbook", () => {
  it("creates owners/units/leases, never a User, idempotent on re-run", async () => {
    const buf = await wbuf([R(), R({ unit: "7D" })]);
    const first = await commitWorkbook(buf);
    expect(first.created).toBe(2);
    await commitWorkbook(buf);
    expect(await prisma.unitOwner.count()).toBe(1);
    expect(await prisma.unit.count()).toBe(2);
    expect(await prisma.lease.count()).toBe(2);
    expect(await prisma.user.count({ where: { role: "UNIT_OWNER" } })).toBe(0);
  });
  it("flags ambiguous owners (joint/blank) with needsReview; links exact names", async () => {
    const buf = await wbuf([
      R({ unit: "6D", lessor: "Spouses Juan and Maria Cruz" }),
      R({ unit: "7D", lessor: "Owner A" }),
      R({ unit: "8D", lessor: " owner a " }), // same as Owner A -> linked, one owner
    ]);
    await commitWorkbook(buf);
    expect(await prisma.unitOwner.count({ where: { name: "Owner A" } })).toBe(1);
    expect(await prisma.unit.count({ where: { owner: { name: "Owner A" } } })).toBe(2); // linked
    expect(await prisma.unitOwner.count({ where: { needsReview: true } })).toBe(1); // the Spouses row
  });
  it("sets needsStatusReview when all leases ended; OCCUPIED when a lease is active", async () => {
    const ended = await wbuf([R({ unit: "6D", ...PAST })]);
    await commitWorkbook(ended);
    const u1 = await prisma.unit.findFirstOrThrow({ where: { unitNumber: "6D" } });
    expect(u1.needsStatusReview).toBe(true);
    await resetCrudTables();
    const active = await wbuf([R({ unit: "9Z", ...ACTIVE })]);
    await commitWorkbook(active);
    const u2 = await prisma.unit.findFirstOrThrow({ where: { unitNumber: "9Z" } });
    expect(u2.needsStatusReview).toBe(false);
    expect(u2.status).toBe("OCCUPIED");
  });
});

const app = createApp();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
describe("import endpoints", () => {
  it("ADMIN preview returns totals and writes nothing; officer 403", async () => {
    const buf = await wbuf([R()]);
    const ok = await request(app).post("/api/import/portfolio/preview").set("Authorization", `Bearer ${tokens.admin()}`).attach("file", buf, { filename: "p.xlsx", contentType: XLSX });
    expect(ok.status).toBe(200);
    expect(ok.body.totals.willCreate).toBe(1);
    expect(await prisma.lease.count()).toBe(0);
    const forbidden = await request(app).post("/api/import/portfolio/preview").set("Authorization", `Bearer ${tokens.officer()}`).attach("file", buf, { filename: "p.xlsx", contentType: XLSX });
    expect(forbidden.status).toBe(403);
  });
  it("ADMIN commit writes; no file 400", async () => {
    const buf = await wbuf([R()]);
    const ok = await request(app).post("/api/import/portfolio/commit").set("Authorization", `Bearer ${tokens.admin()}`).attach("file", buf, { filename: "p.xlsx", contentType: XLSX });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1);
    expect(await prisma.lease.count()).toBe(1);
    const noFile = await request(app).post("/api/import/portfolio/commit").set("Authorization", `Bearer ${tokens.admin()}`);
    expect(noFile.status).toBe(400);
  });
});
