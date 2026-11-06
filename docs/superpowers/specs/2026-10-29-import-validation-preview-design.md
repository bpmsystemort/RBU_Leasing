# Portfolio Import v2 — Header-Mapped, Validated, Preview→Confirm (Step 1)

**Date:** 2026-10-29
**Status:** Approved (design)
**Supersedes the import half of:** `2026-10-29-portfolio-import-and-owner-accounts-design.md` (Phase 1 import). Phase 2 (owner accounts) is unchanged and out of scope here.

## Goal

Replace the positional, commit-immediately importer with a **header-based, validated, preview-then-confirm** importer that:
handles both workbook layouts correctly; validates file/worksheet/headers/fields/dates/duplicates; shows a preview before saving; reports success / skipped / failed per row; matches owners reliably and flags ambiguous ones; never auto-marks a unit available; is idempotent; and never creates login accounts.

## Confirmed workbook structure (read from the real file — not assumed)

Sheets: **2023, 2024, 2025, 2026**. Two layouts:

- **Layout A — 2023 & 2024** (19 cols). 2023 has a title row (`"2023"`) then headers on row 2; 2024 headers on row 1.
  `[2]Tower [3]Unit [4]Unit Type [5]Level [6]Slot No. [7]Lessor [8]Lessee [9]Start Contract Period [10]End Contract Period [11]Renewal Period [12]Monthly Rent [13]Advance Rent [14]Security Deposit [15]Mode of Payment [16]Service Fee Paid [17]Source [18/19]Remarks`
- **Layout B — 2025 & 2026** (26–27 cols). Headers on row 1. Extra leading `O-LEASE` column; the property column's **header is blank**.
  `[2]O-LEASE [3]«property, blank header» [4]Unit [5]Unit Type [6]Level [7]Slot No. [8]Lessor [9]Lessee [10]Start [11]End [12]Renewal [13]Monthly Rent [14]Advance [15]Security Deposit [16]Mode [17]Service Fee [18]Source [19+]Remarks`

Other facts: `Renewal Period` is free text in Layout B (e.g. `"1 July 2023 to 30 June 2024"`) — never parse as a date. `Advance/Security Deposit/Service Fee` are sometimes text (`"1 month"`, `"100,000.00 php"`). `Start/End` are real dates. Property values span short (`Ibiza`, `AST`, `Royalton`) and long (`Viridian in GH`, `CV Ibiza Tower`, `Royalton in CC`) forms — `towerMap.towerNameFor` already covers both. Some lessors are joint (`"Spouses A and B"`).

**Root cause this fixes:** the shipped importer applied Layout-B positions to all sheets, so Layout-A rows read one column off (Unit→building, Type→unitNumber, **Lessee→Lessor, Start→Lessee**). Most 2023/2024 rows were skipped; ~13 imported corrupt.

## Decisions (locked by the user)

| Topic | Decision |
|---|---|
| Column mapping | **Per-sheet, by header name** (detect the header row; map canonical fields from header text). Property column = the one headed `Tower`, else (Layout B) the column immediately left of `Unit`; `O-LEASE` = managedBy. An unrecognized sheet structure is a **reported failure**, never a silent mismap. |
| Owner matching | **Exact normalized-name link**; mark joint/compound/blank/`n/a` names as `needsReview` (unverified). **Never** fuzzy/partial merge. |
| Unit status | Add **`Unit.needsStatusReview`**. Set `OCCUPIED` only when a lease is currently active; if all leases ended, leave status as-is and set `needsStatusReview=true`. **Never auto-VACANT.** |
| Flow | **Preview → Confirm.** Upload parses + validates and returns a preview with no writes; user reviews / re-uploads; confirm commits. Stateless: confirm re-sends the same file and the server re-parses + writes (deterministic + idempotent, so preview matches commit). |
| Bad data already in DB | After build + tests: **clear + re-import** (keep Admin + estates + towers; a pre-clear backup exists) to purge the ~13 corrupt rows and load 2023/2024 correctly. |

## Data model changes (manual SQL, both DBs, then `prisma generate`)

```prisma
model Unit      { needsStatusReview Boolean @default(false) }
model UnitOwner { needsReview       Boolean @default(false) }
```
Additive, defaulted → safe; existing data preserved. Phase-1 keys/uniques (`nameKey`, `unitKey`, lease/unit/owner/tenant uniques) are kept as-is.

## Components

### Parser + validator — `server/src/lib/importParse.js` (new)
- `parseWorkbook(buffer) → { sheets: [{ name, ok, error?, rows: [...] }], ... }`.
- Per sheet: find the header row (the row containing enough known header tokens — `Lessor`, `Lessee`, `Monthly Rent`, `Unit`); build a header→column index map; resolve the property column per the rule above. If no header row / required headers missing → sheet `ok:false` with an error (reported, not imported).
- Per data row: normalize via `importClean` into `{ managedBy, property, unitNumber, unitType, floor, slotNo, lessor, lessee, startDate, endDate, renewalText, monthlyRent, advanceRent, securityDeposit, modeOfPayment, serviceFee, source, remarks }` plus `{ sheet, row }`.

### Validation + disposition — in the service (per row)
- **valid** → will **create** or **update** (by natural key presence in DB/within-run).
- **skipped** → structurally empty/non-data row (e.g. blank line) — not an error.
- **failed** → has data but violates a rule; carries `reasons[]`. Rules: required fields missing (`unitNumber`, `lessee`, `startDate`, `endDate`, `monthlyRent`); unparseable dates; `startDate > endDate`; duplicate natural key **within the same file**.
- Owner match annotation: `link` (exact name) or `needsReview` (joint/blank/ambiguous).
- Unit status annotation: `active` vs `needsStatusReview`.

### Service — `server/src/services/portfolioImportService.js` (rework)
- `analyzeWorkbook(buffer) → { totals: { willCreate, willUpdate, skipped, failed }, perSheet, sampleRows, failures, ownersNeedingReview, unitsNeedingStatusReview }` — **no DB writes**.
- `commitWorkbook(buffer) → { created, updated, skipped, failed, ownersFlagged, unitsFlagged, failures }` — writes valid rows using Phase-1 find-then-create keys; sets owner `needsReview` and unit `needsStatusReview`; **creates no `User`**; idempotent.
- Shared internals so preview and commit agree exactly. CLI (`import-portfolio.js`) calls `commitFromFile`.

### Endpoint — `server/src/routes/importRoutes.js` (extend)
- `POST /api/import/portfolio/preview` (ADMIN, multer `.xlsx`) → analysis JSON, no writes.
- `POST /api/import/portfolio/commit` (ADMIN, multer `.xlsx`) → commit summary.
- (Keep the current path working or redirect; both ADMIN-gated.)

### Client — `client/src/views/PortfolioImportView.vue` (rework)
- Pick file → **Preview**: show totals (create/update/skip/fail), per-sheet status, a failures table (sheet/row + reasons), and owners/units flagged for review. Buttons: **Confirm import** (sends commit) and **Choose another file** (re-upload). After commit, show the final created/updated/skipped/failed summary.
- `resource.js`: `portfolioImport.preview(file)` / `.commit(file)`.

### Operational (final task)
- Clear operational data (keep Admin + estates + towers) using the existing safe procedure, then commit-import all four sheets; report final counts + flagged owners/units.

## Validation surfaced to the user (req 2 & 4)
File type (.xlsx, multer) → each year sheet's structure (header row + required headers) → per-row required fields + date sanity + in-file duplicates. Failures listed with sheet/row and reason; the user fixes the source and re-uploads. (The importer never edits the workbook.)

## Edge cases / safety
- Non-year or unstructured sheets → reported, skipped, never mismapped.
- Joint/blank lessor → owner created but `needsReview=true`; never merged by similarity.
- All-ended leases → `needsStatusReview=true`, status untouched (never VACANT).
- Re-upload of the same file → zero new rows (idempotent keys).
- No `deleteMany` in the importer; no `User` ever created.

## Out of scope
- Step 2 (owner accounts / invitations / self-registration).
- Outbound email.
- Editing the Excel layout or `towerMap` rules.
- Importing Layout-B trailing extra columns beyond the canonical set.
