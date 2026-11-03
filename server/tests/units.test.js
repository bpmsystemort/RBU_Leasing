import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

describe("Units CRUD", () => {
  it("officer creates a unit for an existing owner", async () => {
    const owner = await factory.owner();
    const res = await request(app).post("/api/units")
      .set("Authorization", `Bearer ${tokens.officer()}`)
      .send({ ownerId: owner.id, unitNumber: "12A", type: "TWO_BR", baseRent: 45000 });
    expect(res.status).toBe(201);
    expect(res.body.unitNumber).toBe("12A");
    expect(Number(res.body.baseRent)).toBe(45000);
  });

  it("rejects a unit with a non-existent owner (400)", async () => {
    const res = await request(app).post("/api/units")
      .set("Authorization", `Bearer ${tokens.officer()}`)
      .send({ ownerId: "ghost", unitNumber: "1", baseRent: 1000 });
    expect(res.status).toBe(400);
  });

  it("rejects invalid input (400)", async () => {
    const owner = await factory.owner();
    const res = await request(app).post("/api/units")
      .set("Authorization", `Bearer ${tokens.officer()}`)
      .send({ ownerId: owner.id });
    expect(res.status).toBe(400);
  });

  it("filters units by ownerId", async () => {
    const a = await factory.owner({ name: "A" });
    const b = await factory.owner({ name: "B" });
    await factory.unit(a.id, { unitNumber: "A1" });
    await factory.unit(b.id, { unitNumber: "B1" });
    const res = await request(app).get(`/api/units?ownerId=${a.id}`)
      .set("Authorization", `Bearer ${tokens.viewer()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].unitNumber).toBe("A1");
  });

  it("filters units by needsStatusReview (import v2's unresolved-status flag)", async () => {
    const owner = await factory.owner();
    const flagged = await factory.unit(owner.id, { unitNumber: "F1" });
    await factory.unit(owner.id, { unitNumber: "N1" });
    await prisma.unit.update({ where: { id: flagged.id }, data: { needsStatusReview: true } });
    const res = await request(app).get("/api/units?needsStatusReview=true")
      .set("Authorization", `Bearer ${tokens.viewer()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].unitNumber).toBe("F1");
  });

  it("viewer cannot create (403)", async () => {
    const owner = await factory.owner();
    const res = await request(app).post("/api/units")
      .set("Authorization", `Bearer ${tokens.viewer()}`)
      .send({ ownerId: owner.id, unitNumber: "1", baseRent: 1000 });
    expect(res.status).toBe(403);
  });

  it("blocks delete when unit has leases (409)", async () => {
    const owner = await factory.owner();
    const unit = await factory.unit(owner.id);
    const tenant = await factory.tenant();
    await factory.lease(unit.id, tenant.id);
    const res = await request(app).delete(`/api/units/${unit.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(409);
  });
});
