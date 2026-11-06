import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { flushAudits } from "../src/middleware/audit.js";
import { issueToken } from "../src/services/authService.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const assign = (unitId, body, token = tokens.admin()) =>
  request(app).patch(`/api/units/${unitId}/assign-owner`).set(auth(token)).send(body);
const history = (unitId, token = tokens.admin()) =>
  request(app).get(`/api/units/${unitId}/assignments`).set(auth(token));
const unitOf = (id) => prisma.unit.findUnique({ where: { id } });
const eventsOf = (unitId) => prisma.unitAssignmentEvent.findMany({ where: { unitId }, orderBy: { createdAt: "asc" } });

describe("Reassigning a unit to another owner", () => {
  it("ADMIN reassigns: owner changes, one event records from/to/reason/actor", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id, { unitKey: "K-1" });

    const res = await assign(unit.id, { toOwnerId: b.id, reason: "  Sold to Bravo  " });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(unit.id);
    expect(res.body.ownerId).toBe(b.id);
    expect(res.body.owner).toEqual({ id: b.id, name: "Bravo" });

    expect((await unitOf(unit.id)).ownerId).toBe(b.id);
    const events = await eventsOf(unit.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      unitId: unit.id, fromOwnerId: a.id, toOwnerId: b.id, reason: "Sold to Bravo",
      // tokens.admin() carries the id "test-admin", which is not a User row.
      actorId: "test-admin", actorName: null,
    });
  });

  it("records the actor's name when the admin is a real User row", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    // Stored as VIEWER (resetCrudTables removes every non-ADMIN user, so a killed run
    // self-heals); the token still carries role ADMIN, which is what the route checks.
    const admin = await prisma.user.create({
      data: { name: "Real Admin", email: "real-admin@x.com", passwordHash: "x", role: "VIEWER" },
    });
    try {
      const token = issueToken({ id: admin.id, role: "ADMIN" });
      const res = await assign(unit.id, { toOwnerId: b.id }, token);
      expect(res.status).toBe(200);
      const events = await eventsOf(unit.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorId: admin.id, actorName: "Real Admin", reason: null });
    } finally {
      // Remove the user explicitly (resetCrudTables would also clear a VIEWER) so it never outlives the test.
      await flushAudits();
      await prisma.user.delete({ where: { id: admin.id } });
    }
  });

  it("treats a blank reason as no reason", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    const res = await assign(unit.id, { toOwnerId: b.id, reason: "   " });
    expect(res.status).toBe(200);
    expect((await eventsOf(unit.id))[0].reason).toBeNull();
  });

  it("rejects a missing toOwnerId or an over-long reason (400) without changing anything", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    expect((await assign(unit.id, {})).status).toBe(400);
    expect((await assign(unit.id, { toOwnerId: b.id, reason: "x".repeat(501) })).status).toBe(400);
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });

  it("refuses the owner the unit already has (409) and records nothing", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const unit = await factory.unit(a.id);
    const res = await assign(unit.id, { toOwnerId: a.id });
    expect(res.status).toBe(409);
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });

  it("rejects an unknown target owner (400) and records nothing", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const unit = await factory.unit(a.id);
    const res = await assign(unit.id, { toOwnerId: "no-such-owner" });
    expect(res.status).toBe(400);
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });

  it("404 for an unknown unit", async () => {
    const b = await factory.owner({ name: "Bravo" });
    const res = await assign("no-such-unit", { toOwnerId: b.id });
    expect(res.status).toBe(404);
    expect(await prisma.unitAssignmentEvent.count()).toBe(0);
  });

  it("409 when the target owner already has a unit with the same unit key; nothing changes", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const mine = await factory.unit(a.id, { unitNumber: "101", unitKey: "TWR|101" });
    const theirs = await factory.unit(b.id, { unitNumber: "101", unitKey: "TWR|101" });

    const res = await assign(mine.id, { toOwnerId: b.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/same unit key/);
    expect((await unitOf(mine.id)).ownerId).toBe(a.id);
    expect((await unitOf(theirs.id)).ownerId).toBe(b.id);
    expect(await prisma.unitAssignmentEvent.count()).toBe(0);
  });

  it("only ADMIN may reassign; officer, viewer, owner and tenant get 403", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    const t = await factory.tenant();
    for (const token of [tokens.officer(), tokens.viewer(), tokens.owner(a.id), tokens.tenant(t.id)]) {
      const res = await assign(unit.id, { toOwnerId: b.id }, token);
      expect(res.status).toBe(403);
    }
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });

  it("never creates or changes a User row", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    const login = await prisma.user.create({
      data: { name: "Alpha Login", email: "alpha-login@x.com", passwordHash: "x", role: "UNIT_OWNER", unitOwnerId: a.id },
    });
    const countBefore = await prisma.user.count();
    const snapshotBefore = await prisma.user.findUnique({ where: { id: login.id } });

    const res = await assign(unit.id, { toOwnerId: b.id });
    expect(res.status).toBe(200);

    expect(await prisma.user.count()).toBe(countBefore);
    const snapshotAfter = await prisma.user.findUnique({ where: { id: login.id } });
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(snapshotAfter.unitOwnerId).toBe(a.id);
  });

  it("existing open transactions keep their unitOwnerId", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    const txn = await prisma.leasingTransaction.create({
      data: { reference: "RBU-2026-900001", stage: "UNIT_VIEWING", status: "Pending", unitId: unit.id, unitOwnerId: a.id },
    });

    const res = await assign(unit.id, { toOwnerId: b.id });
    expect(res.status).toBe(200);

    const after = await prisma.leasingTransaction.findUnique({ where: { id: txn.id } });
    expect(after.unitOwnerId).toBe(a.id);
    expect(after.unitId).toBe(unit.id);
  });

  it("the old owner's login stops seeing the unit and the new owner's login sees it", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);

    const before = await request(app).get("/api/units").set(auth(tokens.owner(a.id)));
    expect(before.body.map((u) => u.id)).toEqual([unit.id]);

    expect((await assign(unit.id, { toOwnerId: b.id })).status).toBe(200);

    const oldList = await request(app).get("/api/units").set(auth(tokens.owner(a.id)));
    expect(oldList.status).toBe(200);
    expect(oldList.body).toHaveLength(0);
    const oldDetail = await request(app).get(`/api/units/${unit.id}`).set(auth(tokens.owner(a.id)));
    expect(oldDetail.status).toBe(404);

    const newList = await request(app).get("/api/units").set(auth(tokens.owner(b.id)));
    expect(newList.status).toBe(200);
    expect(newList.body.map((u) => u.id)).toEqual([unit.id]);
  });

  it("two concurrent reassignments to different owners leave one consistent winner", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const c = await factory.owner({ name: "Charlie" });
    const unit = await factory.unit(a.id);

    const results = await Promise.all([
      assign(unit.id, { toOwnerId: b.id }),
      assign(unit.id, { toOwnerId: c.id }),
    ]);
    const statuses = results.map((r) => r.status);
    for (const s of statuses) expect([200, 409]).toContain(s);
    const wins = statuses.filter((s) => s === 200).length;
    expect(wins).toBeGreaterThanOrEqual(1);

    const finalOwner = (await unitOf(unit.id)).ownerId;
    expect([b.id, c.id]).toContain(finalOwner);

    const events = await eventsOf(unit.id);
    expect(events).toHaveLength(wins);
    // No orphan: the newest event is exactly the move that produced the final owner.
    expect(events[events.length - 1].toOwnerId).toBe(finalOwner);
    // The history is one unbroken chain starting at the original owner.
    expect(events[0].fromOwnerId).toBe(a.id);
    if (wins === 2) expect(events[1].fromOwnerId).toBe(events[0].toOwnerId);
  });
});

describe("Assignment history", () => {
  it("is readable by ADMIN, officer and viewer (200), but not by owners or tenants", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    expect((await assign(unit.id, { toOwnerId: b.id, reason: "Sold" })).status).toBe(200);

    for (const token of [tokens.admin(), tokens.officer(), tokens.viewer()]) {
      const res = await history(unit.id, token);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        unitId: unit.id, reason: "Sold",
        fromOwner: { id: a.id, name: "Alpha" }, toOwner: { id: b.id, name: "Bravo" },
      });
    }
    const t = await factory.tenant();
    expect((await history(unit.id, tokens.owner(b.id))).status).toBe(403);
    expect((await history(unit.id, tokens.tenant(t.id))).status).toBe(403);
  });

  it("officer and viewer can read an empty history (200, [])", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const unit = await factory.unit(a.id);
    for (const token of [tokens.officer(), tokens.viewer()]) {
      const res = await history(unit.id, token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it("404 for an unknown unit", async () => {
    const res = await history("no-such-unit");
    expect(res.status).toBe(404);
  });

  it("lists the newest event first", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    await prisma.unitAssignmentEvent.create({
      data: { unitId: unit.id, fromOwnerId: null, toOwnerId: a.id, reason: "first", createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.unitAssignmentEvent.create({
      data: { unitId: unit.id, fromOwnerId: a.id, toOwnerId: b.id, reason: "second", createdAt: new Date("2026-02-01T00:00:00Z") },
    });

    const res = await history(unit.id);
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.reason)).toEqual(["second", "first"]);
    expect(res.body[1].fromOwner).toBeNull();
  });
});

describe("Owner verification data on unit responses", () => {
  it("staff see owner.needsReview; the owner portal keeps { id, name }", async () => {
    const a = await factory.owner({ name: "Alpha", needsReview: true });
    const unit = await factory.unit(a.id);

    for (const token of [tokens.admin(), tokens.viewer()]) {
      const list = await request(app).get("/api/units").set(auth(token));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].owner).toEqual({ id: a.id, name: "Alpha", needsReview: true });
    }
    for (const token of [tokens.admin(), tokens.officer(), tokens.viewer()]) {
      const detail = await request(app).get(`/api/units/${unit.id}`).set(auth(token));
      expect(detail.status).toBe(200);
      expect(detail.body.owner).toEqual({ id: a.id, name: "Alpha", needsReview: true });
    }

    const ownerList = await request(app).get("/api/units").set(auth(tokens.owner(a.id)));
    expect(ownerList.status).toBe(200);
    expect(ownerList.body).toHaveLength(1);
    expect(ownerList.body[0].owner).toEqual({ id: a.id, name: "Alpha" });
    const ownerDetail = await request(app).get(`/api/units/${unit.id}`).set(auth(tokens.owner(a.id)));
    expect(ownerDetail.status).toBe(200);
    expect(ownerDetail.body.owner).toEqual({ id: a.id, name: "Alpha" });
  });
});

describe("Deleting an owner that appears in assignment history", () => {
  it("refuses with 409 when the owner was ever a destination; a source-only owner can go", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const c = await factory.owner({ name: "Charlie" });
    const unit = await factory.unit(a.id);
    // a -> b -> c: afterwards neither a nor b holds a unit, but b is a destination.
    expect((await assign(unit.id, { toOwnerId: b.id })).status).toBe(200);
    expect((await assign(unit.id, { toOwnerId: c.id })).status).toBe(200);

    const blocked = await request(app).delete(`/api/owners/${b.id}`).set(auth(tokens.admin()));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/assignment history/);
    expect(await prisma.unitOwner.findUnique({ where: { id: b.id } })).not.toBeNull();

    // a only appears as fromOwnerId (SET NULL), so it can be deleted.
    const removed = await request(app).delete(`/api/owners/${a.id}`).set(auth(tokens.admin()));
    expect(removed.status).toBe(204);
    const firstMove = await prisma.unitAssignmentEvent.findFirst({ where: { unitId: unit.id, toOwnerId: b.id } });
    expect(firstMove.fromOwnerId).toBeNull();
  });
});

describe("A foreign-key failure while reassigning", () => {
  it("is reported as an unknown target owner (400), not a 500", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);
    // The target owner is deleted between the existence check and the write.
    const spy = vi.spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "P2003" }));
    try {
      const res = await assign(unit.id, { toOwnerId: b.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("toOwnerId does not reference an existing owner");
    } finally {
      spy.mockRestore();
    }
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });
});

describe("Editing a unit's owner through PATCH /api/units/:id", () => {
  const edit = (unitId, body, token) =>
    request(app).patch(`/api/units/${unitId}`).set(auth(token)).send(body);

  it("refuses a different ownerId for an officer and an admin (409): owner unchanged, no event written", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const b = await factory.owner({ name: "Bravo" });
    const unit = await factory.unit(a.id);

    for (const token of [tokens.officer(), tokens.admin()]) {
      const res = await edit(unit.id, { ownerId: b.id }, token);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Use Reassign owner to move a unit to another owner");
    }
    expect((await unitOf(unit.id)).ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });

  it("accepts the unchanged ownerId together with another field (the edit form re-sends it)", async () => {
    const a = await factory.owner({ name: "Alpha" });
    const unit = await factory.unit(a.id);

    const res = await edit(unit.id, { ownerId: a.id, floor: "7" }, tokens.officer());
    expect(res.status).toBe(200);
    expect(res.body.floor).toBe("7");
    const after = await unitOf(unit.id);
    expect(after.floor).toBe("7");
    expect(after.ownerId).toBe(a.id);
    expect(await eventsOf(unit.id)).toHaveLength(0);
  });
});
