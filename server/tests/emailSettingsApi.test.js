import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// The mailer is mocked at the module level (not just the service's env/DB
// inputs) so this file never opens a real SMTP connection or sends a real
// email, and so the /test endpoint's { ok, delivered } response is
// deterministic regardless of server/.env.test. This has to live in its own
// file: emailSettings.test.js (Task 2) imports the REAL sendMail and asserts
// on its genuine no-SMTP-configured fallback ({ delivered:false }) — a
// top-level vi.mock of "../src/lib/mailer.js" there would hijack those
// assertions too and make them pass for the wrong reason (a mock returning
// delivered:true unconditionally, not the real disabled-mail code path).
vi.mock("../src/lib/mailer.js", () => ({
  verifyMail: vi.fn(() => Promise.resolve({ ok: true })),
  sendMail: vi.fn(() => Promise.resolve({ delivered: true })),
  inviteEmail: vi.fn(() => ({ subject: "", html: "", text: "" })),
}));

import { createApp } from "../src/app.js";
import { resetCrudTables, tokens } from "./helpers.js";
import { verifyMail, sendMail } from "../src/lib/mailer.js";

const app = createApp();

const validBody = {
  enabled: true,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  fromAddress: "noreply@example.com",
  fromName: "RBU Leasing",
};

describe("admin email settings API", () => {
  beforeEach(async () => {
    await resetCrudTables(); // also clears the EmailSettings singleton row
    verifyMail.mockClear();
    sendMail.mockClear();
  });

  describe("GET /api/settings/email", () => {
    it("ADMIN gets the status shape with no pass/user", async () => {
      const res = await request(app)
        .get("/api/settings/email")
        .set("Authorization", `Bearer ${tokens.admin()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          enabled: expect.any(Boolean),
          credentialsConfigured: expect.any(Boolean),
          source: expect.any(String),
        }),
      );
      expect(res.body).toHaveProperty("host");
      expect(res.body).toHaveProperty("port");
      expect(res.body).toHaveProperty("secure");
      expect(res.body).toHaveProperty("fromAddress");
      expect(res.body).toHaveProperty("fromName");
      expect(res.body).not.toHaveProperty("pass");
      expect(res.body).not.toHaveProperty("user");
    });

    it("a non-admin (VIEWER) token gets 403", async () => {
      const res = await request(app)
        .get("/api/settings/email")
        .set("Authorization", `Bearer ${tokens.viewer()}`);
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/settings/email", () => {
    it("ADMIN updates settings and a follow-up GET reflects the saved values", async () => {
      const putRes = await request(app)
        .put("/api/settings/email")
        .set("Authorization", `Bearer ${tokens.admin()}`)
        .send(validBody);

      expect(putRes.status).toBe(200);
      expect(putRes.body).not.toHaveProperty("pass");
      expect(putRes.body).not.toHaveProperty("user");

      const getRes = await request(app)
        .get("/api/settings/email")
        .set("Authorization", `Bearer ${tokens.admin()}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        enabled: true,
        host: "smtp.example.com",
        port: 587,
        secure: false,
        fromAddress: "noreply@example.com",
        fromName: "RBU Leasing",
        source: "db",
      });
    });

    it("a non-admin (VIEWER) token gets 403", async () => {
      const res = await request(app)
        .put("/api/settings/email")
        .set("Authorization", `Bearer ${tokens.viewer()}`)
        .send(validBody);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/settings/email/test", () => {
    it("ADMIN with {to} gets 200 { ok:true, delivered:true } (mailer mocked, no real send)", async () => {
      const res = await request(app)
        .post("/api/settings/email/test")
        .set("Authorization", `Bearer ${tokens.admin()}`)
        .send({ to: "someone@example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, delivered: true });
      expect(verifyMail).toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "someone@example.com", subject: "[RBU] test email" }),
      );
    });

    it("a non-admin (VIEWER) token gets 403", async () => {
      const res = await request(app)
        .post("/api/settings/email/test")
        .set("Authorization", `Bearer ${tokens.viewer()}`)
        .send({ to: "someone@example.com" });
      expect(res.status).toBe(403);
    });
  });
});
