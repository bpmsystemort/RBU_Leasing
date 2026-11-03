# Unit Viewing Stage (Officer Proposes → Lessor Confirms → Outcome-Gated) — Design

**Date:** 2026-10-14
**Status:** Approved (design)
**Area:** Leasing pipeline · inquiries · appointments/scheduling · lessor portal

## Goal

Insert a **Unit Viewing** step between *Inquiry* and *Send Requirements* so a
prospective lessee is never asked for documents just to express interest in a
unit. The viewing is scheduled through a **two-way handshake between the leasing
officer and the lessor** (the owner controls access to their unit); its
**outcome gates** whether the prospect proceeds to requirements.

## Background (current behavior)

- **Pipeline** (`shared/leasingStages.js`) is 6 ordered stages: `INQUIRY →
  SEND_REQUIREMENTS → APPROVAL → UNIT_INSPECTION → PHOTOSHOOT →
  CONTRACT_SIGNING`. The state machine (`advance`/`returnStage`/`setStatus` in
  `server/src/services/leasingTransactionService.js`) is index-driven off that
  array; `stageData` is keyed by stage **name**.
- **Inquiry → transaction:** accepting an inquiry (`acceptInquiry` →
  `ensureForInquiry`) creates the `LeasingTransaction`, marks `INQUIRY` as
  `Qualified`/completed, and **rests the transaction straight at
  `SEND_REQUIREMENTS`** ("Upload the required documents"). The inquiry form
  itself collects no documents (`inquiryCreateSchema`): name, email, message,
  consent, optional `unitId`.
- **Lessor onboarding → transaction:** `ensureForUnit` (a lessor registering a
  unit, no lessee) marks `INQUIRY` `Skipped` and also rests at
  `SEND_REQUIREMENTS`.
- **Scheduling** (`server/src/services/appointmentService.js`): the
  `Appointment` model is one row per `(transactionId, stage)`. Only stages in
  `SCHEDULABLE_STAGES` (today `UNIT_INSPECTION`, `PHOTOSHOOT`) can carry one.
  `scheduleAppointment` sets the appointment to `Scheduled` and syncs the stage
  status; `complete` records an `outcome`. **All scheduling actions are
  staff-driven.** Portal users can only *read* their appointments
  (`listMine`, `listForTransaction` via `assertCanAccess`); a lessor cannot act
  on one.
- **Lessor visibility:** a `UNIT_OWNER` sees the transactions for their units
  (`listMine`, Leasing Progress portal) but has no actions on them.

## Decisions

| Topic | Decision |
|---|---|
| Modeling | **New pipeline stage `UNIT_VIEWING`**, inserted at index 1 (between `INQUIRY` and `SEND_REQUIREMENTS`), reusing the appointment system. |
| Lessor's role | **Officer proposes → lessor confirms** (two-way). The lessor may confirm *or* propose a different time; the officer then confirms or re-proposes. |
| Optionality | **Skippable.** The officer can skip the viewing and advance to Send Requirements. |
| Outcome | **Gates advancement.** `Interested` is required (or `Skipped`) before Send Requirements. `Not Interested`/`No-show` do not advance. |
| Scope | Only a **LESSEE inquiry tied to a specific unit** rests at Unit Viewing. No-unit inquiries and `ensureForUnit` (lessor) mark it `Skipped`. |
| Prospect contact | The prospect has **no account** at this stage; the officer relays the confirmed time out-of-band. No notifications added (no email in the system). |

## The stage

Added to `LEASING_STAGES` at index 1:

```js
{
  key: "UNIT_VIEWING", label: "Unit Viewing", short: "Viewing",
  statuses: ["Pending", "Proposed", "Confirmed", "Interested", "Not Interested", "No-show", "Skipped"],
  initial: "Pending", done: "Interested",
  lesseeAction: "A viewing of the unit is being scheduled.",
}
```

and to `SCHEDULABLE_STAGES`:

```js
UNIT_VIEWING: { defaultOutcome: "Interested", outcomeOptions: ["Interested", "Not Interested", "No-show"] },
```

New appointment status strings used by this stage: **`Proposed`**, **`Confirmed`**
(appended to `APPOINTMENT_STATUSES`; `Appointment.status` is a free string
column, so no DB enum change).

## The handshake

The viewing appointment carries the current proposer so each side knows whose
turn it is:

1. **Officer proposes** a time → appointment `status = "Proposed"`,
   `proposedByRole = "LEASING_OFFICER"`; stage status `Proposed`.
2. **Lessor** (Leasing Progress portal) either:
   - **Confirms** → `status = "Confirmed"`, `confirmedAt` set; stage status
     `Confirmed`. The viewing is booked.
   - **Proposes another time** → `status = "Proposed"`,
     `proposedByRole = "UNIT_OWNER"`, new `scheduledAt`; stage status `Proposed`
     (now awaiting the officer).
3. **Officer** confirms the lessor's counter (→ `Confirmed`) or re-proposes.
4. After the viewing happens, the **officer completes** it with an outcome:
   `Interested` | `Not Interested` | `No-show` → stage status = that outcome,
   appointment `status = "Completed"`.

"Awaiting confirmation" is shown to whoever is **not** the last proposer
(`proposedByRole`). Either party may confirm the *other's* proposal; nobody can
confirm their own.

## Data model

**`shared/leasingStages.js`** — insert the stage + schedulable entry + statuses
(above).

**`Appointment`** — add two nullable columns, applied by **manual SQL** on both
dev (`rbu_leasing`) and test (`rbu_leasing_test`) databases (this repo uses
manual migrations — never `migrate dev`/`db push`), then `prisma generate`:

```sql
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "proposedByRole" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
```

and in `schema.prisma`:

```prisma
  proposedByRole String?
  confirmedAt    DateTime?
```

## Server changes

**Rest at the viewing for a unit-specific lessee inquiry** —
`ensureForInquiry` (`leasingTransactionService.js`): when the inquiry is a
`LESSEE` inquiry **and** a unit resolved (`unit` is non-null), build
`stageData` as `INQUIRY: Qualified/completed`, `UNIT_VIEWING: Pending/started`,
and create the transaction at `stage: "UNIT_VIEWING", status: "Pending"`.
Otherwise (no unit, or a `LESSOR` inquiry) mark `UNIT_VIEWING: Skipped` and rest
at `SEND_REQUIREMENTS` as today. `ensureForUnit` marks both `INQUIRY` and
`UNIT_VIEWING` `Skipped` and rests at `SEND_REQUIREMENTS`.

**Propose / confirm / outcome** — `appointmentService.js`:
- `scheduleAppointment`: for `UNIT_VIEWING`, create with `status = "Proposed"`,
  `proposedByRole = actor.role`, and sync stage status `Proposed` (other stages
  keep `Scheduled`, unchanged).
- New `confirmAppointment(user, id)`: allowed only when `status = "Proposed"`
  and the confirmer is **not** the last proposer (an officer confirms a lessor's
  proposal; a lessor confirms an officer's). Sets `status = "Confirmed"`,
  `confirmedAt = now`; stage status `Confirmed`.
- New `proposeTime(user, id, body)` (lessor or officer counter-proposal): sets
  `status = "Proposed"`, `proposedByRole = user.role`, new `scheduledAt`; stage
  status `Proposed`. (For non-viewing stages the existing `reschedule` is used;
  this is the viewing-specific re-propose that flips the turn.)
- `complete`: unchanged mechanics; `UNIT_VIEWING` outcomes come from
  `SCHEDULABLE_STAGES` (`Interested`/`Not Interested`/`No-show`).

**Advance gate** — `advance` (`leasingTransactionService.js`): advancing **from**
`UNIT_VIEWING` requires `txn.status` to be `Interested` or `Skipped`; otherwise
`ConflictError("Record the viewing outcome (or skip it) before Send
Requirements")`. Mirrors the existing `PHOTOSHOOT → CONTRACT_SIGNING` guard.

**Skip** — the officer sets `UNIT_VIEWING` status `Skipped` (existing `setStatus`)
then `advance`. No new endpoint.

**Access control for lessor actions** — `confirmAppointment` and `proposeTime`
must accept a `UNIT_OWNER` acting on **their own** unit's transaction (the
existing `assertCanAccess` already allows owner/tenant read; these writes reuse
it, so a lessor can only touch an appointment on a transaction whose
`unitOwnerId` is theirs). Officers (`ADMIN`/`LEASING_OFFICER`) may also use them.

**Routes** (`appointmentRoutes.js`): add
- `PATCH /api/appointments/:id/confirm` — `confirmAppointment` (owner or staff).
- `PATCH /api/appointments/:id/propose` — `proposeTime` (owner or staff).

(The existing `schedule`/`reschedule`/`complete`/`cancel` stay staff-only.)

## Client changes

**Tracker** — `DeliveryTracker.vue` maps over the shared `LEASING_STAGES`, so the
new stage appears automatically. Verify its labels/short names render; no logic
change expected.

**Officer** — `TransactionDetailView.vue` / `SchedulingPanel.vue`: for the
`UNIT_VIEWING` stage, let the officer **propose** a time, show the lessor's
confirmation state ("Awaiting lessor" / "Confirmed" / "Lessor proposed a new
time — confirm?"), **confirm** a lessor counter-proposal, record the **outcome**,
and **skip**.

**Lessor** — `MyLeasingProgressView.vue` (Leasing Progress): when a transaction
for the owner's unit is at `UNIT_VIEWING` with a pending proposal, show the
proposed date/time with **Confirm** and **Propose another time** actions, and the
status afterward. This is the new owner-facing capability.

**Client API** (`client/src/lib/resource.js`) — add `appointments.confirm(id)`
and `appointments.propose(id, body)`.

## Error / edge handling

- **Confirm your own proposal** → rejected (`ConflictError`): the party who last
  proposed cannot confirm; the other party must.
- **Advance before a viewing outcome** → rejected by the advance gate.
- **No-unit / general inquiry, or LESSOR inquiry** → viewing `Skipped`, flow
  rests at Send Requirements exactly as today (backward compatible).
- **Existing in-flight transactions** (created before this change) are keyed by
  stage name and simply have no `UNIT_VIEWING` entry in `stageData`; they are
  unaffected and never reopen a viewing.
- **Unit unlinked after a viewing was proposed** → the appointment remains on the
  transaction; staff can cancel it. (No cascade change.)
- **Reschedule limit** — not introduced; the handshake can iterate (each
  proposal increments nothing new; `rescheduleCount` stays for the existing
  reschedule path).

## Testing

**Server (Vitest + supertest)**
- `ensureForInquiry`: a `LESSEE` inquiry with a linked unit → transaction rests
  at `UNIT_VIEWING` (`Pending`); a no-unit inquiry and a `LESSOR` inquiry →
  `UNIT_VIEWING` `Skipped`, rests at `SEND_REQUIREMENTS`.
- `ensureForUnit` → `UNIT_VIEWING` `Skipped`.
- Handshake: officer proposes → `Proposed`/`proposedByRole=LEASING_OFFICER`;
  lessor confirms → `Confirmed`; lessor counter-proposes → `Proposed`/
  `proposedByRole=UNIT_OWNER`; officer confirms → `Confirmed`.
- Confirm-your-own-proposal is rejected for both roles.
- `complete(Interested)` → stage `Interested`; `advance` → `SEND_REQUIREMENTS`.
  `complete(Not Interested)` → `advance` blocked. `setStatus(Skipped)` →
  `advance` allowed.
- Access control: a lessor can confirm/propose only on their own unit's
  transaction; a different owner / tenant is 404/forbidden.
- Pipeline integrity: 7 stages; `nextStageKey`/`prevStageKey`/`stageIndex`
  correct; existing stage tests still pass.

**Client (Vitest + @vue/test-utils)**
- Tracker renders the 7 stages including "Unit Viewing".
- Officer panel: propose → shows awaiting-lessor; confirm a lessor proposal;
  record outcome; skip.
- Lessor Leasing Progress: a pending officer proposal shows Confirm / Propose
  actions and calls the right endpoints; after confirm, shows Confirmed.

## Out of scope

- **Notifications / email** — unchanged; the officer relays out-of-band.
- **A prospect account at the viewing stage** — the lessee still has no account
  until later in the flow.
- **Reworking Inspection/Photoshoot/Approval/Contract** — only the new stage and
  its gate are added.
- **A second schedulable handshake elsewhere** — the propose/confirm two-way flow
  is built for `UNIT_VIEWING`; other stages keep single-sided staff scheduling.
- **Changing the lessee inquiry form** — it already collects no documents.
