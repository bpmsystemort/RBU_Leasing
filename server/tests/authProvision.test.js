import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { SUPER_ADMIN_EMAIL } from "../src/services/authService.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

describe("admin provisions owner/tenant accounts", () => {
  it("creates a UNIT_OWNER linked to an owner", async () => {
    const o = await factory.owner({ name: "Ayala" });
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Owner One", email: "owner1@x.com", password: "pw123456", role: "UNIT_OWNER", unitOwnerId: o.id });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("UNIT_OWNER");
    expect(res.body.unitOwnerId).toBe(o.id);
  });

  it("rejects a UNIT_OWNER without a valid owner (400)", async () => {
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "X", email: "x@x.com", password: "pw123456", role: "UNIT_OWNER", unitOwnerId: "ghost" });
    expect(res.status).toBe(400);
  });

  it("creates a TENANT linked to a tenant", async () => {
    const t = await factory.tenant({ name: "Juan" });
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Tenant One", email: "tenant1@x.com", password: "pw123456", role: "TENANT", tenantId: t.id });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(t.id);
  });

  it("creates a plain login (no owner/tenant link needed)", async () => {
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER" });
    expect(res.status).toBe(201);
    expect(res.body.unitOwnerId).toBeNull();
    expect(res.body.tenantId).toBeNull();
  });

  it("creates a UNIT_OWNER with no link (credential only)", async () => {
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Owner No Link", email: "ownernolink", password: "pw123456", role: "UNIT_OWNER" });
    expect(res.status).toBe(201);
    expect(res.body.unitOwnerId).toBeNull();
  });

  it("an unlinked owner sees no units (not all)", async () => {
    const o = await factory.owner();
    await factory.unit(o.id);
    const res = await request(app).get("/api/units").set("Authorization", `Bearer ${tokens.owner()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("lists accounts for an admin, with no password of any kind", async () => {
    await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER" });
    const res = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(200);
    const created = res.body.find((u) => u.email === "frontdesk");
    expect(created).toMatchObject({ name: "Front Desk", role: "VIEWER" });
    for (const key of ["password", "passwordPlain", "passwordHash"]) expect(created[key]).toBeUndefined();
  });

  it("a reset password takes effect at sign-in", async () => {
    const u = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER" });
    await request(app).patch(`/api/auth/users/${u.body.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ password: "newpass123" });
    const res = await request(app).post("/api/auth/login").send({ email: "frontdesk", password: "newpass123" });
    expect(res.status).toBe(200);
  });

  it("a viewer cannot list credentials (403)", async () => {
    const res = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${tokens.viewer()}`);
    expect(res.status).toBe(403);
  });

  async function createLogin(over = {}) {
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER", ...over });
    return res.body;
  }

  it("edits a login's name and role", async () => {
    const u = await createLogin();
    const res = await request(app).patch(`/api/auth/users/${u.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Reception", role: "LEASING_OFFICER" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Reception", role: "LEASING_OFFICER" });
  });

  it("resets a login's password (can log in with the new one)", async () => {
    const u = await createLogin();
    await request(app).patch(`/api/auth/users/${u.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ password: "newpass123" });
    const login = await request(app).post("/api/auth/login").send({ email: "frontdesk", password: "newpass123" });
    expect(login.status).toBe(200);
  });

  // A reset is now the only way to recover access, so a too-short password has to
  // say why — "Validation failed" alone leaves the admin guessing.
  it("says how short a rejected password is, not just that validation failed", async () => {
    const u = await createLogin();
    const res = await request(app).patch(`/api/auth/users/${u.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ password: "abc12" });
    expect(res.status).toBe(400);
    expect(res.body.details[0]).toMatchObject({ path: "password", message: "Password must be at least 6 characters" });
  });

  it("deletes a login", async () => {
    const u = await createLogin();
    const del = await request(app).delete(`/api/auth/users/${u.id}`).set("Authorization", `Bearer ${tokens.admin()}`);
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${tokens.admin()}`);
    expect(list.body.find((x) => x.id === u.id)).toBeUndefined();
  });

  it("protects the super admin from deletion and demotion", async () => {
    const list = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${tokens.admin()}`);
    const superAdmin = list.body.find((x) => x.email === SUPER_ADMIN_EMAIL);
    expect(superAdmin).toBeTruthy();
    const del = await request(app).delete(`/api/auth/users/${superAdmin.id}`).set("Authorization", `Bearer ${tokens.admin()}`);
    expect(del.status).toBe(409);
    const demote = await request(app).patch(`/api/auth/users/${superAdmin.id}`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ role: "VIEWER" });
    expect(demote.status).toBe(409);
  });

  it("a viewer cannot register users (403)", async () => {
    const res = await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.viewer()}`)
      .send({ name: "X", email: "y@x.com", password: "pw123456" });
    expect(res.status).toBe(403);
  });
});
