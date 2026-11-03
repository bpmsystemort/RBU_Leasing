import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { issueToken } from "../src/services/authService.js";
import { createTransaction } from "../src/services/leasingTransactionService.js";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";

// Object-level and role-level access that a signed-in user must NOT have.
//
// The rule these pin: a tenant or an owner reaches only their own records, and
// the read-only staff role (VIEWER) changes nothing. Each case below was a real
// gap — a role with a valid token could do something its role forbids.
const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("GET /api/units/:id", () => {
  async function aUnit() {
    const owner = await factory.owner({ name: "Owner A" });
    const unit = await factory.unit(owner.id, { approvalStatus: "REJECTED", reviewRemarks: "Floor plan does not match." });
    return { owner, unit };
  }

  // A tenant has no business reading a unit record by id: it carries the owner,
  // the rent and the officer's internal review remarks, and a rejected or
  // unpublished unit is deliberately not on the public listing.
  it("refuses a tenant", async () => {
    const { unit } = await aUnit();
    const tenant = await factory.tenant();
    const res = await request(app).get(`/api/units/${unit.id}`).set(auth(tokens.tenant(tenant.id)));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Floor plan");
  });

  it("still serves the unit to its own owner", async () => {
    const { owner, unit } = await aUnit();
    const res = await request(app).get(`/api/units/${unit.id}`).set(auth(tokens.owner(owner.id)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(unit.id);
  });

  it("still hides it from a different owner", async () => {
    const { unit } = await aUnit();
    const other = await factory.owner({ name: "Owner B" });
    const res = await request(app).get(`/api/units/${unit.id}`).set(auth(tokens.owner(other.id)));
    expect(res.status).toBe(404);
  });

  it("still serves staff", async () => {
    const { unit } = await aUnit();
    for (const token of [tokens.admin(), tokens.officer(), tokens.viewer()]) {
      const res = await request(app).get(`/api/units/${unit.id}`).set(auth(token));
      expect(res.status).toBe(200);
    }
  });

  it("still needs a token", async () => {
    const { unit } = await aUnit();
    expect((await request(app).get(`/api/units/${unit.id}`)).status).toBe(401);
  });
});

describe("GET /api/dashboard", () => {
  // Portfolio-wide totals are management information. No screen shows this
  // endpoint to an owner or a tenant, so they have no reason to read it.
  it("refuses a tenant and an owner", async () => {
    const tenant = await factory.tenant();
    const owner = await factory.owner();
    expect((await request(app).get("/api/dashboard").set(auth(tokens.tenant(tenant.id)))).status).toBe(403);
    expect((await request(app).get("/api/dashboard").set(auth(tokens.owner(owner.id)))).status).toBe(403);
  });

  it("still serves every staff role", async () => {
    for (const token of [tokens.admin(), tokens.officer(), tokens.viewer()]) {
      expect((await request(app).get("/api/dashboard").set(auth(token))).status).toBe(200);
    }
  });
});

describe("The read-only role cannot change transaction documents", () => {
  async function aTransaction() {
    const officer = await prisma.user.create({
      data: { name: "Officer", email: "hardening-officer@x.com", passwordHash: "x", role: "LEASING_OFFICER" },
    });
    const tenant = await factory.tenant();
    const owner = await factory.owner();
    const txn = await createTransaction(
      { userId: officer.id, role: "LEASING_OFFICER" },
      { lesseeName: "Ana Reyes", startStage: "SEND_REQUIREMENTS", tenantId: tenant.id, unitOwnerId: owner.id },
    );
    return { officer, tenant, owner, txn, officerToken: issueToken({ id: officer.id, role: "LEASING_OFFICER" }) };
  }

  const pdf = Buffer.from("%PDF-1.4 test");
  const upload = (txnId, token) =>
    request(app).post(`/api/leasing-transactions/${txnId}/documents`).set(auth(token))
      .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" });

  it("refuses an upload from a viewer", async () => {
    const { txn } = await aTransaction();
    const res = await upload(txn.id, tokens.viewer());
    expect(res.status).toBe(403);
    expect(await prisma.transactionDocument.count({ where: { transactionId: txn.id } })).toBe(0);
  });

  // The Letter of Intent and the signed contract are legal documents. A role
  // that is read-only must not be able to remove them.
  it("refuses a delete from a viewer and leaves the document in place", async () => {
    const { txn, officerToken } = await aTransaction();
    const up = await upload(txn.id, officerToken);
    expect(up.status).toBe(201);
    const res = await request(app).delete(`/api/leasing-transactions/${txn.id}/documents/${up.body.id}`).set(auth(tokens.viewer()));
    expect(res.status).toBe(403);
    expect(await prisma.transactionDocument.count({ where: { id: up.body.id } })).toBe(1);
  });

  it("still lets a linked tenant and a linked owner attach and remove their own loose documents", async () => {
    const { tenant, owner, txn } = await aTransaction();
    for (const token of [tokens.tenant(tenant.id), tokens.owner(owner.id)]) {
      const up = await upload(txn.id, token);
      expect(up.status).toBe(201);
    }
    const mine = await prisma.transactionDocument.findFirst({ where: { transactionId: txn.id } });
    // The portal tokens in tests carry no real user id, so uploads are not
    // attributed — staff can remove it, which is the path that matters here.
    const res = await request(app).delete(`/api/leasing-transactions/${txn.id}/documents/${mine.id}`).set(auth(tokens.officer()));
    expect(res.status).toBe(204);
  });

  it("still lets an officer upload and remove", async () => {
    const { txn, officerToken } = await aTransaction();
    const up = await upload(txn.id, officerToken);
    expect(up.status).toBe(201);
    const del = await request(app).delete(`/api/leasing-transactions/${txn.id}/documents/${up.body.id}`).set(auth(officerToken));
    expect(del.status).toBe(204);
  });
});
