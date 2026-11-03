# Configurable Email Settings (admin-managed; password stays in env)

**Date:** 2026-10-30
**Status:** Approved (design)
**Builds on:** `feat/owner-accounts` (the nodemailer mailer + owner invitations). Branch `feat/email-settings`.

## Goal

Let an **ADMIN manage outbound-email settings from the app** — enable/disable, SMTP host, port, security, From address + display name — stored in the database, with a built-in **"send test"** and live status. The **SMTP credentials (`MAIL_USER`/`MAIL_PASS`) stay in `server/.env`** and are never written to or returned from the database. Backward compatible: with no DB settings row, the mailer falls back to pure env config (today's behavior).

## Decisions (locked)

| Topic | Decision |
|---|---|
| Storage | A **singleton `EmailSettings` row** holds the non-secret config: `enabled`, `host`, `port`, `secure`, `fromAddress`, `fromName`. **No username/password in the DB.** |
| Credentials | `MAIL_USER` + `MAIL_PASS` stay in env. The password is **never** stored in the DB nor included in any API response. |
| Effective config | `getEmailSettings()` = DB row (if present) for host/port/secure/from/fromName/enabled, else the `MAIL_*` env values. Auth (`user`/`pass`) always from env. If `enabled` is false, or no host, or no credentials → **no send** (`{ delivered:false }` + log), so the copyable accept-link fallback always works. |
| Surface | Admin **Email Settings** page (Administration, ADMIN) + a "Send test email" action + status. |
| Security | Password/user never leave env; `GET` exposes only non-secret fields + boolean flags; test + save are ADMIN-only; test is rate-limited; mutations audited by the existing middleware. |

## Data model (manual SQL both DBs, then `prisma generate`)
```prisma
model EmailSettings {
  id          String   @id @default("singleton")   // single row
  enabled     Boolean  @default(false)
  host        String?
  port        Int      @default(587)
  secure      Boolean  @default(false)
  fromAddress String?
  fromName    String?
  updatedById String?
  updatedByName String?
  updatedAt   DateTime @updatedAt
}
```
Additive (new table) → safe. The `"singleton"` id is enforced in the service (always read/write id `"singleton"`).

## Components

### Service — `server/src/services/emailSettingsService.js` (new)
- `getEmailSettings()` → effective config object `{ enabled, host, port, secure, user, pass, fromAddress, fromName, source }` where `source` is `"db"` | `"env"` | `"none"`. DB row (if any) supplies the non-secret fields; `user`/`pass` always from `MAIL_USER`/`MAIL_PASS`. **Internal use only** (carries `pass`).
- `getEmailStatus()` → safe, API-facing shape: the non-secret fields + `credentialsConfigured` (`!!(MAIL_USER && MAIL_PASS)`) + `source`. **Never** returns `pass`/`user`.
- `updateEmailSettings(data, actor)` → upsert the singleton (whitelisted non-secret fields only), record `updatedBy*`.

### Mailer — refactor `server/src/lib/mailer.js`
- `transport()` → `async` using `getEmailSettings()`: build a nodemailer transport from the effective host/port/secure + env auth; return `null` when `!enabled` or no host (so `sendMail` logs + `{ delivered:false }`). `sendMail`/`verifyMail` await it; `from` uses `fromName`+`fromAddress` (falling back to `MAIL_FROM`/`MAIL_USER`). `inviteEmail` unchanged. Keep the send-error catch → `{ delivered:false }`. Backward compatible: no DB row + `MAIL_HOST` env set → behaves as today.

### API — routes/controller/validation (new)
- `GET /api/settings/email` (ADMIN) → `getEmailStatus()`.
- `PUT /api/settings/email` (ADMIN) → `updateEmailSettings(body)` (zod: enabled bool, host string?, port int?, secure bool?, fromAddress email?, fromName string?).
- `POST /api/settings/email/test` (ADMIN, **rate-limited**) → `{ to }`: `verifyMail()` then `sendMail` a sample; returns `{ ok, delivered, error? }` (never leaks the password).
- Mount `app.use("/api/settings", settingsRoutes)`.

### Client — `client/src/views/EmailSettingsView.vue` (new) + wiring
- Administration → **Email Settings** (ADMIN-gated route + nav entry). Form: enabled toggle, host, port, secure, fromAddress, fromName. Status row: "Credentials configured: yes/no", effective source (db/env), last test result. **"Send test email"** (to an address) → shows ok/delivered/error. Warn when `fromAddress` ≠ the configured login (Outlook requires match) — shown as a hint (the login isn't exposed, so phrase generally).
- `resource.js`: `emailSettings.get()/save(data)/test(to)`.

## Tests
- Service: DB row overrides env for non-secret fields; `user`/`pass` always from env; no DB row → env; `getEmailStatus()` **never** includes `pass`/`user`; `credentialsConfigured` reflects env.
- Mailer: `enabled:false` (or no host) → `{ delivered:false }`, no send; with a DB row, `from` uses `fromName`/`fromAddress`.
- API: `GET` returns no secret; non-admin → 403; `PUT` upserts; `POST /test` ADMIN-only + rate-limited + mailer mocked (no real send).
- Client: renders current settings, saves, runs a test; ADMIN-gated.

## Edge cases / safety
- Password never in DB, API, logs, or client.
- Changing settings takes effect immediately (mailer reads them per send) — **no server restart needed** (unlike the pure-env path).
- `enabled:false` is the global off-switch → copyable-link fallback.
- Deploy: apply the `EmailSettings` migration (manual SQL both DBs) + `prisma generate`; keep `MAIL_USER`/`MAIL_PASS` in env.

## Out of scope
- Storing SMTP credentials in the DB; OAuth2/modern-auth; multiple sender profiles; per-template editing.
