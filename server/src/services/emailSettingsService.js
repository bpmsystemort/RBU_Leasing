import { prisma } from "../lib/prisma.js";

const ID = "singleton";

function envCfg() {
  return {
    enabled: !!process.env.MAIL_HOST,
    host: process.env.MAIL_HOST || null,
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === "true",
    fromAddress: process.env.MAIL_FROM || process.env.MAIL_USER || null,
    fromName: null,
  };
}

// Internal: carries user/pass — never expose directly to an API response.
// The DB row (when present) always wins for non-secret fields; the SMTP
// user/pass always come from env regardless of the row, per the
// "credentials never touch the DB" constraint. The EmailSettings row's `id`
// is a client-side Prisma default, not DB-enforced, so every lookup/write
// hard-codes `id: ID` rather than trusting a single row to exist.
export async function getEmailSettings() {
  const user = process.env.MAIL_USER || null;
  const pass = process.env.MAIL_PASS || null;
  let row = null;
  try {
    row = await prisma.emailSettings.findUnique({ where: { id: ID } });
  } catch {
    row = null;
  }
  if (!row) {
    const e = envCfg();
    return { ...e, user, pass, source: e.host ? "env" : "none" };
  }
  return {
    enabled: row.enabled,
    host: row.host || process.env.MAIL_HOST || null,
    port: row.port ?? Number(process.env.MAIL_PORT || 587),
    secure: row.secure,
    fromAddress: row.fromAddress || process.env.MAIL_FROM || user || null,
    fromName: row.fromName || null,
    user,
    pass,
    source: "db",
  };
}

// API-facing: non-secret only. Never include user/pass here — this is what
// the admin Email Settings page reads.
export async function getEmailStatus() {
  const c = await getEmailSettings();
  return {
    enabled: c.enabled,
    host: c.host,
    port: c.port,
    secure: c.secure,
    fromAddress: c.fromAddress,
    fromName: c.fromName,
    credentialsConfigured: !!(process.env.MAIL_USER && process.env.MAIL_PASS),
    source: c.source,
  };
}

export async function updateEmailSettings(data, actor) {
  const d = {
    enabled: !!data.enabled,
    host: data.host ?? null,
    port: data.port ?? 587,
    secure: !!data.secure,
    fromAddress: data.fromAddress ?? null,
    fromName: data.fromName ?? null,
    updatedById: actor?.userId ?? null,
    updatedByName: actor?.name ?? null,
  };
  await prisma.emailSettings.upsert({ where: { id: ID }, create: { id: ID, ...d }, update: d });
  return getEmailStatus();
}
