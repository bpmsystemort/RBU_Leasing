# RBU Leasing — Enhancement Program: Progress & Continuation

**Last updated:** 2026-11-03
**Active branch:** `feat/units-blocking` (contains the full stack of all work below)
**Remote:** `origin` → https://github.com/Amantemjm/RBU-Leasing-v.2.git (everything below is pushed)

This is the canonical hand-off for continuing the leasing-system enhancements and merging
them into `master`. It replaces the local-only SDD ledger (`.superpowers/sdd/progress.md`,
which is gitignored and does **not** travel between machines). All specs and plans **are**
committed under `docs/superpowers/` and travel with the branch.

---

## 1. Status at a glance

| Work | Branch | State | Tests |
|---|---|---|---|
| Import v2 (Excel portfolio) | `feat/import-validation-preview` | ✅ **MERGED → master** | green |
| Owner accounts + linking | `feat/owner-accounts` | ✅ **MERGED → master** | green |
| Configurable Email Settings | `feat/email-settings` | ✅ **MERGED → master** | green |
| **SP1 — Navigation & shell** | `feat/nav-shell` | ✅ **MERGED → master** | — |
| **SP2 — Units & blocking** | `feat/units-blocking` @ `6670c27` | 🟡 **spec only** (no code yet) — awaiting approval | — |
| SP3 — Leasing workflow & move-in | — | ⬜ not started | — |
| SP4 — Leases/expiry/renewal + dashboard | — | ⬜ not started | — |
| SP5 — People/accounts + Email History | — | ⬜ not started | — |

**✅ `master` is now at `268ecc0` (pushed to origin) — the four features above are MERGED.**
On 2026-11-03 the feature stack was integrated with `origin/master`'s **security-hardening
line** (which had diverged: endpoint throttling, access control, and "honest password reset"
that removed readable-password storage). The merge preserved **both**: all four features AND
every security fix. Conflict resolutions (rate-limiting reconciled to keep both limiters;
`passwordPlain` exposure + its last write removed) were security-reviewed (verdict: safe) and
validated — **server 70 files / 565 tests, client 65 / 451, build OK**.

`feat/units-blocking` (SP2) has been **merged onto this secured master**, so SP2 now builds on
the hardened base — its code equals master; only the SP2 spec + this doc are extra.

**⚠️ New manual migration from the security line to apply to each DB:**
`server/prisma/manual-migrations/2026-10-27-clear-readable-passwords.sql` (nulls any
pre-existing readable passwords). Apply it to `rbu_leasing` + `rbu_leasing_test` (+ prod)
alongside the others.

---

## 2. The program (how this is being built)

A large request — navigation restructure, page redesigns by business purpose, leasing-workflow
fixes, and lease-term/expiry/renewal + dashboard analytics — was decomposed, after a read-only
audit, into **five sequenced sub-projects**. Each goes through the Superpowers flow:
**brainstorm → spec → (your approval) → writing-plans → subagent-driven build (implementer +
reviewer per task) → final whole-branch review → merge.**

### Locked audit decisions (apply to all sub-projects)
- **Sequenced sub-projects** (not one big bang).
- **Signed deals → Lease**: a signed leasing transaction becomes the source of truth that
  creates/updates a `Lease` (wired in SP4).
- **Pipeline-driven unit lifecycle**: `VACANT / BLOCKED / OCCUPIED / UNAVAILABLE` (SP2).
- **No Prospect entity** — "Prospect Records" is a view over un-converted inquiries.
- Defaults: business timezone **Asia/Manila** (configurable); **move-in** = the pipeline's final
  stage + fields; **Email History** on a Communication page, never the dashboard; executed-
  contract-date edits **ADMIN-only + audited**; no page deleted when a nav entry is consolidated.

### Do NOT (hard constraints)
- No billing, payment tracking, or Property-Management module.
- Preserve: Excel import idempotency + owner-assignment, owner↔account separation, historical
  data, existing permissions/security, audit logging.

---

## 3. Sub-project detail & the next concrete step

### SP1 — Navigation & shell ✅ DONE (merge-ready)
- Spec: `docs/superpowers/specs/2026-10-30-navigation-shell-design.md`
- Plan: `docs/superpowers/plans/2026-10-30-navigation-shell.md`
- Built: `client/src/lib/nav.js` (nav model + `visibleNav`), `AppLayout.vue` rebuilt
  (5-group collapsible, permission-aware sidebar + section sub-labels + persisted collapse +
  brand›group›page breadcrumb), every staff route re-homed, Tracker/Transactions consolidated.
  Structural only — no route/permission/data/server change. Final review: READY TO MERGE.

### SP2 — Units & blocking 🟡 SPEC ONLY — **this is where to resume**
- Spec (approved decisions, pending final go): `docs/superpowers/specs/2026-10-30-units-blocking-design.md`
- Locked SP2 decisions: unit states `{VACANT, BLOCKED, OCCUPIED, UNAVAILABLE}` (keep OCCUPIED);
  **deliberate** block action (never auto-block on inquiry); **one active deal per unit**
  (fixes the `ensureForInquiry` double-transaction bug at `leasingTransactionService.js:67-69`);
  reassignment + a dedicated `UnitAssignmentEvent` history table (verification reuses
  `UnitOwner.needsReview` + `Unit.approvalStatus`).
- **Next step to resume SP2:** confirm the spec → run `writing-plans` to produce
  `docs/superpowers/plans/2026-10-30-units-blocking.md` → build with `subagent-driven-development`
  (implementer+reviewer per task, then a final review) → merge.
- SP2 adds a DB migration (manual SQL both DBs): `UnitStatus` += `BLOCKED`,`UNAVAILABLE`;
  `Unit.blockedByTransactionId` (nullable FK); new `UnitAssignmentEvent` table. Then
  `prisma generate`. It also wires the two SP1-deferred nav entries (Unit Blocking,
  Unit-Owner Assignments).

### SP3 / SP4 / SP5 ⬜ not started
- SP3 Leasing workflow & move-in (Inquiries redesign + Viewing/Follow-up list + move-in stage +
  requirements gating + Requirements/Documents pages).
- SP4 Leases/expiry/renewal + dashboard analytics (signed→Lease wiring, contract metadata,
  renewal history, expiry categories, Leases & Contracts redesign, dashboard cards/chart/table).
  Also reconcile the dead `DashboardView`/`dashboardService` here.
- SP5 People/accounts polish + **Email History** (`EmailLog` model + page).

(Each starts with its own brainstorm → spec → approval → plan → build.)

---

## 4. Keeping BOTH servers identical (frontend + backend)

**Git is the single source of truth for code.** Both machines should sit on the same commit.

### Make the other server match this one
```bash
git clone https://github.com/Amantemjm/RBU-Leasing-v.2.git   # first time only
cd RBU-Leasing-v.2
git fetch origin
git checkout feat/units-blocking
git pull                      # identical frontend + backend SOURCE as this machine
npm install                   # identical deps (root package-lock.json is committed)
npm run build --workspace client   # rebuild client/dist (dist is gitignored, so rebuild it)
```

### Backend schema parity (git does NOT carry the database)
The project uses **manual SQL migrations** (schema history has drifted — see project memory:
never `prisma migrate dev` / `db push`). All SQL **is** committed under
`server/prisma/manual-migrations/` and `server/prisma/migrations/`. To make the other server's
DB identical:

- **Exact parity (recommended — same schema + same data):** dump this server's DBs and restore
  on the other:
  ```bash
  # on THIS server
  pg_dump -Fc rbu_leasing      > rbu_leasing.dump
  pg_dump -Fc rbu_leasing_test > rbu_leasing_test.dump
  # on the OTHER server (createdb first if needed)
  pg_restore -d rbu_leasing      rbu_leasing.dump
  pg_restore -d rbu_leasing_test rbu_leasing_test.dump
  ```
- **Fresh DB (schema only, then import data):** create the DBs, apply the tracked Prisma
  migrations, then apply every file in `server/prisma/manual-migrations/*.sql` in **date order**
  (they cover everything after `2026-08-28`), then `npx prisma generate`. Load portfolio data via
  the in-app ADMIN Import Portfolio page.

### Per-machine files to recreate (gitignored by design)
- `server/.env` — copy from `server/.env.example`; set `DATABASE_URL` (dev), a test
  `DATABASE_URL` in `server/.env.test`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `PUBLIC_BASE_URL`,
  and the `MAIL_*` block (host `smtp-mail.outlook.com`, port `587`, secure `false`, the
  `noreply-posh@ortigas.com.ph` user + its password + from). **The SMTP password is never in
  git and must be entered by you.**
- `client/dist` — produced by `npm run build` (above).
- `node_modules` — produced by `npm install`.

### Staying in sync going forward
Work on **one** machine at a time: commit + `git push` there, then `git pull` on the other
before working. Don't edit both without pulling, or the branches diverge and need a merge.

---

## 5. Running the app
- Dev/prod-style serve (this machine): `NODE_ENV=production` server on `:5050` serves
  `client/dist` + the API. Start: `node server/src/index.js` (this machine also has a Windows
  Startup `.vbs` auto-start loop — that is machine-specific and not in git).
- After any **client** change: `npm run build --workspace client`, then reload.
- After any **server code** change: restart the node process.
- After any **schema** change: stop the server (Windows holds the Prisma DLL), apply the manual
  SQL to **both** DBs, `npx prisma generate`, restart.

---

## 6. Merge-to-master plan (your call; I can do it locally + push, you approve)

1. ✅ `feat/import-validation-preview` → `master` — **DONE** (in `268ecc0`)
2. ✅ `feat/owner-accounts` → `master` — **DONE**
3. ✅ `feat/email-settings` → `master` — **DONE**
4. ✅ `feat/nav-shell` (SP1) → `master` — **DONE**
   *(1–4 landed together as one integration merge `268ecc0`, reconciled with origin/master's
   security line; the earlier `ahead 18 / behind 14` divergence is resolved — origin/master's
   14 security commits are preserved in master.)*
5. ⬜ `feat/units-blocking` (SP2) → `master` — **pending** (only after SP2 is actually built;
   today it is spec-only, already rebased onto the secured master).

Before deploying `master`: apply its manual SQL migrations to the production DB — including the
new `2026-10-27-clear-readable-passwords.sql`. Deploying is yours to run.

---

## 7. Project rules (carry into every session)
- **Manual SQL migrations only** (apply to BOTH `rbu_leasing` and `rbu_leasing_test` + prod),
  then `prisma generate`. Never `prisma migrate dev` / `db push`.
- Every commit ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- SMTP password/user stay in `server/.env`; never in the DB, any API response, logs, or the client.
- Client tests: `npx vitest run` in `client/`. Server tests: `npm test` in `server/`
  (forces the test DB; never sends real email).
- The SMTP account `noreply-posh@ortigas.com.ph` authenticates (verified); a real
  proof-of-delivery test send has **not** been run yet (needs a recipient + go-ahead).

---

## 8. Open items
- [ ] Approve the SP2 spec → build SP2 (plan + subagent build + review).
- [ ] Build SP3, SP4, SP5 (each: brainstorm → spec → approval → plan → build).
- [ ] Merge the merge-ready branches into `master` (stack order above) + deploy.
- [ ] Optional: run the email proof-of-delivery test (`node server/scripts/test-mail.js <you@addr>`).
