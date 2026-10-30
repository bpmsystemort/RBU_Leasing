import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetCrudTables } from "./helpers.js";
import { getEmailSettings, getEmailStatus, updateEmailSettings } from "../src/services/emailSettingsService.js";
import { sendMail } from "../src/lib/mailer.js";

// Every field the service reads from env. Saved/restored per test so these
// assertions are deterministic regardless of what server/.env has configured
// for Dev (which may carry real MAIL_USER/MAIL_PASS values).
const MAIL_VARS = ["MAIL_HOST", "MAIL_PORT", "MAIL_SECURE", "MAIL_FROM", "MAIL_USER", "MAIL_PASS"];

describe("emailSettingsService", () => {
  const saved = {};

  beforeEach(async () => {
    await resetCrudTables(); // clears EmailSettings too — see helpers.js
    for (const k of MAIL_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of MAIL_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("no DB row + MAIL_HOST unset: source is none, disabled, and status exposes no credentials", async () => {
    const cfg = await getEmailSettings();
    expect(cfg.source).toBe("none");
    expect(cfg.enabled).toBe(false);

    const status = await getEmailStatus();
    expect(status).not.toHaveProperty("pass");
    expect(status).not.toHaveProperty("user");
    expect(status.credentialsConfigured).toBe(false);
  });

  it("MAIL_HOST/MAIL_USER/MAIL_PASS env set + no DB row: source is env, pass comes from env, status still omits pass", async () => {
    process.env.MAIL_HOST = "smtp.example.com";
    process.env.MAIL_USER = "bot@example.com";
    process.env.MAIL_PASS = "s3cr3t";

    const cfg = await getEmailSettings();
    expect(cfg.source).toBe("env");
    expect(cfg.host).toBe("smtp.example.com");
    expect(cfg.user).toBe("bot@example.com");
    expect(cfg.pass).toBe("s3cr3t");

    const status = await getEmailStatus();
    expect(status).not.toHaveProperty("pass");
    expect(status).not.toHaveProperty("user");
    expect(status.credentialsConfigured).toBe(true);
    expect(status.source).toBe("env");
  });

  it("updateEmailSettings persists non-secret fields; a later getEmailSettings reads them back with source db, with user/pass still from env", async () => {
    process.env.MAIL_USER = "bot@example.com";
    process.env.MAIL_PASS = "s3cr3t";

    const result = await updateEmailSettings(
      { enabled: true, host: "smtp.x", port: 25, secure: false, fromAddress: "a@b.com", fromName: "RBU" },
      { userId: "u", name: "N" },
    );
    // updateEmailSettings returns getEmailStatus() — never exposes credentials.
    expect(result).not.toHaveProperty("pass");
    expect(result).not.toHaveProperty("user");
    expect(result.source).toBe("db");

    const cfg = await getEmailSettings();
    expect(cfg.source).toBe("db");
    expect(cfg.enabled).toBe(true);
    expect(cfg.host).toBe("smtp.x");
    expect(cfg.port).toBe(25);
    expect(cfg.secure).toBe(false);
    expect(cfg.fromAddress).toBe("a@b.com");
    expect(cfg.fromName).toBe("RBU");
    // Secrets are never persisted to the DB row — still sourced from env.
    expect(cfg.user).toBe("bot@example.com");
    expect(cfg.pass).toBe("s3cr3t");

    const status = await getEmailStatus();
    expect(status).not.toHaveProperty("pass");
    expect(status).not.toHaveProperty("user");

    const row = await prisma.emailSettings.findUnique({ where: { id: "singleton" } });
    expect(row).toMatchObject({
      enabled: true,
      host: "smtp.x",
      port: 25,
      secure: false,
      fromAddress: "a@b.com",
      fromName: "RBU",
      updatedById: "u",
      updatedByName: "N",
    });
  });

  it("mailer.sendMail with a DB row enabled:false resolves { delivered:false } and does not throw", async () => {
    await updateEmailSettings(
      { enabled: false, host: "smtp.x", port: 25, secure: false, fromAddress: "a@b.com", fromName: "RBU" },
      { userId: "u", name: "N" },
    );
    await expect(
      sendMail({ to: "a@b.com", subject: "x", text: "y" }),
    ).resolves.toEqual({ delivered: false });
  });

  // No-auth support: an SMTP host that needs no login must not get
  // fabricated credentials from the service.
  it("DB row enabled:true with a host, but no env MAIL_USER: getEmailSettings().user is null (no fabricated credentials)", async () => {
    await updateEmailSettings(
      { enabled: true, host: "x", port: 25, secure: false, fromAddress: "a@b.com", fromName: "RBU" },
      { userId: "u", name: "N" },
    );
    const cfg = await getEmailSettings();
    expect(cfg.user).toBeNull();
    expect(cfg.pass).toBeNull();
  });
});
