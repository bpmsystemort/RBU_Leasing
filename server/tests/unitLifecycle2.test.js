import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
// A bare pipeline row. Pass tenantId / inquiryId to give it a prospect.
function makeTxn(over = {}) {
  seq += 1;
  return prisma.leasingTransaction.create({
    data: { reference: `RBU-2026-9${String(seq).padStart(5, "0")}`, stage: "SEND_REQUIREMENTS", status: "Pending", ...over },
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
const statusOf = async (id) => (await prisma.unit.findUnique({ where: { id } })).status;
const patch = (path, token) => request(app).patch(`/api/units/${path}`).set(auth(token));

describe("Manual availability (unavailable / restore)", () => {
  it("sets a VACANT unit UNAVAILABLE and restores it to VACANT", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);

    const off = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(off.status).toBe(200);
    expect(off.body.status).toBe("UNAVAILABLE");
    expect(await statusOf(unit.id)).toBe("UNAVAILABLE");

    const on = await patch(`${unit.id}/restore`, tokens.admin());
    expect(on.status).toBe(200);
    expect(on.body.status).toBe("VACANT");
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("is a no-op when the unit is already in the target state", async () => {
    const owner = await factory.owner();
    const vacant = await factory.unit(owner.id);
    const unavailable = await factory.unit(owner.id, { unitNumber: "102", status: "UNAVAILABLE" });

    const restoreVacant = await patch(`${vacant.id}/restore`, tokens.officer());
    expect(restoreVacant.status).toBe(200);
    expect(restoreVacant.body.status).toBe("VACANT");

    const againOff = await patch(`${unavailable.id}/unavailable`, tokens.officer());
    expect(againOff.status).toBe(200);
    expect(againOff.body.status).toBe("UNAVAILABLE");
  });

  it("refuses to set a BLOCKED or OCCUPIED unit unavailable (409), status unchanged", async () => {
    const owner = await factory.owner();
    const blocked = await factory.unit(owner.id, { unitNumber: "B1", status: "BLOCKED" });
    const occupied = await factory.unit(owner.id, { unitNumber: "O1", status: "OCCUPIED" });

    const b = await patch(`${blocked.id}/unavailable`, tokens.officer());
    expect(b.status).toBe(409);
    expect(b.body.error).toMatch(/BLOCKED/);
    expect(await statusOf(blocked.id)).toBe("BLOCKED");

    const o = await patch(`${occupied.id}/unavailable`, tokens.officer());
    expect(o.status).toBe(409);
    expect(o.body.error).toMatch(/OCCUPIED/);
    expect(await statusOf(occupied.id)).toBe("OCCUPIED");
  });

  it("refuses to restore a BLOCKED or OCCUPIED unit (409), status unchanged", async () => {
    const owner = await factory.owner();
    const blocked = await factory.unit(owner.id, { unitNumber: "B1", status: "BLOCKED" });
    const occupied = await factory.unit(owner.id, { unitNumber: "O1", status: "OCCUPIED" });

    expect((await patch(`${blocked.id}/restore`, tokens.officer())).status).toBe(409);
    expect(await statusOf(blocked.id)).toBe("BLOCKED");
    expect((await patch(`${occupied.id}/restore`, tokens.officer())).status).toBe(409);
    expect(await statusOf(occupied.id)).toBe("OCCUPIED");
  });

  it("refuses to set a unit unavailable while a deal with a tenant is open (409)", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, tenantId: tenant.id });

    const res = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/active deal/);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("refuses to set a unit unavailable while a deal with an inquiry is open (409)", async () => {
    const owner = await factory.owner();
    const inquiry = await makeInquiry();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, inquiryId: inquiry.id });

    const res = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(res.status).toBe(409);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("an ended deal (Signed / Declined) does not prevent setting a unit unavailable", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, tenantId: tenant.id, finalStatus: "Declined" });

    const res = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UNAVAILABLE");
  });

  it("a Signed (ended) deal does not prevent setting a unit unavailable", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, tenantId: tenant.id, finalStatus: "Signed" });

    const res = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UNAVAILABLE");
    expect(await statusOf(unit.id)).toBe("UNAVAILABLE");
  });

  it("the lessor-onboarding transaction (no inquiry, no tenant) does NOT block set-unavailable", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, unitOwnerId: owner.id });

    const res = await patch(`${unit.id}/unavailable`, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UNAVAILABLE");
    expect(await statusOf(unit.id)).toBe("UNAVAILABLE");
  });

  it("returns 404 for an unknown unit", async () => {
    expect((await patch("ghost/unavailable", tokens.officer())).status).toBe(404);
    expect((await patch("ghost/restore", tokens.officer())).status).toBe(404);
    expect((await patch("ghost/release-block", tokens.officer())).status).toBe(404);
  });

  it("two concurrent unavailable calls never leave an inconsistent row", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);

    const results = await Promise.all([
      patch(`${unit.id}/unavailable`, tokens.officer()),
      patch(`${unit.id}/unavailable`, tokens.admin()),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes.every((c) => c === 200 || c === 409)).toBe(true);
    expect(codes).toContain(200);
    expect(await statusOf(unit.id)).toBe("UNAVAILABLE");
  });

  it("is read-only for viewers (403 on all three routes)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    for (const path of ["unavailable", "restore", "release-block"]) {
      const res = await patch(`${unit.id}/${path}`, tokens.viewer());
      expect(res.status).toBe(403);
    }
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("is forbidden for a UNIT_OWNER and a TENANT (403 on all three routes)", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const unit = await factory.unit(owner.id);
    for (const token of [tokens.owner(owner.id), tokens.tenant(tenant.id)]) {
      for (const path of ["unavailable", "restore", "release-block"]) {
        const res = await patch(`${unit.id}/${path}`, token);
        expect(res.status).toBe(403);
      }
    }
    expect(await statusOf(unit.id)).toBe("VACANT");
  });
});

describe("PATCH /api/units/:id status", () => {
  it("rejects BLOCKED and OCCUPIED with 400", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    for (const status of ["BLOCKED", "OCCUPIED"]) {
      const res = await patch(unit.id, tokens.officer()).send({ status });
      expect(res.status).toBe(400);
    }
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("rejects BLOCKED and OCCUPIED on create with 400", async () => {
    const owner = await factory.owner();
    for (const status of ["BLOCKED", "OCCUPIED"]) {
      const res = await request(app).post("/api/units").set(auth(tokens.officer()))
        .send({ ownerId: owner.id, unitNumber: "N1", baseRent: 1000, status });
      expect(res.status).toBe(400);
    }
  });

  it("a UNIT_OWNER creating a unit with status UNAVAILABLE gets a VACANT unit", async () => {
    const owner = await factory.owner();
    const res = await request(app).post("/api/units").set(auth(tokens.owner(owner.id)))
      .send({ unitNumber: "S1", baseRent: 1000, status: "UNAVAILABLE" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("VACANT");
    expect(await statusOf(res.body.id)).toBe("VACANT");
  });

  it("allows UNAVAILABLE from VACANT (200) and VACANT back from UNAVAILABLE", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    const off = await patch(unit.id, tokens.officer()).send({ status: "UNAVAILABLE", floor: "9" });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe("UNAVAILABLE");
    expect(off.body.floor).toBe("9");

    const on = await patch(unit.id, tokens.officer()).send({ status: "VACANT" });
    expect(on.status).toBe(200);
    expect(on.body.status).toBe("VACANT");
  });

  it("refuses UNAVAILABLE from an OCCUPIED unit (409)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    await prisma.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });

    const res = await patch(unit.id, tokens.officer()).send({ status: "UNAVAILABLE" });
    expect(res.status).toBe(409);
    expect(await statusOf(unit.id)).toBe("OCCUPIED");
  });

  it("refuses VACANT from a BLOCKED unit (409)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { status: "BLOCKED" });

    const res = await patch(unit.id, tokens.officer()).send({ status: "VACANT" });
    expect(res.status).toBe(409);
    expect(await statusOf(unit.id)).toBe("BLOCKED");
  });

  it("refuses UNAVAILABLE while a prospect deal is open (409)", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const unit = await factory.unit(owner.id);
    await makeTxn({ unitId: unit.id, tenantId: tenant.id });

    const res = await patch(unit.id, tokens.officer()).send({ status: "UNAVAILABLE" });
    expect(res.status).toBe(409);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("a status equal to the stored one is not treated as a change", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { status: "UNAVAILABLE" });
    const res = await patch(unit.id, tokens.officer()).send({ status: "UNAVAILABLE", floor: "3" });
    expect(res.status).toBe(200);
    expect(res.body.floor).toBe("3");
    expect(await statusOf(unit.id)).toBe("UNAVAILABLE");
  });

  it("echoing the stored status (VACANT) with another field only changes that field", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    const res = await patch(unit.id, tokens.officer()).send({ status: "VACANT", floor: "9" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VACANT");
    expect(res.body.floor).toBe("9");
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("a BLOCKED unit keeps its status and holder pointer when PATCH asks for VACANT or UNAVAILABLE (409, other fields not applied)", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const txn = await makeTxn({ tenantId: tenant.id });
    const unit = await factory.unit(owner.id, { status: "BLOCKED", blockedByTransactionId: txn.id });

    for (const status of ["VACANT", "UNAVAILABLE"]) {
      const res = await patch(unit.id, tokens.officer()).send({ status, floor: "9" });
      expect(res.status).toBe(409);
      const after = await prisma.unit.findUnique({ where: { id: unit.id } });
      expect(after.status).toBe("BLOCKED");
      expect(after.blockedByTransactionId).toBe(txn.id);
      expect(after.floor).toBeNull();
    }
  });

  it("a status change that passes the guards is applied together with the other fields", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    const res = await patch(unit.id, tokens.officer()).send({ status: "UNAVAILABLE", floor: "4" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UNAVAILABLE");
    expect(res.body.floor).toBe("4");
    const after = await prisma.unit.findUnique({ where: { id: unit.id } });
    expect(after.status).toBe("UNAVAILABLE");
    expect(after.floor).toBe("4");
  });

  it("a UNIT_OWNER cannot change status (it is ignored, the rest of the edit applies)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { approvalStatus: "DRAFT" });

    const res = await patch(unit.id, tokens.owner(owner.id)).send({ status: "UNAVAILABLE", floor: "5" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VACANT");
    expect(res.body.floor).toBe("5");
    expect(await statusOf(unit.id)).toBe("VACANT");

    // not even the guard fires for an owner: an OCCUPIED unit is left as it is
    const occupied = await factory.unit(owner.id, { unitNumber: "O2", approvalStatus: "DRAFT", status: "OCCUPIED" });
    const res2 = await patch(occupied.id, tokens.owner(owner.id)).send({ status: "VACANT", floor: "6" });
    expect(res2.status).toBe(200);
    expect(await statusOf(occupied.id)).toBe("OCCUPIED");
  });

  it("a UNIT_OWNER sending BLOCKED is still rejected by validation (400)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { approvalStatus: "DRAFT" });
    const res = await patch(unit.id, tokens.owner(owner.id)).send({ status: "BLOCKED" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/units/:id/release-block", () => {
  it("releases a BLOCKED unit that has a holder, clears the pointer and logs the event", async () => {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const txn = await makeTxn({ tenantId: tenant.id });
    const unit = await factory.unit(owner.id, { status: "BLOCKED", blockedByTransactionId: txn.id });
    await prisma.leasingTransaction.update({ where: { id: txn.id }, data: { unitId: unit.id } });

    const res = await patch(`${unit.id}/release-block`, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VACANT");
    expect(res.body.blockedByTransactionId).toBeNull();

    const after = await prisma.unit.findUnique({ where: { id: unit.id } });
    expect(after.status).toBe("VACANT");
    expect(after.blockedByTransactionId).toBeNull();

    const events = await prisma.transactionEvent.findMany({ where: { transactionId: txn.id } });
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Unit block released");
    expect(events[0].actorRole).toBe("LEASING_OFFICER");
  });

  it("clears a BLOCKED unit with no holder (its transaction was deleted)", async () => {
    const owner = await factory.owner();
    const txn = await makeTxn();
    const unit = await factory.unit(owner.id, { status: "BLOCKED", blockedByTransactionId: txn.id });
    await prisma.leasingTransaction.delete({ where: { id: txn.id } });
    expect((await prisma.unit.findUnique({ where: { id: unit.id } })).blockedByTransactionId).toBeNull();

    const res = await patch(`${unit.id}/release-block`, tokens.admin());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VACANT");
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("refuses a unit that is not BLOCKED (409)", async () => {
    const owner = await factory.owner();
    const vacant = await factory.unit(owner.id);
    const unavailable = await factory.unit(owner.id, { unitNumber: "U1", status: "UNAVAILABLE" });

    const a = await patch(`${vacant.id}/release-block`, tokens.officer());
    expect(a.status).toBe(409);
    expect(a.body.error).toMatch(/not blocked/i);
    expect((await patch(`${unavailable.id}/release-block`, tokens.officer())).status).toBe(409);
    expect(await statusOf(unavailable.id)).toBe("UNAVAILABLE");
  });
});

describe("PATCH /api/units/:id/release-block by holder", () => {
  let officerSeq = 0;
  async function makeOfficerUser() {
    officerSeq += 1;
    const user = await prisma.user.create({
      data: { name: `Holder ${officerSeq}`, email: `holder-${officerSeq}@x.com`, passwordHash: "x", role: "LEASING_OFFICER" },
    });
    return { user, token: tokens.officer(user.id) };
  }
  // A BLOCKED unit whose holder deal is assigned to `assignedOfficerId` (or nobody).
  async function heldUnit(txnOver = {}) {
    const owner = await factory.owner();
    const tenant = await factory.tenant();
    const txn = await makeTxn({ tenantId: tenant.id, ...txnOver });
    const unit = await factory.unit(owner.id, { status: "BLOCKED", blockedByTransactionId: txn.id });
    await prisma.leasingTransaction.update({ where: { id: txn.id }, data: { unitId: unit.id } });
    return { unit, txn };
  }

  it("refuses another officer while the holder deal is live (409), but the holder officer and an admin can release", async () => {
    const a = await makeOfficerUser();
    const b = await makeOfficerUser();

    const first = await heldUnit({ assignedOfficerId: a.user.id });
    const denied = await patch(`${first.unit.id}/release-block`, b.token);
    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe(`This unit is held by deal ${first.txn.reference}; release it from that deal`);
    const still = await prisma.unit.findUnique({ where: { id: first.unit.id } });
    expect(still.status).toBe("BLOCKED");
    expect(still.blockedByTransactionId).toBe(first.txn.id);

    const byHolder = await patch(`${first.unit.id}/release-block`, a.token);
    expect(byHolder.status).toBe(200);
    expect(byHolder.body.status).toBe("VACANT");

    const second = await heldUnit({ assignedOfficerId: a.user.id });
    const byAdmin = await patch(`${second.unit.id}/release-block`, tokens.admin());
    expect(byAdmin.status).toBe(200);
    expect(await statusOf(second.unit.id)).toBe("VACANT");
  });

  it("a block with no pointer is releasable by any officer", async () => {
    const b = await makeOfficerUser();
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { status: "BLOCKED" });

    const res = await patch(`${unit.id}/release-block`, b.token);
    expect(res.status).toBe(200);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("a block whose holder deal has ended is releasable by any officer", async () => {
    const a = await makeOfficerUser();
    const b = await makeOfficerUser();
    const { unit } = await heldUnit({ assignedOfficerId: a.user.id, stage: "CONTRACT_SIGNING", status: "Declined", finalStatus: "Declined" });

    const res = await patch(`${unit.id}/release-block`, b.token);
    expect(res.status).toBe(200);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });

  it("a block held by an unassigned deal is releasable by any officer", async () => {
    const b = await makeOfficerUser();
    const { unit } = await heldUnit();

    const res = await patch(`${unit.id}/release-block`, b.token);
    expect(res.status).toBe(200);
    expect(await statusOf(unit.id)).toBe("VACANT");
  });
});

describe("PATCH /api/units/:id/mark-reviewed", () => {
  const flagged = async (over = {}) => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id, { status: "OCCUPIED", ...over });
    await prisma.unit.update({ where: { id: unit.id }, data: { needsStatusReview: true } });
    return { owner, unit };
  };
  const flagOf = async (id) => (await prisma.unit.findUnique({ where: { id } })).needsStatusReview;

  it("clears the flag and leaves the status alone", async () => {
    const { unit } = await flagged();

    const res = await patch(`${unit.id}/mark-reviewed`, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(unit.id);
    expect(res.body.needsStatusReview).toBe(false);
    expect(res.body.status).toBe("OCCUPIED");
    expect(res.body.owner).toMatchObject({ id: unit.ownerId });
    expect(await flagOf(unit.id)).toBe(false);
    expect(await statusOf(unit.id)).toBe("OCCUPIED");
  });

  it("is idempotent, and an admin can do it too", async () => {
    const { unit } = await flagged();
    expect((await patch(`${unit.id}/mark-reviewed`, tokens.admin())).status).toBe(200);

    const again = await patch(`${unit.id}/mark-reviewed`, tokens.officer());
    expect(again.status).toBe(200);
    expect(again.body.needsStatusReview).toBe(false);
    expect(await statusOf(unit.id)).toBe("OCCUPIED");
  });

  it("is forbidden for viewer, unit owner and tenant (403) and leaves the flag set", async () => {
    const { owner, unit } = await flagged();
    const tenant = await factory.tenant();
    for (const token of [tokens.viewer(), tokens.owner(owner.id), tokens.tenant(tenant.id)]) {
      expect((await patch(`${unit.id}/mark-reviewed`, token)).status).toBe(403);
    }
    expect(await flagOf(unit.id)).toBe(true);
  });

  it("returns 404 for an unknown unit", async () => {
    expect((await patch("ghost/mark-reviewed", tokens.officer())).status).toBe(404);
  });
});
