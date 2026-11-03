// Verify the configured SMTP settings and (optionally) send a test invitation
// email. Usage:  node scripts/test-mail.js recipient@example.com
// Reads MAIL_* + PUBLIC_BASE_URL from server/.env (set by you — the password
// never leaves your machine). Exits non-zero if verify or send fails.
import "../src/env.js";
import { verifyMail, sendMail, inviteEmail } from "../src/lib/mailer.js";

const to = process.argv[2];

async function main() {
  if (!process.env.MAIL_HOST) {
    console.error("MAIL_HOST is not set in server/.env — SMTP is disabled (invites would log + show a copyable link). Add the MAIL_* settings and retry.");
    process.exit(2);
  }
  console.log(`Verifying SMTP: host=${process.env.MAIL_HOST} port=${process.env.MAIL_PORT || 587} secure=${process.env.MAIL_SECURE === "true"} user=${process.env.MAIL_USER || "(none)"}`);
  const v = await verifyMail();
  if (!v.ok) {
    console.error(`SMTP verify FAILED: ${v.error}`);
    console.error("Common causes (Outlook/personal MS accounts): use an App Password (not your normal password); the account must allow SMTP AUTH; MAIL_USER must match MAIL_FROM.");
    process.exit(3);
  }
  console.log("SMTP verify OK — connection + authentication succeeded.");

  if (!to) {
    console.log("No recipient given; skipping the test send. Pass an address to send a sample invite email: node scripts/test-mail.js you@example.com");
    process.exit(0);
  }
  const url = `${process.env.PUBLIC_BASE_URL || ""}/accept-invite?token=TEST-TOKEN-NOT-REAL`;
  const { html, text } = inviteEmail(url, "Test Owner");
  const res = await sendMail({ to, subject: "[RBU test] portal invitation (sample)", html, text });
  if (res.delivered) { console.log(`Test email delivered to ${to}. Check the inbox (and spam).`); process.exit(0); }
  console.error("Send reported NOT delivered — see the [mailer] error above.");
  process.exit(4);
}

main().catch((e) => { console.error(e); process.exit(1); });
