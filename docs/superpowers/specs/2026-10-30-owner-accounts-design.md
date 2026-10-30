# Owner Portal Accounts (Step 2) — Invitations + Self-Registration + Linking

**Date:** 2026-10-30
**Status:** Approved (design)
**Depends on:** Step 1 import (branch `feat/import-validation-preview`); this branch `feat/owner-accounts` builds on it. Imported `UnitOwner` records exist as business records with **no** login.

## Goal

Let an existing (imported) Unit Owner get a portal login **two ways**, sharing one account/owner-linking path, without ever granting unit access before identity + association are verified, and without creating duplicate accounts:

- **Option A — RBU invitation:** an officer selects an existing `UnitOwner`, confirms its verified email, and sends a **secure, single-use, expiring invitation link by email**; the owner opens it and sets their own password. No plaintext passwords.
- **Option B — Self-registration:** a public **"Register as Unit Owner"** page; the system looks for a matching imported owner but **never auto-links on name/unit alone** — an uncertain or name-only match stays **PENDING for RBU review**, where an officer verifies identity and links the account to the correct existing owner (or rejects).

## Decisions (locked)

| Topic | Decision |
|---|---|
| Invite delivery | **Real email** via `nodemailer` (new dep), SMTP configured from env (`MAIL_HOST/PORT/USER/PASS/FROM/SECURE`). When SMTP is unset (dev/test), the mailer uses a **no-send transport that logs** the message and the officer still sees the **copyable accept-link**, so the flow is testable before SMTP is wired. Secrets live in the server env — never in code. |
| Invite token | Random 32-byte token; **only its hash is stored** (`OwnerInvite.tokenHash`); the raw token appears once in the accept-link. Single-use (`consumedAt`), expiring (`expiresAt`, default 7 days). |
| Who links | **The officer links**, always. Invitation = the officer vouches by choosing the owner → accepting creates an APPROVED account linked to that owner. Self-registration = officer links to an existing owner (or rejects) at approval; the system only **suggests** a possible match (by normalized name) as a hint. |
| Identity proof | **Email verification alone does not prove ownership.** A self-registration that matches only by name/unit does **not** grant access — it stays PENDING. No applicant gains unit access by typing an owner name or unit number. |
| One account per owner | Enforced: an owner that already has a linked, non-rejected `User` cannot be invited again or linked to a second account. |
| Suspend | Add `AccountStatus.SUSPENDED`; a suspended user cannot sign in / is treated as unapproved. Officers can suspend/restore. |
| Owner email | Written onto `UnitOwner.email` when the account is created/accepted (from the invite's verified email or the approved registration). |

## Data model changes (manual SQL, both DBs, then `prisma generate`)

```prisma
enum AccountStatus { PENDING FOR_REVISION APPROVED REJECTED SUSPENDED } // + SUSPENDED

model OwnerInvite {
  id          String    @id @default(cuid())
  unitOwner   UnitOwner @relation(fields: [unitOwnerId], references: [id], onDelete: Cascade)
  unitOwnerId String
  email       String                         // the verified owner email the invite was sent to
  tokenHash   String    @unique              // sha-256 of the raw token; raw token never stored
  expiresAt   DateTime
  consumedAt  DateTime?                      // single-use
  createdById String?                        // officer who invited
  createdByName String?
  createdAt   DateTime  @default(now())
  @@index([unitOwnerId])
}
// UnitOwner gains: invites OwnerInvite[]   (back-relation)
```
`User` is reused as-is (`status`, `role`, `unitOwnerId`, `contactEmail`, `passwordHash`, `pendingUnit`). Additive/defaulted + a new enum value → safe, data preserved. Existing `UnitOwner.email` column already exists.

## Components

### Email — `server/src/lib/mailer.js` (new)
- `sendMail({ to, subject, html, text })` using `nodemailer`. If `MAIL_HOST` is set → real SMTP transport; else a JSON/stream transport that **logs** (no send). Returns `{ delivered: boolean }` so callers know whether a copyable link must be shown.
- `inviteEmail(acceptUrl, ownerName)` builds the message. No secrets logged.

### Invitations — `ownerInviteService.js` / `ownerInviteController.js` / `ownerInviteRoutes.js` (new)
- `POST /api/owner-invites` (ADMIN, LEASING_OFFICER): body `{ unitOwnerId, email }`. Guards: owner exists; owner has no active (non-rejected) linked `User`; no unconsumed, unexpired invite already outstanding (re-invite supersedes). Generates token, stores hash + expiry, emails the accept-link, **always returns the acceptUrl** so the officer can copy it. Audited.
- `GET /api/owner-invites/:token` (public): validate token (exists, not consumed, not expired) → return minimal `{ ownerName, email }` for the accept page (no sensitive data).
- `POST /api/owner-invites/:token/accept` (public, **rate-limited**): body `{ password }`. Re-validate token; create a `User` (role `UNIT_OWNER`, `status APPROVED`, `unitOwnerId` = the invite's owner, `contactEmail`/owner email set), hash the password (existing bcrypt), mark `consumedAt`. Idempotent against reuse (consumed/expired → 410). Audited.

### Self-registration + approval linking — extend `authService.js` + auth routes
- Public **"Register as Unit Owner"** uses the existing signup path (`signupPortalUser`) to create a `User` PENDING with the applicant's details; **no owner link, no unit access**. The service computes a **suggested match**: existing `UnitOwner` whose `nameKey` equals `key(fullName)` (exact only) → attach `suggestedUnitOwnerId` to the pending record for the officer (a hint, never an auto-link).
- `approveAccount` gains an **optional `existingUnitOwnerId`**: when provided, link the new `User` to that existing owner (write `UnitOwner.email`) **instead of** creating a new owner; guard that the owner has no other active account. Existing create-new-owner behavior stays when no id is given (backward compatible).
- **Suspend/restore:** `PATCH /api/auth/users/:id/suspend` + `/restore` (ADMIN, LEASING_OFFICER) set `status SUSPENDED`/`APPROVED`. Audited. Sign-in + the restricted-session guard treat `SUSPENDED` like unapproved.

### Security
- Passwords: existing bcrypt hashing; never stored/sent in plaintext; tokens hashed at rest.
- **Rate-limiting** — `server/src/middleware/rateLimit.js` (new, in-memory fixed-window; no new dep): applied to invite-accept, self-registration, and login (per-IP). Returns 429 on exceed.
- Permissions enforced on the **backend** (`verifyJwt` + `requireRole`), not just UI. Owner data stays scoped by `unitOwnerId` (existing scoping). A `UNIT_OWNER` cannot edit ownership records or reach another owner's units.
- Audit log entries for invite-created, invite-accepted, account-approved(+linked), suspend/restore.

### Client
- `AcceptInviteView.vue` (public `/accept-invite?token=…`): shows owner/email, password + confirm, submits accept → signs in. Clear expired/used messaging.
- `RegisterUnitOwnerView.vue` (public "Register as Unit Owner") or reuse the existing register flow with owner framing.
- `OwnersView.vue`: **"Invite to portal"** action on an owner → dialog (confirm/enter email) → shows the copyable accept-link + "emailed to …" status. Hidden if the owner already has an account.
- `AccountApprovalsView.vue`: a **"link to existing owner"** picker (searchable, shows the suggested match) on a pending UNIT_OWNER approval; **suspend/restore** controls on accounts.
- `resource.js`: `ownerInvites.create/get/accept`, `accounts.approve(id, existingUnitOwnerId)`, `.suspend/.restore`.

## Permissions summary
- ADMIN / LEASING_OFFICER: review registrations, invite owners, approve + link, suspend/restore.
- UNIT_OWNER: see only their own units/leases/info (existing scoping); cannot edit official ownership records or access another owner's units.
- Public (no auth): register, view-invite, accept-invite (rate-limited) only.

## Tests
- **Unauthorized access:** a non-staff token cannot create invites, approve/link, or suspend (403); a UNIT_OWNER cannot read another owner's units/leases (404/empty).
- **Duplicate prevention:** inviting/linking an owner that already has an active account is rejected; a second accept with a consumed/expired token → 410; self-registering the same login twice is rejected.
- **Invite lifecycle:** create → accept sets password + APPROVED + linked + `consumedAt`; expired/consumed tokens rejected; token is stored only as a hash.
- **Self-registration:** stays PENDING; a name-only match does **not** auto-link or grant access; officer links at approval → correct owner, email written, no duplicate owner.
- **Suspend:** suspended user can't sign in / is treated as unapproved.
- **Mailer:** accept-link always returned even when SMTP unset (delivered:false); mailer is mocked in tests (no real send).

## Edge cases / safety
- Re-invite supersedes an outstanding invite (old token invalidated).
- Accept on an owner that got an account meanwhile → rejected.
- Rate-limit is per-IP, in-memory (resets on restart) — adequate for this deployment; documented.
- Deploy: manual SQL (enum value + `OwnerInvite`) + `prisma generate`; set `MAIL_*` env for real sending.

## Out of scope
- Password reset / email verification for staff accounts.
- Bulk invitations.
- Changing the import feature.
