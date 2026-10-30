import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendMail, inviteEmail, verifyMail } from "../src/lib/mailer.js";
import { prisma } from "../src/lib/prisma.js";

describe("mailer", () => {
  // This suite must never attempt a real SMTP connection. Save/restore
  // MAIL_HOST around each test so the no-SMTP log-fallback path is exercised
  // regardless of what the surrounding environment happens to have set.
  const savedMailHost = process.env.MAIL_HOST;

  beforeEach(async () => {
    delete process.env.MAIL_HOST;
    // This file doesn't call resetCrudTables(), so clear the singleton row
    // directly — a leftover row from another test file would otherwise let
    // the mailer read a DB config instead of exercising the no-config path.
    await prisma.emailSettings.deleteMany();
  });

  afterEach(() => {
    if (savedMailHost === undefined) delete process.env.MAIL_HOST;
    else process.env.MAIL_HOST = savedMailHost;
  });

  it("sendMail resolves { delivered:false } and does not throw when MAIL_HOST is unset", async () => {
    await expect(
      sendMail({ to: "a@b.com", subject: "x", text: "y" }),
    ).resolves.toEqual({ delivered: false });
  });

  it("verifyMail returns { ok:false } without connecting when MAIL_HOST is unset", async () => {
    const r = await verifyMail();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not set|not configured/i);
  });

  it("inviteEmail returns a subject and a body containing the accept URL", () => {
    const url = "https://x/accept-invite?token=T";
    const { subject, html, text } = inviteEmail(url, "Jane");
    expect(typeof subject).toBe("string");
    expect(subject.length).toBeGreaterThan(0);
    expect(html).toContain(url);
    expect(text).toContain(url);
    expect(html).toContain("Jane");
    expect(text).toContain("Jane");
  });

  // ownerName comes from UnitOwner.name, which an officer can type freely —
  // it must not be interpolated into the HTML body unescaped.
  it("HTML-escapes ownerName in the html body, but leaves the plain-text version untouched", () => {
    const url = "https://x/accept?token=T";
    const { html, text } = inviteEmail(url, "<b>Jane</b>");
    expect(html).not.toContain("<b>Jane</b>");
    expect(html).toContain("&lt;b&gt;Jane&lt;/b&gt;");
    expect(html).toContain(url);
    expect(text).toContain("<b>Jane</b>");
  });
});
