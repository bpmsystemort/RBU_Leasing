# Portfolio Import (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Excel portfolio import idempotent (re-runnable with no duplicates, nothing destroyed), covering all year sheets, and expose it as an ADMIN upload page in the portal — importing owners/units/tenants/leases but **never** a login account.

**Architecture:** A new `portfolioImportService` parses the workbook (all `YYYY` sheets) and matches owners (by normalized name), tenants (by normalized name), units (by owner + normalized building/unit/tower), and leases (by `unit+tenant+start+end`) with find-then-create, so a re-run updates in place instead of duplicating. Idempotency is backed by normalized key columns + unique indexes added in a manual migration that also backfills existing rows. An ADMIN multer endpoint and a Vue upload page drive it; the existing CLI is re-pointed at the service with its destructive wipe removed.

**Tech Stack:** Node/Express + Prisma (PostgreSQL) + `exceljs` + `multer` (all present); Vue 3 + Vitest/@vue/test-utils.

## Global Constraints

- **Non-destructive & idempotent:** never `deleteMany`; re-import only finds-or-creates then updates. Portal-created rows must never be forked or clobbered.
- **Importing an owner must NOT create a `User`.**
- **Migration drift — never `prisma migrate dev`/`db push`.** Schema changes go in as manual SQL (`prisma db execute`) against BOTH `rbu_leasing` (dev, `server/.env`) and `rbu_leasing_test` (test, `server/.env.test`), then `prisma generate`. SQL lives in `server/prisma/manual-migrations/`.
- **No new packages.** `exceljs` and `multer` are already dependencies.
- **No renames** of existing identifiers/routes. Existing features must keep working.
- **Normalization must match exactly** between JS and SQL. The JS key is `importClean.key(s)` = `String(s||"").trim().toLowerCase().replace(/\s+/g," ")`. The backfill runs in **JS using `key()`** (not hand-written SQL) so there is no drift.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Server commands run from `server/`, client commands from `client/`. Branch: `feat/portfolio-import`.
- **Windows/Prisma lock:** a running :5050 server holds the Prisma engine DLL and breaks `prisma generate` with EPERM. Before any `prisma generate`, stop the :5050 server and, if present, its auto-restart launcher (kill the `cmd.exe` loop that runs `run-server.cmd` **and** its child `node.exe`). If a lock persists, report it rather than force-killing blindly; restart the server after.

## File Structure

**Server**
- Modify `server/prisma/schema.prisma` — add `nameKey`/`unitKey` + `@@unique` blocks.
- Create `server/prisma/manual-migrations/2026-10-29-import-idempotency.sql`.
- Create `server/scripts/backfill-import-keys.mjs` (one-time backfill + dup check).
- Modify `server/tests/dashboardWindows.test.js` — make one factory lease's key distinct.
- Create `server/src/services/portfolioImportService.js`.
- Create `server/src/routes/importRoutes.js`, `server/src/controllers/importController.js`.
- Modify `server/src/app.js` (mount), `server/scripts/import-portfolio.js` (re-point, drop wipe).
- Test `server/tests/portfolioImport.test.js`.

**Client**
- Create `client/src/views/PortfolioImportView.vue`.
- Modify `client/src/router/index.js` (route), `client/src/components/AppLayout.vue` (nav), `client/src/lib/resource.js` (wrapper).
- Test `client/tests/PortfolioImportView.test.js`.

---

## Task 1: Idempotency keys + unique indexes (migration + backfill)

**Files:**
- Modify: `server/prisma/schema.prisma`, `server/tests/dashboardWindows.test.js`
- Create: `server/prisma/manual-migrations/2026-10-29-import-idempotency.sql`, `server/scripts/backfill-import-keys.mjs`

**Interfaces:**
- Produces: `UnitOwner.nameKey @@unique([nameKey])`, `Tenant.nameKey @@unique([nameKey])`, `Unit.unitKey @@unique([ownerId, unitKey])`, `Lease @@unique([unitId, tenantId, startDate, endDate])`; existing rows backfilled. Consumed by Task 2's find-then-create (`findUnique` by these keys).

- [ ] **Step 1: Add the fields + uniques to the schema**

In `server/prisma/schema.prisma`:
- In `model UnitOwner` add a line `  nameKey String?` and, just before its closing `}`, add `  @@unique([nameKey])`.
- In `model Tenant` add `  nameKey String?` and `  @@unique([nameKey])`.
- In `model Unit` add `  unitKey String?` and `  @@unique([ownerId, unitKey])`.
- In `model Lease` add (no new column) `  @@unique([unitId, tenantId, startDate, endDate])`.

- [ ] **Step 2: Write the column-add SQL**

Create `server/prisma/manual-migrations/2026-10-29-import-idempotency.sql` with ONLY the column adds for now (indexes are appended in Step 7, after the backfill):

```sql
-- Normalized keys for idempotent import. Nullable: a Postgres unique index
-- allows multiple NULLs (and, for a composite index, treats any-NULL rows as
-- distinct), so rows without a key never collide.
ALTER TABLE "UnitOwner" ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Tenant"    ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Unit"      ADD COLUMN IF NOT EXISTS "unitKey" TEXT;
```

- [ ] **Step 3: Apply the columns to both DBs**

From `server/`:
```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-29-import-idempotency.sql
DATABASE_URL="$(grep '^DATABASE_URL' .env.test | cut -d'"' -f2)" npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-29-import-idempotency.sql
```
Expected: `Script executed successfully.` twice. (If `.env.test` quotes its value differently, read its `DATABASE_URL` and pass it however the other manual migrations in this repo were applied.)

- [ ] **Step 4: Regenerate the client** (stop the :5050 server first — see Global Constraints)

From `server/`: `npx prisma generate`
Expected: `Generated Prisma Client`. Restart the server afterward if you stopped it.

- [ ] **Step 5: Write the backfill + dup-check script**

Create `server/scripts/backfill-import-keys.mjs`:

```js
import "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { key } from "../src/lib/importClean.js";

async function main() {
  const owners = await prisma.unitOwner.findMany({ select: { id: true, name: true } });
  for (const o of owners) await prisma.unitOwner.update({ where: { id: o.id }, data: { nameKey: key(o.name) } });

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) await prisma.tenant.update({ where: { id: t.id }, data: { nameKey: key(t.name) } });

  const units = await prisma.unit.findMany({ select: { id: true, building: true, unitNumber: true, towerId: true } });
  for (const u of units) {
    const unitKey = `${key(u.building)}|${key(u.unitNumber)}|${u.towerId ?? ""}`;
    await prisma.unit.update({ where: { id: u.id }, data: { unitKey } });
  }

  // A unique index cannot be created while duplicates exist — surface any before Step 7.
  const ownerDups = await prisma.$queryRawUnsafe(`SELECT "nameKey", COUNT(*) FROM "UnitOwner" WHERE "nameKey" IS NOT NULL GROUP BY "nameKey" HAVING COUNT(*) > 1`);
  const tenantDups = await prisma.$queryRawUnsafe(`SELECT "nameKey", COUNT(*) FROM "Tenant" WHERE "nameKey" IS NOT NULL GROUP BY "nameKey" HAVING COUNT(*) > 1`);
  const unitDups = await prisma.$queryRawUnsafe(`SELECT "ownerId", "unitKey", COUNT(*) FROM "Unit" WHERE "unitKey" IS NOT NULL GROUP BY "ownerId", "unitKey" HAVING COUNT(*) > 1`);
  const leaseDups = await prisma.$queryRawUnsafe(`SELECT "unitId", "tenantId", "startDate", "endDate", COUNT(*) FROM "Lease" GROUP BY "unitId", "tenantId", "startDate", "endDate" HAVING COUNT(*) > 1`);

  console.log(`backfilled: owners=${owners.length} tenants=${tenants.length} units=${units.length}`);
  const dups = { owners: ownerDups.length, tenants: tenantDups.length, units: unitDups.length, leases: leaseDups.length };
  console.log("duplicate groups (must all be 0):", dups);
  if (ownerDups.length || tenantDups.length || unitDups.length || leaseDups.length) {
    console.error("DUPLICATES present — resolve them before creating the unique indexes (Step 7).");
    console.error({ ownerDups, tenantDups, unitDups, leaseDups });
    process.exitCode = 2;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Run the backfill on both DBs**

From `server/`:
```bash
node scripts/backfill-import-keys.mjs
DATABASE_URL="$(grep '^DATABASE_URL' .env.test | cut -d'"' -f2)" node scripts/backfill-import-keys.mjs
```
Expected: both print `duplicate groups (must all be 0): { owners: 0, tenants: 0, units: 0, leases: 0 }` and exit 0. (The test DB is normally empty here, so its counts are all 0.) **If any count is non-zero, STOP and report the printed duplicates** — a human resolves them before indexes can be created.

- [ ] **Step 7: Append the unique indexes to the SQL and apply to both DBs**

Append to `server/prisma/manual-migrations/2026-10-29-import-idempotency.sql`:

```sql
-- Index names follow Prisma's @@unique convention so schema and DB agree.
CREATE UNIQUE INDEX IF NOT EXISTS "UnitOwner_nameKey_key" ON "UnitOwner"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_nameKey_key" ON "Tenant"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Unit_ownerId_unitKey_key" ON "Unit"("ownerId", "unitKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Lease_unitId_tenantId_startDate_endDate_key" ON "Lease"("unitId", "tenantId", "startDate", "endDate");
```

Apply to both DBs with the same two `prisma db execute` commands as Step 3. Expected: success twice.

- [ ] **Step 8: Fix the one existing test that now collides with the Lease unique**

`server/tests/dashboardWindows.test.js` creates five factory leases on the same unit+tenant; two of them (the first ACTIVE one and the EXPIRED one) share the default `startDate` (2026-01-01) and `endDate` 2026-06-25, which the new `Lease` unique now forbids. Give the EXPIRED one a distinct `startDate` (the test only counts ACTIVE leases by `endDate`, so this preserves its intent). Change the EXPIRED line to:

```js
    await factory.lease(unitId, tenantId, { status: "EXPIRED", startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-06-25T00:00:00Z") }); // not ACTIVE
```

- [ ] **Step 9: Verify indexes exist and the touched test passes**

From `server/`:
```bash
node -e "import('./src/lib/prisma.js').then(async ({ prisma }) => { const r = await prisma.\$queryRawUnsafe(\"select indexname from pg_indexes where indexname in ('UnitOwner_nameKey_key','Tenant_nameKey_key','Unit_ownerId_unitKey_key','Lease_unitId_tenantId_startDate_endDate_key') order by 1\"); console.log(r.map(x => x.indexname)); await prisma.\$disconnect(); process.exit(r.length === 4 ? 0 : 1); })"
npx vitest run tests/dashboardWindows.test.js
```
Expected: four index names printed (exit 0); dashboardWindows tests PASS.

- [ ] **Step 10: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/manual-migrations/2026-10-29-import-idempotency.sql server/scripts/backfill-import-keys.mjs server/tests/dashboardWindows.test.js
git commit -m "feat(db): normalized keys + unique indexes for idempotent portfolio import"
```

---

## Task 2: Idempotent import service (+ re-point CLI)

**Files:**
- Create: `server/src/services/portfolioImportService.js`
- Modify: `server/scripts/import-portfolio.js`
- Test: `server/tests/portfolioImport.test.js`

**Interfaces:**
- Consumes: Task 1's keys/uniques; `importClean` (`text/money/toDate/leaseStatus/key`), `towerMap.towerNameFor`, `lib/prisma`.
- Produces: `importWorkbook(buffer) → { owners, units, tenants, leases, skipped, skips }` and `importFromFile(path)`. Consumed by Task 3 and the CLI.

- [ ] **Step 1: Write the failing test**

Create `server/tests/portfolioImport.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

From `server/`: `npx vitest run tests/portfolioImport.test.js`
Expected: FAIL (service module missing).

- [ ] **Step 3: Write the service**

Create `server/src/services/portfolioImportService.js`:

```js
import { createRequire } from "module";
import { prisma } from "../lib/prisma.js";
import { text, money, toDate, leaseStatus, key } from "../lib/importClean.js";
import { towerNameFor } from "../lib/towerMap.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const isYearSheet = (name) => /^\d{4}$/.test(String(name).trim());

export async function importWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const owners = new Map();  // nameKey -> ownerId
  const tenants = new Map();  // nameKey -> tenantId
  const units = new Map();   // `${ownerId}|${unitKey}` -> unitId
  const summary = { owners: 0, units: 0, tenants: 0, leases: 0, skipped: 0, skips: [] };
  const now = new Date();

  for (const ws of wb.worksheets.filter((w) => isYearSheet(w.name))) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values; // exceljs 1-indexed; v[1] ignored
      const building = text(v[3]);
      const unitNumber = text(v[4]);
      const unitType = text(v[5]) || "OTHER";
      const floor = text(v[6]);
      const slotNo = text(v[7]);
      const lessor = text(v[8]);
      const lessee = text(v[9]);
      const startDate = toDate(v[10]);
      const endDate = toDate(v[11]);
      const monthlyRent = money(v[13]);

      if (!lessee || !unitNumber || !startDate || !endDate || monthlyRent == null) {
        if (lessee || unitNumber) { summary.skipped++; summary.skips.push({ sheet: ws.name, row: r, lessee, unitNumber }); }
        continue;
      }

      // Owner — matched by normalized name; NEVER creates a User.
      const ownerName = lessor || "Unknown Owner";
      const ownerKey = key(ownerName);
      let ownerId = owners.get(ownerKey);
      if (ownerId === undefined) {
        let owner = await prisma.unitOwner.findUnique({ where: { nameKey: ownerKey } });
        if (!owner) { owner = await prisma.unitOwner.create({ data: { name: ownerName, nameKey: ownerKey } }); summary.owners++; }
        ownerId = owner.id; owners.set(ownerKey, ownerId);
      }

      // Tenant — matched by normalized name (keeps tenantId stable across re-imports).
      const tKey = key(lessee);
      let tenantId = tenants.get(tKey);
      if (tenantId === undefined) {
        let tenant = await prisma.tenant.findUnique({ where: { nameKey: tKey } });
        if (!tenant) { tenant = await prisma.tenant.create({ data: { name: lessee, nameKey: tKey } }); summary.tenants++; }
        tenantId = tenant.id; tenants.set(tKey, tenantId);
      }

      // Unit — matched by owner + normalized building/unit/tower.
      const towerId = towerByName.get(towerNameFor(building)) ?? null;
      const unitKey = `${key(building)}|${key(unitNumber)}|${towerId ?? ""}`;
      const uMapKey = `${ownerId}|${unitKey}`;
      let unitId = units.get(uMapKey);
      if (unitId === undefined) {
        let unit = await prisma.unit.findUnique({ where: { ownerId_unitKey: { ownerId, unitKey } } });
        const descriptive = { floor, slotNo, type: unitType, baseRent: monthlyRent }; // key fields never change
        if (unit) {
          await prisma.unit.update({ where: { id: unit.id }, data: descriptive });
        } else {
          unit = await prisma.unit.create({ data: { ownerId, unitKey, unitNumber, building, towerId, status: "OCCUPIED", ...descriptive } });
          summary.units++;
        }
        unitId = unit.id; units.set(uMapKey, unitId);
      }

      // Lease — natural key (unit, tenant, start, end).
      const leaseData = {
        monthlyRent, status: leaseStatus(endDate, now),
        advanceRent: text(v[14]), securityDeposit: text(v[15]), modeOfPayment: text(v[16]),
        serviceFee: text(v[17]), source: text(v[18]), remarks: text(v[19]),
        renewalPeriod: text(v[12]), managedBy: text(v[2]),
      };
      const existing = await prisma.lease.findUnique({
        where: { unitId_tenantId_startDate_endDate: { unitId, tenantId, startDate, endDate } },
        select: { id: true },
      });
      if (existing) {
        await prisma.lease.update({ where: { id: existing.id }, data: leaseData });
      } else {
        await prisma.lease.create({ data: { unitId, tenantId, startDate, endDate, ...leaseData } });
        summary.leases++;
      }
    }
  }
  return summary;
}

export async function importFromFile(path) {
  const { readFile } = await import("fs/promises");
  return importWorkbook(await readFile(path));
}
```

- [ ] **Step 4: Run the test to verify it passes**

From `server/`: `npx vitest run tests/portfolioImport.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Re-point the CLI (remove the wipe)**

Replace the contents of `server/scripts/import-portfolio.js` with:

```js
import "../src/env.js";
import { importFromFile } from "../src/services/portfolioImportService.js";
import { prisma } from "../src/lib/prisma.js";

const file = process.argv[2] || "Unit Lease_Residential Leasing.xlsx";

importFromFile(file)
  .then((s) => {
    console.log(`Imported (idempotent): ${s.owners} new owners, ${s.tenants} new tenants, ${s.units} new units, ${s.leases} new leases. Skipped ${s.skipped} incomplete rows.`);
    if (s.skips.length) console.log("First skips:", s.skips.slice(0, 8));
  })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Commit**

```bash
git add server/src/services/portfolioImportService.js server/scripts/import-portfolio.js server/tests/portfolioImport.test.js
git commit -m "feat(import): idempotent portfolio import service; CLI no longer wipes"
```

---

## Task 3: ADMIN upload endpoint

**Files:**
- Create: `server/src/routes/importRoutes.js`, `server/src/controllers/importController.js`
- Modify: `server/src/app.js`, `server/tests/portfolioImport.test.js` (append)

**Interfaces:**
- Consumes: `importWorkbook` (Task 2); `middleware/auth` (`verifyJwt`, `requireRole`); `lib/errors.InvalidReferenceError`.
- Produces: `POST /api/import/portfolio` (ADMIN, multer field `file`) → summary JSON.

- [ ] **Step 1: Write the failing test (append to the existing file)**

At the TOP of `server/tests/portfolioImport.test.js`, extend the helpers import and add two more imports:
```js
import { resetCrudTables, tokens } from "./helpers.js";
import request from "supertest";
import { createApp } from "../src/app.js";
```
Then append these blocks at the end of the file:

```js
const app = createApp();

describe("portfolio import — endpoint", () => {
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("ADMIN upload returns a summary; an officer is refused", async () => {
    const buf = await workbook({ "2024": [L()] });
    const ok = await request(app).post("/api/import/portfolio")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .attach("file", buf, { filename: "portfolio.xlsx", contentType: XLSX });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ owners: 1, units: 1, leases: 1 });

    const forbidden = await request(app).post("/api/import/portfolio")
      .set("Authorization", `Bearer ${tokens.officer()}`)
      .attach("file", buf, { filename: "portfolio.xlsx", contentType: XLSX });
    expect(forbidden.status).toBe(403);
  });

  it("rejects a request with no file (400)", async () => {
    const res = await request(app).post("/api/import/portfolio").set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

From `server/`: `npx vitest run tests/portfolioImport.test.js`
Expected: FAIL (route 404 for the ADMIN case).

- [ ] **Step 3: Controller**

Create `server/src/controllers/importController.js`:

```js
import { importWorkbook } from "../services/portfolioImportService.js";
import { InvalidReferenceError } from "../lib/errors.js";

export async function portfolio(req, res, next) {
  try {
    if (!req.file) throw new InvalidReferenceError("An .xlsx file is required");
    res.json(await importWorkbook(req.file.buffer));
  } catch (err) { next(err); }
}
```

- [ ] **Step 4: Routes (ADMIN only, multer memory storage)**

Create `server/src/routes/importRoutes.js` (mirrors the lessor-requirements upload route):

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
router.post("/portfolio", requireRole("ADMIN"), upload.single("file"), ctrl.portfolio);
export default router;
```

- [ ] **Step 5: Mount it in `app.js`**

In `server/src/app.js`, add with the other route imports:
```js
import importRoutes from "./routes/importRoutes.js";
```
and mount it alongside the other `/api/*` mounts (e.g. just after the `app.use("/api/audit", auditRoutes);` line):
```js
  app.use("/api/import", importRoutes);
```

- [ ] **Step 6: Run the test to verify it passes**

From `server/`: `npx vitest run tests/portfolioImport.test.js`
Expected: PASS (all blocks, 7 tests total).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/importRoutes.js server/src/controllers/importController.js server/src/app.js server/tests/portfolioImport.test.js
git commit -m "feat(import): ADMIN portfolio upload endpoint"
```

---

## Task 4: Admin upload page

**Files:**
- Create: `client/src/views/PortfolioImportView.vue`
- Modify: `client/src/lib/resource.js`, `client/src/router/index.js`, `client/src/components/AppLayout.vue`
- Test: `client/tests/PortfolioImportView.test.js`

**Interfaces:**
- Consumes: `POST /api/import/portfolio` (Task 3); `lib/api.api`.
- Produces: `/app/import` (ADMIN) page; `resource.portfolioImport.upload(file)`.

- [ ] **Step 1: Add the client API wrapper**

In `client/src/lib/resource.js` (`api` is already imported at the top), add near the other upload wrappers:
```js
export const portfolioImport = {
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/import/portfolio", form).then((r) => r.data);
  },
};
```

- [ ] **Step 2: Write the failing test**

Create `client/tests/PortfolioImportView.test.js`:

```js
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
```

- [ ] **Step 3: Run it to verify it fails**

From `client/`: `npx vitest run tests/PortfolioImportView.test.js`
Expected: FAIL (view missing).

- [ ] **Step 4: Create the view**

Create `client/src/views/PortfolioImportView.vue`:

```vue
<script setup>
import { ref, computed } from "vue";
import { portfolioImport } from "../lib/resource.js";

const file = ref(null);
const busy = ref(false);
const error = ref("");
const result = ref(null);

const canImport = computed(() => !!file.value && !busy.value);

function onPick(e) { file.value = e.target.files?.[0] || null; result.value = null; error.value = ""; }

async function run() {
  if (!file.value) return;
  busy.value = true; error.value = ""; result.value = null;
  try { result.value = await portfolioImport.upload(file.value); }
  catch (e) { error.value = e.response?.data?.error || "Import failed."; }
  finally { busy.value = false; }
}
</script>

<template>
  <section>
    <header>
      <h1>Import Portfolio</h1>
      <p class="muted">Upload the monitoring workbook (.xlsx). Re-importing the same file is safe — nothing is duplicated or deleted, and no login accounts are created.</p>
    </header>

    <div class="panel">
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onPick" />
      <p v-if="file" class="muted small">Selected: {{ file.name }}</p>
      <div class="actions">
        <button type="button" class="primary" :disabled="!canImport" @click="run">{{ busy ? "Importing…" : "Import" }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-if="result" class="panel summary">
      <div class="panel__label">Import summary</div>
      <ul class="stats">
        <li><strong>{{ result.owners }}</strong> owners</li>
        <li><strong>{{ result.units }}</strong> units</li>
        <li><strong>{{ result.tenants }}</strong> tenants</li>
        <li><strong>{{ result.leases }}</strong> leases</li>
        <li><strong>{{ result.skipped }}</strong> rows skipped</li>
      </ul>
      <details v-if="result.skips?.length">
        <summary>First skipped rows</summary>
        <ul><li v-for="(s, i) in result.skips.slice(0, 8)" :key="i">sheet {{ s.sheet }}, row {{ s.row }} — {{ s.lessee || '—' }} / {{ s.unitNumber || '—' }}</li></ul>
      </details>
    </div>
  </section>
</template>

<style scoped>
.muted { color: var(--muted); }
.small { font-size: 0.82rem; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); margin-top: 1rem; }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.6rem; }
.actions { margin-top: 0.8rem; }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: var(--danger); margin-top: 0.6rem; }
.stats { list-style: none; display: flex; flex-wrap: wrap; gap: 1.2rem; padding: 0; margin: 0; }
.stats strong { font-size: 1.3rem; color: var(--ink-800); display: block; }
</style>
```

(These CSS variables are used across the existing views; if `--ink-800` or `--on-accent` is not defined in the app's theme, substitute the nearest token used by a sibling view such as `OwnersView.vue`. The test asserts behaviour only, so exact styling is not load-bearing.)

- [ ] **Step 5: Register the route (ADMIN)**

In `client/src/router/index.js`, add with the other (non-lazy) view imports:
```js
import PortfolioImportView from "../views/PortfolioImportView.vue";
```
and add this child of `/app`, next to the Super-Admin routes (`users`/`audit`):
```js
      { path: "import", component: PortfolioImportView, meta: { roles: ["ADMIN"] } },
```

- [ ] **Step 6: Add the nav entry**

In `client/src/components/AppLayout.vue`, in `STAFF_GROUPS` → the **Administration** group's `items` array, add (the `download` icon exists in `AppIcon.vue`; `admin: true` gates the link to Super Admin):
```js
    { to: "/app/import", label: "Import Portfolio", icon: "download", admin: true },
```

- [ ] **Step 7: Run the test to verify it passes**

From `client/`: `npx vitest run tests/PortfolioImportView.test.js`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add client/src/views/PortfolioImportView.vue client/src/router/index.js client/src/components/AppLayout.vue client/src/lib/resource.js client/tests/PortfolioImportView.test.js
git commit -m "feat(client): ADMIN portfolio import upload page"
```

---

## Task 5: Full-suite verification and build

**Files:** none (verification only).

- [ ] **Step 1: Server suite** — from `server/`: `npx vitest run` → all pass (new `portfolioImport` + the untouched suites, including `dashboardWindows`).
- [ ] **Step 2: Client suite** — from `client/`: `npx vitest run` → all pass (new `PortfolioImportView` + the rest).
- [ ] **Step 3: Build** — from `client/`: `npm run build` → completes with no errors.
- [ ] **Step 4:** If any incidental fix was needed, commit it (`git add -A && git commit -m "test: green suites for portfolio import"`); otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** idempotent all-year import (Task 2, year-sheet filter + find-then-create); owners imported without accounts (Task 2 test asserts 0 UNIT_OWNER users); one owner→many units and many leases→one unit incl. history (Task 2 tests); normalized key columns + unique indexes + backfill + dup-check (Task 1); ADMIN portal upload page + endpoint (Tasks 3–4); CLI re-pointed with the wipe removed (Task 2). All present.
- **Idempotency correctness:** owner/tenant matched by normalized name, unit by owner+building+unit+tower, lease by `unit+tenant+start+end`; tenant is DB-keyed so `tenantId` is stable across re-imports (prevents duplicate leases). Backfill uses the same `key()` as the service — no JS/SQL drift. Counts come from explicit find-then-create, not a timestamp heuristic.
- **Regression guarded:** the new `Lease` unique collides with exactly one existing test (`dashboardWindows`), fixed in Task 1 Step 8 without changing its intent; all other multi-lease tests vary unit or tenant. Pre-existing DB duplicates are caught by the Step 6 dup-check before any index is created.
- **Non-destructive:** no `deleteMany` anywhere; only find-then-create/update. Verified names/paths against the codebase: `createApp`, `errorHandler` body `{ error, code }`, `verifyJwt`/`requireRole`, `InvalidReferenceError` (400), `resetCrudTables`/`tokens`/`factory`, `api` from `lib/api.js`, `AppIcon` `download`. No new packages; manual-SQL-only migration honored.
```
