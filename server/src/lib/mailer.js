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
  await t.sendMail({ from, to, subject, html, text });
  return { delivered: true };
}

export function inviteEmail(acceptUrl, ownerName) {
  const subject = "Your RBU Leasing portal invitation";
  const text = `Hello ${ownerName || ""},\n\nYou've been invited to access the RBU Leasing owner portal. Set your password here (link expires in 7 days, single use):\n${acceptUrl}\n\nIf you didn't expect this, ignore this email.`;
  const html = `<p>Hello ${ownerName || ""},</p><p>You've been invited to access the RBU Leasing owner portal. Set your password using the link below (expires in 7 days, single use):</p><p><a href="${acceptUrl}">${acceptUrl}</a></p><p>If you didn't expect this, you can ignore this email.</p>`;
  return { subject, html, text };
}
