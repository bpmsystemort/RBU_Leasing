# Units & Blocking (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give units a pipeline-driven availability lifecycle (`VACANT` / `BLOCKED` / `OCCUPIED` / `UNAVAILABLE`), stop two competing deals opening on one unit, redesign the Units page as a portfolio console, and add a Unit Blocking page and a Unit-Owner Assignments page with validated reassignment and history.

**Architecture:** Additive manual SQL (enum values first and standalone, then a nullable FK column and one append-only table). Status changes live in two places only: guarded manual changes in `unitService.js` (VACANT ↔ UNAVAILABLE) and pipeline-driven changes in `leasingTransactionService.js` (block, unblock, signed, declined, relink). Blocking and the settle-on-outcome hook use conditional `updateMany` writes, so two officers can never both claim a unit. The client gets a rebuilt Units page and two new pages whose nav entries were deferred in SP1.

**Tech Stack:** Node 24 ES modules, Express 5, Prisma 6 + PostgreSQL, Zod 4, Vitest + Supertest; Vue 3 + Pinia + Vite.

**Source:** `docs/superpowers/specs/2026-10-30-units-blocking-design.md` (the spec; this plan implements it, with the clarifications listed under "Interpretations" below) and `LEASING-REVAMP-PROGRESS.md` §3 (SP2) and §7 (project rules).

## Global Constraints

- **Project rules (from `LEASING-REVAMP-PROGRESS.md` §7):** manual SQL migrations only, applied to BOTH `rbu_leasing` and `rbu_leasing_test` (and prod), then `prisma generate`; never `prisma migrate dev` or `db push`. SMTP credentials never in the DB, any API response, logs or the client. This plan touches no mail code.
- **Commit trailer in this session:** `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (the progress doc names a different model; the trailer follows the model that wrote the commit). Use `git commit -m "<subject>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Working tree is CRLF, index LF; autocrlf warnings are normal.
- **Preserve:** Excel import idempotency (`portfolioImportService.js` writes `status: "OCCUPIED"` directly through Prisma and must keep working; the new enum values are additive), owner ↔ account separation (reassignment never creates or touches a `User`), existing permissions, audit logging (the request-level middleware audits every new mutation; no new audit code is needed).
- **Public listing unchanged:** the gate stays `status === VACANT && approvalStatus === APPROVED && published`, so BLOCKED, OCCUPIED and UNAVAILABLE units disappear from the marketplace with no listing change.
- **No Lease creation on signing, no expiry-to-status, no move-in, no inquiry redesign, no new npm dependency** (SP3/SP4). SP2 sets `OCCUPIED` on signing and never auto-vacates.
- **Test run steps** ("Run: …") are executed only if the controller's pre-flight allows running tests; otherwise implementers verify by careful reading and `node --check`, hand-trace every test, and say plainly that nothing was run. Server tests run serially against `rbu_leasing_test`.
- **Every new table goes into `resetCrudTables()`** in `server/tests/helpers.js` in FK-safe order.

## Interpretations (decisions this plan makes where the spec is silent; flag any you disagree with)

1. **"Active deal"** = a `LeasingTransaction` that has a prospect (`inquiryId` or `tenantId` set) and has not ended (`finalStatus` not `Signed`/`Declined`). The lessor-onboarding transaction that `ensureForUnit` opens when a unit is approved has no prospect, so it does not count: a lessee inquiry on a freshly approved unit must still be accepted. Only a deal with a prospect can block a unit.
2. **There is no "Cancelled" transaction state** in this codebase; the auto-release triggers are therefore: final status `Declined`, the transaction's unit being relinked or cleared, and deletion of the transaction (the FK sets the pointer to NULL, leaving a BLOCKED unit with no holder, which the Blocking page shows with a Release action; that needs the unit-level `release-block` endpoint added in Task 2).
3. **A signed deal cannot be returned** to an earlier stage (409): signing marks the unit OCCUPIED and SP4 will create the Lease, so un-signing would corrupt both. (If an existing test returns a Signed transaction, stop and report NEEDS_CONTEXT.)
4. **Accepting an inquiry** is refused before the officer is assigned, so a refused acceptance leaves the inquiry exactly as it was (unassigned, unconverted).
5. **Owner users cannot change a unit's `status`**: it is stripped from their payloads; staff manual changes are limited to VACANT ↔ UNAVAILABLE.
6. Reassigning a unit's owner does not rewrite the lessor on its existing transactions or leases.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/prisma/manual-migrations/2026-11-03-units-blocking-1-enum.sql` | create | two standalone `ALTER TYPE … ADD VALUE` statements |
| `server/prisma/manual-migrations/2026-11-03-units-blocking-2-block-and-assignments.sql` (+ `.down.sql`) | create | `Unit.blockedByTransactionId` and `UnitAssignmentEvent` |
| `server/prisma/schema.prisma` | modify | enum values, FK column, named relations, event model |
| `server/tests/helpers.js` | modify | reset the new table |
| `server/src/services/unitService.js` | modify | guarded manual status changes, owner-safe edits |
| `server/src/services/unitAssignmentService.js` | create | owner reassignment and history |
| `server/src/services/leasingTransactionService.js` | modify | block/unblock, settle hook, active-deal check, relink release |
| `server/src/services/inquiryService.js` | modify | refuse a conflicting acceptance before assigning |
| `server/src/validation/unit.js` | modify | tighter `status`, `assignOwnerSchema` |
| `server/src/{routes,controllers}/{unit,leasingTransaction}*.js` | modify | new endpoints |
| `client/src/lib/resource.js`, `lib/nav.js`, `router/index.js` | modify | clients, two nav entries, two routes |
| `client/src/views/{UnitsView,UnitBlockingView,UnitOwnerAssignmentsView}.vue` | modify/create | the three pages |
| `server/tests/…`, `client/tests/…` | create | per task |

---

### Task 1: Migration, schema and test-helper reset

**Files:**
- Create: `server/prisma/manual-migrations/2026-11-03-units-blocking-1-enum.sql`, `…-2-block-and-assignments.sql`, `…-2-block-and-assignments.down.sql`
- Modify: `server/prisma/schema.prisma`, `server/tests/helpers.js`
- Test: `server/tests/unitsBlockingSchema.test.js`

- [ ] **Step 1: Enum file** (must run on its own, before anything that uses the values):

```sql
-- SP2 part 1: run this file ALONE. Postgres cannot use a new enum value in the same batch that adds it.
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'UNAVAILABLE';
```
- [ ] **Step 2: Part 2 file** (idempotent):

```sql
-- SP2 part 2: the block pointer and the assignment history.
ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "blockedByTransactionId" TEXT;
CREATE INDEX IF NOT EXISTS "Unit_blockedByTransactionId_idx" ON "Unit"("blockedByTransactionId");
DO $$ BEGIN
  ALTER TABLE "Unit" ADD CONSTRAINT "Unit_blockedByTransactionId_fkey"
    FOREIGN KEY ("blockedByTransactionId") REFERENCES "LeasingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "UnitAssignmentEvent" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "fromOwnerId" TEXT,
  "toOwnerId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnitAssignmentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UnitAssignmentEvent_unitId_idx" ON "UnitAssignmentEvent"("unitId");
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_fromOwnerId_fkey" FOREIGN KEY ("fromOwnerId") REFERENCES "UnitOwner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_toOwnerId_fkey" FOREIGN KEY ("toOwnerId") REFERENCES "UnitOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```
Down file for part 2: drop the table, the FK constraint, the index and the column, each with `IF EXISTS`. Add a comment that the two enum values cannot be removed by a down script (PostgreSQL has no `DROP VALUE`).
- [ ] **Step 3: `schema.prisma`:** read the file first. (a) Add `BLOCKED` and `UNAVAILABLE` to `enum UnitStatus`. (b) `Unit` gets `blockedByTransactionId String?` and `blockedByTransaction LeasingTransaction? @relation("UnitBlock", fields: [blockedByTransactionId], references: [id], onDelete: SetNull)`, `assignmentEvents UnitAssignmentEvent[]` and `@@index([blockedByTransactionId])`. (c) `LeasingTransaction` gets `blockedUnits Unit[] @relation("UnitBlock")`. (d) Because `Unit` and `LeasingTransaction` now have two relations between them, name the existing one on BOTH sides (`@relation("TxnUnit")` on `LeasingTransaction.unit` and on `Unit.leasingTransactions`); a relation name is client-only and changes nothing in the database. (e) New model `UnitAssignmentEvent { id, unit (Cascade), unitId, fromOwner UnitOwner? @relation("AssignmentFrom", …, onDelete: SetNull), fromOwnerId String?, toOwner UnitOwner @relation("AssignmentTo", …, onDelete: Restrict), toOwnerId, actorId String?, actorName String?, reason String?, createdAt DateTime @default(now()), @@index([unitId]) }`, with `assignmentsFrom UnitAssignmentEvent[] @relation("AssignmentFrom")` and `assignmentsTo UnitAssignmentEvent[] @relation("AssignmentTo")` on `UnitOwner`.
- [ ] **Step 4: `resetCrudTables()`:** add `await prisma.unitAssignmentEvent.deleteMany();` as the first line of the function body (before `auditLog`).
- [ ] **Step 5: Test** `server/tests/unitsBlockingSchema.test.js`: a unit can be created with `status: "BLOCKED"` and `"UNAVAILABLE"`; `blockedByTransactionId` accepts a real transaction id, and deleting that transaction sets the pointer to NULL while the unit stays BLOCKED; a `UnitAssignmentEvent` can be written and is removed when its unit is deleted; deleting the `toOwner` of an event is refused (Restrict).
- [ ] **Step 6 (dev machine):** stop the server; apply file 1, then file 2, to `rbu_leasing` and `rbu_leasing_test` (`npx prisma db execute --file … --schema prisma/schema.prisma`); `npx prisma generate`; run the new test.
- [ ] **Step 7: Commit** `feat(db): units & blocking schema (BLOCKED/UNAVAILABLE, block pointer, assignment history)`.

---

### Task 2: Guarded manual status changes and unit-level release

**Files:**
- Modify: `server/src/services/unitService.js`, `server/src/validation/unit.js`, `server/src/controllers/unitController.js`, `server/src/routes/unitRoutes.js`
- Modify: `server/src/services/leasingTransactionService.js` (add `activeDealForUnit` and `releaseUnitBlock`, see Task 3 for the shared helpers; if Task 3 has not run yet, create just these two exports here and Task 3 reuses them)
- Test: `server/tests/unitLifecycle2.test.js`

**Behaviour:**
1. **Validation (`unit.js`):** `unitCreateSchema.status` becomes `z.enum(["VACANT", "UNAVAILABLE"]).optional()` (BLOCKED and OCCUPIED are pipeline-driven and are rejected with 400 when sent directly). Nothing else in the schema changes. Existing tests only set OCCUPIED through Prisma directly; grep `server/tests` and `client/src` for any API payload that sends `status` before changing it and report each.
2. **Guard (`unitService.js`):** `assertManualChange(unit, target)`: `target` must be VACANT or UNAVAILABLE; if `unit.status === target` it is a no-op; if the unit's current status is BLOCKED or OCCUPIED throw `ConflictError("Release or finish the <status> unit first")`.
3. **`setUnavailable(user, id)`:** loads the unit, `assertManualChange(unit, "UNAVAILABLE")`, refuses with 409 when `activeDealForUnit(id)` finds a deal ("Unit has an active deal; release it first"), then writes with `prisma.unit.updateMany({ where: { id, status: "VACANT" }, data: { status: "UNAVAILABLE" } })`; `count === 0` means it changed under us, so 409. Returns the unit with the existing `withHierarchy` include. **`restoreUnit(user, id)`:** the mirror (`UNAVAILABLE` → `VACANT`, same conditional write).
4. **`updateUnit`:** when `fields.status` is present and differs from the stored status, run `assertManualChange` (and the active-deal check when the target is UNAVAILABLE); for `UNIT_OWNER` callers delete `fields.status` before anything else (owners never change availability).
5. **`releaseUnitBlock(actor, unitId)`** (exported from `leasingTransactionService.js`, uses its local `logEvent`): reads the unit; if it is not BLOCKED → 409 ("Unit is not blocked"); `updateMany({ where: { id: unitId, status: "BLOCKED" }, data: { status: "VACANT", blockedByTransactionId: null } })`; when the unit had a holder (`blockedByTransactionId`), log the event "Unit block released" on that transaction; return the unit. This is how a block with no holder (its transaction was deleted) is cleared.
6. **`activeDealForUnit(unitId, exceptTransactionId?)`** (exported from `leasingTransactionService.js`):

```js
const OPEN = { OR: [{ finalStatus: null }, { finalStatus: { notIn: ["Signed", "Declined"] } }] };
const HAS_PROSPECT = { OR: [{ inquiryId: { not: null } }, { tenantId: { not: null } }] };

// Interpretation 1: a deal with a prospect that has not ended. The lessor-onboarding transaction has no prospect.
export function activeDealForUnit(unitId, exceptTransactionId) {
  return prisma.leasingTransaction.findFirst({
    where: { unitId, ...(exceptTransactionId ? { id: { not: exceptTransactionId } } : {}), AND: [OPEN, HAS_PROSPECT] },
    orderBy: { createdAt: "desc" },
  });
}
```
7. **Routes (all `requireWrite`, declared with the other `/:id/...` unit routes):** `PATCH /api/units/:id/unavailable`, `PATCH /api/units/:id/restore`, `PATCH /api/units/:id/release-block`. Controllers call the three functions and return the unit.

- [ ] **Step 1: Write the failing tests** `server/tests/unitLifecycle2.test.js` (resetCrudTables, tokens.admin/officer/viewer/owner, factory.owner/unit/tenant/estate/tower, direct Prisma for transactions with `prisma.leasingTransaction.create`): set unavailable on a VACANT unit (200, status UNAVAILABLE) and restore (VACANT); setting a BLOCKED or OCCUPIED unit unavailable → 409 and the status is unchanged; setting unavailable while a prospect deal is open → 409; the lessor-onboarding transaction (no inquiry, no tenant) does NOT block setting unavailable; PATCH `/units/:id` with `{ status: "BLOCKED" }` and `{ status: "OCCUPIED" }` → 400; `{ status: "UNAVAILABLE" }` from VACANT → 200 and from OCCUPIED (set via Prisma) → 409; a `UNIT_OWNER` PATCH with `status` leaves the status unchanged; viewer → 403 on all three routes; `release-block` on a BLOCKED unit with a holder returns VACANT, clears the pointer and writes a `TransactionEvent` on the holder; on a BLOCKED unit with no holder it still works; on a VACANT unit → 409; two concurrent `unavailable` calls (Promise.all) yield `[200, 409]` or `[200, 200]` (second is a no-op) but never an inconsistent row.
- [ ] **Step 2–3: Implement; Step 4: Run** `npx vitest run tests/unitLifecycle2.test.js` plus the existing unit tests (`units`, `unitsHierarchy`, `unitsOwner`, `unitLifecycle`, `unitOnboarding`, `unitListings`, `publicUnits`, `inquiryUnit`, `executiveDashboard`).
- [ ] **Step 5: Commit** `feat(units): guarded manual availability changes and unit-level block release`.

---

### Task 3: Block, unblock and automatic settling in the pipeline

**Files:**
- Modify: `server/src/services/leasingTransactionService.js`, `server/src/controllers/leasingTransactionController.js`, `server/src/routes/leasingTransactionRoutes.js`
- Test: `server/tests/unitBlocking.test.js`

**Behaviour (read the whole service first; `setStatus` at ~249, `advance` ~265, `returnStage` ~309, `linkRecords` ~333):**
1. **`blockUnit(actor, id)`** and **`unblockUnit(actor, id)`** exactly as follows (`loadOrThrow`, `logEvent`, `getTransaction` already exist in the file):

```js
export async function blockUnit(actor, id) {
  const txn = await loadOrThrow(id);
  if (!txn.unitId) throw new ConflictError("Link a unit before blocking it");
  if (!txn.inquiryId && !txn.tenantId) throw new ConflictError("Only a deal with a prospect can block a unit");
  if (["Signed", "Declined"].includes(txn.finalStatus)) throw new ConflictError("This deal has ended");
  const unit = await prisma.unit.findUnique({ where: { id: txn.unitId }, select: { status: true, unitNumber: true, blockedByTransactionId: true } });
  if (unit?.status === "BLOCKED" && unit.blockedByTransactionId === id) return getTransaction(id); // idempotent
  const claimed = await prisma.unit.updateMany({
    where: { id: txn.unitId, status: "VACANT", approvalStatus: "APPROVED" },
    data: { status: "BLOCKED", blockedByTransactionId: id },
  });
  if (!claimed.count) {
    throw new ConflictError(unit && unit.status !== "VACANT"
      ? `Unit ${unit.unitNumber} is ${unit.status.toLowerCase()}, not vacant`
      : "Only an approved, vacant unit can be blocked");
  }
  await logEvent(id, actor, "Unit blocked for this deal", txn.stage);
  return getTransaction(id);
}

// Frees the unit this transaction is holding, if any. Returns true when something was released.
async function releaseBlockFor(transactionId, client = prisma) {
  const r = await client.unit.updateMany({
    where: { blockedByTransactionId: transactionId, status: "BLOCKED" },
    data: { status: "VACANT", blockedByTransactionId: null },
  });
  return r.count > 0;
}

export async function unblockUnit(actor, id) {
  const txn = await loadOrThrow(id);
  if (!(await releaseBlockFor(id))) throw new ConflictError("This deal is not blocking a unit");
  await logEvent(id, actor, "Unit block released", txn.stage);
  return getTransaction(id);
}
```
2. **Settle hook:** `settleUnitOnOutcome(row, client)` (row = the updated transaction): only when `row.unitId` and `isFinalStage(row.stage)`. `finalStatus === "Signed"`: `client.unit.updateMany({ where: { id: row.unitId, OR: [{ status: "VACANT" }, { status: "BLOCKED", blockedByTransactionId: row.id }] }, data: { status: "OCCUPIED", blockedByTransactionId: null } })`; return the event message "Unit marked occupied (contract signed)" when `count > 0`, else "Contract signed, but the unit was not vacant or held by this deal: check its status". `finalStatus === "Declined"`: `releaseBlockFor(row.id, client)`; message "Unit block released (deal declined)" when it released something. Otherwise null.
3. **Call sites:** in `setStatus` and in `advance`, wrap the existing `prisma.leasingTransaction.update(...)` and the hook in one `prisma.$transaction(async (tx) => { const row = await tx.leasingTransaction.update(...); const note = await settleUnitOnOutcome(row, tx); return { row, note }; })`; after the transaction, `logEvent` the note if present (the existing event logging stays as is). `advance` can set a final status directly (`nextStatus` may be `Signed`), so it needs the hook too.
4. **`returnStage`:** at the top, `if (txn.finalStatus === "Signed") throw new ConflictError("A signed deal cannot be returned to an earlier stage")` (Interpretation 3).
5. **`linkRecords`:** when `unitId !== undefined` and the new value (`unitId || null`) differs from `txn.unitId`, call `releaseBlockFor(id)` before the update and log "Unit block released (linked unit changed)" if it released one.
6. **Routes:** `PATCH /api/leasing-transactions/:id/block` and `/unblock`, `requireWrite`, declared next to `/:id/link`; controllers `blockUnit`/`unblockUnit` return the transaction.

- [ ] **Step 1: Write the failing tests** `server/tests/unitBlocking.test.js` (create the transaction rows with `prisma.leasingTransaction.create`, a `reference` like `RBU-2026-9xxxxx`, stage `UNIT_VIEWING` or `SEND_REQUIREMENTS`, `status "Pending"`, `inquiryId` from a created `prisma.inquiry` or `tenantId` from `factory.tenant()` for "has a prospect"): block a VACANT approved unit → unit BLOCKED with `blockedByTransactionId` = the deal and an event row; blocking again is idempotent; a second deal blocking the same unit → 409 and the pointer is unchanged; blocking an UNAVAILABLE, OCCUPIED or unapproved unit → 409 with the status in the message; no unit linked → 409; no prospect (onboarding transaction) → 409; ended deal → 409; unblock returns VACANT and clears the pointer; unblock by a deal that does not hold the block → 409; two concurrent blocks from two deals (Promise.all) → exactly one 200 and one 409; the setStatus route setting CONTRACT_SIGNING "Signed" (put the transaction at stage `CONTRACT_SIGNING` first) turns a BLOCKED unit into OCCUPIED and clears the pointer, and a VACANT unit too; "Declined" on a blocking deal frees the unit; advance with `{ status: "Signed" }` into the final stage does the same; a Signed deal cannot be returned (409) while an unsigned one still can; relinking the transaction to another unit (PATCH `/link`) releases the old unit; routes are 403 for viewer/tenant/owner and 401 without a token; the public listing query (`GET /api/public/units`) never returns a BLOCKED unit even if it is published.
- [ ] **Step 2–3: Implement; Step 4: Run** the new file plus `leasingTransactions`, `contractSigning`, `leasingStages`, `leasingApproval`, `transactionDocuments`, `appointments`, `inquiryConversion`.
- [ ] **Step 5: Commit** `feat(leasing): block and unblock units and settle unit status when a deal is signed or declined`.

---

### Task 4: One active deal per unit (acceptance conflict-fix)

**Files:** Modify `server/src/services/leasingTransactionService.js`, `server/src/services/inquiryService.js`. Test: `server/tests/inquiryConflict.test.js`.

**Behaviour:**
1. In `ensureForInquiry`, after the idempotency check on `inquiryId` and the unit lookup: `if (unit) { const rival = await activeDealForUnit(unit.id); if (rival) throw new ConflictError(\`Unit ${unit.unitNumber} already has an active deal (${rival.reference}) for another prospect; release it first\`); }`. Accepting the same inquiry again still returns the existing transaction (the first line).
2. Export `assertUnitFreeForInquiry(inquiry)` from the same file (the same check, without creating anything; returns early when the inquiry has no `unitId`, the unit is gone, or a transaction already exists for this inquiry). In `inquiryService.acceptInquiry`, call it right after the "already accepted by another officer" check and BEFORE `prisma.inquiry.update(...)`, so a refusal leaves the inquiry unassigned and unconverted (Interpretation 4). `ensureForInquiry`'s own check stays as the backstop.
3. `acceptInquiry` surfaces the 409 unchanged (the error handler already maps `ConflictError`).

- [ ] **Step 1: Tests:** a unit with an open prospect deal (a transaction with a tenant or an inquiry) → accepting a second inquiry for that unit returns 409 with the rival's reference in the message, the second inquiry stays `NEW` and unassigned, and no second transaction exists (`prisma.leasingTransaction.count({ where: { unitId } })` unchanged); accepting the SAME inquiry twice returns the same transaction (idempotent); a unit whose only transaction is the lessor-onboarding one (no prospect) accepts a lessee inquiry (200); a unit whose earlier deal is Signed or Declined accepts a new inquiry; an inquiry with no unit accepts as before; two different officers accepting two inquiries for one unit at the same time (Promise.all) → at most one transaction results (assert the count ≤ 1 for prospect deals; document if the check-then-create race can still allow two and mention it in the report: the spec accepts this window, a unique partial index is out of scope).
- [ ] **Step 2–3: Implement; Step 4: Run** the new file plus `inquiries`, `inquiryConversion`, `inquiryUnit`, `leasingTransactions`. **Step 5: Commit** `fix(leasing): refuse a second active deal on one unit before accepting its inquiry`.

---

### Task 5: Owner reassignment with history

**Files:** Create `server/src/services/unitAssignmentService.js`. Modify `server/src/validation/unit.js`, `server/src/controllers/unitController.js`, `server/src/routes/unitRoutes.js`. Test: `server/tests/unitAssignment.test.js`.

**Behaviour:**
1. `assignOwnerSchema = z.object({ toOwnerId: z.string().min(1), reason: z.string().trim().max(500).nullish() })`.
2. `reassignOwner(actor, unitId, { toOwnerId, reason })` in the new service:

```js
export async function reassignOwner(actor, unitId, { toOwnerId, reason }) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new NotFoundError("Unit not found");
  if (unit.ownerId === toOwnerId) throw new ConflictError("The unit already belongs to that owner");
  const target = await prisma.unitOwner.findUnique({ where: { id: toOwnerId } });
  if (!target) throw new InvalidReferenceError("toOwnerId does not reference an existing owner");
  if (unit.unitKey) {
    const clash = await prisma.unit.findFirst({ where: { ownerId: toOwnerId, unitKey: unit.unitKey, id: { not: unitId } }, select: { id: true } });
    if (clash) throw new ConflictError(`${target.name} already has a unit with the same unit key`);
  }
  const who = actor?.userId ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const moved = await tx.unit.updateMany({ where: { id: unitId, ownerId: unit.ownerId }, data: { ownerId: toOwnerId } });
      if (!moved.count) throw new ConflictError("The unit's owner changed while reassigning; reload and try again");
      await tx.unitAssignmentEvent.create({ data: {
        unitId, fromOwnerId: unit.ownerId, toOwnerId, reason: reason || null,
        actorId: actor?.userId ?? null, actorName: who?.name || who?.email || null,
      } });
      return tx.unit.findUnique({ where: { id: unitId }, include: { tower: { include: { estate: true } }, owner: { select: { id: true, name: true } } } });
    });
  } catch (e) {
    if (e?.code === "P2002") throw new ConflictError(`${target.name} already has a unit with the same unit key`);
    throw e;
  }
}

export function listAssignments(unitId) {
  return prisma.unitAssignmentEvent.findMany({
    where: { unitId }, orderBy: { createdAt: "desc" },
    include: { fromOwner: { select: { id: true, name: true } }, toOwner: { select: { id: true, name: true } } },
  });
}
```
(`listAssignments` must 404 for an unknown unit: check the unit exists first.) Never touches `User`, `LeasingTransaction.unitOwnerId` or `Lease` (Interpretation 6).
3. Routes: `PATCH /api/units/:id/assign-owner` (`requireRole("ADMIN")`), `GET /api/units/:id/assignments` (`requireRole("ADMIN", "LEASING_OFFICER", "VIEWER")`).
4. The staff unit list/detail responses include `owner.needsReview` (extend the `withHierarchy.owner.select` in `unitService.js` to `{ id, name, needsReview }` ONLY for staff callers; for `UNIT_OWNER` callers keep `{ id, name }`; implement by building the include per call).

- [ ] **Step 1: Tests** `server/tests/unitAssignment.test.js`: ADMIN reassigns (200, `Unit.ownerId` changed, one event with from/to/reason and the actor's name, response shows the new owner); the same owner → 409 and no event; unknown target → 400; unknown unit → 404; unit-key collision under the target (create two units with the same `unitKey` under different owners) → 409 and nothing changed; officer and viewer → 403 on assign, 200 on the history GET; history is newest first; **no `User` row is created or changed** (count and a snapshot of an owner-linked user before/after); the old owner's `UNIT_OWNER` login no longer sees the unit in its list and the new owner's does; existing open transactions keep their `unitOwnerId`; a staff unit list includes `owner.needsReview` and an owner-portal list does not; two concurrent reassignments to different owners → one wins, the other gets 409 or applies on top (assert the final owner is one of the two and exactly the winning events exist, no orphan).
- [ ] **Step 2–3: Implement; Step 4: Run** the new file plus `units`, `unitsOwner`, `ownerAssignment`, `roleScoping`. **Step 5: Commit** `feat(units): validated owner reassignment with assignment history`.

---

### Task 6: Client clients and the Units page

**Files:** Modify `client/src/lib/resource.js`, `client/src/views/UnitsView.vue`; create `client/src/components/UnitStatusBadge.vue`. Test: `client/tests/UnitsView.test.js` (additions only), `client/tests/resource.test.js` (additions).

**Behaviour:**
1. `resource.js`: `units.setUnavailable(id)`, `units.restore(id)`, `units.releaseBlock(id)`, `units.assignOwner(id, { toOwnerId, reason })`, `units.assignments(id)`, `leasingTransactions.blockUnit(id)`, `leasingTransactions.unblockUnit(id)` (read how the existing leasing-transactions client is exposed and follow it), all `PATCH`/`GET` on the paths from Tasks 2 to 5.
2. `UnitStatusBadge.vue`: one prop `status`; text VACANT → "Vacant", BLOCKED → "Blocked", OCCUPIED → "Occupied", UNAVAILABLE → "Unavailable"; a distinct colour per state using ONLY tokens that exist in `client/src/styles/app.css` (read it; use `--good`/`--good-050` for Vacant, `--warn`/`--warn-050` for Blocked, `--accent`-family or neutral `--text`/`--paper` for Occupied, `--muted`/`--faint`/`--line` for Unavailable; text colour must keep contrast in the dark theme: use `--text` on a tinted background rather than white on a pale token).
3. **UnitsView redesign** (keep every existing behaviour and test: the Estate/Tower multi-selects, the "Needs status review only" toggle, the single table, delete for ADMIN, `ResourceTable` and its `#cell-flags` slot): add a search box (unit number, owner name, tower name; case-insensitive), sortable column headers (click toggles ascending/descending; sort by unit, owner, tower, type, rent, status), pagination (25 per page, a pager with previous/next and "page x of y"), a status filter (All, Vacant, Blocked, Occupied, Unavailable) and an approval filter (All, Draft, Submitted, Approved, Rejected), the Status column rendered with `UnitStatusBadge` through a `#cell-status` slot, and row actions for ADMIN/officer (`auth.canWrite`): "Set unavailable" on VACANT rows, "Restore" on UNAVAILABLE rows, "Release block" on BLOCKED rows (each calls the client, reloads the list and shows the server's `error` text on failure), and for ADMIN a "Reassign owner" link to `/app/unit-assignments?unit=<id>`. Loading, empty and error states. If `ResourceTable` has no row-actions slot, add the actions as an extra `#cell-actions` column using the existing slot mechanism (read `ResourceTable.vue`; do not change its behaviour for other screens).
- [ ] **Step 1: Tests (additions only; do not alter existing assertions):** search narrows rows; status and approval filters; sorting toggles order; pagination (build 30 mock rows, page 1 shows 25, next shows 5); badge text per status; Set unavailable / Restore / Release block call the right client and reload; an error message is shown when the call rejects; read-only roles see no action buttons; the existing "needs status review" test still passes. Follow the mock setup in the existing test exactly (it mocks `../src/lib/resource.js`; extend that mock with the new functions).
- [ ] **Step 2–3: Implement; Step 4: Run** `npx vitest run` in `client/`. **Step 5: Commit** `feat(client): units console with status badges, filters, sorting, paging and availability actions`.

---

### Task 7: Unit Blocking page, Unit-Owner Assignments page, nav and routes

**Files:** Create `client/src/views/UnitBlockingView.vue`, `client/src/views/UnitOwnerAssignmentsView.vue`. Modify `client/src/lib/nav.js`, `client/src/router/index.js`. Tests: `client/tests/UnitBlockingView.test.js`, `client/tests/UnitOwnerAssignmentsView.test.js`, `client/tests/nav.test.js` (additions; find the existing nav/AppLayout tests and add the new entries there).

**Behaviour:**
1. **Routes:** `unit-blocking` (roles WRITE) and `unit-assignments` (roles ADMIN) under `/app`. **Nav:** in `STAFF_NAV` › Leasing Operations: "Unit Blocking" (`/app/unit-blocking`, `write: true`, icon `activity`) in the "Leasing Management" section; "Unit-Owner Assignments" (`/app/unit-assignments`, `admin: true`, icon `users`) in the "Units" section. The existing nav tests (item counts and role visibility) get additions only.
2. **Unit Blocking page:** two tables. "Blocked units": `units.list({ status: "BLOCKED" })` rows with unit, tower, the holding deal (match `blockedByTransactionId` against the transaction list: show reference and prospect name `lesseeName`, or "No holder" when none), and a **Release** button (calls `leasingTransactions.unblockUnit(holderId)` when there is a holder, else `units.releaseBlock(unitId)`). "Deals ready to block": the transactions from `leasingTransactions.list()` that have a unit, a prospect (`inquiryId` or `tenantId`), are not ended (`finalStatus` not Signed/Declined) and whose unit is VACANT, each with a **Block** button (`leasingTransactions.blockUnit(id)`). After every action reload both tables; show the server's `error` text on failure (for example the 409 when the unit was taken meanwhile). Read how the existing leasing tracker view loads transactions to reuse the same client call.
3. **Assignments page:** a table of units (`units.list()`) with unit, tower, current owner, a verification column (owner `needsReview` badge "Owner needs review" and the unit's `approvalStatus` badge) and actions **Reassign owner** and **History**. Reassign opens a small dialog with an owner picker (`owners.linkable()`, searchable select; reuse `SearchableSelect.vue`), an optional reason, Confirm and Cancel; Confirm calls `units.assignOwner` and reloads; the server's `error` text is shown on failure. History expands a row (or opens a panel) listing `units.assignments(id)` (when, from → to, by, reason). If the URL has `?unit=<id>`, scroll to and open that unit's reassign dialog.
- [ ] **Step 1: Tests:** Blocking page lists blocked units with their holder and a no-holder case; Release calls `unblockUnit` with a holder and `releaseBlock` without; the ready-to-block table only lists eligible deals and Block calls `blockUnit` then reloads; an error from the server is shown; Assignments page shows the verification badges; the reassign dialog requires an owner, sends `{ toOwnerId, reason }`, reloads; history renders; routes are ADMIN-only (Assignments) and WRITE (Blocking) as in the existing router tests; nav entries visible only to the right roles. Mock `../src/lib/resource.js` in the style of the nearest existing view test.
- [ ] **Step 2–3: Implement; Step 4: Run** `npx vitest run` and `npx vite build` in `client/`. **Step 5: Commit** `feat(client): unit blocking console, unit-owner assignments page and their nav entries`.

---

### Task 8: Deploy checklist (not dispatched)

- [ ] Run the existing suites first on this branch's base: `npm test` in `server/` and `npx vitest run` in `client/` (the progress doc reports server 70 files / 565 tests and client 65 / 451, green).
- [ ] Stop the server (Windows holds the Prisma DLL). Apply `2026-11-03-units-blocking-1-enum.sql` ALONE, then `2026-11-03-units-blocking-2-block-and-assignments.sql`, to `rbu_leasing` and `rbu_leasing_test` (and prod), then `npx prisma generate`, then restart.
- [ ] Rebuild the client (`npm run build --workspace client`) and reload.
- [ ] Smoke test as ADMIN: block a vacant unit from a deal, confirm it vanishes from `/available-units`, release it; set a vacant unit unavailable and restore it; try to accept a second inquiry for a unit with an active deal (expect the 409 message); reassign an owner and read the history; confirm the old owner's portal no longer lists the unit.
- [ ] Remember the earlier-merged `2026-10-27-clear-readable-passwords.sql` still has to be applied to each database if it has not been (progress doc §1).
