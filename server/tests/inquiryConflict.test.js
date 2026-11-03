import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { ConflictError } from "../src/lib/errors.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { assertUnitFreeForInquiry } from "../src/services/leasingTransactionService.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
// assignedToId is FK-constrained, so the acting officer must be a real User row.
async function makeOfficer() {
  seq += 1;
  const user = await prisma.user.create({
    data: { name: `Officer ${seq}`, email: `officer-${seq}@x.com`, passwordHash: "x", role: "LEASING_OFFICER" },
  });
  return { user, token: tokens.officer(user.id) };
}
function makeInquiry(over = {}) {
  return prisma.inquiry.create({
    data: {
      category: "RESIDENCES", inquirerType: "LESSEE", inquiryType: "Unit Availability",
      fullName: "Ana", email: "ana@example.com", consent: true, ...over,
    },
  });
}
// A bare pipeline row. These are seeded BEFORE any acceptance in a test: the
// service numbers new references from the highest existing one.
function makeTxn(over = {}) {
  seq += 1;
  return prisma.leasingTransaction.create({
    data: { reference: `RBU-2026-8${String(seq).padStart(5, "0")}`, stage: "UNIT_VIEWING", status: "Pending", ...over },
  });
}
async function makeUnit(over = {}) {
  const owner = await factory.owner();
  return factory.unit(owner.id, over);
}
// A deal with a prospect (an inquiry) on the given unit.
async function makeDeal(unitId, over = {}) {
  const inquiry = await makeInquiry({ fullName: "Rival Prospect", email: "rival@example.com" });
  return makeTxn({ unitId, inquiryId: inquiry.id, ...over });
}
const accept = (inquiryId, token) =>
  request(app).patch(`/api/inquiries/${inquiryId}/accept`).set(auth(token));
const dealsOn = (unitId) => prisma.leasingTransaction.count({ where: { unitId } });

describe("Accepting an inquiry for a unit that already has an active deal", () => {
  it("refuses with 409 naming the rival deal, and leaves the inquiry unassigned and unconverted", async () => {
    const unit = await makeUnit({ unitNumber: "12A" });
    const rival = await makeDeal(unit.id);
    const second = await makeInquiry({ unitId: unit.id });
    const { token } = await makeOfficer();
    const before = await dealsOn(unit.id);
    expect(before).toBe(1);

    const res = await accept(second.id, token);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain(rival.reference);
    expect(res.body.error).toContain("12A");

    const after = await prisma.inquiry.findUnique({ where: { id: second.id } });
    expect(after.status).toBe("NEW");
    expect(after.assignedToId).toBeNull();
    expect(await dealsOn(unit.id)).toBe(before);
    expect(await prisma.leasingTransaction.findUnique({ where: { inquiryId: second.id } })).toBeNull();
  });

  it("refuses when the rival deal has a tenant rather than an inquiry", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant();
    const rival = await makeTxn({ unitId: unit.id, tenantId: tenant.id });
    const second = await makeInquiry({ unitId: unit.id });
    const { token } = await makeOfficer();

    const res = await accept(second.id, token);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain(rival.reference);
    const after = await prisma.inquiry.findUnique({ where: { id: second.id } });
    expect(after.assignedToId).toBeNull();
    expect(await dealsOn(unit.id)).toBe(1);
  });

  it("is not affected by an active deal on a different unit", async () => {
    const busy = await makeUnit({ unitNumber: "1A" });
    const free = await makeUnit({ unitNumber: "2B" });
    await makeDeal(busy.id);
    const inq = await makeInquiry({ unitId: free.id });
    const { token } = await makeOfficer();

    const res = await accept(inq.id, token);
    expect(res.status).toBe(200);
    expect(await dealsOn(free.id)).toBe(1);
  });

  it("accepting the same inquiry twice returns the same transaction (idempotent)", async () => {
    const unit = await makeUnit();
    const inq = await makeInquiry({ unitId: unit.id });
    const { token, user } = await makeOfficer();

    const first = await accept(inq.id, token);
    expect(first.status).toBe(200);
    const txn = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txn).not.toBeNull();

    // Its own deal is now the unit's active deal; that must not conflict with itself.
    const again = await accept(inq.id, token);
    expect(again.status).toBe(200);
    expect(again.body.assignedToId).toBe(user.id);
    const txnAgain = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txnAgain.id).toBe(txn.id);
    expect(await dealsOn(unit.id)).toBe(1);
  });
});

describe("Deals that do not hold a unit", () => {
  it("accepts a lessee inquiry on a unit whose only transaction is the lessor-onboarding one", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    // ensureForUnit's shape: a unit and its owner, no inquiry and no tenant.
    const onboarding = await makeTxn({ unitId: unit.id, unitOwnerId: owner.id });
    const inq = await makeInquiry({ unitId: unit.id });
    const { token } = await makeOfficer();

    const res = await accept(inq.id, token);
    expect(res.status).toBe(200);
    const txn = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txn.unitId).toBe(unit.id);
    expect(txn.id).not.toBe(onboarding.id);
    expect(await dealsOn(unit.id)).toBe(2);
  });

  it.each(["Signed", "Declined"])("accepts a new inquiry once the earlier deal is %s", async (finalStatus) => {
    const unit = await makeUnit();
    await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: finalStatus, finalStatus });
    const inq = await makeInquiry({ unitId: unit.id });
    const { token } = await makeOfficer();

    const res = await accept(inq.id, token);
    expect(res.status).toBe(200);
    expect(await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } })).not.toBeNull();
    expect(await dealsOn(unit.id)).toBe(2);
  });

  it("accepts an inquiry that has no unit, as before", async () => {
    const unit = await makeUnit();
    await makeDeal(unit.id); // an active deal elsewhere is irrelevant
    const inq = await makeInquiry();
    const { token, user } = await makeOfficer();

    const res = await accept(inq.id, token);
    expect(res.status).toBe(200);
    expect(res.body.assignedToId).toBe(user.id);
    const txn = await prisma.leasingTransaction.findUnique({ where: { inquiryId: inq.id } });
    expect(txn.unitId).toBeNull();
  });
});

describe("assertUnitFreeForInquiry", () => {
  it("returns quietly when the inquiry has no unit or its unit is gone", async () => {
    await expect(assertUnitFreeForInquiry({ id: "i1", unitId: null })).resolves.toBeUndefined();
    await expect(assertUnitFreeForInquiry({ id: "i2", unitId: "no-such-unit" })).resolves.toBeUndefined();
  });

  it("throws a ConflictError naming the rival deal", async () => {
    const unit = await makeUnit({ unitNumber: "7C" });
    const rival = await makeDeal(unit.id);
    const second = await makeInquiry({ unitId: unit.id });
    const err = await assertUnitFreeForInquiry(second).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain(rival.reference);
    expect(err.message).toContain("7C");
  });

  it("returns quietly for an inquiry that already has its own transaction", async () => {
    const unit = await makeUnit();
    const inq = await makeInquiry({ unitId: unit.id });
    await makeTxn({ unitId: unit.id, inquiryId: inq.id });
    await expect(assertUnitFreeForInquiry(inq)).resolves.toBeUndefined();
  });
});

describe("Two officers accepting two inquiries for one unit at once", () => {
  // Known window: the check (activeDealForUnit) and the create are separate
  // statements and there is no unique index on "one active deal per unit", so
  // both requests can pass the check before either creates. The spec accepts
  // this; a partial unique index is out of scope. A second, pre-existing hazard
  // sits in the same window: both requests can compute the same next reference
  // and the loser then fails the unique constraint (surfacing as a 500, with no
  // transaction created for it). So this test asserts what is guaranteed, not
  // "exactly one winner".
  it("leaves one transaction per successful acceptance and none for a refused one", async () => {
    const unit = await makeUnit();
    const a = await makeInquiry({ unitId: unit.id, fullName: "Prospect A", email: "a@example.com" });
    const b = await makeInquiry({ unitId: unit.id, fullName: "Prospect B", email: "b@example.com" });
    const o1 = await makeOfficer();
    const o2 = await makeOfficer();

    const results = await Promise.all([accept(a.id, o1.token), accept(b.id, o2.token)]);
    const statuses = results.map((r) => r.status);
    for (const s of statuses) expect([200, 409, 500]).toContain(s);

    const won = results.filter((r) => r.status === 200).length;
    expect(won).toBeGreaterThanOrEqual(1);
    const prospectDeals = await prisma.leasingTransaction.count({ where: { unitId: unit.id, inquiryId: { not: null } } });
    expect(prospectDeals).toBeLessThanOrEqual(2);
    // Every 200 has its transaction and every refusal has none.
    expect(prospectDeals).toBe(won);
  });
});
