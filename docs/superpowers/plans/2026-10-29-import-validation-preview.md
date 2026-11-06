# Portfolio Import v2 (Validation + Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the portfolio importer to map columns by **header name per sheet** (handling both workbook layouts), validate structure/fields/dates/duplicates, show a **preview before saving**, report created/updated/skipped/failed, link owners by exact name while **flagging ambiguous ones**, and **flag uncertain unit statuses** instead of auto-marking them available — idempotently, creating no accounts.

**Architecture:** A new pure parser (`importParse.js`) detects each sheet's header row and maps canonical fields by header text. The service exposes `analyzeWorkbook` (preview, **no writes**) and `commitWorkbook` (writes), sharing one disposition/matching/status engine so preview equals commit. Two ADMIN endpoints (`/preview`, `/commit`) and a reworked Vue page drive the preview→confirm flow. Stateless: confirm re-sends the same file; deterministic parsing + idempotent keys make preview match commit.

**Tech Stack:** Node/Express + Prisma (PostgreSQL) + `exceljs` + `multer`; Vue 3 + Vitest/@vue/test-utils.

## Global Constraints

- **Header-based mapping only** — never the old fixed positional map. An unrecognized sheet structure is a reported failure, never a silent mismap.
- **Preview makes zero DB writes.** Commit is **idempotent** (re-running the same file creates nothing new) and **non-destructive** (no `deleteMany` in the importer).
- **Importing never creates a `User`.**
- **Migration policy:** schema changes via manual SQL (`prisma db execute`) to BOTH `rbu_leasing` (`server/.env`) and `rbu_leasing_test` (`server/.env.test`), then `prisma generate`. **Never** `prisma migrate dev`/`db push`. SQL in `server/prisma/manual-migrations/`.
- **No new packages.** `exceljs`, `multer` already present.
- **No renames** of existing identifiers/routes beyond those this plan states. Existing features keep working.
- **Normalization:** reuse `importClean.key()` = `String(s||"").trim().toLowerCase().replace(/\s+/g," ")` for all match keys; no drift.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Server cmds from `server/`, client from `client/`. Branch: `feat/import-validation-preview`.
- **Windows/Prisma lock:** the :5050 server holds the Prisma engine DLL; `prisma generate` fails (EPERM) while it runs. The controller stops the server before Task 1's `prisma generate` and restarts it after — implementers must NOT kill/restart server processes.

## Confirmed workbook structure (from the real file — do not re-derive)

- **Layout A — 2023 & 2024** (headers: `Tower, Unit, Unit Type, Level, Slot No., Lessor, Lessee, Start Contract Period, End Contract Period, Renewal Period, Monthly Rent, Advance Rent, Security Deposit, Mode of Payment, Service Fee Paid, Source, Remarks`). 2023 has a title row (`"2023"`) above the header row; 2024's header is row 1. `Tower` is the property column.
- **Layout B — 2025 & 2026** (same headers EXCEPT a leading `O-LEASE` column and the property column's header is **blank**): `O-LEASE, «blank=property», Unit, Unit Type, Level, Slot No., Lessor, Lessee, …`. Property = the column immediately left of `Unit`.
- `Renewal Period` is free text (never a date). `Advance Rent`/`Security Deposit`/`Service Fee Paid` may be text. `Start`/`End` are real dates.

## File Structure

**Server**
- Create `server/src/lib/importParse.js` — header detection + per-sheet mapping + row extraction.
- Modify `server/src/services/portfolioImportService.js` — `analyzeWorkbook` + `commitWorkbook` + shared engine; re-point CLI helper.
- Modify `server/src/controllers/importController.js`, `server/src/routes/importRoutes.js` (add `/preview`, `/commit`).
- Modify `server/scripts/import-portfolio.js`.
- Modify `server/prisma/schema.prisma`; create `server/prisma/manual-migrations/2026-10-29-import-review-flags.sql`.
- Tests: `server/tests/importParse.test.js` (new), `server/tests/portfolioImport.test.js` (rework).

**Client**
- Modify `client/src/views/PortfolioImportView.vue`, `client/src/lib/resource.js`.
- Test: `client/tests/PortfolioImportView.test.js` (rework).

---

## Task 1: Migration — review/status flags

**Files:** Modify `server/prisma/schema.prisma`; Create `server/prisma/manual-migrations/2026-10-29-import-review-flags.sql`.

**Interfaces:** Produces `Unit.needsStatusReview Boolean @default(false)`, `UnitOwner.needsReview Boolean @default(false)`. Consumed by Task 3.

- [ ] **Step 1: Schema** — in `server/prisma/schema.prisma` add to `model Unit`: `  needsStatusReview Boolean @default(false)` and to `model UnitOwner`: `  needsReview Boolean @default(false)`.

- [ ] **Step 2: SQL** — create `server/prisma/manual-migrations/2026-10-29-import-review-flags.sql`:
```sql
ALTER TABLE "Unit"      ADD COLUMN IF NOT EXISTS "needsStatusReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UnitOwner" ADD COLUMN IF NOT EXISTS "needsReview"       BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply to both DBs** — from `server/`:
```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-29-import-review-flags.sql
DATABASE_URL="$(grep -E '^DATABASE_URL' .env.test | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')" npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-29-import-review-flags.sql
```
Expected: `Script executed successfully.` twice.

- [ ] **Step 4: Generate** (controller will have stopped the :5050 server) — from `server/`: `npx prisma generate` → `Generated Prisma Client`.

- [ ] **Step 5: Verify** — from `server/`:
```bash
node -e "import('./src/lib/prisma.js').then(async({prisma})=>{const u=await prisma.unit.findFirst({select:{needsStatusReview:true}}).catch(e=>'ERR:'+e.message);const o=await prisma.unitOwner.findFirst({select:{needsReview:true}}).catch(e=>'ERR:'+e.message);console.log('unit.needsStatusReview ok:',u!==undefined&&!String(u).startsWith('ERR'));console.log('owner.needsReview ok:',o!==undefined&&!String(o).startsWith('ERR'));await prisma.\$disconnect();})"
```
Expected: both `ok: true` (null first-row is fine — the point is the field is known to the client).

- [ ] **Step 6: Commit**
```bash
git add server/prisma/schema.prisma server/prisma/manual-migrations/2026-10-29-import-review-flags.sql
git commit -m "feat(db): needsStatusReview + owner needsReview flags for import v2"
```

---

## Task 2: Header-based parser/validator (`importParse.js`)

**Files:** Create `server/src/lib/importParse.js`, `server/tests/importParse.test.js`.

**Interfaces:**
- Consumes: `importClean` (`text/money/toDate`).
- Produces: `parseFromBuffer(buffer) → Promise<{ sheets: [{ name, ok, error, headerRow, rows: Row[] }] }>` (async) where `Row = { sheet, row, property, unitNumber, unitType, floor, slotNo, lessor, lessee, startDate|null, endDate|null, renewalText, monthlyRent|null, advanceRent, securityDeposit, modeOfPayment, serviceFee, source, remarks, managedBy, rawStart, rawEnd }`. `rawStart/rawEnd` are the original cell values (so the service can distinguish "blank" from "present-but-unparseable" dates). Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `server/tests/importParse.test.js`:
```js
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
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/importParse.test.js` (module missing).

- [ ] **Step 3: Implement `server/src/lib/importParse.js`**
```js
import { createRequire } from "module";
import { text, money, toDate } from "./importClean.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const isYearSheet = (name) => /^\d{4}$/.test(String(name).trim());
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function headerCellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

// canonical field for a normalized header string (exact-ish matches)
const HEADER_FIELD = [
  [/^tower$/, "property"], [/^unit$/, "unitNumber"], [/^unit type$/, "unitType"],
  [/^level$/, "floor"], [/^slot ?no\.?$/, "slotNo"], [/^lessor$/, "lessor"], [/^lessee$/, "lessee"],
  [/^start contract period$/, "startDate"], [/^end contract period$/, "endDate"],
  [/^renewal period$/, "renewalText"], [/^monthly rent$/, "monthlyRent"], [/^advance rent$/, "advanceRent"],
  [/^security deposit$/, "securityDeposit"], [/^mode of payment$/, "modeOfPayment"],
  [/^service fee( paid)?$/, "serviceFee"], [/^source$/, "source"], [/^o-?lease$/, "managedBy"],
  [/^remarks$/, "remarks"],
];
const REQUIRED = ["unitNumber", "lessor", "lessee", "startDate", "endDate", "monthlyRent"];

// Scan the first rows to find the header row; return { map: {field: colIndex}, headerRow } or null.
function findHeader(ws) {
  const maxScan = Math.min(8, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    const vals = ws.getRow(r).values; // 1-indexed
    const map = {};
    for (let c = 1; c < vals.length; c++) {
      const h = norm(headerCellText(vals[c]));
      if (!h) continue;
      for (const [re, field] of HEADER_FIELD) { if (re.test(h) && map[field] === undefined) { map[field] = c; break; } }
    }
    const hasCore = map.unitNumber != null && map.lessor != null && map.lessee != null && map.monthlyRent != null;
    if (hasCore) {
      // Property column: explicit "Tower" header, else the column immediately left of "Unit" (Layout B blank header).
      if (map.property == null && map.unitNumber > 1) map.property = map.unitNumber - 1;
      return { map, headerRow: r };
    }
  }
  return null;
}

export async function parseFromBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  for (const ws of wb.worksheets) {
    if (!isYearSheet(ws.name)) continue;
    const found = findHeader(ws);
    if (!found) { sheets.push({ name: ws.name, ok: false, error: "No recognizable header row (need Unit, Lessor, Lessee, Monthly Rent).", headerRow: null, rows: [] }); continue; }
    const missing = REQUIRED.filter((f) => found.map[f] == null);
    if (missing.length) { sheets.push({ name: ws.name, ok: false, error: `Missing required columns: ${missing.join(", ")}`, headerRow: found.headerRow, rows: [] }); continue; }
    const { map, headerRow } = found;
    const at = (vals, f) => (map[f] != null ? vals[map[f]] : undefined);
    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values;
      rows.push({
        sheet: ws.name, row: r,
        managedBy: text(at(v, "managedBy")), property: text(at(v, "property")),
        unitNumber: text(at(v, "unitNumber")), unitType: text(at(v, "unitType")) || "OTHER",
        floor: text(at(v, "floor")), slotNo: text(at(v, "slotNo")),
        lessor: text(at(v, "lessor")), lessee: text(at(v, "lessee")),
        rawStart: at(v, "startDate") ?? null, rawEnd: at(v, "endDate") ?? null,
        startDate: toDate(at(v, "startDate")), endDate: toDate(at(v, "endDate")),
        renewalText: text(at(v, "renewalText")), monthlyRent: money(at(v, "monthlyRent")),
        advanceRent: text(at(v, "advanceRent")), securityDeposit: text(at(v, "securityDeposit")),
        modeOfPayment: text(at(v, "modeOfPayment")), serviceFee: text(at(v, "serviceFee")),
        source: text(at(v, "source")), remarks: text(at(v, "remarks")),
      });
    }
    sheets.push({ name: ws.name, ok: true, error: null, headerRow, rows });
  }
  return { sheets };
}
```
(`parseFromBuffer` is async — the Step 1 test imports it and `await`s each call.)

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/importParse.test.js` (5 tests).

- [ ] **Step 5: Commit**
```bash
git add server/src/lib/importParse.js server/tests/importParse.test.js
git commit -m "feat(import): header-based per-sheet workbook parser (both layouts)"
```

---

## Task 3: Service — analyze (preview) + commit, with matching & flags

**Files:** Modify `server/src/services/portfolioImportService.js`, `server/scripts/import-portfolio.js`; Test rework `server/tests/portfolioImport.test.js`.

**Interfaces:**
- Consumes: `parseFromBuffer` (Task 2); Task 1 flags; `importClean.key`, `towerMap.towerNameFor`, `lib/prisma`.
- Produces: `analyzeWorkbook(buffer) → { totals:{willCreate,willUpdate,skipped,failed}, sheets:[{name,ok,error}], failures:[{sheet,row,reasons}], ownersNeedingReview:number, unitsNeedingStatusReview:number }` (NO writes); `commitWorkbook(buffer) → { created, updated, skipped, failed, ownersFlagged, unitsFlagged, failures:[...] }`; `commitFromFile(path)`.

- [ ] **Step 1: Write the failing tests** — replace `server/tests/portfolioImport.test.js` with:
```js
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import { resetCrudTables } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
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
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/portfolioImport.test.js`.

- [ ] **Step 3: Implement the service** — replace `server/src/services/portfolioImportService.js`:
```js
import { prisma } from "../lib/prisma.js";
import { key, leaseStatus } from "../lib/importClean.js";
import { towerNameFor } from "../lib/towerMap.js";
import { parseFromBuffer } from "../lib/importParse.js";

const JOINT = /\b and \b|&|\bspouses?\b|\/|\bc\/o\b|\bet al\b/i;
const ownerNeedsReview = (name) => !name || JOINT.test(name);

// Classify one parsed row. Returns { kind: "skip"|"fail"|"ok", reasons?, key? }
function classify(row, seen) {
  const blank = !row.unitNumber && !row.lessee && !row.lessor && row.rawStart == null && row.rawEnd == null && row.monthlyRent == null;
  if (blank) return { kind: "skip" };
  const reasons = [];
  if (!row.unitNumber) reasons.push("missing Unit");
  if (!row.lessee) reasons.push("missing Lessee");
  if (row.rawStart == null) reasons.push("missing Start date"); else if (!row.startDate) reasons.push("unparseable Start date");
  if (row.rawEnd == null) reasons.push("missing End date"); else if (!row.endDate) reasons.push("unparseable End date");
  if (row.monthlyRent == null) reasons.push("missing/invalid Monthly Rent");
  if (row.startDate && row.endDate && row.startDate.getTime() > row.endDate.getTime()) reasons.push("Start date after End date");
  if (reasons.length) return { kind: "fail", reasons };
  const dupKey = `${key(row.property)}|${key(row.unitNumber)}|${key(row.lessee)}|${row.startDate.toISOString()}|${row.endDate.toISOString()}`;
  if (seen.has(dupKey)) return { kind: "fail", reasons: ["duplicate row within file"] };
  seen.add(dupKey);
  return { kind: "ok" };
}

async function loadParse(buffer) {
  const { sheets } = await parseFromBuffer(buffer);
  const sheetMeta = sheets.map((s) => ({ name: s.name, ok: s.ok, error: s.error }));
  const rows = sheets.filter((s) => s.ok).flatMap((s) => s.rows);
  return { sheetMeta, rows };
}

export async function analyzeWorkbook(buffer) {
  const { sheetMeta, rows } = await loadParse(buffer);
  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const totals = { willCreate: 0, willUpdate: 0, skipped: 0, failed: 0 };
  const failures = [];
  const ownerKeys = new Set(); const unitKeysActive = new Map(); const seen = new Set();
  for (const row of rows) {
    const c = classify(row, seen);
    if (c.kind === "skip") { totals.skipped++; continue; }
    if (c.kind === "fail") { totals.failed++; failures.push({ sheet: row.sheet, row: row.row, reasons: c.reasons }); continue; }
    const towerId = towerByName.get(towerNameFor(row.property)) ?? null;
    const unitKey = `${key(row.property)}|${key(row.unitNumber)}|${towerId ?? ""}`;
    const existing = await prisma.lease.findFirst({ where: { unit: { unitKey }, tenant: { nameKey: key(row.lessee) }, startDate: row.startDate, endDate: row.endDate }, select: { id: true } });
    if (existing) totals.willUpdate++; else totals.willCreate++;
    if (ownerNeedsReview(row.lessor)) ownerKeys.add(`REVIEW:${key(row.lessor || "unknown owner")}`);
    const active = row.startDate <= new Date() && row.endDate >= new Date();
    const prev = unitKeysActive.get(unitKey) || false; unitKeysActive.set(unitKey, prev || active);
  }
  const unitsNeedingStatusReview = [...unitKeysActive.values()].filter((v) => !v).length;
  return { totals, sheets: sheetMeta, failures, ownersNeedingReview: ownerKeys.size, unitsNeedingStatusReview };
}

export async function commitWorkbook(buffer) {
  const { sheetMeta, rows } = await loadParse(buffer);
  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const owners = new Map(); const tenants = new Map(); const units = new Map();
  const summary = { created: 0, updated: 0, skipped: 0, failed: 0, ownersFlagged: 0, unitsFlagged: 0, failures: [], sheets: sheetMeta };
  const seen = new Set(); const affectedUnitIds = new Set();

  for (const row of rows) {
    const c = classify(row, seen);
    if (c.kind === "skip") { summary.skipped++; continue; }
    if (c.kind === "fail") { summary.failed++; summary.failures.push({ sheet: row.sheet, row: row.row, reasons: c.reasons }); continue; }

    const ownerName = row.lessor || "Unknown Owner";
    const ownerKey = key(ownerName);
    let ownerId = owners.get(ownerKey);
    if (ownerId === undefined) {
      let owner = await prisma.unitOwner.findUnique({ where: { nameKey: ownerKey } });
      const needsReview = ownerNeedsReview(row.lessor);
      if (!owner) { owner = await prisma.unitOwner.create({ data: { name: ownerName, nameKey: ownerKey, needsReview } }); if (needsReview) summary.ownersFlagged++; }
      else if (needsReview && !owner.needsReview) { await prisma.unitOwner.update({ where: { id: owner.id }, data: { needsReview: true } }); summary.ownersFlagged++; }
      ownerId = owner.id; owners.set(ownerKey, ownerId);
    }

    const tKey = key(row.lessee);
    let tenantId = tenants.get(tKey);
    if (tenantId === undefined) {
      let tenant = await prisma.tenant.findUnique({ where: { nameKey: tKey } });
      if (!tenant) tenant = await prisma.tenant.create({ data: { name: row.lessee, nameKey: tKey } });
      tenantId = tenant.id; tenants.set(tKey, tenantId);
    }

    const towerId = towerByName.get(towerNameFor(row.property)) ?? null;
    const unitKey = `${key(row.property)}|${key(row.unitNumber)}|${towerId ?? ""}`;
    const uMapKey = `${ownerId}|${unitKey}`;
    let unitId = units.get(uMapKey);
    if (unitId === undefined) {
      let unit = await prisma.unit.findUnique({ where: { ownerId_unitKey: { ownerId, unitKey } } });
      const descriptive = Object.fromEntries(Object.entries({ floor: row.floor, slotNo: row.slotNo, type: row.unitType, baseRent: row.monthlyRent }).filter(([, v]) => v != null));
      if (unit) await prisma.unit.update({ where: { id: unit.id }, data: descriptive });
      else unit = await prisma.unit.create({ data: { ownerId, unitKey, unitNumber: row.unitNumber, building: row.property, towerId, status: "OCCUPIED", ...descriptive } });
      unitId = unit.id; units.set(uMapKey, unitId);
    }
    affectedUnitIds.add(unitId);

    const leaseData = { monthlyRent: row.monthlyRent, status: leaseStatus(row.endDate, new Date()), advanceRent: row.advanceRent, securityDeposit: row.securityDeposit, modeOfPayment: row.modeOfPayment, serviceFee: row.serviceFee, source: row.source, remarks: row.remarks, renewalPeriod: row.renewalText, managedBy: row.managedBy };
    const existing = await prisma.lease.findUnique({ where: { unitId_tenantId_startDate_endDate: { unitId, tenantId, startDate: row.startDate, endDate: row.endDate } }, select: { id: true } });
    if (existing) { await prisma.lease.update({ where: { id: existing.id }, data: leaseData }); summary.updated++; }
    else { await prisma.lease.create({ data: { unitId, tenantId, startDate: row.startDate, endDate: row.endDate, ...leaseData } }); summary.created++; }
  }

  // Status pass: never auto-VACANT. Active lease (now within [start,end]) -> OCCUPIED; else flag for review.
  const now = new Date();
  for (const unitId of affectedUnitIds) {
    const leases = await prisma.unit.findUnique({ where: { id: unitId }, select: { leases: { select: { startDate: true, endDate: true } } } });
    const active = leases.leases.some((l) => l.startDate <= now && l.endDate >= now);
    if (active) await prisma.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED", needsStatusReview: false } });
    else { await prisma.unit.update({ where: { id: unitId }, data: { needsStatusReview: true } }); summary.unitsFlagged++; }
  }
  return summary;
}

export async function commitFromFile(path) {
  const { readFile } = await import("fs/promises");
  return commitWorkbook(await readFile(path));
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/portfolioImport.test.js` (all).

- [ ] **Step 5: Re-point the CLI** — replace `server/scripts/import-portfolio.js` to call `commitFromFile` (keep `import "../src/env.js"`; print `created/updated/skipped/failed/ownersFlagged/unitsFlagged`; on `failed>0` print first 8 failures).

- [ ] **Step 6: Commit**
```bash
git add server/src/services/portfolioImportService.js server/scripts/import-portfolio.js server/tests/portfolioImport.test.js
git commit -m "feat(import): analyze/commit with validation, owner & status flags, idempotent"
```

---

## Task 4: Preview + commit endpoints

**Files:** Modify `server/src/controllers/importController.js`, `server/src/routes/importRoutes.js`; append tests to `server/tests/portfolioImport.test.js`.

**Interfaces:** Consumes `analyzeWorkbook`/`commitWorkbook`. Produces `POST /api/import/portfolio/preview` and `POST /api/import/portfolio/commit` (ADMIN, multer `file`).

- [ ] **Step 1: Append failing tests** — at the top of `server/tests/portfolioImport.test.js` extend imports: `import { resetCrudTables, tokens } from "./helpers.js";`, `import request from "supertest";`, `import { createApp } from "../src/app.js";`. Append:
```js
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
```

- [ ] **Step 2: Run → FAIL** (routes 404).

- [ ] **Step 3: Controller** — replace `server/src/controllers/importController.js`:
```js
import { analyzeWorkbook, commitWorkbook } from "../services/portfolioImportService.js";
import { InvalidReferenceError } from "../lib/errors.js";

export async function preview(req, res, next) {
  try { if (!req.file) throw new InvalidReferenceError("An .xlsx file is required"); res.json(await analyzeWorkbook(req.file.buffer)); }
  catch (err) { next(err); }
}
export async function commit(req, res, next) {
  try { if (!req.file) throw new InvalidReferenceError("An .xlsx file is required"); res.json(await commitWorkbook(req.file.buffer)); }
  catch (err) { next(err); }
}
```

- [ ] **Step 4: Routes** — replace `server/src/routes/importRoutes.js` with:
```js
import { Router } from "express";
import multer from "multer";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import * as ctrl from "../controllers/importController.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === XLSX),
});

const router = Router();
router.use(verifyJwt);
router.post("/portfolio/preview", requireRole("ADMIN"), upload.single("file"), ctrl.preview);
router.post("/portfolio/commit", requireRole("ADMIN"), upload.single("file"), ctrl.commit);
export default router;
```
(The old `/portfolio` route is removed — the client uses the new paths; `app.js` still mounts `app.use("/api/import", importRoutes)`.)

- [ ] **Step 5: Run → PASS** — `npx vitest run tests/portfolioImport.test.js`.

- [ ] **Step 6: Commit**
```bash
git add server/src/controllers/importController.js server/src/routes/importRoutes.js server/tests/portfolioImport.test.js
git commit -m "feat(import): ADMIN preview + commit endpoints"
```

---

## Task 5: Client preview → confirm page

**Files:** Modify `client/src/lib/resource.js`, `client/src/views/PortfolioImportView.vue`; rework `client/tests/PortfolioImportView.test.js`.

**Interfaces:** Consumes `/preview` + `/commit`. Produces `portfolioImport.preview(file)` / `.commit(file)`.

- [ ] **Step 1: resource wrappers** — in `client/src/lib/resource.js` replace the `portfolioImport` export with:
```js
export const portfolioImport = {
  preview: (file) => { const f = new FormData(); f.append("file", file); return api.post("/import/portfolio/preview", f).then((r) => r.data); },
  commit: (file) => { const f = new FormData(); f.append("file", file); return api.post("/import/portfolio/commit", f).then((r) => r.data); },
};
```

- [ ] **Step 2: Failing test** — replace `client/tests/PortfolioImportView.test.js`:
```js
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
```

- [ ] **Step 3: Run → FAIL**.

- [ ] **Step 4: Implement the view** — replace `client/src/views/PortfolioImportView.vue`:
```vue
<script setup>
import { ref, computed } from "vue";
import { portfolioImport } from "../lib/resource.js";
const file = ref(null); const busy = ref(false); const error = ref("");
const preview = ref(null); const result = ref(null);
const canPreview = computed(() => !!file.value && !busy.value);
function onPick(e) { file.value = e.target.files?.[0] || null; preview.value = null; result.value = null; error.value = ""; }
async function runPreview() {
  if (!file.value) return; busy.value = true; error.value = ""; result.value = null;
  try { preview.value = await portfolioImport.preview(file.value); }
  catch (e) { error.value = e.response?.data?.error || "Preview failed."; }
  finally { busy.value = false; }
}
async function confirm() {
  if (!file.value) return; busy.value = true; error.value = "";
  try { result.value = await portfolioImport.commit(file.value); preview.value = null; }
  catch (e) { error.value = e.response?.data?.error || "Import failed."; }
  finally { busy.value = false; }
}
</script>
<template>
  <section>
    <header><h1>Import Portfolio</h1>
      <p class="muted">Upload the monitoring workbook (.xlsx). You'll see a preview before anything is saved. Re-importing the same file changes nothing, and no login accounts are created. Imported units are recorded as Occupied; units whose leases have all ended are flagged for status review (never auto-set to available).</p>
    </header>
    <div class="panel">
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onPick" />
      <p v-if="file" class="muted small">Selected: {{ file.name }}</p>
      <div class="actions">
        <button type="button" class="primary" :disabled="!canPreview" @click="runPreview">{{ busy && !result ? "Checking…" : "Preview" }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-if="preview" class="panel">
      <div class="panel__label">Preview — nothing saved yet</div>
      <ul class="stats">
        <li><strong>{{ preview.totals.willCreate }}</strong> new</li>
        <li><strong>{{ preview.totals.willUpdate }}</strong> update</li>
        <li><strong>{{ preview.totals.skipped }}</strong> skipped</li>
        <li><strong>{{ preview.totals.failed }}</strong> failed</li>
      </ul>
      <p class="muted small">{{ preview.ownersNeedingReview }} owner(s) flagged for review · {{ preview.unitsNeedingStatusReview }} unit(s) need status review</p>
      <ul v-if="preview.sheets?.some(s => !s.ok)" class="sheets">
        <li v-for="s in preview.sheets.filter(s => !s.ok)" :key="s.name" class="error">Sheet {{ s.name }}: {{ s.error }}</li>
      </ul>
      <details v-if="preview.failures?.length" open><summary>{{ preview.failures.length }} failed row(s)</summary>
        <ul><li v-for="(f,i) in preview.failures.slice(0,50)" :key="i">sheet {{ f.sheet }}, row {{ f.row }} — {{ f.reasons.join("; ") }}</li></ul>
      </details>
      <div class="actions">
        <button type="button" class="primary" :disabled="busy" @click="confirm">{{ busy ? "Importing…" : "Confirm import" }}</button>
        <button type="button" class="ghost" :disabled="busy" @click="file = null; preview = null;">Choose another file</button>
      </div>
    </div>

    <div v-if="result" class="panel summary">
      <div class="panel__label">Import complete</div>
      <ul class="stats">
        <li><strong>{{ result.created }}</strong> created</li>
        <li><strong>{{ result.updated }}</strong> updated</li>
        <li><strong>{{ result.skipped }}</strong> skipped</li>
        <li><strong>{{ result.failed }}</strong> failed</li>
      </ul>
      <p class="muted small">{{ result.ownersFlagged }} owner(s) flagged · {{ result.unitsFlagged }} unit(s) need status review</p>
    </div>
  </section>
</template>
<style scoped>
.muted { color: var(--muted); } .small { font-size: 0.82rem; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); margin-top: 1rem; }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.6rem; }
.actions { margin-top: 0.8rem; display: flex; gap: 0.6rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost { background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: var(--danger); } .stats { list-style: none; display: flex; flex-wrap: wrap; gap: 1.2rem; padding: 0; margin: 0.4rem 0; }
.stats strong { font-size: 1.3rem; color: var(--ink-800); display: block; } .sheets { padding-left: 1rem; }
</style>
```
(If `--ink-800`/`--on-accent` aren't defined, use the nearest token a sibling view uses. The route `/app/import` and nav entry from Phase 1 are unchanged.)

- [ ] **Step 5: Run → PASS** — `npx vitest run tests/PortfolioImportView.test.js`.

- [ ] **Step 6: Commit**
```bash
git add client/src/lib/resource.js client/src/views/PortfolioImportView.vue client/tests/PortfolioImportView.test.js
git commit -m "feat(client): import preview → confirm with validation results"
```

---

## Task 6: Full-suite, build, then clear + re-import (operational)

**Files:** none (verification + data operation).

- [ ] **Step 1: Server suite** — `server/`: `npx vitest run` → all pass.
- [ ] **Step 2: Client suite + build** — `client/`: `npx vitest run` and `npm run build` → pass / no errors.
- [ ] **Step 3: Controller performs the clear + re-import** (NOT a subagent step): back up already exists; clear operational data keeping Admin + estates + towers (existing procedure), then `node scripts/import-portfolio.js` against the real workbook; capture created/updated/skipped/failed + flagged counts; spot-check that former Layout-A rows now map (e.g. a 2023 `Ibiza/19A` row has `unitNumber="19A"`, a real tower link or flagged, and correct lessor/lessee).
- [ ] **Step 4:** Commit any incidental fixes.

---

## Self-Review notes

- **Spec coverage:** (1) ADMIN upload ✓ T4/T5; (2) validation of type/structure/headers/fields/dates/duplicates ✓ T2/T3; (3) preview before save ✓ T3 analyze + T5; (4) clear errors + re-upload ✓ T5; (5) success/skip/fail reporting ✓ T3; (6) stable keys + create/update ✓ T3; (7) unit/owner/lease separate ✓ T3; (8) link same owner across units (exact name) ✓ T3; (9) no name-only merge of ambiguous (joint/blank → needsReview, no fuzzy) ✓ T3; (10) idempotent ✓ T3; (11) no accounts ✓ T3 test; (12) no auto-available + flag uncertain ✓ T1/T3.
- **Header-based, not positional** — T2 proves both layouts; unstructured sheet → reported.
- **Preview writes nothing** — asserted in T3 + T4.
- **Type consistency:** service exports `analyzeWorkbook`/`commitWorkbook`/`commitFromFile`; parser exports `parseFromBuffer`; controller `preview`/`commit`; routes `/portfolio/preview` + `/portfolio/commit`; client `portfolioImport.preview`/`.commit`. Consistent across tasks.
- Manual-SQL migration, no new packages, commit trailer — honored.
