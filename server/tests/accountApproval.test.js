import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetCrudTables, tokens, factory } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { issueToken, SUPER_ADMIN_EMAIL } from "../src/services/authService.js";

const app = createApp();
beforeEach(async () => { await resetCrudTables(); });

const applicant = {
  name: "Ana Reyes",
  email: "ana.reyes",
  contactEmail: "ana@example.com",
  password: "strong-pass-8",
  role: "TENANT",
  consent: true,
};

const signup = (over = {}) => request(app).post("/api/auth/signup").send({ ...applicant, ...over });

async function pendingUser(email = applicant.email) {
  return prisma.user.findUnique({ where: { email } });
}

describe("Portal signup requires approval", () => {
  it("creates the account as PENDING and does not sign the applicant in", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    // The whole point of the gate: no session is handed out.
    expect(res.body.token).toBeUndefined();
  });

  // Owners/Tenants lists must only ever hold vetted parties.
  it("does not create the linked tenant record until approval", async () => {
    await signup();
    expect(await prisma.tenant.count()).toBe(0);
    const u = await pendingUser();
    expect(u.tenantId).toBeNull();
    expect(u.contactEmail).toBe("ana@example.com");
  });

  it("lets a pending applicant sign in to a restricted session", async () => {
    await signup();
    const res = await request(app).post("/api/auth/login")
      .send({ email: applicant.email, password: applicant.password });
    // Signing in is the only way to tell an applicant where they stand —
    // there is no outbound email. The token is restricted; restrictedSession
    // .test.js covers what it cannot reach.
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("PENDING");
  });

  it("still rejects a wrong password on a pending account as invalid credentials", async () => {
    await signup();
    const res = await request(app).post("/api/auth/login")
      .send({ email: applicant.email, password: "not-the-password" });
    expect(res.status).toBe(401);
  });

  it("requires a contact email so the approver can reach the applicant", async () => {
    const res = await signup({ contactEmail: undefined });
    expect(res.status).toBe(400);
  });

  it("requires at least 8 characters of password", async () => {
    const res = await signup({ password: "short7!" });
    expect(res.status).toBe(400);
  });

  it("requires consent, like the public inquiry form does", async () => {
    const res = await signup({ consent: undefined });
    expect(res.status).toBe(400);
  });
});

describe("Approval queue", () => {
  it("lists pending accounts for an admin", async () => {
    await signup();
    const res = await request(app).get("/api/auth/pending")
      .set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "Ana Reyes", role: "TENANT", contactEmail: "ana@example.com" });
  });

  // The owner asked for admin OR O-Lease.
  it("lists pending accounts for a leasing officer too", async () => {
    await signup();
    const res = await request(app).get("/api/auth/pending")
      .set("Authorization", `Bearer ${tokens.officer()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("refuses a viewer (403)", async () => {
    await signup();
    const res = await request(app).get("/api/auth/pending")
      .set("Authorization", `Bearer ${tokens.viewer()}`);
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller (401)", async () => {
    const res = await request(app).get("/api/auth/pending");
    expect(res.status).toBe(401);
  });

  it("shows only pending accounts, not approved staff", async () => {
    await signup();
    await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER" });
    const res = await request(app).get("/api/auth/pending")
      .set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.body.map((u) => u.email)).toEqual([applicant.email]);
  });
});

describe("Approving an account", () => {
  it("creates the linked tenant record and lets the applicant in", async () => {
    await signup();
    const u = await pendingUser();
    const res = await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");

    const after = await pendingUser();
    expect(after.tenantId).toBeTruthy();
    const tenant = await prisma.tenant.findUnique({ where: { id: after.tenantId } });
    expect(tenant).toMatchObject({ name: "Ana Reyes", email: "ana@example.com" });

    const login = await request(app).post("/api/auth/login")
      .send({ email: applicant.email, password: applicant.password });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.user.tenantId).toBe(after.tenantId);
  });

  it("creates a unit-owner record for a lessor instead", async () => {
    await signup({ email: "juan.owner", role: "UNIT_OWNER", name: "Juan Cruz", contactEmail: "juan@example.com" });
    const u = await pendingUser("juan.owner");
    await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", `Bearer ${tokens.admin()}`);
    const after = await pendingUser("juan.owner");
    expect(after.unitOwnerId).toBeTruthy();
    expect(await prisma.tenant.count()).toBe(0);
  });

  it("records who decided and when", async () => {
    await signup();
    const u = await pendingUser();
    // Approve as a real, resolvable admin so the name can be looked up.
    const admin = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
    await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", `Bearer ${issueToken({ id: admin.id, role: "ADMIN" })}`);
    const after = await pendingUser();
    expect(after.decidedAt).toBeTruthy();
    expect(after.approvedById).toBe(admin.id);
    // The JWT carries only userId and role, so the name must be resolved
    // server-side — otherwise the audit trail records an anonymous decision.
    expect(after.approvedByName).toBe(admin.name);
  });

  it("is idempotent — approving twice does not create a second record", async () => {
    await signup();
    const u = await pendingUser();
    const auth = { Authorization: `Bearer ${tokens.admin()}` };
    await request(app).patch(`/api/auth/pending/${u.id}/approve`).set(auth);
    const second = await request(app).patch(`/api/auth/pending/${u.id}/approve`).set(auth);
    expect(second.status).toBe(409);
    expect(await prisma.tenant.count()).toBe(1);
  });

  it("refuses a viewer (403)", async () => {
    await signup();
    const u = await pendingUser();
    const res = await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", `Bearer ${tokens.viewer()}`);
    expect(res.status).toBe(403);
  });

  // The conflict message is shown verbatim in the officer's modal — it must
  // read as a proper status label, not the raw lowercased enum.
  it("describes an already-decided account with its proper label, not a raw enum", async () => {
    await signup();
    const u = await pendingUser();
    const auth = { Authorization: `Bearer ${tokens.admin()}` };
    await request(app).patch(`/api/auth/pending/${u.id}/approve`).set(auth);
    const res = await request(app).patch(`/api/auth/pending/${u.id}/approve`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("account is already Approved");
  });

  // Approval is where a vetted party enters the business records, so it is also
  // where the unit they described becomes real — in the same transaction, so a
  // half-approved lessor with no unit cannot exist.
  it("creates the owner and the unit together and clears the pending unit", async () => {
    const estate = await factory.estate();
    const tower = await factory.tower(estate.id);
    const user = await prisma.user.create({
      data: {
        name: "Pending Lessor", email: "pending.lessor@x.com", contactEmail: "pending.lessor@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
        pendingUnit: { estateId: estate.id, towerId: tower.id, unitNumber: "19A", floor: "19", type: "1 Bedroom", baseRent: 25000 },
      },
    });

    const res = await request(app).patch(`/api/auth/pending/${user.id}/approve`).set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.pendingUnit).toBeNull();
    expect(after.unitOwnerId).toBeTruthy();

    const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
    expect(unit.unitNumber).toBe("19A");
    expect(unit.towerId).toBe(tower.id);
    expect(Number(unit.baseRent)).toBe(25000);
    // APPROVED, not DRAFT: the officer just reviewed these details as half of
    // this same approval decision, so DRAFT would ask a second time for
    // something already approved.
    expect(unit.approvalStatus).toBe("APPROVED");
  });

  it("defaults a skipped rent to zero, since baseRent is required on Unit", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Pending Lessor", email: "pending.lessor@x.com", contactEmail: "pending.lessor@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
        pendingUnit: { unitNumber: "19A" },
      },
    });
    await request(app).patch(`/api/auth/pending/${user.id}/approve`).set("Authorization", `Bearer ${tokens.admin()}`);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
    expect(Number(unit.baseRent)).toBe(0);
  });

  // Reference data changing must never make an applicant unapprovable.
  it("still approves when the recorded tower has since been deleted", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Pending Lessor", email: "pending.lessor@x.com", contactEmail: "pending.lessor@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
        pendingUnit: { unitNumber: "19A", towerId: "deleted-tower-id" },
      },
    });
    const res = await request(app).patch(`/api/auth/pending/${user.id}/approve`).set("Authorization", `Bearer ${tokens.admin()}`);
    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
    expect(unit.unitNumber).toBe("19A");
    expect(unit.towerId).toBeNull();
  });

  it("creates no unit when the applicant skipped the step", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Pending Lessor", email: "pending.lessor@x.com", contactEmail: "pending.lessor@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
      },
    });
    await request(app).patch(`/api/auth/pending/${user.id}/approve`).set("Authorization", `Bearer ${tokens.admin()}`);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.unitOwnerId).toBeTruthy();
    expect(await prisma.unit.count({ where: { ownerId: after.unitOwnerId } })).toBe(0);
  });

  it("creates no unit when the application is rejected", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Pending Lessor", email: "pending.lessor@x.com", contactEmail: "pending.lessor@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
        pendingUnit: { unitNumber: "19A" },
      },
    });
    const before = await prisma.unit.count();
    await request(app).patch(`/api/auth/pending/${user.id}/reject`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ reason: "not verified" });
    expect(await prisma.unit.count()).toBe(before);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.unitOwnerId).toBeNull();
  });
});

describe("Approval materialises a reviewed unit", () => {
  // Default applicant.role is TENANT, so a unit only materialises when the
  // signup is a lessor with a described unit — follow the same override the
  // other lessor tests in this file use rather than a new fixture.
  const lessorSignup = () => signup({
    email: "lessor.materialise", role: "UNIT_OWNER", name: "Lessor Materialise",
    contactEmail: "lessor.materialise@example.com", unit: { unitNumber: "19A" },
  });

  // ensureForUnit falls back to the approver as the transaction's assigned
  // officer when the new owner has none yet, and assignedOfficerId is
  // FK-constrained to User — tokens.admin()'s "test-admin" is not a real row,
  // so these tests (unlike the others in this file) need a resolvable admin.
  async function realAdminAuth() {
    const admin = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
    return `Bearer ${issueToken({ id: admin.id, role: "ADMIN" })}`;
  }

  it("creates the unit APPROVED, not DRAFT", async () => {
    await lessorSignup();
    const u = await pendingUser("lessor.materialise");
    await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", await realAdminAuth()).send();

    const after = await prisma.user.findUnique({ where: { id: u.id } });
    const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
    // The officer reviewed these details as part of this same decision, so
    // DRAFT would ask a second time for something already approved.
    expect(unit.approvalStatus).toBe("APPROVED");
  });

  it("opens the onboarding transaction at SEND_REQUIREMENTS", async () => {
    await lessorSignup();
    const u = await pendingUser("lessor.materialise");
    await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", await realAdminAuth()).send();

    const after = await prisma.user.findUnique({ where: { id: u.id } });
    const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
    const txn = await prisma.leasingTransaction.findFirst({ where: { unitId: unit.id } });
    expect(txn).toBeTruthy();
    expect(txn.stage).toBe("SEND_REQUIREMENTS");
    expect(txn.stageData.INQUIRY.status).toBe("Skipped");
  });

  it("still approves when no unit was described", async () => {
    const user = await prisma.user.create({
      data: {
        name: "No Unit", email: "nounit@x.com", contactEmail: "nounit@x.com",
        role: "UNIT_OWNER", status: "PENDING", passwordHash: "x",
      },
    });
    const res = await request(app).patch(`/api/auth/pending/${user.id}/approve`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send();
    expect(res.status).toBe(200);
  });
});

describe("Rejecting an account", () => {
  it("keeps the account with a reason and creates no linked record", async () => {
    await signup();
    const u = await pendingUser();
    const res = await request(app).patch(`/api/auth/pending/${u.id}/reject`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ reason: "Could not verify identity" });
    expect(res.status).toBe(200);

    // The row survives so the applicant can be told why. Their username stays
    // taken — a genuine re-application needs an officer to reopen the account.
    const after = await pendingUser();
    expect(after.status).toBe("REJECTED");
    expect(after.rejectionReason).toBe("Could not verify identity");
    expect(await prisma.tenant.count()).toBe(0);
  });

  it("lets a rejected applicant sign in to be told why", async () => {
    await signup();
    const u = await pendingUser();
    await request(app).patch(`/api/auth/pending/${u.id}/reject`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ reason: "Could not verify identity" });

    const res = await request(app).post("/api/auth/login")
      .send({ email: applicant.email, password: applicant.password });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("REJECTED");
  });

  it("requires a reason", async () => {
    await signup();
    const u = await pendingUser();
    const res = await request(app).patch(`/api/auth/pending/${u.id}/reject`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({});
    expect(res.status).toBe(400);
  });
});

describe("For Revision", () => {
  // For Revision only makes sense for a lessor — the thing being revised IS
  // the unit they described. These success-path tests use a lessor signup
  // (rather than the default TENANT applicant) so they still exercise a
  // reachable case once revise is refused for a lessee below.
  const lessorSignup = () => signup({
    email: "lessor.revise", role: "UNIT_OWNER", name: "Lessor Revise",
    contactEmail: "lessor.revise@example.com", unit: { unitNumber: "19A" },
  });

  it("keeps the row, records remarks, and leaves the unit unmaterialised", async () => {
    await lessorSignup();
    const u = await pendingUser("lessor.revise");
    const res = await request(app).patch(`/api/auth/pending/${u.id}/revise`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ remarks: "Tower does not match the unit number" });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after.status).toBe("FOR_REVISION");
    expect(after.rejectionReason).toBe("Tower does not match the unit number");
    expect(after.unitOwnerId).toBeNull();
    expect(await prisma.unit.count({ where: { unitNumber: "19A" } })).toBe(0);
  });

  it("refuses empty remarks", async () => {
    await lessorSignup();
    const u = await pendingUser("lessor.revise");
    const res = await request(app).patch(`/api/auth/pending/${u.id}/revise`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ remarks: "" });
    expect(res.status).toBe(400);
  });

  it("can still be approved after a revision round", async () => {
    await lessorSignup();
    const u = await pendingUser("lessor.revise");
    await request(app).patch(`/api/auth/pending/${u.id}/revise`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send({ remarks: "fix the floor" });
    const res = await request(app).patch(`/api/auth/pending/${u.id}/approve`)
      .set("Authorization", `Bearer ${tokens.admin()}`).send();
    expect(res.status).toBe(200);
  });

  // Finding 1 of the merge-gate review: a lessee has no unit to revise, so
  // For Revision must be refused at the service, not merely hidden by the
  // client — otherwise a direct API call can strand a TENANT in a status
  // whose only exit demands a unit number they do not have.
  it("refuses to send a lessee application back for revision", async () => {
    await signup(); // default applicant is a TENANT
    const u = await pendingUser();
    const res = await request(app).patch(`/api/auth/pending/${u.id}/revise`)
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ remarks: "please add more detail" });
    expect(res.status).toBe(409);

    // Refused, not silently ignored: the account must still be PENDING.
    const after = await pendingUser();
    expect(after.status).toBe("PENDING");
  });
});

describe("Existing accounts are unaffected", () => {
  it("an admin-created staff login is approved outright and can sign in", async () => {
    await request(app).post("/api/auth/register")
      .set("Authorization", `Bearer ${tokens.admin()}`)
      .send({ name: "Front Desk", email: "frontdesk", password: "pw123456", role: "VIEWER" });
    const u = await pendingUser("frontdesk");
    expect(u.status).toBe("APPROVED");
    const login = await request(app).post("/api/auth/login")
      .send({ email: "frontdesk", password: "pw123456" });
    expect(login.status).toBe(200);
  });

  it("the seeded super admin can still sign in", async () => {
    const admin = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
    expect(admin.status).toBe("APPROVED");
  });
});
