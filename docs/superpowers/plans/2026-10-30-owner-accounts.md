# Owner Portal Accounts (Step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give existing (imported) Unit Owners a portal login two ways — an **officer invitation** (secure, single-use, expiring link sent by real email) and **self-registration** that an officer links to an existing owner at approval — sharing one linking path, never granting unit access before verification, never creating duplicate accounts.

**Architecture:** Reuse the existing `User`/JWT/bcrypt auth. Self-registration uses the existing `signup` → PENDING flow; approval gains an optional **link-to-existing-owner**. Invitations add an `OwnerInvite` (hashed, expiring, single-use token) + a `mailer` (nodemailer, SMTP from env, log-only fallback). Permissions stay backend-enforced; logins/registration/accept are rate-limited; the existing `auditMiddleware` already records these mutations.

**Tech Stack:** Node/Express + Prisma + bcrypt + jsonwebtoken + **nodemailer (new)**; Vue 3 + Vitest.

## Global Constraints

- Build on branch `feat/owner-accounts` (off the import work). Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Migration policy:** manual SQL (`prisma db execute`) to BOTH `rbu_leasing` and `rbu_leasing_test`, then `prisma generate`. Never `migrate dev`/`db push`. (Controller stops the :5050 server before `prisma generate`.)
- **One new dependency only: `nodemailer`** (for Task 4; `npm install nodemailer` in `server/`). No others.
- **Security is backend-enforced:** `verifyJwt` (fails closed on non-APPROVED) + `requireRole`. Never trust the client. Passwords only via bcrypt (`hashPassword`), never stored/returned in plaintext beyond the existing `passwordPlain` admin-tool column. Invite tokens stored only as a SHA-256 hash; raw token appears once, in the link.
- **No unit access before verification:** a self-registration is PENDING and unlinked until an officer links it; a `UNIT_OWNER` only ever sees data scoped by its `unitOwnerId` (existing scoping — do not weaken).
- **No duplicate accounts:** an owner with an active (non-REJECTED/SUSPENDED-excluded) linked `User` cannot be invited or linked again.
- Existing `auditMiddleware` (app-level) auto-records successful mutations — no explicit audit code needed; do not remove it.
- Reuse existing error classes (`ConflictError`→409, `NotFoundError`→404, `InvalidReferenceError`/`ValidationError`→400, `ForbiddenError`→403); error body is `{ error, code }`.

## File Structure
**Server:** modify `schema.prisma`, `authService.js`, `authController.js`, `authRoutes.js`, `validation/user.js`, `app.js`; create `prisma/manual-migrations/2026-10-30-owner-accounts.sql`, `lib/mailer.js`, `middleware/rateLimit.js`, `services/ownerInviteService.js`, `controllers/ownerInviteController.js`, `routes/ownerInviteRoutes.js`, `validation/ownerInvite.js`. Tests under `server/tests/`.
**Client:** modify `views/AccountApprovalsView.vue`, `views/OwnersView.vue`, `lib/resource.js`, `router/index.js`; create `views/AcceptInviteView.vue` (and a "Register as Unit Owner" entry — reuse the existing public register flow). Tests under `client/tests/`.

---

## Task 1: Migration — SUSPENDED status + OwnerInvite

**Files:** modify `server/prisma/schema.prisma`; create `server/prisma/manual-migrations/2026-10-30-owner-accounts.sql`.
**Interfaces:** Produces `AccountStatus.SUSPENDED`; `model OwnerInvite { id, unitOwnerId, email, tokenHash @unique, expiresAt, consumedAt?, createdById?, createdByName?, createdAt }` + `UnitOwner.invites OwnerInvite[]`. Consumed by Tasks 2 & 5.

- [ ] **Step 1 — schema:** in `schema.prisma`, add `SUSPENDED` to `enum AccountStatus`; add the `OwnerInvite` model (fields per the Interfaces line; `unitOwner UnitOwner @relation(fields:[unitOwnerId],references:[id], onDelete: Cascade)`, `@@index([unitOwnerId])`); add `invites OwnerInvite[]` to `model UnitOwner`.
- [ ] **Step 2 — SQL** `server/prisma/manual-migrations/2026-10-30-owner-accounts.sql`:
```sql
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
CREATE TABLE IF NOT EXISTS "OwnerInvite" (
  "id" TEXT PRIMARY KEY,
  "unitOwnerId" TEXT NOT NULL REFERENCES "UnitOwner"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OwnerInvite_tokenHash_key" ON "OwnerInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "OwnerInvite_unitOwnerId_idx" ON "OwnerInvite"("unitOwnerId");
```
> NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in Postgres. `prisma db execute` runs the file without an explicit transaction, so it is fine; if any wrapper complains, run the `ALTER TYPE` line separately first.
- [ ] **Step 3 — apply to both DBs** (dev, then test with the `.env.test` `DATABASE_URL`), as in prior migrations.
- [ ] **Step 4 — `prisma generate`** (controller stops :5050 first).
- [ ] **Step 5 — verify:** a node one-liner confirms `prisma.ownerInvite` exists and `AccountStatus.SUSPENDED` is accepted (e.g. `prisma.user.count({ where:{ status:"SUSPENDED" }})` resolves). 
- [ ] **Step 6 — commit:** `feat(db): SUSPENDED status + OwnerInvite model for owner accounts`.

---

## Task 2: Approval link-to-existing-owner, suspend/restore, suggested match (server)

**Files:** modify `server/src/services/authService.js`, `authController.js`, `authRoutes.js`, `validation/user.js`; test `server/tests/ownerAccounts.test.js` (new).
**Interfaces:** Consumes Task 1. Produces `approveAccount(id, approver, { existingUnitOwnerId } = {})`; `suspendUser(id)`/`restoreUser(id)`; `listPendingAccounts()` now includes `suggestedOwner`; routes `PATCH /auth/pending/:id/approve` (accepts `{ existingUnitOwnerId? }`), `PATCH /auth/users/:id/suspend`, `/users/:id/restore`.

- [ ] **Step 1 — failing tests** (`server/tests/ownerAccounts.test.js`): use `tokens`, `resetCrudTables`, `factory`, `request(createApp())`.
  - approve a PENDING UNIT_OWNER **with `existingUnitOwnerId`** → the user links to THAT owner (no new owner created; owner count unchanged) and `UnitOwner.email` gets the user's `contactEmail`.
  - approve **without** `existingUnitOwnerId` → unchanged behavior (creates a new owner).
  - approve with an `existingUnitOwnerId` whose owner **already has an active linked user** → 409 (no duplicate account).
  - suspend an APPROVED user → `status SUSPENDED`; restore → `APPROVED`. A suspended user's `loginUser` returns a restricted token (status SUSPENDED) — assert `verifyJwt`-gated route 403 for it.
  - **unauthorized:** a VIEWER/UNIT_OWNER token calling approve/suspend/restore → 403.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — service** (`authService.js`):
  - Add `STATUS_LABEL.SUSPENDED = "Suspended"`.
  - Change `approveAccount(id, approver, { existingUnitOwnerId } = {})`. Inside the transaction, for `UNIT_OWNER`: if `existingUnitOwnerId` given → `const owner = await tx.unitOwner.findUnique({ where: { id: existingUnitOwnerId } });` (throw `InvalidReferenceError` if missing); guard no active account: `const taken = await tx.user.findFirst({ where: { unitOwnerId: owner.id, status: { in: ["APPROVED","PENDING","FOR_REVISION"] }, id: { not: id } } }); if (taken) throw new ConflictError("that owner already has an account");` then `data.unitOwnerId = owner.id;` and `if (user.contactEmail) await tx.unitOwner.update({ where:{id:owner.id}, data:{ email: user.contactEmail } });`. Still build `pendingUnit` under that owner if present. Else (no id) → existing create-new-owner path unchanged.
  - Add `export async function suspendUser(id){...}` and `restoreUser(id)`: load user (NotFound if missing); block the super admin (`SUPER_ADMIN_EMAIL`) from suspension (ConflictError); set `status: "SUSPENDED"` / `"APPROVED"`; return `{id,name,email,status}`.
  - In `listPendingAccounts`, after fetching, attach a suggestion: for each UNIT_OWNER pending row, `suggestedOwner = await prisma.unitOwner.findFirst({ where: { nameKey: key(name) }, select: { id:true, name:true } })` (import `key` from `../lib/importClean.js`). Return rows with `suggestedOwner` (null if none). (Hint only; never auto-links.)
- [ ] **Step 4 — controller/routes/validation:**
  - `approve` controller: parse optional `{ existingUnitOwnerId }` (add `approveSchema = z.object({ existingUnitOwnerId: z.string().optional() })` in `validation/user.js`), pass to `approveAccount(req.params.id, req.user, { existingUnitOwnerId })`.
  - Add `suspend`/`restore` controllers calling `suspendUser`/`restoreUser`.
  - `authRoutes.js`: `router.patch("/users/:id/suspend", verifyJwt, requireRole("ADMIN","LEASING_OFFICER"), suspend);` and `/users/:id/restore` likewise.
- [ ] **Step 5 — run → PASS.**
- [ ] **Step 6 — commit:** `feat(auth): approval links to existing owner; suspend/restore; suggested owner match`.

---

## Task 3: Client — approvals linking, suspend, register-owner entry

**Files:** modify `client/src/views/AccountApprovalsView.vue`, `client/src/lib/resource.js`, `client/src/router/index.js`; test `client/tests/AccountApprovalsView.test.js` (extend/add).
**Interfaces:** Consumes Task 2 endpoints. After this, **self-registration is end-to-end testable**.

- [ ] **Step 1 — resource wrappers** (`resource.js`): `pendingAccounts.approve(id, existingUnitOwnerId)` → `api.patch(.../approve, existingUnitOwnerId ? { existingUnitOwnerId } : {})`; add `accounts.suspend(id)` / `.restore(id)` → PATCH `/auth/users/:id/suspend|restore`.
- [ ] **Step 2 — failing client test:** mount `AccountApprovalsView` with a mocked pending UNIT_OWNER that has a `suggestedOwner`; assert the owner picker/suggestion renders and that approving calls `pendingAccounts.approve(id, <ownerId>)`.
- [ ] **Step 3 — view:** in `AccountApprovalsView.vue`, for a UNIT_OWNER pending row add a **"Link to existing owner"** control — a searchable select over `owners.list()` defaulting to `row.suggestedOwner` when present — and pass the chosen id to `pendingAccounts.approve(id, ownerId)`. Approving with no selection keeps the create-new-owner behavior (and should warn that a new owner will be created). Add **Suspend/Restore** buttons on approved accounts where that list is shown (or add a small control; follow existing button patterns and `auth.canWrite` gating). Keep existing reject/revise intact.
- [ ] **Step 4 — register-owner entry:** confirm the existing public lessor registration (`/register-unit` via `/signup?as=LESSOR`, per `router/index.js`) reads as "Register as Unit Owner"; if not already labelled so, adjust copy only (no flow change). (Self-registration already creates a PENDING UNIT_OWNER via `signup`.)
- [ ] **Step 5 — run client test → PASS; full client suite green.**
- [ ] **Step 6 — commit:** `feat(client): approvals link-to-existing-owner + suspend/restore`.

**→ Checkpoint: self-registration path is now testable end-to-end (register → PENDING → officer links to an imported owner → owner signs in, sees only their units).**

---

## Task 4: Mailer (nodemailer, SMTP env, log fallback)

**Files:** create `server/src/lib/mailer.js`; modify `server/package.json` (add `nodemailer`); test `server/tests/mailer.test.js`.
**Interfaces:** Produces `sendMail({to,subject,html,text}) → { delivered:boolean }` and `inviteEmail(acceptUrl, ownerName) → {subject,html,text}`. Consumed by Task 5.

- [ ] **Step 1 — add dep:** from `server/`, `npm install nodemailer` (adds to package.json + lockfile).
- [ ] **Step 2 — failing test** (`mailer.test.js`): with no `MAIL_HOST` env, `sendMail({to:"a@b.com",subject:"x",text:"y"})` resolves `{ delivered:false }` and does not throw; `inviteEmail("https://x/accept?token=T","Jane")` returns a subject + a body containing the URL.
- [ ] **Step 3 — implement** `mailer.js`:
```js
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
```
- [ ] **Step 4 — run → PASS.** (Tests never hit real SMTP.)
- [ ] **Step 5 — commit:** `feat(mail): nodemailer mailer with SMTP env + log fallback`.

---

## Task 5: Invitations (server) — service, routes, rate-limit

**Files:** create `server/src/services/ownerInviteService.js`, `controllers/ownerInviteController.js`, `routes/ownerInviteRoutes.js`, `validation/ownerInvite.js`, `middleware/rateLimit.js`; modify `server/src/app.js` (mount + rate-limit); test append to `server/tests/ownerAccounts.test.js`.
**Interfaces:** Produces `POST /api/owner-invites` (ADMIN/LEASING_OFFICER), `GET /api/owner-invites/:token` (public), `POST /api/owner-invites/:token/accept` (public, rate-limited).

- [ ] **Step 1 — rate-limit middleware** `middleware/rateLimit.js` (in-memory fixed window, no dep):
```js
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, key = (req) => req.ip } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const k = key(req); const now = Date.now();
    const rec = hits.get(k);
    if (!rec || now > rec.reset) { hits.set(k, { count: 1, reset: now + windowMs }); return next(); }
    if (rec.count >= max) return res.status(429).json({ error: "Too many requests, try again later", code: "RATE_LIMITED" });
    rec.count++; next();
  };
}
```
- [ ] **Step 2 — failing tests** (append to `ownerAccounts.test.js`):
  - officer creates an invite for an owner → 201, response has a copyable `acceptUrl`; DB row stored with a `tokenHash` (not the raw token) and an `expiresAt` in the future.
  - `GET /owner-invites/:token` with the raw token → 200 `{ ownerName, email }`; with a bad token → 404; after accept → 410.
  - accept with a password → creates an APPROVED `UNIT_OWNER` user linked to the invite's owner, `consumedAt` set; a second accept → 410; an expired invite → 410.
  - inviting an owner that already has an active account → 409.
  - **unauthorized:** a non-staff token creating an invite → 403.
- [ ] **Step 3 — run → FAIL.**
- [ ] **Step 4 — service** `ownerInviteService.js` (uses `crypto`, `prisma`, `hashPassword`, `issueToken`, `mailer`):
```js
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { hashPassword, issueToken } from "./authService.js";
import { sendMail, inviteEmail } from "../lib/mailer.js";
import { NotFoundError, ConflictError, InvalidReferenceError, GoneError } from "../lib/errors.js";

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const ACTIVE = ["APPROVED", "PENDING", "FOR_REVISION"];

export async function createInvite({ unitOwnerId, email }, inviter) {
  const owner = await prisma.unitOwner.findUnique({ where: { id: unitOwnerId } });
  if (!owner) throw new InvalidReferenceError("owner not found");
  const taken = await prisma.user.findFirst({ where: { unitOwnerId, status: { in: ACTIVE } } });
  if (taken) throw new ConflictError("that owner already has an account");
  // Supersede any outstanding invite for this owner.
  await prisma.ownerInvite.deleteMany({ where: { unitOwnerId, consumedAt: null } });
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.ownerInvite.create({ data: { unitOwnerId, email, tokenHash: sha(token), expiresAt, createdById: inviter?.userId ?? null, createdByName: inviter?.name ?? null } });
  const base = process.env.PUBLIC_BASE_URL || "";
  const acceptUrl = `${base}/accept-invite?token=${token}`;
  const { subject, html, text } = inviteEmail(acceptUrl, owner.name);
  const { delivered } = await sendMail({ to: email, subject, html, text });
  return { acceptUrl, delivered, email, ownerName: owner.name };
}

async function liveInvite(token) {
  const invite = await prisma.ownerInvite.findUnique({ where: { tokenHash: sha(token) }, include: { unitOwner: true } });
  if (!invite) throw new NotFoundError("invitation not found");
  if (invite.consumedAt || invite.expiresAt < new Date()) throw new GoneError("this invitation has expired or was already used");
  return invite;
}

export async function getInvite(token) {
  const invite = await liveInvite(token);
  return { ownerName: invite.unitOwner.name, email: invite.email };
}

export async function acceptInvite(token, password) {
  const invite = await liveInvite(token);
  const taken = await prisma.user.findFirst({ where: { unitOwnerId: invite.unitOwnerId, status: { in: ACTIVE } } });
  if (taken) throw new ConflictError("that owner already has an account");
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: {
      name: invite.unitOwner.name, email: invite.email, contactEmail: invite.email,
      passwordHash: await hashPassword(password), passwordPlain: password,
      role: "UNIT_OWNER", status: "APPROVED", unitOwnerId: invite.unitOwnerId,
    } });
    await tx.unitOwner.update({ where: { id: invite.unitOwnerId }, data: { email: invite.email } });
    await tx.ownerInvite.update({ where: { id: invite.id }, data: { consumedAt: new Date() } });
    return user;
  });
  const token2 = issueToken({ id: result.id, role: result.role, unitOwnerId: result.unitOwnerId, status: "APPROVED" });
  return { token: token2, user: { id: result.id, name: result.name, email: result.email, role: result.role, unitOwnerId: result.unitOwnerId, status: result.status } };
}
```
> The accept `email` may collide with an existing `User.email` (unique). Guard: before create, `if (await tx.user.findUnique({ where:{ email: invite.email } })) throw new ConflictError("a user with that email already exists")`.
- [ ] **Step 5 — controller/routes/validation/mount:**
  - `validation/ownerInvite.js`: `createInviteSchema = z.object({ unitOwnerId: z.string(), email: z.string().email() })`, `acceptSchema = z.object({ password: z.string().min(8) })`.
  - Add `GoneError` to `server/src/lib/errors.js`: `export class GoneError extends AppError { constructor(message = "Gone") { super(message, 410, "GONE"); } }`. Then NotFound→404, Gone→410, Conflict→409 all flow through the existing error handler — no per-controller status mapping needed.
  - Controller: `create` (parse, `createInvite(body, req.user)` → 201), `get` (`getInvite(req.params.token)`), `accept` (parse `acceptSchema`, `acceptInvite(req.params.token, password)`, return token+user).
  - `routes/ownerInviteRoutes.js`: `POST /` → `verifyJwt, requireRole("ADMIN","LEASING_OFFICER"), create`; `GET /:token` → public `get`; `POST /:token/accept` → `rateLimit({ max: 10 }), accept`.
  - `app.js`: `app.use("/api/owner-invites", ownerInviteRoutes)`.
- [ ] **Step 6 — run → PASS; full server suite green.**
- [ ] **Step 7 — commit:** `feat(auth): owner invitations — create/get/accept, hashed single-use token, email`.

---

## Task 6: Invitations (client) — accept page + invite action

**Files:** create `client/src/views/AcceptInviteView.vue`; modify `client/src/views/OwnersView.vue`, `client/src/lib/resource.js`, `client/src/router/index.js`; test `client/tests/AcceptInviteView.test.js`.

- [ ] **Step 1 — resource wrappers:** `ownerInvites = { create:(unitOwnerId,email)=>api.post("/owner-invites",{unitOwnerId,email}).then(r=>r.data), get:(token)=>api.get(\`/owner-invites/${token}\`).then(r=>r.data), accept:(token,password)=>api.post(\`/owner-invites/${token}/accept\`,{password}).then(r=>r.data) }`.
- [ ] **Step 2 — router:** add public `{ path: "/accept-invite", component: AcceptInviteView, meta: { ownsThemeToggle: true } }` (static import). No auth.
- [ ] **Step 3 — failing test** (`AcceptInviteView.test.js`): mock `ownerInvites.get` → `{ownerName,email}` and `.accept` → `{token,user}`; mount with a `token` query; assert it shows the owner/email, submits password → calls `accept(token, password)`, and stores the session (follow how `LoginView`/auth store persist a token — reuse `useAuthStore`).
- [ ] **Step 4 — views:**
  - `AcceptInviteView.vue`: read `token` from the route query; on mount call `ownerInvites.get(token)` (handle 404/410 with a clear message); show owner/email read-only; password + confirm; submit → `ownerInvites.accept(token,password)` → persist session via the auth store → redirect to the owner home (`/app/my-units`).
  - `OwnersView.vue`: add an **"Invite to portal"** action per owner (visible to `auth.canWrite`, hidden if the owner already has an account — if that isn't known client-side, show it and let the 409 surface). Dialog: confirm/enter email (default `owner.email`) → `ownerInvites.create(owner.id, email)` → show the returned **copyable `acceptUrl`** and whether it was emailed (`delivered`).
- [ ] **Step 5 — run client test → PASS; full client suite green; `npm run build`.**
- [ ] **Step 6 — commit:** `feat(client): accept-invite page + invite-to-portal action`.

---

## Task 7: Rate-limit login/registration + full verification

**Files:** modify `server/src/app.js` (or the auth routes) to apply `rateLimit` to `POST /api/auth/login` and `POST /api/auth/signup`; verification only otherwise.

- [ ] **Step 1 — apply** `rateLimit({ max: 20, windowMs: 15*60*1000 })` to the login + signup routes (per-IP). A focused test: exceeding the cap returns 429; under it works. (Keep the cap high enough not to break existing auth tests — scope the limiter so the existing suite's rapid logins stay under `max`, or instantiate per-route with a generous cap; verify the auth suite still passes.)
- [ ] **Step 2 — full server suite** (`server/` `npx vitest run`) and **full client suite** + `npm run build` → all green.
- [ ] **Step 3 — controller applies the migration + `prisma generate`** already done in Task 1; confirm both DBs have `OwnerInvite` + `SUSPENDED`.
- [ ] **Step 4 — commit** any final fixes.

---

## Self-Review notes
- **Requirement coverage:** Option A invitation (Tasks 4–6: secure single-use expiring token, emailed, password set by owner, no plaintext); Option B self-registration (Tasks 2–3: PENDING, officer links at approval, suggested match is a hint only, no access on name/unit alone); one-account-per-owner guard (Tasks 2 & 5); SUSPENDED (Task 2); backend-enforced perms (verifyJwt/requireRole on every mutating route); token protection + rate-limit (Tasks 5 & 7); audit via existing middleware; owner scoping unchanged. Tests for unauthorized access + duplicate registration (Tasks 2 & 5).
- **Type consistency:** service exports `createInvite/getInvite/acceptInvite`, `approveAccount(id,approver,{existingUnitOwnerId})`, `suspendUser/restoreUser`; routes `/api/owner-invites[...]`, `/auth/users/:id/suspend|restore`; client `ownerInvites.{create,get,accept}`, `pendingAccounts.approve(id,existingUnitOwnerId)`, `accounts.{suspend,restore}`.
- **Testability-first ordering:** Tasks 1–3 make self-registration testable before any email work.
- Manual-SQL migration; one new dep (nodemailer); commit trailer — honored.
