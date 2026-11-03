# RBU Leasing — Business Requirements Document (BRD)

**Version:** 2.0 (revised to match the implemented system)
**Date:** 2026-08-12
**Owner:** Residential Business Unit (RBU)
**Supersedes:** 2026-08-05 design spec (v1)

---

## 1. Purpose

The RBU Leasing application is the Residential Business Unit's system of record for
managing residential leasing across the estate portfolio. It centralizes unit owners,
residential units (organized by estate and tower), tenants, lease contracts, and rent
payments, and gives management operational visibility through a live dashboard, a
period-based executive summary, and downloadable Excel reports. The system also provides
self-service portals for unit owners and tenants, plus an administrative back office.

This document describes the business requirements as currently realized. It reflects a
scope that has expanded materially beyond the original v1 design.

## 2. Background & Scope Change

The original v1 design (2026-08-05) covered five records (owners, units, tenants, leases,
payments), a dashboard, an executive summary, Excel reports, and JWT auth with three staff
roles. Several items originally listed as non-goals have since been built:

- A **tenant-facing portal** with document (requirement) uploads.
- A **unit-owner portal** with self-service unit registration and an approval workflow.
- An **Estate → Tower → Unit hierarchy** aligned to the real portfolio.
- An **administrative user-management** back office.
- **Real-data alignment** fields on units and leases to match existing spreadsheets.

This BRD folds those into the official scope.

## 3. Business Objectives

- Maintain a single, authoritative source for owners, units, tenants, leases, and payments.
- Reflect the real portfolio structure (estates and towers) so units are organized and
  reportable the way the business actually operates.
- Give leasing staff efficient day-to-day data management with appropriate controls.
- Give management at-a-glance operational metrics and period-over-period analysis.
- Produce standard leasing reports in Excel without manual compilation.
- Let unit owners register units and track approval status themselves.
- Let tenants submit required documents digitally.

## 4. Stakeholders & User Roles

| Role (system) | Business label | Primary use |
|---|---|---|
| ADMIN | Super Admin | Full control incl. user accounts and administration back office |
| LEASING_OFFICER | O-Lease (Leasing Officer) | Day-to-day management of all leasing records; approvals |
| VIEWER | Viewer | Read-only access to dashboard, summary, and reports |
| UNIT_OWNER | Lessor | Self-service: register units, view own units and approval status |
| TENANT | Lessee | Self-service: upload required documents, view own submissions |

## 5. Portfolio Structure (Estates & Towers)

Units belong to a **Tower**, and each Tower belongs to an **Estate**. The current portfolio:

- **Capitol Commons:** The Royalton, The Imperium, Maven, Empress
- **Greenhills Center:** Viridian in Greenhills, Connor at Greenhills
- **Circulo Verde:** Avila North and South, Majorca Residences, Ibiza Tower, Seville
  Residences, Lleida Tower, Garden Homes
- **Ortigas East:** Maple at Verdant Towers
- **Ortigas Center:** Residences at The Galleon, Olin at Jade Drive

## 6. High-Level Capabilities (Business Requirements)

**BR-1 Authentication & access control.** Users log in with a username/email and password.
Access to features and data is governed by role. Only an administrator can create accounts.

**BR-2 Owner management.** Staff can maintain unit-owner records (name, contact details).
An owner cannot be deleted while they still have units.

**BR-3 Unit management with hierarchy.** Staff can maintain residential units, each assigned
to an estate and tower, with attributes needed by the business (unit/level/slot numbers,
type, size, base rent, occupancy status). Units carry an approval status.

**BR-4 Tenant management.** Staff can maintain tenant records and view tenant-submitted
documents.

**BR-5 Lease management.** Staff can record lease contracts linking a unit and tenant, with
term, rent, deposits, and the commercial terms used in the business (advance rent, security
deposit, mode of payment, service fee, source, renewal period, managed-by, remarks).

**BR-6 Payment recording.** Staff can record rent payments per lease (period, amount, due
date, paid date, method). The system derives overdue and outstanding balances.

**BR-7 Operational dashboard.** All authenticated users see live metrics: occupancy,
monthly rental income, leases expiring in 30/60/90 days, overdue and outstanding amounts,
new leases this month, and portfolio counts.

**BR-8 Executive summary.** Users can view a chosen period (month, quarter, or year) with
totals and prior-period comparisons for income, collections, occupancy, and lease activity.

**BR-9 Excel reports.** Users can download four standard reports: rent roll, collections,
lease expiry, and owner statement.

**BR-10 Unit-owner self-service.** A unit owner can register a unit for approval and track
its status; owners see only their own units, leases, and payments.

**BR-11 Approval workflow.** Owner-submitted units enter a pending state; staff approve or
reject them.

**BR-12 Tenant document uploads.** A tenant can upload required documents (PDF/image/Word);
staff can view and download all tenant documents. Tenants see only their own.

**BR-13 Administration back office.** Administrators manage user accounts and access a
consolidated admin view of all records.

## 7. Assumptions

- Single currency: Philippine Peso (PHP).
- Payments are recorded manually and represent full per-period amounts.
- Estate/tower reference data is seeded and maintained centrally.
- The application is used internally by RBU staff, owners, and tenants (not the public).

## 8. Out of Scope (current version)

- Online rent payment / payment gateway integration.
- Partial-payment allocation within a period.
- Multi-currency support.
- Automated ingestion of filled PDF forms from SharePoint (see §10, deferred).

## 9. Non-Functional Requirements

- **Security:** Passwords hashed (bcrypt); role-based authorization enforced on the server
  for every write operation; JWT-based sessions.
- **Usability:** Responsive web UI with role-appropriate navigation and light/dark themes.
- **Reportability:** Reports exportable to Excel (`.xlsx`).
- **Data integrity:** Referential rules prevent deleting records that are still in use
  (e.g., owners with units, units with leases, leases with payments).

## 10. Known Gaps & Risks (for decision)

- **G-1 Session persistence.** Login state is held in memory only; refreshing the browser
  logs the user out. Recommended for hardening.
- **G-2 Plaintext password storage — resolved 27 Oct 2026.** The system no longer stores a
  recoverable copy of any password; the admin "reveal password" feature is replaced by an
  admin-initiated reset.
- **G-3 SharePoint/PDF import (deferred).** A requested workflow to retrieve filled owner/
  tenant PDF forms from SharePoint and load new records is not built. No SharePoint
  connector is currently available; import utilities exist but there is no import UI/route.
- **G-4 Legacy field redundancy.** Units retain a legacy free-text `building` field
  alongside the newer tower relationship; recommend consolidating.

## 11. Traceability

Functional detail for each business requirement is in the companion document,
`2026-08-12-functional-spec.md`.
