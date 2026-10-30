import { createRequire } from "module";
const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer");

function transport() {
  if (process.env.MAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT || 587),
      secure: process.env.MAIL_SECURE === "true",
      auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
    });
  }
  return null; // no SMTP configured
}

export async function sendMail({ to, subject, html, text }) {
  const t = transport();
  const from = process.env.MAIL_FROM || "RBU Leasing <no-reply@rbu.local>";
  if (!t) { console.log(`[mailer] SMTP not configured — not sending to ${to}: ${subject}`); return { delivered: false }; }
  try {
    await t.sendMail({ from, to, subject, html, text });
    return { delivered: true };
  } catch (err) {
    // A configured-but-failing SMTP server must degrade to "not delivered"
    // rather than throw: the caller (e.g. createInvite) has already
    // committed the invite row, and the officer still gets the copyable
    // acceptUrl back either way. Never log err beyond .message — it may
    // carry transport details (host/auth) we don't want in logs.
    console.error(`[mailer] send failed to ${to}: ${err.message}`);
    return { delivered: false };
  }
}

// Verify the configured SMTP connection + auth WITHOUT sending a message.
// Returns { ok } on success or { ok:false, error } otherwise. Used by
// scripts/test-mail.js so an operator can confirm MAIL_* credentials.
export async function verifyMail() {
  const t = transport();
  if (!t) return { ok: false, error: "MAIL_HOST not set — SMTP is not configured" };
  try { await t.verify(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}

// ownerName is a free-text UnitOwner.name an officer can set to anything, so
// it must never be interpolated into the HTML body unescaped.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inviteEmail(acceptUrl, ownerName) {
  const subject = "Your RBU Leasing portal invitation";
  // Plain text has no markup to break out of — left as-is.
  const text = `Hello ${ownerName || ""},\n\nYou've been invited to access the RBU Leasing owner portal. Set your password here (link expires in 7 days, single use):\n${acceptUrl}\n\nIf you didn't expect this, ignore this email.`;
  const safeName = escapeHtml(ownerName || "");
  // The href attribute carries the server-built acceptUrl verbatim; the
  // visible link text is escaped defensively too.
  const html = `<p>Hello ${safeName},</p><p>You've been invited to access the RBU Leasing owner portal. Set your password using the link below (expires in 7 days, single use):</p><p><a href="${acceptUrl}">${escapeHtml(acceptUrl)}</a></p><p>If you didn't expect this, you can ignore this email.</p>`;
  return { subject, html, text };
}
