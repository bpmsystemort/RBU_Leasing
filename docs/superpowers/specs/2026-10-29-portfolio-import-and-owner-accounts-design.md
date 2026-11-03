# Portfolio Import & Owner Portal Accounts — Design

**Date:** 2026-10-29
**Status:** Approved (design)
**Area:** data import · unit/lease/owner records · auth (owner accounts)

## Goal

Two connected features:

1. **Idempotent portfolio import** — load existing units, owners, tenants, and
   leases from the monitoring workbook *Unit Lease_Residential Leasing.xlsx*
   (all year sheets) into the system, re-runnably, without creating duplicates
   or destroying existing data, and **without creating any login accounts**.
2. **Owner portal accounts** — let existing (imported) Unit Owners get a login,
   either by **RBU invitation** or by **self-registration linked to an existing
   owner**, never creating a duplicate owner.

**This spec builds Phase 1 (import) first; Phase 2 (accounts) is outlined for
context and built after Phase 1 is reviewed.**

## Background (current state)

- **Import already ~80% exists** as a CLI script,
  `server/scripts/import-portfolio.js`: it reads the workbook's **"2026"**
  sheet, maps a fixed column layout (verified to match the file), and creates
  owners → units → tenants → leases using the cleaning helpers in
  `server/src/lib/importClean.js` (`text/money/toDate/leaseStatus/key`) and the
  building→tower mapper `server/src/lib/towerMap.js` (`towerNameFor`). It dedups
  **within a run** (owner by name, unit by `building|unitNumber`, tenant by
  name). Two problems: it **`deleteMany`-wipes** `lease/unit/tenant/unitOwner`
  first (destructive, not idempotent across runs), and it reads only the
  **2026** sheet.
- The workbook has **four sheets: 2023, 2024, 2025, 2026** (yearly monitoring;
  2025/2026 carry extra trailing columns beyond the core 2–19 used here).
- **Models:** `UnitOwner` (business record, not a login; `name`, optional
  `email/phone/address`; `units Unit[]`, `users User[]`), `Unit`
  (`ownerId` req, `building?`, `towerId?`, `unitNumber`, …, `leases Lease[]`),
  `Lease` (`unitId`, `tenantId`, dates, `monthlyRent`, `status` ACTIVE/EXPIRED,
  plus `advanceRent/securityDeposit/modeOfPayment/serviceFee/source/renewalPeriod/remarks/managedBy`),
  `Tenant`, `User` (login; `email @unique`; `role`; optional `unitOwnerId`/`tenantId`).
  **None of `UnitOwner`/`Unit`/`Lease` has a unique constraint** today.
- **Auth:** JWT; self-signup → `User` PENDING → `approveAccount` **creates a new
  `UnitOwner`/`Tenant`** and links it. No path links an account to an *existing*
  owner. No invitation mechanism.
- **Migrations:** manual SQL in `server/prisma/manual-migrations/`, applied with
  `prisma db execute` to dev + test DBs, then `prisma generate` (never
  `migrate dev`/`db push`).
- **Deps already present:** `exceljs`, `multer`. No new packages.

## Decisions (locked)

| Topic | Decision |
|---|---|
| History scope | Import **all four sheets (2023–2026)**; each year's row for a unit becomes another (historical) lease. |
| Idempotency | **Unique indexes** via a manual migration, enforced through normalized key columns so Prisma `upsert` can use them. **No `deleteMany`.** |
| Owner key | Normalized **name** (`UnitOwner.nameKey`). |
| Unit key | Owner + **building + unit number + tower** (`Unit.unitKey`). |
| Lease key | `(unitId, tenantId, startDate, endDate)`. |
| Owner email | Not an import key (sheet has none); **written onto the `UnitOwner` when that owner creates/accepts an account** (Phase 2). |
| Import surface | **ADMIN upload page in the portal** (multer), showing an import summary. The CLI stays, re-pointed at the shared service. |
| Owner accounts | Self-registering owner is **linked to an existing owner by the officer at approval**; invitations produce a **copyable accept-link** (no outbound email in the system). |

## Data model changes

**Phase 1 (manual migration, both DBs, then `prisma generate`):**

```prisma
model UnitOwner {
  // normalized name for idempotent owner matching: key(name)
  nameKey String?
  @@unique([nameKey])
}
model Tenant {
  // normalized name so tenantId is STABLE across re-imports (the lease key
  // depends on it — without this, re-import would mint a new tenant and
  // duplicate every lease).
  nameKey String?
  @@unique([nameKey])
}
model Unit {
  // normalized identity within an owner: key(building)|key(unitNumber)|towerId
  unitKey String?
  @@unique([ownerId, unitKey])
}
model Lease {
  @@unique([unitId, tenantId, startDate, endDate])
}
```

- `nameKey`/`unitKey` are **nullable** so pre-existing portal-created rows (which
  may not have keys) don't collide — Postgres unique indexes allow multiple
  NULLs. Import rows always carry a key.
- The migration **backfills** `UnitOwner.nameKey`, `Tenant.nameKey`, and
  `Unit.unitKey` for existing rows, then adds the indexes. **Pre-existing
  duplicates must be absent** for a unique index to apply; the current data came
  from the within-run-dedup script, so it is expected unique — this is verified
  before each index is created, and any dup is resolved first.

**Phase 2 (later):** `UnitOwner.email` is written on account creation; a new
`OwnerInvite` (token → `unitOwnerId`, expiry, consumedAt) backs invitations.

## Phase 1 — Idempotent import + portal upload

### Import service — `server/src/services/portfolioImportService.js` (new)
- Parse a workbook (Buffer or path). Iterate **every year sheet present** (2023–
  2026), using the existing fixed column map (cols 2–19) and `importClean`.
- For each valid row (requires lessee, unitNumber, startDate, endDate,
  monthlyRent — same skip rule as today):
  - **Owner:** `upsert` by `nameKey = key(lessor || "Unknown Owner")` → create
    `{ name, nameKey }` or reuse. **Never creates a `User`.**
  - **Unit:** `upsert` by `(ownerId, unitKey)` where
    `unitKey = key(building)|key(unitNumber)|(towerId ?? "")`; create with the
    building/floor/slot/type/baseRent + derived `towerId`
    (`towerByName.get(towerNameFor(building))`), `status "OCCUPIED"`; on re-import,
    update the mutable descriptive fields but never fork a second unit.
  - **Tenant:** `upsert` by `nameKey = key(name)` (cross-run stable, so the
    lease key's `tenantId` is stable and re-import never duplicates leases).
  - **Lease:** `upsert` by `(unitId, tenantId, startDate, endDate)` → create/update
    the lease fields; `status` from `leaseStatus(endDate, new Date())` (**real
    now**, not the hardcoded 2026-08-07).
- Return `{ owners, units, tenants, leases, skipped, skips[] }`.
- In-run caches keyed by the same normalized keys keep one file's repeated rows
  from re-querying.

### Upload endpoint (ADMIN) — new
- `routes/importRoutes.js`: `POST /api/import/portfolio` behind `verifyJwt` +
  `requireRole("ADMIN")`, `multer` single `.xlsx` (memory storage, size cap,
  mimetype filter like the requirement uploads).
- `controllers/importController.js`: hand the uploaded buffer to the service,
  return the summary JSON.
- `validation/import.js`: (minimal) — the file is validated by multer; optional
  `sheets` selector later.
- Mount `app.use("/api/import", importRoutes)` in `app.js`.

### Admin page — new
- `client/src/views/PortfolioImportView.vue`: drag/drop or pick a `.xlsx`, POST
  it, show the returned summary (owners/units/tenants/leases created, rows
  skipped, first few skips). Guard to ADMIN.
- Route under `/app` (ADMIN), a nav entry in `AppLayout` STAFF/admin group, and a
  `resource.js` wrapper `portfolioImport.upload(file)` (FormData, like the
  requirement upload).

### CLI — `server/scripts/import-portfolio.js`
- Re-point at the service (read file → call the service), **removing the
  `deleteMany` wipe**; keep the console summary.

### Tests — `server/tests/portfolioImport.test.js`
- Import a small fixture workbook **twice** → **owners/units/leases counts
  identical** (no duplicates).
- One owner with two units → one `UnitOwner`, two `Unit`.
- Same unit across two year sheets → one `Unit`, two `Lease` (history).
- Incomplete rows skipped; **no `User` is ever created** by import.
- Endpoint: ADMIN upload → 200 + summary; non-admin → 403.

## Phase 2 — Owner accounts (outline, built after Phase 1)

- **Link-to-existing-owner at approval:** `approveAccount` accepts an optional
  `existingUnitOwnerId` → link the new `User` to that owner instead of creating
  one, and **write the account's `contactEmail` onto `UnitOwner.email`**.
  `AccountApprovalsView` gains a "link to existing owner" picker.
- **Invitations:** `OwnerInvite` (token → `unitOwnerId`); admin action on
  `OwnersView` "Invite to portal" → **copyable accept-link**; public
  `/accept-invite?token=…` page where the owner sets username/password →
  **APPROVED `UNIT_OWNER` linked to that existing owner**, `UnitOwner.email` set;
  guard against an owner who already has an account and against a consumed/expired
  token.
- Tests for both paths (correct owner linked; no duplicate owner/account).

## Edge cases / safety

- **Non-destructive:** no `deleteMany`; re-import only upserts. Portal-created
  units/owners (null keys) are never touched by import.
- **Incomplete rows** (missing lessee/unit/dates/rent) are skipped and reported.
- **Building→tower** via `towerNameFor`; unmapped buildings → `towerId null`
  (unit still imported; `unitKey` uses empty tower segment).
- **Historical leases** are preserved — each yearly row is its own lease under
  the one unit.
- **Backfill/dup check** precede the unique index creation.

## Out of scope

- Changing the Excel column layout or the `towerMap` rules.
- Importing the extra 2025/2026 trailing columns (beyond cols 2–19).
- Outbound email (invitations are copyable links).
- Tenant onboarding and the leasing pipeline (unchanged).
