import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetCrudTables } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/authService.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

async function applicant(status = "PENDING") {
  return prisma.user.create({
    data: {
      name: "Applicant", email: `applicant.${status}@x.com`, contactEmail: "a@x.com",
      role: "UNIT_OWNER", status, passwordHash: await hashPassword("secret123"),
      pendingUnit: { unitNumber: "19A" },
    },
  });
}
async function signIn(email) {
  return request(app).post("/api/auth/login").send({ email, password: "secret123" });
}

describe("Restricted sessions", () => {
  it.each(["PENDING", "FOR_REVISION", "REJECTED"])("admits a %s account and reports its status", async (status) => {
    const u = await applicant(status);
    const res = await signIn(u.email);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.status).toBe(status);
  });

  it("refuses a restricted token on an ordinary protected route", async () => {
    const u = await applicant("PENDING");
    const { body } = await signIn(u.email);
    const res = await request(app).get("/api/units").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(403);
  });

  it("refuses a restricted token on the account queue too", async () => {
    const u = await applicant("PENDING");
    const { body } = await signIn(u.email);
    const res = await request(app).get("/api/auth/pending").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(403);
  });

  it("still admits an approved account everywhere", async () => {
    const u = await applicant("APPROVED");
    const { body } = await signIn(u.email);
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(200);
  });
});
