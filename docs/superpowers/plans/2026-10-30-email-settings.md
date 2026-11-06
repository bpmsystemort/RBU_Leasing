# Configurable Email Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An ADMIN-managed Email Settings page (enable/disable, host, port, security, From address/name) stored in a singleton DB row, with a send-test + status, while `MAIL_USER`/`MAIL_PASS` stay in `server/.env` and never touch the DB. Backward compatible: no DB row → pure env config (today's behavior).

**Architecture:** `emailSettingsService` computes the effective config = DB row (non-secret) merged over env, with credentials always from env; the `mailer` reads it per send (no restart needed). Admin API (GET/PUT/test) + a Vue page. Credentials never in DB/API/logs.

**Tech Stack:** Node/Express + Prisma + nodemailer; Vue 3 + Vitest.

## Global Constraints
- Branch `feat/email-settings` (off `feat/owner-accounts`). Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Manual-SQL migration to BOTH DBs + `prisma generate` (never `migrate dev`/`db push`). Controller stops the :5050 server before `prisma generate`.
- **No new packages.** **The SMTP password/user must never be stored in the DB, returned by any API, or logged.**
- Backward compatible: with no DB row and `MAIL_HOST` env set, email behaves exactly as today.
- Reuse existing error classes + `verifyJwt`/`requireRole` + the `rateLimit` middleware.

## File Structure
Server: create `prisma/manual-migrations/2026-10-30-email-settings.sql`, `src/services/emailSettingsService.js`, `src/controllers/settingsController.js`, `src/routes/settingsRoutes.js`, `src/validation/emailSettings.js`; modify `prisma/schema.prisma`, `src/lib/mailer.js`, `src/app.js`, `tests/helpers.js`, `tests/mailer.test.js`. Tests: `tests/emailSettings.test.js`.
Client: create `src/views/EmailSettingsView.vue`; modify `src/lib/resource.js`, `src/router/index.js`, `src/components/AppLayout.vue`. Test: `tests/EmailSettingsView.test.js`.

---

## Task 1: Migration — EmailSettings singleton
**Files:** modify `server/prisma/schema.prisma`; create `server/prisma/manual-migrations/2026-10-30-email-settings.sql`.
**Interfaces:** Produces `model EmailSettings { id, enabled, host?, port, secure, fromAddress?, fromName?, updatedById?, updatedByName?, updatedAt }`. Consumed by Task 2.

- [ ] **Step 1 — schema** add to `schema.prisma`:
```prisma
model EmailSettings {
  id            String   @id @default("singleton")
  enabled       Boolean  @default(false)
  host          String?
  port          Int      @default(587)
  secure        Boolean  @default(false)
  fromAddress   String?
  fromName      String?
  updatedById   String?
  updatedByName String?
  updatedAt     DateTime @updatedAt
}
```
- [ ] **Step 2 — SQL** `2026-10-30-email-settings.sql`:
```sql
CREATE TABLE IF NOT EXISTS "EmailSettings" (
  "id" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "host" TEXT,
  "port" INTEGER NOT NULL DEFAULT 587,
  "secure" BOOLEAN NOT NULL DEFAULT false,
  "fromAddress" TEXT,
  "fromName" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
- [ ] **Step 3** apply to both DBs (dev + `.env.test`).
- [ ] **Step 4** `npx prisma generate` (controller stops :5050 first).
- [ ] **Step 5** verify: `prisma.emailSettings.findUnique({where:{id:"singleton"}})` resolves (null is fine) on both DBs.
- [ ] **Step 6** commit: `feat(db): EmailSettings singleton for configurable email`.

---

## Task 2: Service + mailer refactor
**Files:** create `server/src/services/emailSettingsService.js`, `server/tests/emailSettings.test.js`; modify `server/src/lib/mailer.js`, `server/tests/helpers.js`, `server/tests/mailer.test.js`.
**Interfaces:** Consumes Task 1. Produces `getEmailSettings()` (internal, carries user/pass), `getEmailStatus()` (safe), `updateEmailSettings(data, actor)`. Mailer `sendMail`/`verifyMail` now config-driven. Consumed by Task 3.

- [ ] **Step 1 — failing tests** `server/tests/emailSettings.test.js` (uses `resetCrudTables`, `prisma`):
  - with no DB row + `MAIL_HOST` unset → `getEmailSettings()` `.source === "none"`, `enabled:false`; `getEmailStatus()` has NO `pass`/`user` keys and `credentialsConfigured` reflects env.
  - set `MAIL_HOST`/`MAIL_USER`/`MAIL_PASS` env (save/restore around the test) + no DB row → `source:"env"`, `getEmailSettings().pass` equals the env value, `getEmailStatus()` still omits `pass`.
  - `updateEmailSettings({ enabled:true, host:"smtp.x", port:25, secure:false, fromAddress:"a@b.com", fromName:"RBU" }, {userId:"u",name:"N"})` → persists; a later `getEmailSettings()` returns those non-secret fields with `source:"db"`, and `user`/`pass` still from env; `getEmailStatus()` never exposes `pass`.
  - Also assert `mailer.sendMail` with `enabled:false` (DB row) → `{ delivered:false }` and no throw.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — service** `emailSettingsService.js`:
```js
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
export async function getEmailSettings() {
  const user = process.env.MAIL_USER || null;
  const pass = process.env.MAIL_PASS || null;
  let row = null;
  try { row = await prisma.emailSettings.findUnique({ where: { id: ID } }); } catch { row = null; }
  if (!row) { const e = envCfg(); return { ...e, user, pass, source: e.host ? "env" : "none" }; }
  return {
    enabled: row.enabled,
    host: row.host || process.env.MAIL_HOST || null,
    port: row.port ?? Number(process.env.MAIL_PORT || 587),
    secure: row.secure,
    fromAddress: row.fromAddress || process.env.MAIL_FROM || user || null,
    fromName: row.fromName || null,
    user, pass, source: "db",
  };
}
// API-facing: non-secret only.
export async function getEmailStatus() {
  const c = await getEmailSettings();
  return {
    enabled: c.enabled, host: c.host, port: c.port, secure: c.secure,
    fromAddress: c.fromAddress, fromName: c.fromName,
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
```
- [ ] **Step 4 — mailer refactor** `mailer.js`: replace `transport()` with an async builder reading the service; keep `escapeHtml`/`inviteEmail`:
```js
import { createRequire } from "module";
import { getEmailSettings } from "../services/emailSettingsService.js";
const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer");

async function buildTransport() {
  const cfg = await getEmailSettings();
  if (!cfg.enabled || !cfg.host) return null;
  const t = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  return { t, cfg };
}
export async function sendMail({ to, subject, html, text }) {
  const built = await buildTransport();
  if (!built) { console.log(`[mailer] email disabled or not configured — not sending to ${to}: ${subject}`); return { delivered: false }; }
  const { t, cfg } = built;
  const from = cfg.fromName && cfg.fromAddress ? `${cfg.fromName} <${cfg.fromAddress}>`
    : (cfg.fromAddress || cfg.user || "RBU Leasing <no-reply@rbu.local>");
  try { await t.sendMail({ from, to, subject, html, text }); return { delivered: true }; }
  catch (err) { console.error(`[mailer] send failed to ${to}: ${err.message}`); return { delivered: false }; }
}
export async function verifyMail() {
  const built = await buildTransport();
  if (!built) return { ok: false, error: "Email is disabled or SMTP host not configured" };
  try { await built.t.verify(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}
// escapeHtml + inviteEmail unchanged (keep existing bodies).
```
- [ ] **Step 5 — test isolation:** in `server/tests/helpers.js` `resetCrudTables`, add `await prisma.emailSettings.deleteMany();` (so each test starts with no email row → env fallback). In `server/tests/mailer.test.js` `beforeEach`, also `await prisma.emailSettings.deleteMany();` (that file doesn't call resetCrudTables) and keep the existing `delete process.env.MAIL_HOST` — so the existing mailer tests still see the no-config path. (Import `prisma` there.)
- [ ] **Step 6 — run → GREEN** (`tests/emailSettings.test.js` + `tests/mailer.test.js`), then FULL server suite (invite tests still pass: no DB row + MAIL_HOST unset → `{delivered:false}`).
- [ ] **Step 7 — commit:** `feat(mail): email settings service + config-driven mailer (DB over env, password in env)`.

---

## Task 3: Admin API (GET/PUT/test)
**Files:** create `server/src/controllers/settingsController.js`, `server/src/routes/settingsRoutes.js`, `server/src/validation/emailSettings.js`; modify `server/src/app.js`; append tests to `server/tests/emailSettings.test.js`.
**Interfaces:** `GET/PUT /api/settings/email` (ADMIN), `POST /api/settings/email/test` (ADMIN, rate-limited).

- [ ] **Step 1 — failing tests** (append): GET as ADMIN → the status shape with **no `pass`/`user`**; non-admin → 403; PUT as ADMIN updates + GET reflects it; `POST /test {to}` as ADMIN → 200 `{ ok, delivered }` (mailer mocked so no real send); non-admin test → 403.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — validation** `validation/emailSettings.js`: `emailSettingsSchema = z.object({ enabled: z.boolean(), host: z.string().optional().nullable(), port: z.number().int().optional(), secure: z.boolean().optional(), fromAddress: z.string().email().optional().nullable(), fromName: z.string().optional().nullable() })`; `testSchema = z.object({ to: z.string().email() })`.
- [ ] **Step 4 — controller** `settingsController.js`: `getEmail` → `getEmailStatus()`; `putEmail` → `updateEmailSettings(emailSettingsSchema.parse(req.body), req.user)`; `testEmail` → parse `testSchema`, `const v = await verifyMail(); if(!v.ok) return res.json({ ok:false, delivered:false, error:v.error }); const r = await sendMail({to, subject:"[RBU] test email", text:"Test from RBU Leasing email settings.", html:"<p>Test from RBU Leasing email settings.</p>"}); res.json({ ok:true, delivered:r.delivered });` (errors → next).
- [ ] **Step 5 — routes** `settingsRoutes.js`:
```js
import { Router } from "express";
import { verifyJwt, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/settingsController.js";
const r = Router();
r.use(verifyJwt);
r.get("/email", requireRole("ADMIN"), ctrl.getEmail);
r.put("/email", requireRole("ADMIN"), ctrl.putEmail);
r.post("/email/test", requireRole("ADMIN"), rateLimit({ max: 10 }), ctrl.testEmail);
export default r;
```
Mount in `app.js`: `app.use("/api/settings", settingsRoutes)`.
- [ ] **Step 6 — run → GREEN**; full server suite.
- [ ] **Step 7 — commit:** `feat(api): admin email settings endpoints (get/put/test)`.

---

## Task 4: Admin Email Settings page
**Files:** create `client/src/views/EmailSettingsView.vue`; modify `client/src/lib/resource.js`, `client/src/router/index.js`, `client/src/components/AppLayout.vue`; test `client/tests/EmailSettingsView.test.js`.

- [ ] **Step 1 — resource** `emailSettings = { get:()=>api.get("/settings/email").then(r=>r.data), save:(d)=>api.put("/settings/email",d).then(r=>r.data), test:(to)=>api.post("/settings/email/test",{to}).then(r=>r.data) }`.
- [ ] **Step 2 — failing test** (`EmailSettingsView.test.js`, mock resource): on mount loads `emailSettings.get()` and fills the form (enabled/host/port/secure/fromAddress/fromName) + a "Credentials configured" indicator; Save calls `emailSettings.save(...)` with the edited values; "Send test" with an address calls `emailSettings.test(addr)` and shows the result.
- [ ] **Step 3 — view** `EmailSettingsView.vue`: form bound to the loaded settings (enabled toggle, host, port, secure, fromAddress, fromName); a status row (credentials configured yes/no, source db/env); a "Send test email" input + button showing `{ ok, delivered, error }`; surface `e.response?.data?.error`. Follow existing admin-view/form styling (e.g. `UsersView.vue`). Note near fromAddress: "must match the SMTP login account".
- [ ] **Step 4 — route + nav:** `router/index.js` add `{ path: "email-settings", component: EmailSettingsView, meta: { roles: ["ADMIN"] } }` under `/app` (static import). `AppLayout.vue` add to the Administration group: `{ to: "/app/email-settings", label: "Email Settings", icon: "message", admin: true }` (use an existing AppIcon name).
- [ ] **Step 5 — run → GREEN**; full client suite + `npm run build`.
- [ ] **Step 6 — commit:** `feat(client): admin Email Settings page`.

---

## Task 5: Verify + apply
- [ ] Full server suite + full client suite + build green.
- [ ] Controller applies the migration to both DBs (done in Task 1) + restarts the server; a quick manual check that `GET /api/settings/email` (ADMIN) returns the status with no secret and the page loads.

## Self-Review notes
- Password/user: never in DB (schema has neither), never in `getEmailStatus`/API, never logged. `getEmailSettings` (internal) carries them only to build the transport.
- Backward compatible: no DB row + env `MAIL_*` → `source:"env"`, same as today; tests force the no-config path (resetCrudTables clears the row; setup.env.js unsets MAIL_HOST).
- No restart needed to change settings (mailer reads per send). Manual-SQL migration; no new packages; trailer.
- Type consistency: service `getEmailSettings`/`getEmailStatus`/`updateEmailSettings`; routes `/api/settings/email[/test]`; client `emailSettings.get/save/test`.
