# Units & Blocking (Sub-Project 2 of the Leasing Revamp)

**Date:** 2026-10-30
**Status:** Approved; built; pending dev-machine verification (the tests have been written and reviewed by reading but not yet run)
**Branch:** `sp2/units-blocking` (base `7f23243`; carries SP1 + the earlier unmerged import/accounts/email work)

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
| BLOCKED → VACANT | **Release/Unblock** (WRITE, subject to the holder rule below), or automatically when the blocking deal ends (Declined at Contract Signing, or dead early — see below), is deleted, or is re-linked to another unit | Clears `blockedByTransactionId`; frees the unit so other inquiries can proceed |
| BLOCKED → OCCUPIED | Blocking transaction reaches **CONTRACT_SIGNING = "Signed"** | SP2 sets OCCUPIED + clears block pointer; **SP4** creates the Lease row |
| VACANT ↔ UNAVAILABLE | Manual **Set Unavailable / Restore** (WRITE) on the Units page | Only from/to VACANT (a blocked/occupied unit must be released first) |
| OCCUPIED → VACANT | **Not** automatic on expiry (per audit); only via SP4's lease-end flow | SP2 never auto-vacants |

- **Manual status edits** (`PATCH /units/:id`) may set **only VACANT↔UNAVAILABLE**; BLOCKED and OCCUPIED are pipeline-driven and rejected if set directly (prevents the inconsistency the two-dashboards bug class comes from).
- **Owner edits:** `PATCH /units/:id` no longer moves a unit to another owner. A `ownerId` equal to the current one is ignored (the edit form re-sends it); a different one is refused with **409** "Use Reassign owner to move a unit to another owner", so the assignment history is always written. The unit edit form shows the owner locked, with a pointer to Unit-Owner Assignments.
- **Who may release a block:** the unit-level release (`PATCH /units/:id/release-block`) and the deal-level unblock follow one **holder rule**: an ADMIN, the holder deal's assigned officer, or any officer when the holder deal is unassigned (an unassigned deal is in every officer's scope); anyone else gets a 409. A block with no holder (pointer null), or whose holder deal has ended, can be released by any write role.

**Dead early and ended deals.** There is **no Cancelled status**. A deal that dies before Contract Signing never writes `finalStatus`, so it is recognised by its stage and status (one shared list, `DEAD_EARLY_STATES` in `shared/leasingStages.js`, used by server and client): **INQUIRY** *Not Qualified* or *Declined*, and **UNIT_VIEWING** *Not Interested*. A deal is **ended** when `finalStatus` is Signed or Declined, or it is dead early.
- An ended deal never counts as an active deal, cannot block a unit (409 "This deal has ended"), and is left out of the Blocking page's *Deals ready to block*.
- **A dead deal's block is released automatically** in the same commit that records the status (the `/status` and `/advance` endpoints, and a viewing appointment completed as *Not Interested*), with the event "Unit block released (deal ended)".
- **Signed deals cannot be changed:** `/status` off Signed, `/return`, and `/link` to a different unit or lessor are refused with 409 (re-saving Signed is allowed). Contract Signing "Declined" releases the block as before.
- **No reviving over a rival:** moving an ended deal (Declined, or dead early) back to a live status — by `/status` (including Declined → Signed), `/advance`, `/return`, or an appointment that would set a live viewing status — is refused with 409 "Another active deal now exists on this unit" when another active deal now holds the unit.
- **Deleting a deal** that holds a block releases the unit in the same transaction (no holderless BLOCKED unit).

**One active deal per unit (conflict-fix):** accepting an inquiry creates the unit's single active `LeasingTransaction` but does **not** block the unit (stays VACANT/listed — honoring "don't auto-block on inquiry"). An **active deal** is a transaction that is not ended (see above) **and has a prospect** (an inquiry or a tenant). The lessor-onboarding transaction that `ensureForUnit` opens has no prospect and never counts. A second inquiry for a unit that already has an active deal is **refused at acceptance** with a 409 conflict — `Unit <no> already has an active deal (<reference>) for another prospect; unlink the unit from that deal or close it first` — and the inquiry row is **preserved** in the queue, unassigned and unconverted. Accepting the *same* inquiry again is idempotent (returns the existing transaction). The check is `activeDealForUnit` (not `openTransactionForUnit`, which only `ensureForUnit` still uses), run before the acceptance and again as a backstop inside `ensureForInquiry`; "Set unavailable" uses the same check.

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
- **Block/unblock on the transaction** (`leasingTransactionService`): `blockUnit(transactionId, actor)` → sets the unit BLOCKED + `blockedByTransactionId` (fails 409 if the unit isn't VACANT); `unblockUnit(transactionId, actor)` → back to VACANT + clears pointer. A block needs a unit, a prospect (inquiry or tenant) and a live deal; the claim is one conditional write (`status VACANT, approvalStatus APPROVED`), so two deals racing for a unit cannot both win. The existing stage machine sets OCCUPIED + clears the pointer when the blocking transaction hits `CONTRACT_SIGNING="Signed"`, and auto-unblocks (→VACANT) when it is Declined at Contract Signing or dies early (see *Dead early and ended deals*).
- **Conflict-fix** in `ensureForInquiry`: call `activeDealForUnit(unitId)`; if an active deal (with a prospect, not ended) exists → throw `ConflictError` (409) and leave the inquiry unconverted; if the inquiry already has its own transaction → return it. `acceptInquiry` runs the same check first (`assertUnitFreeForInquiry`) so a refusal leaves the inquiry exactly as it was, and surfaces the 409 to the officer.
- **Mark reviewed:** import v2 never auto-vacants a unit whose leases have all ended; it sets `needsStatusReview` instead. `PATCH /units/:id/mark-reviewed` (WRITE) clears that flag **without changing the status** (idempotent), which is how staff say the current status is right. The importer's status pass also clears a stale block pointer when it sets a unit OCCUPIED.
- **Reassignment:** `PATCH /api/units/:id/assign-owner { toOwnerId, reason? }` (ADMIN) → validate (exists, changed, no unitKey collision under target) → write `UnitAssignmentEvent` + update `Unit.ownerId`. `GET /api/units/:id/assignments` → history list.
- **Endpoints added:** `PATCH /units/:id/unavailable`, `PATCH /units/:id/restore`, `PATCH /units/:id/release-block` (WRITE; holder rule above; also clears a block whose holder is gone), `PATCH /units/:id/mark-reviewed` (WRITE), `PATCH /units/:id/assign-owner`, `GET /units/:id/assignments`, `PATCH /leasing-transactions/:id/block`, `PATCH /leasing-transactions/:id/unblock`. All role-gated and audited by the existing middleware; block/unblock + reassignment cannot leak into the public listing (BLOCKED≠VACANT).

## Frontend

- **`resource.js`:** `units.setUnavailable(id)/restore(id)/releaseBlock(id)/markReviewed(id)/assignOwner(id,{toOwnerId,reason})/assignments(id)`; `leasingTransactions.blockUnit(id)/unblockUnit(id)`.
- **Units page redesign (`UnitsView.vue`):** search (unit no./owner/tower), sortable columns, pagination, **status filter** (VACANT/BLOCKED/OCCUPIED/UNAVAILABLE) + approval filter; columns unit · owner · type · **status badge** (distinct colour per state) · approval · actions; contextual actions View/Edit (existing), Set Unavailable/Restore, Reassign Owner. Follows existing admin-table styling; empty/loading/error states.
- **Unit Blocking page (new, nav: Leasing Operations › Leasing Management › Unit Blocking, WRITE):** a reservation console — currently-BLOCKED units with their holder, and *Deals ready to block*. The holder column has **three cases**: the holder deal is in the officer's loaded list (reference + prospect, **Release** goes through the deal's unblock); the unit names a holder deal that is not in the list (another officer's deal, or a stale list) → "Held by a deal outside your view" with **no** Release, since a unit-level release would free someone else's reservation; no holder at all → "No holder" with a unit-level **Release**. A deal is ready to block when it has a unit and a prospect, is not ended (signed, declined or dead early) and its unit is VACANT and APPROVED. Each action reloads both tables; a failed reload after a saved action keeps the tables and says "Saved, but the list could not be refreshed. Reload the page."; only a failed first load hides them.
- **Unit-Owner Assignments page (new, nav: Leasing Operations › Units › Unit-Owner Assignments, ADMIN):** units with current owner + **verification status** (owner `needsReview` badge + unit `approvalStatus`); a **Reassign owner** action (owner picker via `owners.linkable()`, with reason); per-unit **assignment history** from `GET /units/:id/assignments`.
- Both new pages get their nav entries (the SP1-deferred ones) added to `client/src/lib/nav.js` now that the pages exist.

## Testing

- **Backend:** each status transition + guard (block only VACANT; manual set rejects BLOCKED/OCCUPIED; unblock clears pointer; sign→OCCUPIED+clear; decline or dead-early→VACANT; signed deals unchangeable; no revival over a rival); the conflict-fix (2nd inquiry accept on an active-deal unit → 409 + inquiry preserved + no 2nd transaction; same-inquiry idempotent); reassignment (target-exists, no-op rejected, unitKey-collision rejected, event written, `Unit.ownerId` updated, **no `User` row created/changed**); listing visibility (BLOCKED/OCCUPIED/UNAVAILABLE never returned by the public listing query).
- **Frontend:** Units filters/search/sort/pagination/badges; Blocking page block+release round-trip (mocked resource); Assignments page reassign + history render; role gating (Assignments ADMIN-only, Blocking WRITE).
- **Preserve (regression):** portfolio import still green (new enum values are additive; the import status pass is unchanged); owner/account separation intact; SP1 nav tests still green after adding two entries.

## Edge cases / integrity

Blocking a non-VACANT unit → 409. Setting UNAVAILABLE on a unit with an active deal → refuse (release first). Reassign with a unitKey collision under the target owner → refuse. A blocking transaction deleted → `blockedByTransactionId` SET NULL (a scheduled reconcile is out of scope; the Blocking page shows such a unit as BLOCKED with no holder and offers Release). Deleting a deal that holds a block releases the unit first, so this normally only arises from data written outside the app.

**Known windows (accepted, not closed in SP2):**
- There is **no unique index** for "one active prospect deal per unit". The check and the create are separate statements, so two simultaneous acceptances (or a link racing an acceptance) can both pass. A partial unique index would close it but needs manual SQL and must also cover the `/link` and tenant-linked paths.
- `nextReference()` reads the highest reference and then writes: two simultaneous creates can compute the same reference and the loser fails the unique constraint (surfaces as a 500, nothing created). Pre-existing.
- A block can race a concurrent decline or re-link of the same deal; the result is recoverable through Release.

Unit status, approval status, and (future) lease status stay separate concerns. No data invented; no silent status flips.

## Migration/deploy note

Apply the manual SQL to `rbu_leasing` (dev) and `rbu_leasing_test` (test) — enum `ADD VALUE` statements first and standalone, then the `Unit` column and the `UnitAssignmentEvent` table — then `prisma generate` (stop the :5050 server first for the Windows Prisma DLL lock, restart after). Additive and backward compatible.

## Out of scope (restated)

No Lease creation/linking on signing (SP4), no expiry/renewal/lease fields, no move-in, no inquiry/viewing redesign, no marketplace/photo changes, no new npm dependency, no permission change beyond the new endpoints' gating.
