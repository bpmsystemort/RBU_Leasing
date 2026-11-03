import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens } from "./helpers.js";

// A password is something the system checks, not something it can tell you.
// Until now every account also kept a recoverable copy in User.passwordPlain, and
// an admin API returned it, so a database dump or a stolen admin session exposed
// every user's real password — owners' and tenants' included. These pin that no
// readable copy is stored, returned, or left behind when a password changes.
const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const admin = () => ({ Authorization: `Bearer ${tokens.admin()}` });
const rowFor = (email) => prisma.user.findUnique({ where: { email } });

describe("no readable password is kept", () => {
  it("when an admin creates a login", async () => {
    const res = await request(app).post("/api/auth/register").set(admin())
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "LEASING_OFFICER" });
    expect(res.status).toBe(201);
    expect((await rowFor("frontdesk")).passwordPlain).toBeNull();
    // and the hash still works: the person can sign in
    const login = await request(app).post("/api/auth/login").send({ email: "frontdesk", password: "pw123456" });
    expect(login.status).toBe(200);
  });

  it("when someone applies through the public sign-up", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      name: "New Lessee", email: "lessee.nopw", contactEmail: "lessee.nopw@x.com",
      password: "pw12345678", role: "TENANT", consent: true,
    });
    expect(res.status).toBe(201);
    expect((await rowFor("lessee.nopw")).passwordPlain).toBeNull();
  });

  // A copy left over from before this change must not survive a reset: it would
  // be wrong the moment the password changes, and still readable.
  it("and a reset clears any copy left from before", async () => {
    const created = await request(app).post("/api/auth/register").set(admin())
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "LEASING_OFFICER" });
    await prisma.user.update({ where: { id: created.body.id }, data: { passwordPlain: "pw123456" } }); // legacy row
    const reset = await request(app).patch(`/api/auth/users/${created.body.id}`).set(admin()).send({ password: "newpass123" });
    expect(reset.status).toBe(200);
    expect((await rowFor("frontdesk")).passwordPlain).toBeNull();
  });
});

describe("an admin reset is what replaces the reveal", () => {
  it("the new password signs in and the old one no longer does", async () => {
    const created = await request(app).post("/api/auth/register").set(admin())
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "LEASING_OFFICER" });
    await request(app).patch(`/api/auth/users/${created.body.id}`).set(admin()).send({ password: "newpass123" });
    expect((await request(app).post("/api/auth/login").send({ email: "frontdesk", password: "newpass123" })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: "frontdesk", password: "pw123456" })).status).toBe(401);
  });
});

describe("the account list", () => {
  it("never returns a password, even when a legacy copy still sits in the database", async () => {
    const created = await request(app).post("/api/auth/register").set(admin())
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "LEASING_OFFICER" });
    await prisma.user.update({ where: { id: created.body.id }, data: { passwordPlain: "leftover-secret" } });
    const res = await request(app).get("/api/auth/users").set(admin());
    expect(res.status).toBe(200);
    const row = res.body.find((u) => u.email === "frontdesk");
    expect(row).toBeDefined();
    for (const key of ["password", "passwordPlain", "passwordHash"]) expect(row[key]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("leftover-secret");
  });
});
