# Leasing requirements: confirmed decisions

**Date:** 2026-10-26
**Status:** Decisions accepted; stages 1-8 awaiting their remaining inputs

This records the answers given to the gap analysis of the existing RBU Leasing
system against the new business requirements (Modules A-G, three roles, no
payment module). Where an answer was "accept the recommendation", the
recommendation is written out here so the decision is not lost.

The principle that governs everything below: **enhance the existing application.**
Preserve existing data, architecture and working features; build only what the
requirements confirm; invent no contractual terms or approval rules.

## Decisions

### Data and import

1. **The live database** is `rbu_leasing` on this machine. It currently holds
   demo data; real data arrives only through the new import.
2. **The workbook** "Unit Lease_Residential Leasing Monitoring" is **still
   needed.** The import engine is built against the known column layout and
   finalised against the real file when it arrives.
3. **Identity and conflicts.**
   - A unit is identified by building/tower + unit number (slot or floor to be
     confirmed against the real workbook).
   - An owner is identified by name.
   - A lease is identified by unit + tenant + start date.
   - On re-import, when the app and the file disagree, the row is **skipped and
     flagged for an officer to decide.** The file never silently overwrites.
   - Imported units stay **unlisted and unpublished** until an officer
     publishes them.

### Roles

4. **ADMIN and VIEWER.** One technical account is kept for user management and
   the audit trail; it is not a business role. Everything else belongs to the
   **Leasing Officer.** VIEWER is retired.
5. **Officers see all** units, owners and tenants, not only assigned owners'.
6. **What each party sees of the other.**
   - Owners see a prospect's name only from the LOI stage.
   - Tenants see the owner's name.
   - Neither sees the other's uploaded documents.
   - The internal event log is hidden from both.

### Inquiries

7. A **prospective tenant** is a tenant record flagged as a prospect, created
   when an officer converts an inquiry; it needs no login. Signing up no longer
   marks an inquiry "Converted". Sources: website, phone, social media, broker,
   marketplace, walk-in, other. Closed and Not Interested inquiries can be
   reopened by an officer. The seven inquiry statuses are those in the
   requirements.

### Documents

8. **Signing is wet-ink** (print, sign, scan, upload), as today. The system
   tracks and stores; it does not e-sign.
   - **Still needed:** the approved LOI and Contract of Lease templates and their
     fill-in fields; who signs for each side; whether a contract has a single
     tenant; and what "LOI submitted" means.
9. **Notarization and distribution are tracked only.**
   - Notarization records the date, the notary and the notarized copy.
   - Distribution records the recipient, the date and the method.
   - Nothing is sent from the application.

### Move-in

10. **Readiness values:** Not Ready, For Review, Ready. **Completed** requires:
    a signed contract on file, all move-in requirements approved, the Property
    Management endorsement recorded, and the actual move-in date entered.
    - **Still needed:** the move-in document list and who submits each, and the
      fields of the endorsement record. Nothing is built for these until given.

### Other

11. **Notifications are in-app only:** a bell and inbox for all three roles, for
    the obvious events (LOI or contract ready to sign, signed document uploaded,
    requirement rejected, move-in scheduled). One shared service, with a switch
    that suppresses notification during import.
12. **Payment-adjacent items stay.** Every lease field and document is kept. The
    "Revenue" metric and the "Service fee paid" label are relabelled. The owner
    bank-details document remains a condition for publishing unless told
    otherwise. No billing or payment feature is added.
13. **Anchor record.** A separate leasing-application record per prospect and
    unit carries the LOI, contract and move-in. The existing pipeline and its
    tests are left untouched.
14. **Stage 0: access-control and credential hardening** is approved. It is done
    and verified before any new module is built.

## Stages

| # | Stage | Blocked on |
| --- | --- | --- |
| 0 | Access-control hardening | one confirmation on credential storage |
| 1 | Excel import (preview, commit, keys) and unit availability | the workbook |
| 2 | Officer unit and owner management | |
| 3 | Inquiries, conversion, in-app notifications | |
| 4 | LOI and contract | the templates and signer details |
| 5 | Move-in | the move-in document list |
| 6 | Three-role permissions | |
| 7 | End-to-end workflow test | |
| 8 | Regression test | |

## Out of scope

No invoice, payment request, due date, proof-of-payment upload, verification,
receipt, SAP integration, or payment dashboard, report or notification.
