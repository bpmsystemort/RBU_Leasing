import { getEmailStatus, updateEmailSettings } from "../services/emailSettingsService.js";
import { verifyMail, sendMail } from "../lib/mailer.js";
import { emailSettingsSchema, testSchema } from "../validation/emailSettings.js";

export async function getEmail(req, res, next) {
  try {
    res.json(await getEmailStatus());
  } catch (e) { next(e); }
}

export async function putEmail(req, res, next) {
  try {
    res.json(await updateEmailSettings(emailSettingsSchema.parse(req.body), req.user));
  } catch (e) { next(e); }
}

export async function testEmail(req, res, next) {
  try {
    const { to } = testSchema.parse(req.body);
    const v = await verifyMail();
    if (!v.ok) return res.json({ ok: false, delivered: false, error: v.error });
    const r = await sendMail({
      to,
      subject: "[RBU] test email",
      text: "Test from RBU Leasing email settings.",
      html: "<p>Test from RBU Leasing email settings.</p>",
    });
    res.json({ ok: true, delivered: r.delivered });
  } catch (e) { next(e); }
}
