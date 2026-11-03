# Unit Viewing Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a `UNIT_VIEWING` stage between Inquiry and Send Requirements, scheduled through an officer↔lessor proposal/confirmation handshake, with the viewing outcome gating whether the prospect proceeds to requirements.

**Architecture:** `UNIT_VIEWING` is added to the shared stage registry (the pipeline and state machine are index-driven off it, so most of the flow adapts automatically). The viewing reuses the existing `Appointment` system with two new nullable columns (`proposedByRole`, `confirmedAt`) and new appointment status strings (`Proposed`, `Confirmed`). Accepting a lessee inquiry tied to a unit rests the transaction at `UNIT_VIEWING`; everything else skips it. Advancing out of `UNIT_VIEWING` is gated on `Interested` or `Skipped`.

**Tech Stack:** Vue 3 + vue-router + Pinia client; Node/Express + Prisma (PostgreSQL) server; Vitest (+ supertest / @vue/test-utils); Zod.

## Global Constraints

- **No renames.** Keep existing stage keys, enum values, routes, and component names. This feature only ADDS a stage, columns, endpoints, and UI.
- **Migration drift — never `prisma migrate dev` / `db push`.** Schema changes go in by manual SQL applied with `prisma db execute` against BOTH `rbu_leasing` (dev, `server/.env`) and `rbu_leasing_test` (test, `server/.env.test`), then `prisma generate`. Manual-migration SQL lives in `server/prisma/manual-migrations/`.
- **Never commit `server/.env` / `server/.env.test`** (gitignored).
- **Backward compatibility:** existing in-flight transactions are keyed by stage name and must keep working; no-unit inquiries and lessor onboarding behave exactly as today (viewing `Skipped`).
- **Commit attribution — end every commit message with:**
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Server commands run from `server/`; client commands from `client/`. Branch: `feat/unit-viewing-stage`.

---

## File Structure

**Server**
- Modify `shared/leasingStages.js` — add the stage, schedulable entry, appointment statuses.
- Create `server/prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql`.
- Modify `server/prisma/schema.prisma` — `Appointment.proposedByRole`, `Appointment.confirmedAt`.
- Modify `server/src/services/leasingTransactionService.js` — rest-at-viewing + advance gate.
- Modify `server/src/services/appointmentService.js` — propose/confirm handshake.
- Modify `server/src/validation/appointment.js` — `proposeSchema`.
- Modify `server/src/controllers/appointmentController.js` — `confirm`, `propose`.
- Modify `server/src/routes/appointmentRoutes.js` — the two new routes.
- Tests: `server/tests/unitViewing.test.js` (+ existing suites stay green).

**Client**
- Modify `client/src/lib/resource.js` — `appointments.confirm`, `appointments.propose`.
- Modify `client/src/components/DeliveryTracker.vue` — stage icon.
- Modify `client/src/components/SchedulingPanel.vue` — officer viewing support.
- Create `client/src/components/ViewingConfirmPanel.vue` — lessor confirm/propose.
- Modify `client/src/views/MyLeasingProgressView.vue` — mount the lessor panel.
- Tests: `client/tests/ViewingConfirmPanel.test.js`, updates to `SchedulingPanel` / tracker tests as needed.

---

## Task 1: Add the UNIT_VIEWING stage to the shared registry

**Files:**
- Modify: `shared/leasingStages.js`
- Test: `server/tests/unitViewing.test.js` (new — first block)

**Interfaces:**
- Produces: `UNIT_VIEWING` stage at index 1; `SCHEDULABLE_STAGES.UNIT_VIEWING`; `Proposed`/`Confirmed` in `APPOINTMENT_STATUSES`. Consumed by every later task.

- [ ] **Step 1: Write the failing test**

Create `server/tests/unitViewing.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  LEASING_STAGES, STAGE_KEYS, stageIndex, nextStageKey, prevStageKey,
  SCHEDULABLE_STAGES, isSchedulableStage, APPOINTMENT_STATUSES, stageByKey,
} from "../../shared/leasingStages.js";

describe("UNIT_VIEWING stage registry", () => {
  it("sits between INQUIRY and SEND_REQUIREMENTS", () => {
    expect(STAGE_KEYS).toHaveLength(7);
    expect(stageIndex("UNIT_VIEWING")).toBe(1);
    expect(nextStageKey("INQUIRY")).toBe("UNIT_VIEWING");
    expect(nextStageKey("UNIT_VIEWING")).toBe("SEND_REQUIREMENTS");
    expect(prevStageKey("SEND_REQUIREMENTS")).toBe("UNIT_VIEWING");
  });

  it("is schedulable with the viewing outcomes and the Interested done-status", () => {
    expect(isSchedulableStage("UNIT_VIEWING")).toBe(true);
    expect(SCHEDULABLE_STAGES.UNIT_VIEWING.outcomeOptions).toEqual(["Interested", "Not Interested", "No-show"]);
    expect(stageByKey("UNIT_VIEWING").done).toBe("Interested");
    expect(stageByKey("UNIT_VIEWING").statuses).toEqual(
      expect.arrayContaining(["Pending", "Proposed", "Confirmed", "Interested", "Not Interested", "No-show", "Skipped"]),
    );
  });

  it("adds Proposed and Confirmed appointment statuses", () => {
    expect(APPOINTMENT_STATUSES).toEqual(expect.arrayContaining(["Proposed", "Confirmed"]));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: FAIL (7 !== 6; UNIT_VIEWING undefined).

- [ ] **Step 3: Insert the stage**

In `shared/leasingStages.js`, add this object to the `LEASING_STAGES` array **between** the `INQUIRY` entry and the `SEND_REQUIREMENTS` entry:

```js
  {
    key: "UNIT_VIEWING", label: "Unit Viewing", short: "Viewing",
    statuses: ["Pending", "Proposed", "Confirmed", "Interested", "Not Interested", "No-show", "Skipped"],
    initial: "Pending", done: "Interested",
    lesseeAction: "A viewing of the unit is being scheduled.",
  },
```

- [ ] **Step 4: Make it schedulable and extend appointment statuses**

In the same file, add to `SCHEDULABLE_STAGES` (before `UNIT_INSPECTION`):

```js
  UNIT_VIEWING:    { defaultOutcome: "Interested", outcomeOptions: ["Interested", "Not Interested", "No-show"] },
```

and extend `APPOINTMENT_STATUSES`:

```js
export const APPOINTMENT_STATUSES = ["Proposed", "Confirmed", "Scheduled", "Rescheduled", "Completed", "Cancelled", "No-show"];
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing leasing-stage suites to confirm no regression**

Run (from `server/`): `npx vitest run tests/leasingStages.test.js tests/leasingTransactions.test.js`
Expected: PASS. (If an existing test hardcodes "6 stages" or stage order, that is a real coupling to fix — update it to the 7-stage reality and note it in the task report.)

- [ ] **Step 7: Commit**

```bash
git add shared/leasingStages.js server/tests/unitViewing.test.js
git commit -m "feat(stages): add UNIT_VIEWING between inquiry and requirements"
```

---

## Task 2: Add the Appointment handshake columns

**Files:**
- Modify: `server/prisma/schema.prisma` (Appointment model)
- Create: `server/prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql`

**Interfaces:**
- Produces: `Appointment.proposedByRole` (nullable text), `Appointment.confirmedAt` (nullable datetime). Consumed by Task 4.

- [ ] **Step 1: Add the fields to the schema**

In `server/prisma/schema.prisma`, inside `model Appointment` (after `rescheduleCount Int @default(0)`), add:

```prisma
  // Officer↔lessor viewing handshake: who made the current proposal
  // (LEASING_OFFICER/ADMIN vs UNIT_OWNER) and when the other side confirmed.
  proposedByRole String?
  confirmedAt    DateTime?
```

- [ ] **Step 2: Write the manual migration SQL**

Create `server/prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql`:

```sql
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "proposedByRole" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply to the dev database**

Run (from `server/`):

```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql
```

Expected: `Script executed successfully.`

- [ ] **Step 4: Apply to the test database**

Run (from `server/`, Git Bash):

```bash
DATABASE_URL=$(grep '^DATABASE_URL' .env.test | cut -d'"' -f2) npx prisma db execute --schema prisma/schema.prisma --file prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql
```

Expected: `Script executed successfully.`

- [ ] **Step 5: Regenerate the Prisma client**

Run (from `server/`): `npx prisma generate`
Expected: `Generated Prisma Client`. (On Windows, if it fails with EPERM/file-lock, a `node`/dev-server process is holding the engine DLL — report it as a concern with the exact error; do not force-kill.)

- [ ] **Step 6: Verify the columns on both DBs**

Run (from `server/`):

```bash
node -e "import('./src/lib/prisma.js').then(async ({prisma})=>{const r=await prisma.\$queryRawUnsafe(\"select column_name from information_schema.columns where table_name='Appointment' and column_name in ('proposedByRole','confirmedAt') order by column_name\");console.log('dev:',r);process.exit(r.length===2?0:1)})"
DATABASE_URL=$(grep '^DATABASE_URL' .env.test | cut -d'"' -f2) node -e "import('./src/lib/prisma.js').then(async ({prisma})=>{const r=await prisma.\$queryRawUnsafe(\"select column_name from information_schema.columns where table_name='Appointment' and column_name in ('proposedByRole','confirmedAt') order by column_name\");console.log('test:',r);process.exit(r.length===2?0:1)})"
```

Expected: each prints both columns and exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/manual-migrations/2026-10-14-appointment-viewing-handshake.sql
git commit -m "feat(db): add Appointment.proposedByRole/confirmedAt for viewing handshake"
```

---

## Task 3: Rest at the viewing, and gate advancing out of it

**Files:**
- Modify: `server/src/services/leasingTransactionService.js`
- Test: `server/tests/unitViewing.test.js` (append a describe block)

**Interfaces:**
- Consumes: the `UNIT_VIEWING` stage (Task 1).
- Produces: a lessee-with-unit inquiry rests at `UNIT_VIEWING`; `advance` from `UNIT_VIEWING` requires `Interested`/`Skipped`. Consumed by Task 4 (handshake + advance integration).

- [ ] **Step 1: Write the failing test**

Append to `server/tests/unitViewing.test.js`:

```js
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { acceptInquiry } from "../src/services/inquiryService.js";

const app = createApp();

describe("Inquiry acceptance routes through Unit Viewing", () => {
  beforeEach(async () => { await resetCrudTables(); });

  async function lesseeInquiry(withUnit) {
    let unitId = null, ownerId = null;
    if (withUnit) {
      const owner = await factory.owner();
      const unit = await factory.unit(owner.id, { unitNumber: "9A", status: "VACANT", approvalStatus: "APPROVED" });
      unitId = unit.id; ownerId = owner.id;
    }
    const inq = await prisma.inquiry.create({ data: {
      category: "RESIDENCES", inquirerType: "LESSEE", inquiryType: "Residential Lease",
      fullName: "Prospect P", email: "p@example.com", consent: true, status: "NEW", unitId,
    } });
    return { inq, unitId, ownerId };
  }

  it("rests a lessee inquiry WITH a unit at UNIT_VIEWING", async () => {
    const { inq } = await lesseeInquiry(true);
    await acceptInquiry({ userId: "test-officer", role: "LEASING_OFFICER" }, inq.id);
    const txn = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txn.stage).toBe("UNIT_VIEWING");
    expect(txn.status).toBe("Pending");
    expect(txn.stageData.INQUIRY.status).toBe("Qualified");
  });

  it("skips the viewing for a lessee inquiry with NO unit", async () => {
    const { inq } = await lesseeInquiry(false);
    await acceptInquiry({ userId: "test-officer", role: "LEASING_OFFICER" }, inq.id);
    const txn = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txn.stage).toBe("SEND_REQUIREMENTS");
    expect(txn.stageData.UNIT_VIEWING.status).toBe("Skipped");
  });

  it("blocks advancing out of UNIT_VIEWING until Interested or Skipped", async () => {
    const owner = await factory.owner();
    const t = await prisma.leasingTransaction.create({ data: {
      reference: "RBU-2026-900001", stage: "UNIT_VIEWING", status: "Confirmed",
      stageData: { UNIT_VIEWING: { status: "Confirmed", startedAt: new Date().toISOString() } },
      unitOwnerId: owner.id,
    } });
    const blocked = await request(app).patch(`/api/leasing-transactions/${t.id}/advance`)
      .set("Authorization", `Bearer ${tokens.officer()}`).send({});
    expect(blocked.status).toBe(409);

    await request(app).patch(`/api/leasing-transactions/${t.id}/status`)
      .set("Authorization", `Bearer ${tokens.officer()}`).send({ status: "Interested" });
    const ok = await request(app).patch(`/api/leasing-transactions/${t.id}/advance`)
      .set("Authorization", `Bearer ${tokens.officer()}`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.stage).toBe("SEND_REQUIREMENTS");
  });
});
```

(Add `beforeEach` to the import line: `import { describe, it, expect, beforeEach } from "vitest";` at the top of the file.)

- [ ] **Step 2: Run it to verify it fails**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: FAIL (rests at SEND_REQUIREMENTS, not UNIT_VIEWING; advance not gated).

- [ ] **Step 3: Rest lessee-with-unit inquiries at the viewing**

In `server/src/services/leasingTransactionService.js`, replace the `stageData`/`create` block of `ensureForInquiry` (the part that builds `stageData` and calls `prisma.leasingTransaction.create`) with:

```js
  const now = stampNow();
  const reference = await nextReference();

  // A lessee inquiring about a specific unit views it first; everything else
  // (no unit, or a lessor inquiry) skips straight to Send Requirements as before.
  const wantsViewing = inquiry.inquirerType === "LESSEE" && !!unit;
  const stageData = wantsViewing
    ? {
        INQUIRY: { status: "Qualified", completedAt: now },
        UNIT_VIEWING: { status: "Pending", startedAt: now },
      }
    : {
        INQUIRY: { status: "Qualified", completedAt: now },
        UNIT_VIEWING: { status: "Skipped", completedAt: now },
        SEND_REQUIREMENTS: { status: "Pending", startedAt: now },
      };
  const restStage = wantsViewing ? "UNIT_VIEWING" : "SEND_REQUIREMENTS";

  const txn = await prisma.leasingTransaction.create({
    data: {
      reference,
      stage: restStage,
      status: "Pending",
      stageData,
      lesseeName: inquiry.fullName,
      inquiryId: inquiry.id,
      assignedOfficerId: inquiry.assignedToId || actor?.userId || null,
      unitId: unit ? unit.id : null,
      unitOwnerId: unit ? unit.ownerId : null,
    },
  });
```

(The `logEvent` calls that follow in `ensureForInquiry` are unchanged.)

- [ ] **Step 4: Skip the viewing in `ensureForUnit`**

In the same file, in `ensureForUnit`, change its `stageData` to include the skipped viewing:

```js
  const stageData = {
    INQUIRY: { status: "Skipped", completedAt: now },
    UNIT_VIEWING: { status: "Skipped", completedAt: now },
    SEND_REQUIREMENTS: { status: "Pending", startedAt: now },
  };
```

- [ ] **Step 5: Gate advancing out of the viewing**

In `advance`, right after the `PHOTOSHOOT` guard block (before `const now = stampNow();`), add:

```js
  // A viewing must reach a verdict (or be explicitly skipped) before the
  // prospect is asked for any documents.
  if (txn.stage === "UNIT_VIEWING" && !["Interested", "Skipped"].includes(txn.status)) {
    throw new ConflictError("Record the viewing outcome (or skip it) before Send Requirements");
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: PASS.

- [ ] **Step 7: Run inquiry/transaction regression suites**

Run (from `server/`): `npx vitest run tests/inquiries.test.js tests/inquiryConversion.test.js tests/leasingTransactions.test.js tests/contractSigning.test.js`
Expected: PASS. (A test asserting an accepted lessee-with-unit inquiry lands on SEND_REQUIREMENTS is now wrong — update it to UNIT_VIEWING and note it.)

- [ ] **Step 8: Commit**

```bash
git add server/src/services/leasingTransactionService.js server/tests/unitViewing.test.js
git commit -m "feat(leasing): rest unit-specific lessee inquiries at Unit Viewing, gate advance"
```

---

## Task 4: The officer↔lessor viewing handshake

**Files:**
- Modify: `server/src/services/appointmentService.js`
- Modify: `server/src/validation/appointment.js`
- Modify: `server/src/controllers/appointmentController.js`
- Modify: `server/src/routes/appointmentRoutes.js`
- Test: `server/tests/unitViewing.test.js` (append a describe block)

**Interfaces:**
- Consumes: the stage (Task 1), the columns (Task 2), the advance gate (Task 3).
- Produces: `POST /api/appointments/transaction/:id/UNIT_VIEWING` creates a `Proposed` appointment; `PATCH /api/appointments/:id/confirm`; `PATCH /api/appointments/:id/propose`; `complete` records viewing outcomes.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/unitViewing.test.js`:

```js
describe("Viewing handshake", () => {
  beforeEach(async () => { await resetCrudTables(); });

  async function txnAtViewing() {
    const owner = await factory.owner({ name: "Owner Co" });
    const t = await prisma.leasingTransaction.create({ data: {
      reference: "RBU-2026-910001", stage: "UNIT_VIEWING", status: "Pending",
      stageData: { UNIT_VIEWING: { status: "Pending", startedAt: new Date().toISOString() } },
      unitOwnerId: owner.id,
    } });
    return { t, ownerId: owner.id };
  }
  const officer = () => ({ Authorization: `Bearer ${tokens.officer()}` });
  const lessor = (id) => ({ Authorization: `Bearer ${tokens.owner(id)}` });

  it("officer proposes → Proposed by staff; lessor confirms → Confirmed", async () => {
    const { t, ownerId } = await txnAtViewing();
    const prop = await request(app).post(`/api/appointments/transaction/${t.id}/UNIT_VIEWING`)
      .set(officer()).send({ scheduledAt: "2026-10-20T04:00:00.000Z", location: "Lobby" });
    expect(prop.status).toBe(201);
    expect(prop.body.status).toBe("Proposed");
    expect(prop.body.proposedByRole).toBe("LEASING_OFFICER");

    // The proposer cannot confirm their own proposal.
    const selfConfirm = await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(officer()).send({});
    expect(selfConfirm.status).toBe(409);

    const conf = await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(lessor(ownerId)).send({});
    expect(conf.status).toBe(200);
    expect(conf.body.status).toBe("Confirmed");
    const txn = await prisma.leasingTransaction.findUnique({ where: { id: t.id } });
    expect(txn.status).toBe("Confirmed");
  });

  it("lessor proposes another time → Proposed by owner; officer confirms", async () => {
    const { t, ownerId } = await txnAtViewing();
    const prop = await request(app).post(`/api/appointments/transaction/${t.id}/UNIT_VIEWING`)
      .set(officer()).send({ scheduledAt: "2026-10-20T04:00:00.000Z" });
    const counter = await request(app).patch(`/api/appointments/${prop.body.id}/propose`)
      .set(lessor(ownerId)).send({ scheduledAt: "2026-10-21T06:00:00.000Z" });
    expect(counter.status).toBe(200);
    expect(counter.body.status).toBe("Proposed");
    expect(counter.body.proposedByRole).toBe("UNIT_OWNER");
    // Now the lessor cannot confirm their own counter; the officer can.
    expect((await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(lessor(ownerId)).send({})).status).toBe(409);
    expect((await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(officer()).send({})).status).toBe(200);
  });

  it("completing with Interested lets the transaction advance", async () => {
    const { t, ownerId } = await txnAtViewing();
    const prop = await request(app).post(`/api/appointments/transaction/${t.id}/UNIT_VIEWING`).set(officer()).send({ scheduledAt: "2026-10-20T04:00:00.000Z" });
    await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(lessor(ownerId)).send({});
    const done = await request(app).patch(`/api/appointments/${prop.body.id}/complete`).set(officer()).send({ outcome: "Interested" });
    expect(done.status).toBe(200);
    const txn = await prisma.leasingTransaction.findUnique({ where: { id: t.id } });
    expect(txn.status).toBe("Interested");
    const adv = await request(app).patch(`/api/leasing-transactions/${t.id}/advance`).set(officer()).send({});
    expect(adv.body.stage).toBe("SEND_REQUIREMENTS");
  });

  it("a stranger owner cannot confirm another owner's viewing", async () => {
    const { t } = await txnAtViewing();
    const prop = await request(app).post(`/api/appointments/transaction/${t.id}/UNIT_VIEWING`).set(officer()).send({ scheduledAt: "2026-10-20T04:00:00.000Z" });
    const res = await request(app).patch(`/api/appointments/${prop.body.id}/confirm`).set(lessor("someone-else")).send({});
    expect(res.status).toBe(404);
  });

  it("rejects a viewing outcome outside the curated set (400)", async () => {
    const { t } = await txnAtViewing();
    const prop = await request(app).post(`/api/appointments/transaction/${t.id}/UNIT_VIEWING`).set(officer()).send({ scheduledAt: "2026-10-20T04:00:00.000Z" });
    const res = await request(app).patch(`/api/appointments/${prop.body.id}/complete`).set(officer()).send({ outcome: "Passed" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: FAIL (schedule returns "Scheduled" not "Proposed"; confirm/propose routes 404).

- [ ] **Step 3: Schedule-as-Proposed + the handshake service functions**

In `server/src/services/appointmentService.js`:

Replace the `scheduleAppointment` upsert + sync so a viewing starts `Proposed` and records the proposer:

```js
export async function scheduleAppointment(user, txnId, stage, body) {
  if (!isSchedulableStage(stage)) throw new InvalidReferenceError(`"${stage}" is not a schedulable stage`);
  const txn = await prisma.leasingTransaction.findUnique({ where: { id: txnId } });
  if (!txn) throw new NotFoundError("Transaction not found");
  if (stageIndex(stage) < stageIndex(txn.stage) && (txn.stageData?.[stage]?.completedAt)) {
    throw new ConflictError("That stage is already completed");
  }
  // A unit viewing is proposed to the lessor for confirmation; every other
  // schedulable visit is booked outright by staff.
  const viewing = stage === "UNIT_VIEWING";
  const status = viewing ? "Proposed" : "Scheduled";
  const appt = await prisma.appointment.upsert({
    where: { transactionId_stage: { transactionId: txnId, stage } },
    create: {
      transactionId: txnId, stage, status,
      scheduledAt: new Date(body.scheduledAt), location: body.location ?? null, notes: body.notes ?? null,
      proposedByRole: viewing ? user?.role ?? null : null,
      createdById: user?.userId || null, createdByName: await resolveName(user),
    },
    update: {
      status, scheduledAt: new Date(body.scheduledAt), location: body.location ?? null, notes: body.notes ?? null,
      proposedByRole: viewing ? user?.role ?? null : null, confirmedAt: null,
    },
  });
  await syncStageStatus(txn, stage, status);
  await logEvent(txnId, user, `${stageByKey(stage).label} ${viewing ? "proposed" : "scheduled"} for ${new Date(body.scheduledAt).toISOString()}`, stage);
  return appt;
}
```

Add two new exported functions (after `reschedule`):

```js
// The two "sides" of a viewing handshake: the lessor, and everyone on staff.
function sideOf(role) {
  return role === "UNIT_OWNER" ? "lessor" : "staff";
}
const HANDSHAKE_ROLES = ["ADMIN", "LEASING_OFFICER", "UNIT_OWNER"];

// Confirm the OTHER side's proposed viewing time.
export async function confirmViewing(user, id) {
  if (!HANDSHAKE_ROLES.includes(user?.role)) throw new ForbiddenError("Not allowed to confirm this viewing");
  const appt = await loadAppt(id);
  const txn = await txnOf(appt);
  await assertCanAccess(user, txn.id); // 404 unless staff or THIS txn's owner
  if (appt.stage !== "UNIT_VIEWING") throw new ConflictError("Only a unit viewing is confirmed this way");
  if (appt.status !== "Proposed") throw new ConflictError("This viewing is not awaiting confirmation");
  if (sideOf(appt.proposedByRole) === sideOf(user.role)) {
    throw new ConflictError("Awaiting the other party's confirmation, not yours");
  }
  const updated = await prisma.appointment.update({ where: { id }, data: { status: "Confirmed", confirmedAt: new Date() } });
  await syncStageStatus(txn, appt.stage, "Confirmed");
  await logEvent(txn.id, user, `Unit Viewing confirmed for ${new Date(appt.scheduledAt).toISOString()}`, appt.stage);
  return updated;
}

// Propose a different viewing time (either side), flipping whose turn it is.
export async function proposeViewing(user, id, body) {
  if (!HANDSHAKE_ROLES.includes(user?.role)) throw new ForbiddenError("Not allowed to propose a viewing time");
  const appt = await loadAppt(id);
  const txn = await txnOf(appt);
  await assertCanAccess(user, txn.id);
  if (appt.stage !== "UNIT_VIEWING") throw new ConflictError("Only a unit viewing is proposed this way");
  if (["Completed", "Cancelled"].includes(appt.status)) throw new ConflictError("This viewing is closed");
  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: "Proposed", proposedByRole: user.role, confirmedAt: null,
      scheduledAt: new Date(body.scheduledAt), location: body.location ?? appt.location, notes: body.notes ?? appt.notes,
    },
  });
  await syncStageStatus(txn, appt.stage, "Proposed");
  await logEvent(txn.id, user, `Unit Viewing time proposed for ${new Date(body.scheduledAt).toISOString()}`, appt.stage);
  return updated;
}
```

Add `ForbiddenError` to the imports from `../lib/errors.js` at the top of the file.

(The existing `complete` already validates outcomes against `SCHEDULABLE_STAGES[stage].outcomeOptions`, so it handles viewing outcomes with no change.)

- [ ] **Step 4: Validation + controller + routes**

In `server/src/validation/appointment.js`, add:

```js
export const proposeSchema = z.object({
  scheduledAt: z.string().datetime(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
```

In `server/src/controllers/appointmentController.js`, import `proposeSchema` and add:

```js
export async function confirm(req, res, next) {
  try { res.json(await svc.confirmViewing(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function propose(req, res, next) {
  try { res.json(await svc.proposeViewing(req.user, req.params.id, proposeSchema.parse(req.body))); } catch (e) { next(e); }
}
```

In `server/src/routes/appointmentRoutes.js`, add (after the `cancel` route) — note: **no `requireWrite`**, so a `UNIT_OWNER` can reach them; the service enforces access:

```js
r.patch("/:id/confirm", ctrl.confirm);
r.patch("/:id/propose", ctrl.propose);
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `server/`): `npx vitest run tests/unitViewing.test.js`
Expected: PASS (all blocks).

- [ ] **Step 6: Run the appointment regression suite**

Run (from `server/`): `npx vitest run tests/appointments.test.js`
Expected: PASS (inspection/photoshoot scheduling still returns `Scheduled`; only `UNIT_VIEWING` is `Proposed`).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/appointmentService.js server/src/validation/appointment.js server/src/controllers/appointmentController.js server/src/routes/appointmentRoutes.js server/tests/unitViewing.test.js
git commit -m "feat(appointments): officer proposes, lessor confirms the unit viewing"
```

---

## Task 5: Officer UI — propose/confirm/outcome + tracker icon

**Files:**
- Modify: `client/src/lib/resource.js`
- Modify: `client/src/components/DeliveryTracker.vue`
- Modify: `client/src/components/SchedulingPanel.vue`
- Test: `client/tests/SchedulingPanel.test.js` (extend) — or create if absent

**Interfaces:**
- Consumes: the server endpoints (Task 4).
- Produces: `appointments.confirm`/`appointments.propose`; the officer panel handles `UNIT_VIEWING`.

- [ ] **Step 1: Add the client API methods**

In `client/src/lib/resource.js`, inside the `appointments` object, add:

```js
  confirm: (id) => api.patch(`/appointments/${id}/confirm`).then((r) => r.data),
  propose: (id, body) => api.patch(`/appointments/${id}/propose`, body).then((r) => r.data),
```

- [ ] **Step 2: Add the tracker icon**

In `client/src/components/DeliveryTracker.vue`, add `UNIT_VIEWING` to the `STAGE_ICON` map:

```js
const STAGE_ICON = {
  INQUIRY: "📝", UNIT_VIEWING: "🏠", SEND_REQUIREMENTS: "📎", APPROVAL: "✅",
  UNIT_INSPECTION: "🔍", PHOTOSHOOT: "📸", CONTRACT_SIGNING: "✍️",
};
```

- [ ] **Step 3: Write the failing officer-panel test**

Add to `client/tests/SchedulingPanel.test.js` (create the file if it does not exist, following the existing component-test pattern — mock `../src/lib/resource.js`'s `appointments`, mount with a `transaction` prop):

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  appointments: {
    forTransaction: vi.fn(() => Promise.resolve([])),
    schedule: vi.fn(() => Promise.resolve({ id: "a1", status: "Proposed", proposedByRole: "LEASING_OFFICER" })),
    confirm: vi.fn(() => Promise.resolve({})),
    propose: vi.fn(() => Promise.resolve({})),
    reschedule: vi.fn(() => Promise.resolve({})),
    complete: vi.fn(() => Promise.resolve({})),
    cancel: vi.fn(() => Promise.resolve({})),
  },
}));

import SchedulingPanel from "../src/components/SchedulingPanel.vue";
import { appointments } from "../src/lib/resource.js";

const txn = (over = {}) => ({ id: "t1", stage: "UNIT_VIEWING", status: "Pending", ...over });

describe("SchedulingPanel — Unit Viewing", () => {
  beforeEach(() => { Object.values(appointments).forEach((f) => f.mockClear?.()); appointments.forTransaction.mockResolvedValue([]); });

  it("proposes a viewing time (not 'schedule')", async () => {
    const w = mount(SchedulingPanel, { props: { transaction: txn() } });
    await flushPromises();
    await w.find('input[type="datetime-local"]').setValue("2026-10-20T12:00");
    await w.findAll("button").find((b) => /propose/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(appointments.schedule).toHaveBeenCalledWith("t1", "UNIT_VIEWING", expect.objectContaining({ scheduledAt: expect.any(String) }));
  });

  it("shows a Confirm action when the lessor proposed a time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "UNIT_OWNER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mount(SchedulingPanel, { props: { transaction: txn({ status: "Proposed" }) } });
    await flushPromises();
    const confirmBtn = w.findAll("button").find((b) => /^confirm$/i.test(b.text()));
    expect(confirmBtn).toBeTruthy();
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(appointments.confirm).toHaveBeenCalledWith("a1");
  });

  it("offers the viewing outcomes when confirmed", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Confirmed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mount(SchedulingPanel, { props: { transaction: txn({ status: "Confirmed" }) } });
    await flushPromises();
    const opts = w.find("select").findAll("option").map((o) => o.text());
    expect(opts).toEqual(expect.arrayContaining(["Interested", "Not Interested", "No-show"]));
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run (from `client/`): `npx vitest run tests/SchedulingPanel.test.js`
Expected: FAIL (button says "Schedule"; no Confirm; outcome select only for inspection).

- [ ] **Step 5: Teach the panel the viewing lifecycle**

In `client/src/components/SchedulingPanel.vue`:

Add a viewing flag and derived helpers in `<script setup>` (near the other computeds):

```js
const isViewing = computed(() => targetStage.value === "UNIT_VIEWING");
// For a viewing, "active" must include a Proposed/Confirmed row (not just Scheduled).
const hasOutcomeSelect = computed(() => ["UNIT_INSPECTION", "UNIT_VIEWING"].includes(targetStage.value));
// The lessor proposed the current time → staff may confirm it.
const canConfirm = computed(() => isViewing.value && current.value?.status === "Proposed" && current.value?.proposedByRole === "UNIT_OWNER");
// We proposed and are waiting on the lessor.
const awaitingLessor = computed(() => isViewing.value && current.value?.status === "Proposed" && current.value?.proposedByRole !== "UNIT_OWNER");
```

Set the default outcome for a viewing in `load()` — change the inspection-only line to:

```js
  if (hasOutcomeSelect.value && !outcome.value) {
    outcome.value = stageCfg.value?.outcomeOptions?.[0] || "";
  }
```

Make `schedule()` and `reschedule()` route through propose for a viewing, and add `confirmViewing()`:

```js
async function schedule() {
  if (!scheduledAt.value) return;
  error.value = ""; busy.value = true;
  try {
    const body = { scheduledAt: new Date(scheduledAt.value).toISOString(), location: location.value || null, notes: notes.value || null };
    await appointments.schedule(props.transaction.id, targetStage.value, body);
    resetFormFields(); await load(); emit("changed");
  } catch (e) { error.value = e.response?.data?.error || "Could not schedule the appointment"; }
  finally { busy.value = false; }
}

async function reschedule() {
  if (!scheduledAt.value) return;
  error.value = ""; busy.value = true;
  try {
    const body = { scheduledAt: new Date(scheduledAt.value).toISOString(), location: location.value || null, notes: notes.value || null };
    if (isViewing.value) await appointments.propose(current.value.id, body);
    else await appointments.reschedule(current.value.id, body);
    rescheduling.value = false; resetFormFields(); await load(); emit("changed");
  } catch (e) { error.value = e.response?.data?.error || "Could not update the appointment"; }
  finally { busy.value = false; }
}

async function confirmViewing() {
  error.value = ""; busy.value = true;
  try { await appointments.confirm(current.value.id); await load(); emit("changed"); }
  catch (e) { error.value = e.response?.data?.error || "Could not confirm the viewing"; }
  finally { busy.value = false; }
}
```

Make `complete()` send the outcome for any outcome-select stage:

```js
async function complete() {
  error.value = ""; busy.value = true;
  try {
    const body = hasOutcomeSelect.value ? { outcome: outcome.value } : {};
    await appointments.complete(current.value.id, body);
    await load(); emit("changed");
  } catch (e) { error.value = e.response?.data?.error || "Could not complete the appointment"; }
  finally { busy.value = false; }
}
```

In the template:
- The schedule button label: `{{ isViewing ? "Propose time" : "Schedule" }}`.
- Where the inspection outcome select is gated (`v-if="targetStage === 'UNIT_INSPECTION'"`), change to `v-if="hasOutcomeSelect"`.
- In the active-appointment block, add — above the existing Reschedule/Complete/Cancel actions:

```html
          <p v-if="awaitingLessor" class="muted">Awaiting the lessor's confirmation of this time.</p>
          <div v-if="canConfirm" class="actions">
            <button type="button" class="primary" :disabled="busy" @click="confirmViewing">Confirm</button>
          </div>
```

  and relabel the Reschedule button for a viewing: `{{ isViewing ? "Propose another time" : "Reschedule" }}`. For a viewing, **Complete** should be offered only once `current.status === 'Confirmed'` — add `v-if="!isViewing || current.status === 'Confirmed'"` to the Complete button so an unconfirmed proposal can't be completed.

(Leave Inspection/Photoshoot behavior exactly as it was — all branches above are gated on `isViewing`/`hasOutcomeSelect`.)

- [ ] **Step 6: Run the test to verify it passes**

Run (from `client/`): `npx vitest run tests/SchedulingPanel.test.js`
Expected: PASS. Also run any existing tracker test: `npx vitest run tests/DeliveryTracker.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/resource.js client/src/components/DeliveryTracker.vue client/src/components/SchedulingPanel.vue client/tests/SchedulingPanel.test.js
git commit -m "feat(client): officer proposes/confirms/records the unit viewing"
```

---

## Task 6: Lessor UI — confirm / propose another time

**Files:**
- Create: `client/src/components/ViewingConfirmPanel.vue`
- Modify: `client/src/views/MyLeasingProgressView.vue`
- Test: `client/tests/ViewingConfirmPanel.test.js`

**Interfaces:**
- Consumes: `appointments.forTransaction`, `appointments.confirm`, `appointments.propose` (Tasks 4–5).
- Produces: the lessor's confirm / propose actions in Leasing Progress.

- [ ] **Step 1: Write the failing test**

Create `client/tests/ViewingConfirmPanel.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../src/lib/resource.js", () => ({
  appointments: {
    forTransaction: vi.fn(() => Promise.resolve([])),
    confirm: vi.fn(() => Promise.resolve({})),
    propose: vi.fn(() => Promise.resolve({})),
  },
}));

import ViewingConfirmPanel from "../src/components/ViewingConfirmPanel.vue";
import { appointments } from "../src/lib/resource.js";

const mountFor = (txn) => mount(ViewingConfirmPanel, { props: { transaction: txn } });

describe("ViewingConfirmPanel (lessor)", () => {
  beforeEach(() => { appointments.forTransaction.mockReset(); appointments.confirm.mockClear(); appointments.propose.mockClear(); });

  it("shows Confirm + Propose when the officer proposed a time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    const confirmBtn = w.findAll("button").find((b) => /confirm/i.test(b.text()));
    expect(confirmBtn).toBeTruthy();
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(appointments.confirm).toHaveBeenCalledWith("a1");
  });

  it("lets the lessor propose another time", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "LEASING_OFFICER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    await w.findAll("button").find((b) => /propose another/i.test(b.text())).trigger("click");
    await w.find('input[type="datetime-local"]').setValue("2026-10-22T09:00");
    await w.findAll("button").find((b) => /send/i.test(b.text())).trigger("click");
    await flushPromises();
    expect(appointments.propose).toHaveBeenCalledWith("a1", expect.objectContaining({ scheduledAt: expect.any(String) }));
  });

  it("says it's awaiting the officer when the lessor already proposed", async () => {
    appointments.forTransaction.mockResolvedValue([{ id: "a1", stage: "UNIT_VIEWING", status: "Proposed", proposedByRole: "UNIT_OWNER", scheduledAt: "2026-10-20T12:00:00.000Z" }]);
    const w = mountFor({ id: "t1", stage: "UNIT_VIEWING" });
    await flushPromises();
    expect(w.text()).toMatch(/awaiting/i);
    expect(w.findAll("button").find((b) => /^confirm$/i.test(b.text()))).toBeFalsy();
  });

  it("renders nothing when the transaction is not at the viewing stage", async () => {
    const w = mountFor({ id: "t1", stage: "APPROVAL" });
    await flushPromises();
    expect(appointments.forTransaction).not.toHaveBeenCalled();
    expect(w.text()).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `client/`): `npx vitest run tests/ViewingConfirmPanel.test.js`
Expected: FAIL (component does not exist).

- [ ] **Step 3: Create the component**

Create `client/src/components/ViewingConfirmPanel.vue`:

```vue
<script setup>
// Lessor-facing panel in Leasing Progress: when the officer has proposed a
// viewing time for the owner's unit, confirm it or propose another.
import { ref, computed, onMounted, watch } from "vue";
import { appointments } from "../lib/resource.js";
import { formatDate } from "../lib/formatters.js";

const props = defineProps({ transaction: { type: Object, required: true } });
const emit = defineEmits(["changed"]);

const appt = ref(null);
const error = ref("");
const busy = ref(false);
const proposing = ref(false);
const scheduledAt = ref("");

const atViewing = computed(() => props.transaction?.stage === "UNIT_VIEWING");
// A proposal from staff is awaiting the lessor's decision.
const awaitingLessor = computed(() => appt.value?.status === "Proposed" && appt.value?.proposedByRole !== "UNIT_OWNER");
const awaitingOfficer = computed(() => appt.value?.status === "Proposed" && appt.value?.proposedByRole === "UNIT_OWNER");
const confirmed = computed(() => appt.value?.status === "Confirmed");

async function load() {
  if (!atViewing.value || !props.transaction?.id) { appt.value = null; return; }
  try {
    const rows = await appointments.forTransaction(props.transaction.id);
    appt.value = rows.find((a) => a.stage === "UNIT_VIEWING") || null;
  } catch (e) { error.value = e.response?.data?.error || "Could not load the viewing"; }
}
onMounted(load);
watch(() => props.transaction?.id, load);

async function confirm() {
  error.value = ""; busy.value = true;
  try { await appointments.confirm(appt.value.id); await load(); emit("changed"); }
  catch (e) { error.value = e.response?.data?.error || "Could not confirm"; }
  finally { busy.value = false; }
}
async function sendProposal() {
  if (!scheduledAt.value) return;
  error.value = ""; busy.value = true;
  try {
    await appointments.propose(appt.value.id, { scheduledAt: new Date(scheduledAt.value).toISOString() });
    proposing.value = false; scheduledAt.value = ""; await load(); emit("changed");
  } catch (e) { error.value = e.response?.data?.error || "Could not propose a time"; }
  finally { busy.value = false; }
}
function timeOf(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; }
</script>

<template>
  <div v-if="atViewing && appt" class="panel viewing">
    <div class="panel__label">Unit viewing</div>
    <p v-if="error" class="error">{{ error }}</p>

    <p class="when">{{ formatDate(appt.scheduledAt) }} · {{ timeOf(appt.scheduledAt) }}</p>
    <p v-if="appt.location" class="muted">{{ appt.location }}</p>

    <template v-if="confirmed">
      <p class="ok">Confirmed — we'll see you then.</p>
    </template>
    <template v-else-if="awaitingOfficer">
      <p class="muted">Your proposed time was sent — awaiting the leasing officer's confirmation.</p>
    </template>
    <template v-else-if="awaitingLessor">
      <p class="ask">The leasing officer proposed this time. Confirm it, or propose another.</p>
      <div v-if="!proposing" class="actions">
        <button type="button" class="primary" :disabled="busy" @click="confirm">Confirm</button>
        <button type="button" class="ghost" :disabled="busy" @click="proposing = true">Propose another time</button>
      </div>
      <div v-else class="form">
        <label>New date &amp; time</label>
        <input type="datetime-local" v-model="scheduledAt" />
        <div class="actions">
          <button type="button" class="ghost" :disabled="busy" @click="proposing = false">Cancel</button>
          <button type="button" class="primary" :disabled="busy || !scheduledAt" @click="sendProposal">Send</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-sm); }
.panel__label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; margin-bottom: 0.75rem; }
.when { font-weight: 600; font-size: 1rem; margin: 0 0 0.2rem; }
.muted { color: var(--muted); margin: 0.2rem 0; font-size: 0.88rem; }
.ask { color: var(--text); margin: 0.5rem 0 0.8rem; }
.ok { color: var(--good); font-weight: 600; }
.error { color: var(--danger); }
.actions { display: flex; gap: 0.55rem; flex-wrap: wrap; margin-top: 0.4rem; }
.form { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; }
.form label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--muted); }
.form input { font: inherit; padding: 0.55rem 0.65rem; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.primary { background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 0.5rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
.ghost { background: var(--surface); color: var(--ink-700); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 0.5rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: Mount it in Leasing Progress**

In `client/src/views/MyLeasingProgressView.vue`:
- Import it: `import ViewingConfirmPanel from "../components/ViewingConfirmPanel.vue";`
- Render it in the right-hand `.col`, above the "Your documents" panel:

```html
          <ViewingConfirmPanel :transaction="active" @changed="reloadActive" />
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `client/`): `npx vitest run tests/ViewingConfirmPanel.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ViewingConfirmPanel.vue client/src/views/MyLeasingProgressView.vue client/tests/ViewingConfirmPanel.test.js
git commit -m "feat(client): lessor confirms or re-proposes the viewing in Leasing Progress"
```

---

## Task 7: Full-suite verification and build

**Files:** none (verification only).

- [ ] **Step 1: Server suite**

Run (from `server/`): `npx vitest run`
Expected: all pass (new `unitViewing` suite + untouched suites, including `appointments`, `inquiries`, `inquiryConversion`, `leasingTransactions`, `contractSigning`).

- [ ] **Step 2: Client suite**

Run (from `client/`): `npx vitest run`
Expected: all pass (new `ViewingConfirmPanel`, extended `SchedulingPanel`, tracker, plus the rest).

- [ ] **Step 3: Build the client**

Run (from `client/`): `npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Commit any incidental fixes**

If Steps 1–3 required fixes, `git add -A && git commit -m "test: green suites for the unit viewing stage"`. Otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** new stage between Inquiry and Send Requirements (Task 1/3); schema handshake columns (Task 2); rest-at-viewing only for lessee-with-unit, else Skipped (Task 3); advance gate on Interested/Skipped (Task 3); officer proposes → lessor confirms, either side may re-propose, nobody confirms their own (Task 4); outcome-gated advance (Tasks 3+4); officer UI + tracker (Task 5); lessor confirm/propose UI (Task 6); backward compatibility for no-unit/lessor/legacy transactions (Task 3). All present.
- **Manual-SQL constraint** honored (Task 2 uses `prisma db execute` on both DBs).
- **Type/shape consistency:** `proposedByRole` is written by `scheduleAppointment`/`proposeViewing`, read by `confirmViewing`'s `sideOf`, and surfaced to both UIs; appointment status strings `Proposed`/`Confirmed` are declared in `APPOINTMENT_STATUSES` (Task 1) and used throughout; `SCHEDULABLE_STAGES.UNIT_VIEWING.outcomeOptions` drives both `complete` validation and the outcome selects.
- **No placeholders:** every step carries complete code/commands.
