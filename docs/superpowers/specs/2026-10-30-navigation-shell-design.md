# Navigation Restructure & Shell (Sub-Project 1 of the Leasing Revamp)

**Date:** 2026-10-30
**Status:** Design — pending user spec-review
**Branch:** `feat/nav-shell` (off `feat/email-settings` tip `bf1606e`, which carries the still-unmerged import-v2 + owner-accounts + email-settings work)

---

## Program context (the whole revamp)

This is the first of five sequenced sub-projects agreed after the Phase-1 audit. Each is its own spec → plan → subagent-driven build with reviews.

**Locked decisions:** (1) sequenced sub-projects; (2) a signed leasing transaction becomes the source of truth that creates/updates a `Lease`; (3) pipeline-driven unit lifecycle (VACANT/BLOCKED/LEASED/UNAVAILABLE); (4) no new Prospect entity — "Prospect Records" is a view over un-converted inquiries.
**Locked defaults:** business timezone Asia/Manila (configurable); move-in = final pipeline stage + fields; Email History on a Communication page, never the dashboard; executed-contract-date edits ADMIN-only + audited; no page deleted when a nav entry is consolidated.

**Sequence:** **SP1 Navigation & shell (this spec)** → SP2 Units & blocking → SP3 Leasing workflow & move-in → SP4 Leases/expiry/renewal + dashboard analytics → SP5 People/accounts polish + Email History.

---

## Goal

Replace the current two-group staff sidebar with the approved five-group structure, make every grouping collapsible and permission-aware, add a third breadcrumb level for detail pages, and re-home every existing staff route under the new structure — **with zero change to page internals, permissions, business logic, or the data model.** After SP1 the whole app is reachable through the new navigation and nothing functional has changed.

## Scope

**In scope:** the **staff/Admin sidebar only** — navigation structure, grouping, collapse behavior, active highlighting, icons, breadcrumbs, and the route↔group mapping.

**Explicitly out of scope** (each goes to its own sub-project):
- Page-internal redesigns (Units→SP2, Leases/Dashboard→SP4, Owners/Tenants/Accounts + Users/Content/Audit→SP5).
- New destination pages: Unit-Owner Assignments (SP2), Unit Blocking (SP2), Move-In (SP3), Viewing & Follow-Up list (SP3), Document Review / Contract Documents standalone (SP3), Prospect Records (SP5), Email History (SP5). Their nav entries arrive **with** their page so SP1 never ships a link that leads nowhere.
- Dead-code / two-dashboards reconciliation (`DashboardView.vue`, `lib/dashboard.js`, `dashboardService.js`) → SP4.
- The `canWrite` local-shadow inconsistency in Units/Tenants/Leases views → documented below, reconciled in the owning SP with explicit business-rule confirmation (it's a permission change, not a nav concern).
- The Owner and Tenant **portal** menus — left exactly as they are (`OWNER_GROUPS`/`TENANT_GROUPS`). The audit's target is the Admin navigation.
- Data-model / API changes — **none** in SP1.

## Current state (verified)

Nav data lives inline in `client/src/components/AppLayout.vue:48-86` as `STAFF_GROUPS` (two groups: "Workspace", "Administration") with per-item `admin`/`write` flags filtered by the `groups` computed (`:87-92`). Groups are **labeled but not collapsible** (only the whole sidebar collapses to icons at 66px). Breadcrumbs are two segments — brand + the active nav item's label (`currentLabel`, `:98-101`). Active state uses `route.path.startsWith(item.to)` (`:95-97`). Icons come from a fixed feather set in `AppIcon.vue`. Route→role gating is `meta.roles` in `router/index.js`, enforced by `router.beforeEach` (`:136-149`) and, authoritatively, by the server.

## Target navigation (SP1 deliverable)

Top-level groups are **collapsible**; within a group, lightweight **section sub-labels** carry the audit's second level (reusing the existing `navgroup__label`/`navgroup__rule` styling). Every entry below maps to an **existing** route; deferred entries are listed for completeness but are **not rendered** until their sub-project.

| Group | Section | Item (nav label) | Route | Roles | SP1? |
|---|---|---|---|---|---|
| Overview | — | Dashboard | `/app` | STAFF | ✅ re-home |
| Leasing Operations | Units | Unit List | `/app/units` | STAFF | ✅ |
| | Units | Approvals *(existing; exact scope — unit submissions vs broader — confirmed in its owning SP, label kept for now)* | `/app/approvals` | WRITE | ✅ re-home |
| | Units | Import Portfolio | `/app/import` | ADMIN | ✅ |
| | Units | Unit-Owner Assignments | — | — | ⏳ SP2 |
| | Inquiries | Inquiry List | `/app/inquiries` | STAFF | ✅ |
| | Inquiries | Viewing & Follow-Up | — | — | ⏳ SP3 |
| | Leasing Management | Leasing Tracker *(consolidates "Leasing Tracker" + "Leasing Transactions" — one entry)* | `/app/transactions` | STAFF | ✅ consolidate |
| | Leasing Management | Unit Blocking | — | — | ⏳ SP2 |
| | Leasing Management | Leases & Contracts | `/app/leases` | STAFF | ✅ |
| | Leasing Management | Move-In Tracking | — | — | ⏳ SP3 |
| | Requirements & Documents | Requirements Tracking | `/app/requirements` | WRITE | ✅ |
| | Requirements & Documents | Lessor Acceptance Forms *(existing "Lessor Sheets")* | `/app/lessor-sheets` | WRITE | ✅ re-home |
| | Requirements & Documents | Lessee Acceptance Forms *(existing "Lessee Sheets")* | `/app/lessee-sheets` | WRITE | ✅ re-home |
| | Requirements & Documents | Document Review / Contract Documents | — | — | ⏳ SP3 |
| People & Accounts | Unit Owners | Owner Directory | `/app/owners` | STAFF | ✅ |
| | Prospects & Tenants | Tenant Records | `/app/tenants` | STAFF | ✅ |
| | Prospects & Tenants | Prospect Records | — | — | ⏳ SP5 |
| | Account Approvals | Account Approvals | `/app/account-approvals` | WRITE | ✅ |
| Communication | — | Email Configuration | `/app/email-settings` | ADMIN | ✅ re-home |
| Communication | — | Email History | — | — | ⏳ SP5 |
| Administration | — | System Users & Roles | `/app/users` | ADMIN | ✅ |
| | — | Content Manager | `/app/content` | WRITE | ✅ |
| | — | Audit Trail | `/app/audit` | ADMIN | ✅ |

Child/detail routes without their own nav entry stay reachable from their parent page: `metrics/:key`, `transactions/:id`, `owners/new|:id`, `lessor-profile/:id`, `tenants/new|:id`, `units/new|:id`, `units/:id/listing`, `leases/new|:id`, `content/listings`, and `forms` + `forms/:role/:pageKey` (the CMS Form Builder — reached from within Content Manager, no top-level nav entry, matching the target). **No route path changes** (preserves deep links/bookmarks); SP1 only regroups/relabels nav and consolidates the duplicate Tracker entry. Finer audit sub-items (Owner Details, Assigned Units, Owner Account Status; Pending/Verify/Link) are **sections within their page**, not sidebar links.

## Nav mechanics

- **Collapsible groups:** each top-level group collapses/expands; collapsed-group labels persist in `localStorage` (key `rbu.nav.collapsedGroups`, an array of group labels) wrapped in try/catch so a blocked/empty store degrades to "all expanded". Default: all expanded.
- **Active highlighting:** keep `route.path.startsWith(item.to)`; a group containing the active item renders expanded even if the user collapsed it (so the current page is always visible).
- **Icons:** reuse existing `AppIcon` names (one per group header + per item). Add a new feather path to `AppIcon.vue` **only** if no existing name fits; prefer reuse.
- **Breadcrumbs:** extend from two to up to three segments — brand › group › page. Detail/child routes append a fourth crumb that is best-effort in SP1 (the child route's label, e.g. "Owners › Edit", or the `:id`); real record-name crumbs are a per-page enhancement left to the owning SP. Falls back cleanly to the current two-segment form when no match.
- **Responsive:** reuse the existing sidebar full-collapse (icon rail) at the current breakpoint; collapsible groups are independent of it.

## Architecture / components

- **Extract the nav model** out of `AppLayout.vue` into `client/src/lib/nav.js`: a pure data export (the groups→sections→items tree) plus a `visibleNav(role, canWrite)` helper that applies the existing `admin`/`write` filtering. This makes the structure unit-testable and leaves `AppLayout.vue` a renderer. The role-filter logic is moved verbatim (no behavior change).
- `AppLayout.vue`: consume `visibleNav`, render collapsible groups + section sub-labels, wire the collapse-persistence and the breadcrumb builder.
- `router/index.js`: unchanged route paths; this spec does not touch routing beyond confirming every rendered nav `to` resolves. (The nav model and the router stay in sync by test.)

## Data flow / states

Nav is static client data filtered by the auth store's role/`canWrite`; no network calls, so no loading/empty/error states beyond the existing auth gate. The breadcrumb builder must handle an unmatched route (fallback) and a missing detail label (omit the 4th crumb). `localStorage` access is guarded.

## Testing

- `client/src/lib/nav.test.js` (new): `visibleNav` hides `admin` items from non-ADMIN and `write` items from VIEWER/non-write; every item `to` is a non-empty string; no deferred (null-route) entries are present in the shipped model.
- `client/tests/router.test.js`: assert **every** nav `to` in the model resolves to a defined route with compatible `meta.roles` (guards against a nav entry pointing at a nonexistent/role-mismatched route).
- `client/tests/AppLayout.test.js`: the five groups render for an ADMIN; section sub-labels render; a group toggles collapsed/expanded and the choice persists (mock `localStorage`); the active item's group auto-expands; the breadcrumb shows group › page and appends a detail crumb on a child route; permission filtering hides Administration/Communication items for a VIEWER.
- Full client suite + `vite build` stay green. No server tests affected (no server change).

## Risks / constraints

- **Deep-link stability:** keep all route `path`s unchanged — only grouping/labels/consolidation change.
- **Test-count churn:** `AppLayout.test.js` / `router.test.js` may enumerate nav items; update assertions for the new structure (expected, not a regression).
- **No permission drift:** the `admin`/`write` filter logic moves verbatim; SP1 must not change who sees or can do anything. The `canWrite` local-shadow in Units/Tenants/Leases views is left untouched and flagged for its owning SP.
- **Portals untouched:** `OWNER_GROUPS`/`TENANT_GROUPS` and all portal routes stay as-is.
- **No new dependency.**

## Out of scope (restated)

No page-internal redesigns, no new destination pages, no dead-code removal, no data-model/API/permission changes. Those land in SP2–SP5.
