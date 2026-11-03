# RBU Leasing — Functional Specification

**Version:** 2.0 (revised to match the implemented system)
**Date:** 2026-08-12
**Companion to:** `2026-08-12-business-requirements.md`

---

## 1. Architecture Overview

Monorepo with two applications:

- **Client** — Vue 3 (Vite) SPA; Vue Router, Pinia state, Axios HTTP client.
- **Server** — Node.js + Express, layered as routes → controllers → services → Prisma.
  All business calculations live in the service layer.
- **Database** — PostgreSQL via Prisma ORM.
- **Auth** — JWT bearer tokens; role-based middleware.
- **Reports** — ExcelJS (`.xlsx`).

In production the built client is served as static files by the Express server with SPA
fallback. API is mounted under `/api`.

## 2. Roles & Permissions

Five roles (business labels in parentheses):

| System role | Label | Access summary |
|---|---|---|
| ADMIN | Super Admin | All data + user management + admin back office |
| LEASING_OFFICER | O-Lease | Full CRUD on all leasing records; unit approvals; requirements view |
| VIEWER | Viewer | Read-only: dashboard, summary, reports |
| UNIT_OWNER | Lessor | Own units/leases/payments (read); register units (pending approval) |
| TENANT | Lessee | Own documents (upload/view); own leasing data (read) |

**Write access** (create/update/delete on core records) is limited to ADMIN and
LEASING_OFFICER (`requireWrite`). The frontend hides create/edit/delete controls for users
without write access, and the server enforces the same guard on every write route.

**Super Admin protection:** the account `admin@rbu.local` cannot be demoted from ADMIN or
deleted.

## 3. Data Model

### Enumerations
- **Role:** ADMIN, LEASING_OFFICER, VIEWER, UNIT_OWNER, TENANT
- **UnitStatus:** VACANT, OCCUPIED
- **UnitApprovalStatus:** PENDING, APPROVED, REJECTED
- **LeaseStatus:** ACTIVE, EXPIRED, TERMINATED
- **PaymentStatus:** PAID, PENDING, OVERDUE

### Entities

**User** — id, name, email (unique, used as username), passwordHash, passwordPlain
(deprecated: no longer written or read, always null — see §11), role (default VIEWER), optional link to a UnitOwner and/or
Tenant, timestamps.

**Estate** — id, name (unique), has many Towers.

**Tower** — id, name, estate (FK), unique per (estate, name), has many Units.

**UnitOwner** — id, name, email?, phone?, address?; has many Units and Users.

**Unit** — id, owner (FK, required), unitNumber, tower (FK, optional), building (legacy
text, optional), floor?, slotNo?, type (free text, default "OTHER"), sizeSqm?, baseRent
(required), status (default VACANT), approvalStatus (default APPROVED); has many Leases.

**Tenant** — id, name, email?, phone?, address?; has many Leases, Users, and Requirements.

**Requirement** — id, tenant (FK), filename, mimeType, size, data (file bytes), uploadedAt.
Stores uploaded tenant documents directly in the database.

**Lease** — id, unit (FK), tenant (FK), startDate, endDate, monthlyRent, deposit (default 0),
status (default ACTIVE); commercial extras (free text): advanceRent, securityDeposit,
modeOfPayment, serviceFee, source, renewalPeriod, remarks, managedBy; has many Payments.

**Payment** — id, lease (FK), periodMonth, amount, dueDate, paidDate?, status (default
PENDING), method?.

Referential deletes are blocked while dependents exist (owner→units, unit→leases,
lease→payments return HTTP 409).

## 4. Functional Modules

### 4.1 Authentication
- **Login:** user submits username/email + password. On success the server returns a JWT
  and the user profile `{ id, name, email, role, unitOwnerId, tenantId }`. The token payload
  carries `userId, role, unitOwnerId, tenantId`; default expiry 1 day.
- **Session:** stored client-side (in memory). Requests attach `Authorization: Bearer`.
- **Routing by role after login:** unit owners land on My Units, tenants on Requirements,
  all others on the Dashboard.

### 4.2 Owner Management
- List, view, create, edit, delete owners (name, email, phone, address).
- Delete blocked (409) if the owner still has units.

### 4.3 Unit Management (with Estate/Tower hierarchy)
- List units with filters: owner, status, estate, tower, approval status. Each unit resolves
  its tower and estate and its owner.
- Create/edit units with: owner, estate → tower (cascading), unit number, level (floor),
  slot number, type, size (sqm), base rent, status.
- Approve / reject units (staff): dedicated endpoints set approval status.
- Delete blocked (409) if the unit has leases.

### 4.4 Tenant Management
- List, view, create, edit, delete tenants.
- Staff can view/download documents tenants have uploaded (see 4.10).

### 4.5 Lease Management
- List leases with filters: unit, tenant, status.
- Create/edit leases: unit, tenant, start/end dates, monthly rent, deposit, status, plus
  commercial extras (advance rent, security deposit, mode of payment, service fee, source,
  renewal period, managed-by, remarks).
- Delete blocked (409) if the lease has payments.

### 4.6 Payment Management
- List payments with filters: lease, status.
- Create/edit payments: lease, period month, amount, due date, paid date, status, method.

### 4.7 Dashboard (live)
All authenticated users. Metrics (`GET /api/dashboard`):
- **Counts:** owners, tenants, units.
- **Occupancy:** total units, occupied (≥1 active lease), vacant, occupancy rate.
- **Income:** count of active leases + total monthly income (Σ monthlyRent of active leases).
- **New leases this month:** leases starting in the current calendar month.
- **Expiring:** active leases ending within 30 / 31–60 / 61–90 days (non-overlapping buckets).
- **Overdue/outstanding:** count and amount of payments past due and unpaid; total
  outstanding amount across all unpaid payments.

### 4.8 Executive Summary (period-based)
`GET /api/summary?period=month|quarter|year&date=...`. Computes for the selected period and
the immediately prior period, with deltas (change, percent, direction):
- Expected collections (Σ amount of payments due in period).
- Collected / total income (Σ amount of payments paid in period).
- Collection rate.
- New leases (started in period); terminated leases (terminated in period).
- Occupancy rate at period end (point-in-time).
Returns period label ("August 2026", "Q3 2026", "2026"), current vs prior, and deltas.

### 4.9 Reports (Excel)
All return `.xlsx` (bold header row):
- **Rent Roll** (`/api/reports/rent-roll`) — active leases: tenant, unit, owner, monthly
  rent, start, end, outstanding balance.
- **Collections** (`/api/reports/collections?period=&date=`) — payments received in the
  period: paid date, tenant, unit, amount, method.
- **Lease Expiry** (`/api/reports/lease-expiry?days=90`) — active leases ending within the
  window: tenant, unit, owner, end date, days remaining, monthly rent.
- **Owner Statement** (`/api/reports/owner-statement`) — per owner: units, occupied,
  occupancy rate, gross monthly income.

### 4.10 Unit-Owner Portal (Lessor)
- **My Units:** read-only list of the owner's units with approval status.
- **Register Unit:** submit a new unit (estate → tower cascade); created as PENDING for
  staff approval; the owner is forced to their own owner record.
- Owners are auto-scoped: they see only their own units, leases, and payments.

### 4.11 Approvals (Staff)
- List pending units; Approve or Reject each. Approval/rejection sets the unit's approval
  status.

### 4.12 Tenant Portal & Requirements
- **Tenant upload:** a tenant uploads a document (`POST /api/requirements`, single file).
  Allowed types: PDF, JPEG, PNG, DOCX; max 10 MB. File stored in the database, tied to the
  tenant.
- **List/download:** tenants see and download only their own documents; ADMIN and
  LEASING_OFFICER see and download all.

### 4.13 Administration
- **Admin back office:** a tabbed view consolidating Approvals, Requirements, Owners, Units,
  Tenants, Leases, Payments (and Users for ADMIN).
- **User management (ADMIN):** list users, create accounts (assign role, optionally link to
  an owner/tenant), edit (name/email/password/role), delete. Passwords cannot be viewed: an admin who
  needs to give someone access sets a new one (see §11). Super Admin row is protected.

## 5. API Endpoints (summary)

All under `/api`. `A`=any authenticated, `W`=requireWrite (ADMIN/LEASING_OFFICER),
`ADM`=ADMIN only. Health: `GET /api/health`.

**Auth:** POST `/auth/login` (public); POST `/auth/register` (ADM); GET `/auth/users` (ADM);
PATCH `/auth/users/:id` (ADM); DELETE `/auth/users/:id` (ADM); GET `/auth/me` (A).

**Owners / Tenants:** GET `/`, GET `/:id` (A); POST `/`, PATCH `/:id`, DELETE `/:id` (W).

**Units:** GET `/` (A, filters ownerId/status/estateId/towerId/approvalStatus; owners
auto-scoped); GET `/:id` (A); POST `/` (ADMIN/LEASING_OFFICER/UNIT_OWNER; owner→PENDING);
PATCH `/:id/approve` (W); PATCH `/:id/reject` (W); PATCH `/:id` (W); DELETE `/:id` (W).

**Leases:** GET `/` (A, filters unitId/tenantId/status; owners scoped); GET `/:id` (A);
POST/PATCH/DELETE (W).

**Payments:** GET `/` (A, filters leaseId/status; owners scoped); GET `/:id` (A);
POST/PATCH/DELETE (W).

**Dashboard:** GET `/dashboard` (A). **Summary:** GET `/summary` (A).

**Reports:** GET `/reports/rent-roll|collections|lease-expiry|owner-statement` (A).

**Estates/Towers:** GET `/estates` (A); GET `/towers?estateId=` (A).

**Requirements:** POST `/requirements` (TENANT); GET `/requirements` (TENANT/ADMIN/
LEASING_OFFICER); GET `/requirements/:id/download` (same).

## 6. Validation Rules (server, Zod)

- **Owner/Tenant:** name required (non-empty); email must be email format if present; phone,
  address optional.
- **Unit:** ownerId and unitNumber required; baseRent required, numeric, ≥0; sizeSqm numeric
  ≥0 if present; status in {VACANT, OCCUPIED}; towerId and text fields optional.
- **Lease:** unitId, tenantId, startDate, endDate, monthlyRent required (rent ≥0); deposit
  ≥0 optional; status in {ACTIVE, EXPIRED, TERMINATED}; commercial extras optional text.
- **Payment:** leaseId, periodMonth, amount (≥0), dueDate required; paidDate optional;
  status in {PAID, PENDING, OVERDUE}; method optional.
- **User (register):** name required; email/username ≥3 chars; password ≥6 chars; role
  optional (one of the five); owner/tenant link optional and validated against real records.
- FK existence is checked on create/update (invalid references rejected).

## 7. Client Screens & Navigation

- **Public:** Login.
- **Staff (ADMIN/LEASING_OFFICER/VIEWER):** Dashboard, Summary, Reports, Owners, Units,
  Tenants, Leases, Payments; plus (write roles) Approvals and the Master Admin back office;
  Users (ADMIN only).
- **Unit Owner:** My Units, Register Unit.
- **Tenant:** Requirements.
- Navigation adapts to role; unauthorized routes redirect. Light/dark theme toggle persists
  locally. Currency displays as PHP; dates in a consistent short format.

Reusable components: AppLayout (nav shell), ResourceTable (generic list with role-gated
actions), ResourceForm (generic form), MultiSelect (estate/tower filters).

## 8. Business Rules & Calculations (reference)

- **Occupancy:** a unit is occupied if it has at least one ACTIVE lease.
- **Overdue payment:** paidDate is null AND dueDate < now.
- **Outstanding:** sum of amounts for all payments with no paid date.
- **Monthly income:** sum of monthlyRent across ACTIVE leases.
- **Expiry buckets:** 0–30, 31–60, 61–90 days from now, non-overlapping.
- **Period occupancy (summary):** measured at the last day of the period.
- **Collection rate:** collected ÷ expected for the period (0 if expected is 0).

## 9. Non-Functional Requirements

- **Security:** bcrypt password hashing; JWT sessions; server-side role enforcement on all
  writes; super-admin protection.
- **Data integrity:** referential delete guards (HTTP 409).
- **Portability/Reporting:** Excel export via ExcelJS.
- **Maintainability:** business logic isolated in the service layer; generic UI components.

## 10. Testing

Server test suite (Vitest/Supertest) covers: auth service/middleware/routes and user
provisioning; CRUD + validation + conflict rules for owners, tenants, units, leases,
payments; dashboard occupancy/income/expiry and endpoint; summary periods/metrics/deltas and
endpoint; report rows and xlsx endpoints; date helpers; estate/tower seeding, endpoints, and
unit hierarchy filtering; unit-owner scoping and pending-approval creation; owner/tenant
read-only scoping; requirements upload/list/download and scoping; schema-field presence;
import/tower-map utilities.

## 11. Known Gaps (carried from BRD §10)

- **Session persistence:** in-memory only; refresh logs out. *Recommended fix.*
- **Plaintext passwords — resolved 27 Oct 2026:** the system no longer stores or returns a
  readable password; the admin reveal is replaced by an admin reset. The `passwordPlain`
  column remains (always null) so older backups stay valid; dropping it is a separate decision.
- **SharePoint/PDF import:** not implemented; no connector available. Import utilities
  (`importClean`, `towerMap`) exist but there is no import route or UI. *Deferred.*
- **Legacy `building` field:** redundant with the tower relation; consolidate.
- **Partial payments / payment gateway / multi-currency:** not implemented (out of scope).
- **Lease expiry report:** endpoint covered by route tests but has no dedicated row-level
  unit test. *Minor test gap.*
