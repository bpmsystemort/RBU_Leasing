# Units & Blocking (Sub-Project 2 of the Leasing Revamp)

**Date:** 2026-10-30
**Status:** Design — pending user spec-review
**Branch:** `feat/units-blocking` (off `feat/nav-shell` tip `891563c`; carries SP1 + the earlier unmerged import/accounts/email work)

---

## Program context

SP2 of five. **Locked audit decisions** carried in: signed deals→Lease (SP4), pipeline-driven unit lifecycle (this SP), no Prospect entity, Asia/Manila tz (SP4). **SP2 decisions (just confirmed):** unit states = **{VACANT, BLOCKED, OCCUPIED, UNAVAILABLE}** (keep OCCUPIED as "leased"); blocking is a **deliberate action**, never automatic on inquiry; **one active deal per unit** (fixes the two-transactions bug); unit→owner reassignment gets a **dedicated history table**, verification reuses existing flags.

Sequence: SP1 nav (done) → **SP2 Units & blocking (this)** → SP3 Leasing workflow & move-in → SP4 Leases/expiry/renewal + dashboard → SP5 People/accounts + Email History.

## Goal

Give units a real, pipeline-driven availability lifecycle (reserve/block, lease, withdraw), fix the bug that lets two competing deals open on one unit, redesign the Units page as a portfolio console, and add a dedicated Unit-Owner Assignments page with validated reassignment + history — while preserving import, owner↔account separation, and existing permissions.

## Scope

**In:** `UnitStatus` lifecycle + transitions; the block/unblock reservation flow tied to a transaction; the inquiry-acceptance conflict-fix; the Units page redesign; the Unit-Owner Assignments page + reassignment + `UnitAssignmentEvent` history; the Unit Blocking page; wiring the two deferred nav entries (Unit Blocking, Unit-Owner Assignments).

**Out (other SPs / unchanged):** Lease-row creation on signing and expiry→status (SP4 — SP2 only sets `OCCUPIED` on signing and never auto-vacants on expiry); move-in and inquiry/viewing redesigns (SP3); the existing `UnitListing`/photo marketplace management (unchanged); Lease model (untouched in SP2).

## Locked business rules

**Unit status lifecycle** (`UnitStatus = VACANT | BLOCKED | OCCUPIED | UNAVAILABLE`):
- **VACANT** — available; the only state a unit can be publicly listed in (`status===VACANT && approvalStatus===APPROVED && published`, unchanged — so BLOCKED/OCCUPIED/UNAVAILABLE are automatically hidden from the marketplace with no listing-gate change).
- **BLOCKED** — reserved for one prospect's active deal; carries `blockedByTransactionId`.
- **OCCUPIED** — leased (contract signed). (= today's "OCCUPIED"; existing dashboard/listing code keeps working.)
- **UNAVAILABLE** — manually withdrawn / under renovation.

**Transitions and who may cause them:**
| From → To | Trigger | Rule |
|---|---|---|
| VACANT → BLOCKED | Deliberate **"Block unit"** on an active transaction (WRITE staff) | Only if unit is VACANT; records `blockedByTransactionId`; one block per unit |
| BLOCKED → VACANT | **Release/Unblock** (WRITE), or auto on the blocking transaction going Declined/Cancelled/returned-dead | Clears `blockedByTransactionId`; frees the unit so other inquiries can proceed |
| BLOCKED → OCCUPIED | Blocking transaction reaches **CONTRACT_SIGNING = "Signed"** | SP2 sets OCCUPIED + clears block pointer; **SP4** creates the Lease row |
| VACANT ↔ UNAVAILABLE | Manual **Set Unavailable / Restore** (WRITE) on the Units page | Only from/to VACANT (a blocked/occupied unit must be released first) |
| OCCUPIED → VACANT | **Not** automatic on expiry (per audit); only via SP4's lease-end flow | SP2 never auto-vacants |

- **Manual status edits** (`PATCH /units/:id`) may set **only VACANT↔UNAVAILABLE**; BLOCKED and OCCUPIED are pipeline-driven and rejected if set directly (prevents the inconsistency the two-dashboards bug class comes from).

**One active deal per unit (conflict-fix):** accepting an inquiry creates the unit's single active `LeasingTransaction` but does **not** block the unit (stays VACANT/listed — honoring "don't auto-block on inquiry"). A second inquiry for a unit that already has an **active** deal (a transaction not Declined/Cancelled and not yet Signed) is **refused at acceptance** with a 409 conflict ("this unit already has an active deal for another prospect; release it first"); the inquiry row is **preserved** in the queue (not converted). Accepting the *same* inquiry again is idempotent (returns the existing transaction). This fixes `ensureForInquiry` skipping the `openTransactionForUnit` check that `ensureForUnit` already performs.

**Unit-owner reassignment:** reassigning a unit's owner validates the target owner exists, is a real change, and does not collide with the target owner's existing `@@unique([ownerId, unitKey])`; refuses conflicts; writes a `UnitAssignmentEvent`; **never creates or touches a login account** (owner records stay separate from accounts).

## Data model (manual SQL to BOTH DBs, then `prisma generate` — never migrate dev/db push)

1. **`UnitStatus` enum** — add two values:
   `ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';` and `… 'UNAVAILABLE';`
   (Postgres: `ADD VALUE` can't run inside a transaction nor be used in the same statement batch that adds it — the migration file runs these standalone, before any statement that uses them.)
2. **`Unit.blockedByTransactionId TEXT?`** — nullable FK → `LeasingTransaction(id)` `ON DELETE SET NULL`; the transaction currently holding the block. (Additive `ADD COLUMN`.)
3. **New `UnitAssignmentEvent`** (append-only, mirrors the `TransactionEvent` pattern):
   `id, unitId (FK Unit, Cascade), fromOwnerId (FK UnitOwner?, SetNull), toOwnerId (FK UnitOwner, Restrict), actorId?, actorName?, reason?, createdAt`.
   Prisma model + back-relations on `Unit` and `UnitOwner`. No change to `Lease`.

## Backend

- **Unit status service** (`unitService` or a small `unitStatusService`): `setUnavailable(id)/restore(id)` (VACANT↔UNAVAILABLE, guarded); `unitUpdateSchema` tightened so a direct `status` write accepts only VACANT/UNAVAILABLE.
- **Block/unblock on the transaction** (`leasingTransactionService`): `blockUnit(transactionId, actor)` → sets the unit BLOCKED + `blockedByTransactionId` (fails 409 if the unit isn't VACANT); `unblockUnit(transactionId, actor)` → back to VACANT + clears pointer. The existing stage machine sets OCCUPIED + clears the pointer when the blocking transaction hits `CONTRACT_SIGNING="Signed"`, and auto-unblocks (→VACANT) when it goes Declined/Cancelled or is returned to a dead state.
- **Conflict-fix** in `ensureForInquiry`: call `openTransactionForUnit(unitId)`; if an active transaction for a *different* inquiry exists → throw `ConflictError` (409) and leave the inquiry unconverted; if it's the same inquiry → return it. `acceptInquiry` surfaces the 409 to the officer.
- **Reassignment:** `PATCH /api/units/:id/assign-owner { toOwnerId, reason? }` (ADMIN) → validate (exists, changed, no unitKey collision under target) → write `UnitAssignmentEvent` + update `Unit.ownerId`. `GET /api/units/:id/assignments` → history list.
- **Endpoints added:** `PATCH /units/:id/unavailable`, `PATCH /units/:id/restore`, `PATCH /units/:id/assign-owner`, `GET /units/:id/assignments`, `PATCH /leasing-transactions/:id/block`, `PATCH /leasing-transactions/:id/unblock`. All role-gated and audited by the existing middleware; block/unblock + reassignment cannot leak into the public listing (BLOCKED≠VACANT).

## Frontend

- **`resource.js`:** `units.setUnavailable(id)/restore(id)/assignOwner(id,{toOwnerId,reason})/assignments(id)`; `leasingTransactions.blockUnit(id)/unblockUnit(id)`.
- **Units page redesign (`UnitsView.vue`):** search (unit no./owner/tower), sortable columns, pagination, **status filter** (VACANT/BLOCKED/OCCUPIED/UNAVAILABLE) + approval filter; columns unit · owner · type · **status badge** (distinct colour per state) · approval · actions; contextual actions View/Edit (existing), Set Unavailable/Restore, Reassign Owner. Follows existing admin-table styling; empty/loading/error states.
- **Unit Blocking page (new, nav: Leasing Operations › Leasing Management › Unit Blocking, WRITE):** a reservation console — currently-BLOCKED units with the holding prospect/transaction + a **Release** action; active unblocked deals with a **Block** action. Each action calls the transaction block/unblock endpoints and reflects the new status.
- **Unit-Owner Assignments page (new, nav: Leasing Operations › Units › Unit-Owner Assignments, ADMIN):** units with current owner + **verification status** (owner `needsReview` badge + unit `approvalStatus`); a **Reassign owner** action (owner picker via `owners.linkable()`, with reason); per-unit **assignment history** from `GET /units/:id/assignments`.
- Both new pages get their nav entries (the SP1-deferred ones) added to `client/src/lib/nav.js` now that the pages exist.

## Testing

- **Backend:** each status transition + guard (block only VACANT; manual set rejects BLOCKED/OCCUPIED; unblock clears pointer; sign→OCCUPIED+clear; cancel/decline→VACANT); the conflict-fix (2nd inquiry accept on an active-deal unit → 409 + inquiry preserved + no 2nd transaction; same-inquiry idempotent); reassignment (target-exists, no-op rejected, unitKey-collision rejected, event written, `Unit.ownerId` updated, **no `User` row created/changed**); listing visibility (BLOCKED/OCCUPIED/UNAVAILABLE never returned by the public listing query).
- **Frontend:** Units filters/search/sort/pagination/badges; Blocking page block+release round-trip (mocked resource); Assignments page reassign + history render; role gating (Assignments ADMIN-only, Blocking WRITE).
- **Preserve (regression):** portfolio import still green (new enum values are additive; the import status pass is unchanged); owner/account separation intact; SP1 nav tests still green after adding two entries.

## Edge cases / integrity

Blocking a non-VACANT unit → 409. Setting UNAVAILABLE on a unit with an active deal → refuse (release first). Reassign with a unitKey collision under the target owner → refuse. A blocking transaction deleted → `blockedByTransactionId` SET NULL (a scheduled reconcile is out of scope; the Blocking page shows such a unit as BLOCKED with no holder and offers Release). Unit status, approval status, and (future) lease status stay separate concerns. No data invented; no silent status flips.

## Migration/deploy note

Apply the manual SQL to `rbu_leasing` (dev) and `rbu_leasing_test` (test) — enum `ADD VALUE` statements first and standalone, then the `Unit` column and the `UnitAssignmentEvent` table — then `prisma generate` (stop the :5050 server first for the Windows Prisma DLL lock, restart after). Additive and backward compatible.

## Out of scope (restated)

No Lease creation/linking on signing (SP4), no expiry/renewal/lease fields, no move-in, no inquiry/viewing redesign, no marketplace/photo changes, no new npm dependency, no permission change beyond the new endpoints' gating.
