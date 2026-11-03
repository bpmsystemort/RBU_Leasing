import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { ensureForUnit } from "../src/services/leasingTransactionService.js";
import { LESSOR_REQUIREMENT_TYPES } from "../../shared/lessorRequirements.js";

const app = createApp();
// Publishing a unit (public listing test) runs ensureForUnit, whose actor must
// resolve to a real User row (assignedOfficerId is FK-constrained).
let officer;
beforeEach(async () => {
  await prisma.lessorRequirement.deleteMany();
  await resetCrudTables();
  officer = await prisma.user.create({
    data: { name: "Default Officer", email: "officer-1@x.com", passwordHash: "x", role: "LEASING_OFFICER" },
  });
});
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
// A bare pipeline row. Pass inquiryId / tenantId to give it a prospect.
function makeTxn(over = {}) {
  seq += 1;
  return prisma.leasingTransaction.create({
    data: { reference: `RBU-2026-9${String(seq).padStart(5, "0")}`, stage: "UNIT_VIEWING", status: "Pending", ...over },
  });
}
function makeInquiry() {
  return prisma.inquiry.create({
    data: {
      category: "RESIDENCES", inquirerType: "LESSEE", inquiryType: "Unit Availability",
      fullName: "Ana", email: "ana@example.com", consent: true,
    },
  });
}
// A deal with a prospect (an inquiry) on the given unit.
async function makeDeal(unitId, over = {}) {
  const inquiry = await makeInquiry();
  return makeTxn({ unitId, inquiryId: inquiry.id, ...over });
}
async function makeUnit(over = {}) {
  const owner = await factory.owner();
  return factory.unit(owner.id, over);
}
const unitOf = (id) => prisma.unit.findUnique({ where: { id } });
const messagesOf = async (transactionId) =>
  (await prisma.transactionEvent.findMany({ where: { transactionId } })).map((e) => e.message);
const call = (verb, id, action, token = tokens.officer(), body) => {
  const r = request(app)[verb](`/api/leasing-transactions/${id}/${action}`).set(auth(token));
  return body === undefined ? r : r.send(body);
};
const block = (id, token) => call("patch", id, "block", token);
const unblock = (id, token) => call("patch", id, "unblock", token);

describe("Blocking a unit from a deal", () => {
  it("blocks a vacant approved unit for the deal and records an event", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);

    const res = await block(deal.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(deal.id);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(deal.id);
    expect(await messagesOf(deal.id)).toContain("Unit blocked for this deal");
  });

  it("is idempotent when the same deal blocks its unit again", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);

    expect((await block(deal.id)).status).toBe(200);
    expect((await block(deal.id)).status).toBe(200);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(deal.id);
    const blocked = (await messagesOf(deal.id)).filter((m) => m === "Unit blocked for this deal");
    expect(blocked).toHaveLength(1);
  });

  it("refuses a second deal on the same unit (409) and leaves the pointer alone", async () => {
    const unit = await makeUnit();
    const first = await makeDeal(unit.id);
    const second = await makeDeal(unit.id);
    expect((await block(first.id)).status).toBe(200);

    const res = await block(second.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/blocked/);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(first.id);
  });

  it("refuses an UNAVAILABLE or OCCUPIED unit (409) with the status in the message", async () => {
    const off = await makeUnit({ unitNumber: "U1", status: "UNAVAILABLE" });
    const occ = await makeUnit({ unitNumber: "O1", status: "OCCUPIED" });
    const offDeal = await makeDeal(off.id);
    const occDeal = await makeDeal(occ.id);

    const a = await block(offDeal.id);
    expect(a.status).toBe(409);
    expect(a.body.error).toMatch(/unavailable/);
    const b = await block(occDeal.id);
    expect(b.status).toBe(409);
    expect(b.body.error).toMatch(/occupied/);

    expect((await unitOf(off.id)).status).toBe("UNAVAILABLE");
    expect((await unitOf(occ.id)).status).toBe("OCCUPIED");
    expect((await unitOf(off.id)).blockedByTransactionId).toBeNull();
  });

  it("refuses a vacant unit that is not approved (409)", async () => {
    const unit = await makeUnit({ status: "VACANT", approvalStatus: "SUBMITTED" });
    const deal = await makeDeal(unit.id);

    const res = await block(deal.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Only an approved, vacant unit can be blocked");
    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
  });

  it("refuses a deal with no unit linked (409)", async () => {
    const deal = await makeDeal(null);
    const res = await block(deal.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Link a unit before blocking it");
  });

  it("refuses a deal with no prospect, such as an onboarding transaction (409)", async () => {
    const unit = await makeUnit();
    const onboarding = await makeTxn({ unitId: unit.id, stage: "SEND_REQUIREMENTS" });

    const res = await block(onboarding.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Only a deal with a prospect can block a unit");
    expect((await unitOf(unit.id)).status).toBe("VACANT");
  });

  it("accepts a prospect that is a tenant instead of an inquiry", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant({ name: "Ben" });
    const deal = await makeTxn({ unitId: unit.id, tenantId: tenant.id });

    expect((await block(deal.id)).status).toBe(200);
    expect((await unitOf(unit.id)).blockedByTransactionId).toBe(deal.id);
  });

  it("refuses an ended deal (409)", async () => {
    const unit = await makeUnit();
    for (const finalStatus of ["Signed", "Declined"]) {
      const deal = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: finalStatus, finalStatus });
      const res = await block(deal.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("This deal has ended");
    }
    expect((await unitOf(unit.id)).status).toBe("VACANT");
  });

  it("returns 404 for a deal that does not exist", async () => {
    const res = await block("no-such-deal");
    expect(res.status).toBe(404);
  });

  it("lets only one of two deals racing for the same unit win", async () => {
    const unit = await makeUnit();
    const a = await makeDeal(unit.id);
    const b = await makeDeal(unit.id);

    const results = await Promise.all([block(a.id), block(b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const winner = results[0].status === 200 ? a : b;
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(winner.id);
  });
});

describe("Unblocking a unit", () => {
  it("returns the unit to VACANT, clears the pointer and records an event", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    await block(deal.id);

    const res = await unblock(deal.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(deal.id);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
    expect(await messagesOf(deal.id)).toContain("Unit block released");
  });

  it("refuses a deal that does not hold the block (409) and leaves the holder in place", async () => {
    const unit = await makeUnit();
    const holder = await makeDeal(unit.id);
    const other = await makeDeal(unit.id);
    await block(holder.id);

    const res = await unblock(other.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This deal is not blocking a unit");

    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(holder.id);
  });

  it("refuses a deal that never blocked anything (409)", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    const res = await unblock(deal.id);
    expect(res.status).toBe(409);
  });
});

describe("Settling the unit when the deal reaches its outcome", () => {
  const sign = (id) => call("patch", id, "status", tokens.officer(), { status: "Signed" });
  const decline = (id) => call("patch", id, "status", tokens.officer(), { status: "Declined" });
  const atSigning = (unitId, over = {}) =>
    makeDeal(unitId, { stage: "CONTRACT_SIGNING", status: "Pending", finalStatus: "Pending", ...over });

  it("turns a BLOCKED unit OCCUPIED and clears the pointer when the deal is Signed", async () => {
    const unit = await makeUnit();
    const deal = await atSigning(unit.id);
    await block(deal.id);

    const res = await sign(deal.id);
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("Signed");

    const after = await unitOf(unit.id);
    expect(after.status).toBe("OCCUPIED");
    expect(after.blockedByTransactionId).toBeNull();
    const messages = await messagesOf(deal.id);
    expect(messages).toContain("Unit marked occupied (contract signed)");
    expect(messages).toContain('Contract Signing status set to "Signed"');
  });

  it("turns a VACANT (never blocked) unit OCCUPIED when the deal is Signed", async () => {
    const unit = await makeUnit();
    const deal = await atSigning(unit.id);

    expect((await sign(deal.id)).status).toBe(200);
    const after = await unitOf(unit.id);
    expect(after.status).toBe("OCCUPIED");
    expect(after.blockedByTransactionId).toBeNull();
  });

  it("does not take a unit that is neither vacant nor held by the deal, and says so", async () => {
    const holderUnit = await makeUnit({ unitNumber: "H1" });
    const offUnit = await makeUnit({ unitNumber: "U1", status: "UNAVAILABLE" });
    const holder = await makeDeal(holderUnit.id);
    await block(holder.id);
    const heldDeal = await atSigning(holderUnit.id);
    const offDeal = await atSigning(offUnit.id);

    expect((await sign(heldDeal.id)).status).toBe(200);
    expect((await sign(offDeal.id)).status).toBe(200);

    const held = await unitOf(holderUnit.id);
    expect(held.status).toBe("BLOCKED");
    expect(held.blockedByTransactionId).toBe(holder.id);
    expect((await unitOf(offUnit.id)).status).toBe("UNAVAILABLE");
    expect(await messagesOf(offDeal.id)).toContain(
      "Contract signed, but the unit was not vacant or held by this deal: check its status");
  });

  it("frees the unit when the blocking deal is Declined", async () => {
    const unit = await makeUnit();
    const deal = await atSigning(unit.id);
    await block(deal.id);

    const res = await decline(deal.id);
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("Declined");

    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
    expect(await messagesOf(deal.id)).toContain("Unit block released (deal declined)");
  });

  it("does not release a block held by a different deal when this one is Declined", async () => {
    const unit = await makeUnit();
    const holder = await makeDeal(unit.id);
    await block(holder.id);
    const loser = await atSigning(unit.id);

    expect((await decline(loser.id)).status).toBe(200);
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(holder.id);
  });

  it("leaves a blocked unit alone for statuses that are not an outcome", async () => {
    const unit = await makeUnit();
    const deal = await atSigning(unit.id);
    await block(deal.id);

    const res = await call("patch", deal.id, "status", tokens.officer(), { status: "For Signature" });
    expect(res.status).toBe(200);
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(deal.id);
  });

  it("settles the unit when advancing straight into Contract Signing as Signed", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant({ name: "Ana" });
    const deal = await makeTxn({
      unitId: unit.id, tenantId: tenant.id, stage: "PHOTOSHOOT", status: "Completed",
    });
    await prisma.transactionDocument.create({
      data: {
        transactionId: deal.id, filename: "loi.pdf", mimeType: "application/pdf",
        size: 3, data: Buffer.from("abc"), docType: "LETTER_OF_INTENT",
      },
    });
    await block(deal.id);

    const res = await call("patch", deal.id, "advance", tokens.officer(), { status: "Signed" });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("CONTRACT_SIGNING");
    expect(res.body.finalStatus).toBe("Signed");

    const after = await unitOf(unit.id);
    expect(after.status).toBe("OCCUPIED");
    expect(after.blockedByTransactionId).toBeNull();
    expect(await messagesOf(deal.id)).toContain("Unit marked occupied (contract signed)");
  });

  it("leaves a blocked unit blocked when a deal merely advances into Contract Signing", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant({ name: "Ana" });
    const deal = await makeTxn({
      unitId: unit.id, tenantId: tenant.id, stage: "PHOTOSHOOT", status: "Completed",
    });
    await prisma.transactionDocument.create({
      data: {
        transactionId: deal.id, filename: "loi.pdf", mimeType: "application/pdf",
        size: 3, data: Buffer.from("abc"), docType: "LETTER_OF_INTENT",
      },
    });
    await block(deal.id);

    const res = await call("patch", deal.id, "advance", tokens.officer(), {});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("CONTRACT_SIGNING");
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(deal.id);
  });
});

describe("Returning a deal", () => {
  it("refuses to return a Signed deal (409) and leaves it where it was", async () => {
    const unit = await makeUnit({ status: "OCCUPIED" });
    const deal = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: "Signed", finalStatus: "Signed" });

    const res = await call("patch", deal.id, "return", tokens.officer(), {});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A signed deal cannot be returned to an earlier stage");

    const after = await prisma.leasingTransaction.findUnique({ where: { id: deal.id } });
    expect(after.stage).toBe("CONTRACT_SIGNING");
    expect(after.finalStatus).toBe("Signed");
  });

  it("still returns an unsigned deal from Contract Signing", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: "For Signature", finalStatus: "For Signature" });

    const res = await call("patch", deal.id, "return", tokens.officer(), {});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("PHOTOSHOOT");
    expect(res.body.finalStatus).toBeNull();
  });
});

describe("Relinking a deal's unit", () => {
  const link = (id, body) => call("patch", id, "link", tokens.officer(), body);

  it("releases the old unit when the deal is linked to another unit", async () => {
    const owner = await factory.owner();
    const oldUnit = await factory.unit(owner.id, { unitNumber: "A1" });
    const newUnit = await factory.unit(owner.id, { unitNumber: "B1" });
    const deal = await makeDeal(oldUnit.id);
    await block(deal.id);

    const res = await link(deal.id, { unitId: newUnit.id });
    expect(res.status).toBe(200);
    expect(res.body.unit.unitNumber).toBe("B1");

    const old = await unitOf(oldUnit.id);
    expect(old.status).toBe("VACANT");
    expect(old.blockedByTransactionId).toBeNull();
    expect((await unitOf(newUnit.id)).status).toBe("VACANT");
    expect(await messagesOf(deal.id)).toContain("Unit block released (linked unit changed)");
  });

  it("releases the unit when the link is cleared", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    await block(deal.id);

    const res = await link(deal.id, { unitId: null });
    expect(res.status).toBe(200);
    expect(res.body.unitId).toBeNull();
    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
  });

  it("keeps the block when the same unit is linked again", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    await block(deal.id);

    const res = await link(deal.id, { unitId: unit.id });
    expect(res.status).toBe(200);
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(deal.id);
    expect(await messagesOf(deal.id)).not.toContain("Unit block released (linked unit changed)");
  });

  it("keeps the block when only the tenant is linked", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    await block(deal.id);
    const tenant = await factory.tenant({ name: "Ben" });

    expect((await link(deal.id, { tenantId: tenant.id })).status).toBe(200);
    expect((await unitOf(unit.id)).blockedByTransactionId).toBe(deal.id);
  });
});

describe("Access to block and unblock", () => {
  it("is forbidden (403) for viewer, tenant and owner, and unauthenticated is 401", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant({ name: "Cy" });
    const deal = await makeDeal(unit.id);
    const owner = await factory.owner({ name: "Someone Else" });
    const holder = await makeDeal(unit.id);
    await block(holder.id);

    const forbidden = [tokens.viewer(), tokens.tenant(tenant.id), tokens.owner(owner.id)];
    for (const token of forbidden) {
      expect((await block(deal.id, token)).status).toBe(403);
      expect((await unblock(holder.id, token)).status).toBe(403);
    }
    expect((await request(app).patch(`/api/leasing-transactions/${deal.id}/block`)).status).toBe(401);
    expect((await request(app).patch(`/api/leasing-transactions/${holder.id}/unblock`)).status).toBe(401);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(holder.id);
  });

  it("lets an admin block and unblock", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    expect((await block(deal.id, tokens.admin())).status).toBe(200);
    expect((await unblock(deal.id, tokens.admin())).status).toBe(200);
  });
});

describe("Public listing", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5c0000000049454e44ae426082", "hex");
  const staff = () => auth(tokens.officer());

  // Same fixture as publicUnits.test.js: publishing needs an approved unit whose
  // lessor's requirements are approved and whose photoshoot is complete.
  async function publishedUnit() {
    const owner = await factory.owner();
    const estate = await factory.estate({ name: "PublicEstate" });
    const tower = await factory.tower(estate.id, { name: "T1" });
    const u = await factory.unit(owner.id, {
      unitNumber: "9A", type: "2BR", baseRent: 40000, towerId: tower.id, status: "VACANT", approvalStatus: "APPROVED",
    });
    for (const t of LESSOR_REQUIREMENT_TYPES) {
      await prisma.lessorRequirement.create({
        data: { unitOwnerId: owner.id, requirementKey: t.key, status: "Approved" },
      });
    }
    const txn = await ensureForUnit(u, { userId: officer.id, role: "LEASING_OFFICER" });
    await prisma.appointment.create({
      data: { transactionId: txn.id, stage: "PHOTOSHOOT", status: "Completed", outcome: "Completed", scheduledAt: new Date() },
    });
    await request(app).post(`/api/unit-listings/${u.id}/photos`).set(staff()).attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    await request(app).patch(`/api/unit-listings/${u.id}`).set(staff()).send({
      visibleFields: ["unitNumber", "unitType", "rentalRate"],
      details: { unitNumber: "9A", unitType: "2BR", rentalRate: 40000, bedrooms: 2 },
    });
    await request(app).patch(`/api/unit-listings/${u.id}/publish`).set(staff());
    return u;
  }

  it("never lists a BLOCKED unit, even though it is published, and lists it again once released", async () => {
    const u = await publishedUnit();
    const listed = await request(app).get("/api/public/units");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].unitId).toBe(u.id);

    const deal = await makeDeal(u.id);
    expect((await block(deal.id)).status).toBe(200);
    const listing = await prisma.unitListing.findUnique({ where: { unitId: u.id } });
    expect(listing.published).toBe(true);

    const hidden = await request(app).get("/api/public/units");
    expect(hidden.status).toBe(200);
    expect(hidden.body).toHaveLength(0);

    expect((await unblock(deal.id)).status).toBe(200);
    const back = await request(app).get("/api/public/units");
    expect(back.body).toHaveLength(1);
  });
});

describe("A signed deal stays signed", () => {
  const setStatus = (id, status) => call("patch", id, "status", tokens.officer(), { status });
  const signedDeal = async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: "Pending", finalStatus: "Pending" });
    await block(deal.id);
    expect((await setStatus(deal.id, "Signed")).status).toBe(200);
    return { unit, deal };
  };

  it("refuses to move a Signed deal to Declined (409); the unit stays OCCUPIED", async () => {
    const { unit, deal } = await signedDeal();

    const res = await setStatus(deal.id, "Declined");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A signed deal cannot be changed");

    expect((await unitOf(unit.id)).status).toBe("OCCUPIED");
    const after = await prisma.leasingTransaction.findUnique({ where: { id: deal.id } });
    expect(after.finalStatus).toBe("Signed");
    expect(after.status).toBe("Signed");
  });

  it("refuses to move a Signed deal back to Pending (409)", async () => {
    const { unit, deal } = await signedDeal();

    const res = await setStatus(deal.id, "Pending");
    expect(res.status).toBe(409);
    const after = await prisma.leasingTransaction.findUnique({ where: { id: deal.id } });
    expect(after.finalStatus).toBe("Signed");
    expect((await unitOf(unit.id)).status).toBe("OCCUPIED");
  });

  it("re-saving Signed succeeds, keeps the unit OCCUPIED and logs no misleading 'check its status' note", async () => {
    const { unit, deal } = await signedDeal();

    const res = await call("patch", deal.id, "status", tokens.officer(), { status: "Signed", remarks: "Contract re-uploaded" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("Signed");

    expect((await unitOf(unit.id)).status).toBe("OCCUPIED");
    const messages = await messagesOf(deal.id);
    expect(messages.filter((m) => m.includes("check its status"))).toEqual([]);
    expect(messages.filter((m) => m === "Unit marked occupied (contract signed)")).toHaveLength(1);
    expect(messages.filter((m) => m.startsWith('Contract Signing status set to "Signed"'))).toHaveLength(2);
  });
});

describe("Declining by advancing into the final stage", () => {
  it("releases the block when advancing straight into Contract Signing as Declined", async () => {
    const unit = await makeUnit();
    const tenant = await factory.tenant({ name: "Ana" });
    const deal = await makeTxn({
      unitId: unit.id, tenantId: tenant.id, stage: "PHOTOSHOOT", status: "Completed",
    });
    await prisma.transactionDocument.create({
      data: {
        transactionId: deal.id, filename: "loi.pdf", mimeType: "application/pdf",
        size: 3, data: Buffer.from("abc"), docType: "LETTER_OF_INTENT",
      },
    });
    await block(deal.id);

    const res = await call("patch", deal.id, "advance", tokens.officer(), { status: "Declined" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("Declined");

    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
    expect(await messagesOf(deal.id)).toContain("Unit block released (deal declined)");
  });
});

describe("Deleting a deal that holds a unit", () => {
  it("frees the unit instead of leaving a holderless block", async () => {
    const unit = await makeUnit();
    const deal = await makeDeal(unit.id);
    await block(deal.id);
    expect((await unitOf(unit.id)).status).toBe("BLOCKED");

    const res = await request(app).delete(`/api/leasing-transactions/${deal.id}`).set(auth(tokens.admin()));
    expect(res.status).toBe(204);

    const after = await unitOf(unit.id);
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();
    expect(await prisma.leasingTransaction.findUnique({ where: { id: deal.id } })).toBeNull();
  });

  it("leaves a block held by a different deal alone", async () => {
    const unit = await makeUnit();
    const holder = await makeDeal(unit.id);
    const other = await makeDeal(unit.id);
    await block(holder.id);

    expect((await request(app).delete(`/api/leasing-transactions/${other.id}`).set(auth(tokens.admin()))).status).toBe(204);
    const after = await unitOf(unit.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedByTransactionId).toBe(holder.id);
  });
});

describe("Reviving a declined deal", () => {
  it("refuses to return a Declined deal when another active deal has taken the unit (409)", async () => {
    const unit = await makeUnit();
    const declined = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: "Declined", finalStatus: "Declined" });
    await makeDeal(unit.id); // a live rival

    const res = await call("patch", declined.id, "return", tokens.officer(), {});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Another active deal now exists on this unit");
    const after = await prisma.leasingTransaction.findUnique({ where: { id: declined.id } });
    expect(after.stage).toBe("CONTRACT_SIGNING");
    expect(after.finalStatus).toBe("Declined");
  });

  it("still returns a Declined deal when nothing else is active on its unit", async () => {
    const unit = await makeUnit();
    const declined = await makeDeal(unit.id, { stage: "CONTRACT_SIGNING", status: "Declined", finalStatus: "Declined" });

    const res = await call("patch", declined.id, "return", tokens.officer(), {});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("PHOTOSHOOT");
    expect(res.body.finalStatus).toBeNull();
  });
});
