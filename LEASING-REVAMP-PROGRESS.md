# RBU Leasing — Enhancement Program: Progress & Continuation

**Last updated:** 2026-11-06
**Active branch:** `sp2/units-blocking` @ `9047802` (worktree `repo-sp2`). Carries the whole stack below.
**Remote:** `origin` → https://github.com/bpmsystemort/RBU_Leasing.git
**Pushed?** **No.** Nothing on `sp2/units-blocking` is pushed, and none of it is on `origin/master` yet.

This is the canonical hand-off for continuing the leasing-system enhancements and getting them
onto `master`. It supersedes the 2026-11-03 version, which described `master` as already
containing the integrated features and SP2 as spec-only; neither was true of this repository.
Specs and plans are committed under `docs/superpowers/`. The SDD ledger
(`.superpowers/sdd/progress.md`) is gitignored and does not travel between machines.

---

## 1. Status at a glance

| Work | State | Where it lives |
|---|---|---|
| Import v2 (Excel portfolio) | ✅ built, in the branch | `sp2/units-blocking` (not on `origin/master`) |
| Owner accounts + linking | ✅ built, in the branch | same |
| Configurable Email Settings | ✅ built, in the branch | same |
| SP1 — Navigation & shell | ✅ built, in the branch | same |
| **SP2 — Units & blocking** | ✅ **built, reviewed, tested** (see §3) | `sp2/units-blocking` |
| Post-SP2 import work (dates, Mark vacant, review tables) | ✅ built, tested | `sp2/units-blocking` (3 commits on top) |
| SP3 — Leasing workflow & move-in | ⬜ not started | — |
| SP4 — Leases/expiry/renewal + dashboard | ⬜ not started | — |
| SP5 — People/accounts + Email History | ⬜ not started | — |

**Branch vs `master`:** `origin/master` (`577575d`) was merged into the branch on 2026-11-06, so the branch is no longer behind it. It was **80 commits ahead** of `origin/master` and
**1 behind** (`577575d` "fail loudly when startup cannot succeed", `server/src/index.js` only).
Merge base is `6ff5a00`. The previously documented `268ecc0` integration merge is **not** an
ancestor of `master`; it exists only in the old `amante/*` remote-tracking refs from the
earlier `Amantemjm/RBU-Leasing-v.2` repository, which is no longer a configured remote.

**Security line:** `master` and the branch both contain
`server/prisma/manual-migrations/2026-10-27-clear-readable-passwords.sql` (verified), so the
branch is on the hardened base. That migration still has to be applied to every DB.

**Tests at last run (no code changed since):** server 75 files / 732 tests, client 68 files /
518 tests, all passing.

---

## 2. The program

A large request — navigation restructure, page redesigns by business purpose, leasing-workflow
fixes, and lease-term/expiry/renewal + dashboard analytics — was decomposed into **five
sequenced sub-projects**. Each goes through: **brainstorm → spec → approval → writing-plans →
subagent-driven build (implementer + reviewer per task) → final whole-branch review → merge.**

### Locked audit decisions
- Sequenced sub-projects, not one big bang.
- **Signed deals → Lease**: a signed leasing transaction becomes the source of truth that
  creates/updates a `Lease` (wired in SP4).
- **Pipeline-driven unit lifecycle**: `VACANT / BLOCKED / OCCUPIED / UNAVAILABLE` (SP2).
- **No Prospect entity** — "Prospect Records" is a view over un-converted inquiries.
- Defaults: timezone **Asia/Manila** (configurable); **move-in** = the pipeline's final stage;
  **Email History** on a Communication page, never the dashboard; executed-contract-date edits
  **ADMIN-only + audited**; no page deleted when a nav entry is consolidated.

### Do NOT
- No billing, payment tracking, or Property-Management module.
- Preserve: Excel import idempotency + owner assignment, owner↔account separation, historical
  data, existing permissions/security, audit logging.

---

## 3. What is built

### SP1 — Navigation & shell ✅
Spec/plan: `docs/superpowers/{specs,plans}/2026-10-30-navigation-shell*`. `client/src/lib/nav.js`,
rebuilt `AppLayout.vue` (5 collapsible permission-aware groups, breadcrumb). Structural only.

### SP2 — Units & blocking ✅
Spec: `docs/superpowers/specs/2026-10-30-units-blocking-design.md` (brought in line with the
build in `14127e7`). Plan: `docs/superpowers/plans/2026-10-30-units-blocking.md`.
- Unit states `VACANT / BLOCKED / OCCUPIED / UNAVAILABLE`; deliberate block action (never an
  auto-block on inquiry); **one active deal per unit** (fixes the `ensureForInquiry`
  double-transaction bug); validated owner reassignment with `UnitAssignmentEvent` history;
  signed deals keep their unit; dead early deals end and release.
- Manual availability changes allowed only VACANT↔UNAVAILABLE; OCCUPIED/BLOCKED refuse with 409.
- Client: units console (badges, filters, sorting, paging, availability actions), Unit Blocking
  console, Unit-Owner Assignments page, and their nav entries.
- Review decisions taken: owner edit through plain PATCH is refused (409, use reassignment);
  "Mark reviewed" clears `needsStatusReview`.
- **Schema (manual SQL, no Prisma migrate):**
  `2026-11-03-units-blocking-1-enum.sql`, `2026-11-03-units-blocking-2-block-and-assignments.sql`
  (+ `.down.sql`): `UnitStatus` += `BLOCKED`,`UNAVAILABLE`; `Unit.blockedByTransactionId`;
  `UnitAssignmentEvent` table.

### Post-SP2 import work ✅ (commits `dfac084`, `561a706`, `9047802`)
- **Date parsing** (`server/src/lib/importClean.js`): text dates in any common format
  (`2025-11-29`, `29 Nov 2025`, `November 29, 2025`, `11/29/2025`, ordinals) read as the same
  UTC day Excel date cells produce. Numeric d/m/y is month-first unless a part is > 12;
  impossible dates and typo'd month names are `null`, never guessed.
- **Mark vacant** (`PATCH /api/units/:id/mark-vacant`, Admin + Leasing Officer): an imported
  OCCUPIED unit flagged `needsStatusReview` with no current lease can be made VACANT in one
  click on the Units page. Closes the SP2 open decision that such units were unresolvable until
  SP4. Re-import does not re-flag a unit staff already made VACANT.
- **Mark reviewed survives a re-import** (`statusReviewedAt`).
- **Import Portfolio preview** now lists the flagged units (oldest last lease first) and the
  flagged owners (joint / no lessor), each with its source sheet and row.

---

## 4. Next steps (in order)

1. **Real-data smoke test.** API-level run done 2026-11-06 against the sandbox DB
   `rbu_leasing_sp2`, which already holds the imported portfolio (264 units, 292 leases, 243
   owners; 158 units and 32 owners flagged). Re-previewing the cleaned workbook gave 0 create /
   292 update / 0 failed, 161 flagged units, 32 flagged owners. Mark vacant returned 200 on a
   flagged unit and 409 on an unflagged or already-vacant one (401 without a token), and the
   preview then dropped to 160. The test unit was restored afterwards. **Still not done:** a
   click-through in the browser (the in-app browser pane has not been usable for this app).
   **Finding, fixed:** a re-import used to re-flag units cleared with "Mark reviewed" (3 units:
   161 in the preview vs 158 flagged). Mark reviewed now records `Unit.statusReviewedAt`; the importer and
   the preview skip reviewed units until a current lease has come and gone. Migration
   `2026-11-06-unit-status-reviewed.sql` (also backfills units reviewed before the column existed) is
   applied to the sandbox and test DBs.
2. **Reconcile with `master`.** Done 2026-11-06: `origin/master` (one small commit) is merged in. The
   history was also scrubbed before any push (a lessor's real name and one Windows-username path
   removed from the branch's commits; hashes changed, authorship and commit count did not). The
   pre-scrub branch is kept locally as `backup/sp2-before-scrub`; delete it once the PR is up. The
   squash warning in the SDD ledger is about the separate Phase 1a line (`feature/leasing-mvp-phase-1a`),
   not this branch. Windows-username paths in `docs/lessee-simulation-guide.md`,
   `server/scripts/import-portfolio.js` and the Phase-07 plan are already on `origin/master`.
3. **Apply the manual SQL to every DB** (dev, test, prod), then `npx prisma generate`:
   `2026-10-27-clear-readable-passwords.sql`, `2026-10-29-import-review-flags.sql`,
   `2026-10-30-email-settings.sql`, `2026-10-30-owner-accounts.sql`,
   `2026-10-30-one-active-account-per-owner.sql`, `2026-11-03-units-blocking-1-enum.sql`,
   `2026-11-03-units-blocking-2-block-and-assignments.sql`, `2026-11-06-unit-status-reviewed.sql`.
   Only the sandbox DB has the SP2 ones so far.
4. **Push and open the PR** (nothing is pushed today). Deploying is the owner's step.
5. SP3 → SP4 → SP5, each starting with its own brainstorm → spec → approval → plan → build.

### Known follow-ups inside SP2 (recorded, not blocking)
- `nextReference()` is read-then-write; a collision gives a 500 (pre-existing).
- No unique index yet for "one active prospect deal per unit"; the guard is in code only.
  Closing it needs manual SQL and covering `/link` and tenant-linked paths.
- Officer-scope note on the Unit Blocking console; direct test for the unit status stale-read
  conflict path.
- One import test hardcodes an ACTIVE lease ending 2027-01-01 (pre-existing); it will start
  failing when that date passes.

### Enhancement ideas (not requested)
- Bulk **Mark vacant** / **Mark reviewed** with row checkboxes (161 flagged units one by one is
  slow); Export to Excel and a tower / last-ended filter on the two review tables.
- Owner review currently has only "Mark reviewed"; no way to split a joint owner.
- Undo or per-batch record for a committed import.
- Update the Walkthrough sheet in `Roles Notes.xlsx` for Mark vacant and the review tables.

### Data questions open on the cleaned workbook
- 2026 row 265: one Lessor entry needs confirmation.
- Two typo guesses in Renewal Period are marked for review; repeated periods and "1 year" values
  are left as written.

### Other lines of work in the main checkout (not part of this program)
`repo/` carries `feature/leasing-mvp-phase-1a` (Phase 1a written and reviewed, **nothing
executed**; Task 12 dev-machine checklist pending; Phase 1b plan written) and
`feature/unit-hold-and-closing-reasons`. Track those in their own ledgers.

---

## 5. Keeping machines identical

Git is the source of truth for code; it does **not** carry the database.

```bash
git clone https://github.com/bpmsystemort/RBU_Leasing.git   # first time only
git fetch origin
git checkout sp2/units-blocking      # once pushed
npm install
npm run build --workspace client     # client/dist is gitignored
```

**Schema parity:** manual SQL only (history has drifted — never `prisma migrate dev` / `db push`).
Either dump/restore (`pg_dump -Fc` / `pg_restore`) for exact parity, or create the DBs, apply
the tracked Prisma migrations, then every file in `server/prisma/manual-migrations/*.sql` in
date order, then `npx prisma generate`. Load portfolio data through the Admin Import Portfolio page.

**Per-machine, gitignored:** `server/.env` (copy `.env.example`: `DATABASE_URL`, `JWT_SECRET`,
`PORT`, `NODE_ENV`, `PUBLIC_BASE_URL`, `MAIL_*`; the SMTP password is never in git), a test
`DATABASE_URL` in `server/.env.test`, `client/dist`, `node_modules`.

Work on one machine at a time: commit + push there, pull on the other before working.

---

## 6. Running the app
- The server serves the built client (`client/dist`) **only when `NODE_ENV=production`**. In
  that mode one process serves both the API and the web app (this worktree's `.env` uses
  `PORT=5055`, DB `rbu_leasing_sp2`). Start: `NODE_ENV=production node server/src/index.js`.
- After any **client** change: `npm run build --workspace client`, then hard-reload (Ctrl+F5).
  A running server keeps serving the old build until rebuilt; check what is listening on the
  port first if the page looks stale.
- After any **server code** change: restart the node process.
- After any **schema** change: stop the server (Windows holds the Prisma DLL), apply the manual
  SQL to every DB, `npx prisma generate`, restart.
- Dev mode instead: `npx vite` in `client/` proxies `/api` to the API port set in
  `client/vite.config.js` (5050 in this worktree).
- The Claude desktop preview launch config lives outside the repo, at
  `C:\Users\bpm\Documents\RBU Leasing\.claude\launch.json` (configs `sp2-app` 5055,
  `sp2-server` 5050, `sp2-client` 5174, each a `.cmd` beside it).

---

## 7. Project rules (carry into every session)
- **Manual SQL migrations only**, applied to every DB, then `prisma generate`.
- Commit attribution follows the session instructions; recent commits end with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- SMTP password/user stay in `server/.env`; never in the DB, any API response, logs, or client.
- Client tests: `npx vitest run` in `client/`. Server tests: `npm test` in `server/` (forces the
  test DB; never sends real email; the server suite takes several minutes, so run it with a long
  timeout or in the background).
- The SMTP account authenticates (verified earlier); a real proof-of-delivery test send has not
  been run (needs a recipient + go-ahead: `node server/scripts/test-mail.js <you@addr>`).

---

## 8. Open items
- [ ] Smoke-test the import → review → Mark vacant flow on real data.
- [x] Merge `origin/master` into the branch (done 2026-11-06, clean) and scrub the history (done; backup branch `backup/sp2-before-scrub`).
- [ ] Apply the manual SQL (§4.3) to dev, test and prod.
- [ ] Push `sp2/units-blocking` and open the PR; deploy.
- [ ] Build SP3, SP4, SP5.
- [ ] Answer the open data questions on the cleaned workbook (§4).
- [ ] Optional: email proof-of-delivery test.
