import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/authService.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const adminAuth = () => ({ Authorization: `Bearer ${tokens.admin()}` });

// Direct-to-DB like accountApproval.test.js's pending-lessor fixtures — this
// suite is about the approval decision itself, not the signup endpoint.
let pendingSeq = 0;
async function pendingOwnerUser(over = {}) {
  pendingSeq += 1;
  return prisma.user.create({
    data: {
      name: "Pending Lessor",
      email: `pending.lessor.${pendingSeq}@x.com`,
      contactEmail: "pending.lessor@example.com",
      role: "UNIT_OWNER",
      status: "PENDING",
      passwordHash: "x",
      passwordPlain: "x",
      ...over,
    },
  });
}

describe("Approval can link to an existing (imported) owner", () => {
  it("links to the given existingUnitOwnerId instead of creating a new owner", async () => {
    const owner = await factory.owner({ name: "Juan Cruz" });
    const user = await pendingOwnerUser({ contactEmail: "juan.updated@example.com" });
    const before = await prisma.unitOwner.count();

    const res = await request(app)
      .patch(`/api/auth/pending/${user.id}/approve`)
      .set(adminAuth())
      .send({ existingUnitOwnerId: owner.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.unitOwnerId).toBe(owner.id);
    // No new UnitOwner row — the applicant was linked to the existing one.
    expect(await prisma.unitOwner.count()).toBe(before);

    // The owner's email is refreshed from the applicant's contact email.
    const after = await prisma.unitOwner.findUnique({ where: { id: owner.id } });
    expect(after.email).toBe("juan.updated@example.com");
  });

  it("still creates a new owner when no existingUnitOwnerId is given", async () => {
    const user = await pendingOwnerUser();
    const before = await prisma.unitOwner.count();

    const res = await request(app)
      .patch(`/api/auth/pending/${user.id}/approve`)
      .set(adminAuth())
      .send();

    expect(res.status).toBe(200);
    expect(await prisma.unitOwner.count()).toBe(before + 1);
    expect(res.body.unitOwnerId).toBeTruthy();
  });

  it("refuses to link an owner that already has an active account (409)", async () => {
    const owner = await factory.owner({ name: "Taken Owner" });
    await prisma.user.create({
      data: {
        name: "Existing Owner User", email: "existing.owner@x.com", contactEmail: "existing.owner@x.com",
        role: "UNIT_OWNER", status: "APPROVED", passwordHash: "x", passwordPlain: "x",
        unitOwnerId: owner.id,
      },
    });
    const applicant = await pendingOwnerUser({ email: "second.applicant@x.com" });

    const res = await request(app)
      .patch(`/api/auth/pending/${applicant.id}/approve`)
      .set(adminAuth())
      .send({ existingUnitOwnerId: owner.id });

    expect(res.status).toBe(409);
    // Refused outright, not half-applied: the applicant is still PENDING.
    const after = await prisma.user.findUnique({ where: { id: applicant.id } });
    expect(after.status).toBe("PENDING");
    expect(after.unitOwnerId).toBeNull();
  });

  it("rejects an existingUnitOwnerId that does not reference a real owner (400)", async () => {
    const applicant = await pendingOwnerUser();
    const res = await request(app)
      .patch(`/api/auth/pending/${applicant.id}/approve`)
      .set(adminAuth())
      .send({ existingUnitOwnerId: "ghost-owner-id" });
    expect(res.status).toBe(400);
  });
});

describe("Suspending and restoring an account", () => {
  async function approvedUser(over = {}) {
    pendingSeq += 1;
    return prisma.user.create({
      data: {
        name: "Active User",
        email: `active.${pendingSeq}@x.com`,
        role: "VIEWER",
        status: "APPROVED",
        passwordHash: "x",
        passwordPlain: "x",
        ...over,
      },
    });
  }

  it("suspends an approved user, who still shows up in /auth/users as SUSPENDED, then restores them", async () => {
    const user = await approvedUser();

    const suspendRes = await request(app)
      .patch(`/api/auth/users/${user.id}/suspend`)
      .set(adminAuth());
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body).toMatchObject({ id: user.id, status: "SUSPENDED" });

    const listRes = await request(app).get("/api/auth/users").set(adminAuth());
    expect(listRes.status).toBe(200);
    const row = listRes.body.find((u) => u.id === user.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("SUSPENDED");

    const restoreRes = await request(app)
      .patch(`/api/auth/users/${user.id}/restore`)
      .set(adminAuth());
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body).toMatchObject({ id: user.id, status: "APPROVED" });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.status).toBe("APPROVED");
  });

  it("a suspended account logs in to a restricted session that verifyJwt-gated routes refuse", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Will Suspend", email: "will.suspend@x.com", role: "VIEWER", status: "APPROVED",
        passwordHash: await hashPassword("pw123456"), passwordPlain: "pw123456",
      },
    });
    await request(app).patch(`/api/auth/users/${user.id}/suspend`).set(adminAuth());

    const login = await request(app).post("/api/auth/login")
      .send({ email: "will.suspend@x.com", password: "pw123456" });
    expect(login.status).toBe(200);
    expect(login.body.user.status).toBe("SUSPENDED");

    const me = await request(app).get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(403);
  });

  it("refuses a VIEWER token for suspend/restore/approve (403)", async () => {
    const user = await approvedUser();
    const viewer = { Authorization: `Bearer ${tokens.viewer()}` };

    const suspendRes = await request(app).patch(`/api/auth/users/${user.id}/suspend`).set(viewer);
    expect(suspendRes.status).toBe(403);

    const restoreRes = await request(app).patch(`/api/auth/users/${user.id}/restore`).set(viewer);
    expect(restoreRes.status).toBe(403);

    const applicant = await pendingOwnerUser({ email: "viewer.blocked@x.com" });
    const approveRes = await request(app).patch(`/api/auth/pending/${applicant.id}/approve`).set(viewer);
    expect(approveRes.status).toBe(403);
  });
});

describe("Pending queue surfaces a suggested owner match", () => {
  it("attaches a suggestedOwner hint when an imported owner's name matches", async () => {
    const owner = await factory.owner({ name: "Maria Santos", nameKey: "maria santos" });
    await pendingOwnerUser({ name: "Maria Santos", email: "maria.pending@x.com" });

    const res = await request(app).get("/api/auth/pending").set(adminAuth());
    expect(res.status).toBe(200);
    const row = res.body.find((u) => u.email === "maria.pending@x.com");
    expect(row.suggestedOwner).toMatchObject({ id: owner.id, name: "Maria Santos" });
  });

  it("suggestedOwner is null when no imported owner's name matches", async () => {
    await pendingOwnerUser({ name: "Nobody Matching", email: "nomatch@x.com" });
    const res = await request(app).get("/api/auth/pending").set(adminAuth());
    const row = res.body.find((u) => u.email === "nomatch@x.com");
    expect(row.suggestedOwner).toBeNull();
  });
});
