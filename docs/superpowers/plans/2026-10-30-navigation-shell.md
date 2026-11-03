# Navigation Restructure & Shell (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the staff sidebar with the approved five-group, collapsible, permission-aware navigation (+ section sub-labels, a 3rd breadcrumb level, and the consolidated Leasing Tracker entry), re-homing every existing staff route — with no change to page internals, permissions, routing, or the data model.

**Architecture:** Extract the sidebar model out of `AppLayout.vue` into a pure, unit-testable module `client/src/lib/nav.js` (groups → sections → items + a `visibleNav(role, canWrite)` role filter moved verbatim). `AppLayout.vue` becomes a renderer that consumes it, adds collapsible groups (state persisted in `localStorage`) and a brand › group › page breadcrumb. Routes are unchanged; a test proves every nav destination resolves to a real, correctly-gated route.

**Tech Stack:** Vue 3 (`<script setup>`), vue-router, Pinia, `@vue/test-utils` + Vitest, the existing `AppIcon` feather set and `app.css` token system.

## Global Constraints

- **Client-only.** No server, schema, migration, or API changes in SP1.
- **Staff/Admin sidebar only.** The Owner and Tenant portal menus and all portal routes are moved **verbatim** — no behavior change.
- **No route-path changes.** Only nav grouping/labels + the duplicate-entry consolidation change; deep links/bookmarks must keep working.
- **No permission change.** The `admin`/`write` filter logic moves verbatim (`admin` ⇒ role ADMIN; `write` ⇒ `canWrite` = ADMIN|LEASING_OFFICER). Nobody gains or loses access. Do **not** touch the `canWrite` local-shadow in Units/Tenants/Leases views.
- **Reuse existing `AppIcon` names** (grid, message, users, building, user, file, check, clipboard, folder, shield, list, columns, activity, download, chevron, chevron-down, …). Do not invent icon names.
- **No new npm dependency.**
- Every commit ends with the trailer line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Sidebar labels (final): Dashboard · Unit List · Approvals · Import Portfolio · Inquiry List · Leasing Tracker · Leases & Contracts · Requirements Tracking · Lessor Sheets · Lessee Sheets · Owner Directory · Tenant Records · Account Approvals · Email Configuration · System Users & Roles · Content Manager · Audit Trail. (Sheets keep their existing labels to match their page titles.)
- Deferred (NOT added to the sidebar in SP1 — they arrive with their page): Unit-Owner Assignments, Unit Blocking, Move-In, Viewing & Follow-Up list, Document Review/Contract Documents, Prospect Records, Email History.

---

### Task 1: Nav model module (`client/src/lib/nav.js`) + tests

**Files:**
- Create: `client/src/lib/nav.js`
- Test: `client/tests/nav.test.js` (new)
- Test: `client/tests/router.test.js` (append two tests)

**Interfaces:**
- Produces: `STAFF_NAV`, `OWNER_NAV`, `TENANT_NAV` (arrays of `{ label: string|null, sections: [{ label?: string|null, items: [{ to, label, icon, admin?, write? }] }] }`); `visibleNav(role, canWrite) -> filtered nav array` (empty sections/groups dropped); `navItems(nav) -> flat item array`.

- [ ] **Step 1: Write the failing unit tests**

Create `client/tests/nav.test.js`:
```js
import { describe, it, expect } from "vitest";
import { STAFF_NAV, OWNER_NAV, TENANT_NAV, visibleNav, navItems } from "../src/lib/nav.js";

describe("nav model", () => {
  it("shows ADMIN-only items only to ADMIN", () => {
    const admin = navItems(visibleNav("ADMIN", true)).map((i) => i.to);
    const officer = navItems(visibleNav("LEASING_OFFICER", true)).map((i) => i.to);
    expect(admin).toContain("/app/users");
    expect(admin).toContain("/app/import");
    expect(officer).not.toContain("/app/users");
    expect(officer).not.toContain("/app/import");
  });

  it("shows write items to officers but not viewers, keeping plain staff items", () => {
    const officer = navItems(visibleNav("LEASING_OFFICER", true)).map((i) => i.to);
    const viewer = navItems(visibleNav("VIEWER", false)).map((i) => i.to);
    expect(officer).toContain("/app/approvals");
    expect(viewer).not.toContain("/app/approvals");
    expect(viewer).toContain("/app/units");
  });

  it("gives owners and tenants their own nav", () => {
    expect(navItems(visibleNav("UNIT_OWNER", false)).map((i) => i.to)).toContain("/app/my-units");
    const tenant = navItems(visibleNav("TENANT", false)).map((i) => i.to);
    expect(tenant).toContain("/app/my-lease");
    expect(tenant).not.toContain("/app/owners");
  });

  it("drops groups left empty after filtering", () => {
    const viewer = visibleNav("VIEWER", false);
    expect(viewer.find((g) => g.label === "Communication")).toBeUndefined(); // email config is admin-only
    expect(viewer.find((g) => g.label === "Administration")).toBeUndefined();
    expect(viewer.find((g) => g.label === "Overview")).toBeTruthy();
  });

  it("every shipped item has a non-empty route and label", () => {
    for (const nav of [STAFF_NAV, OWNER_NAV, TENANT_NAV]) {
      for (const i of navItems(nav)) {
        expect(typeof i.to).toBe("string");
        expect(i.to.length).toBeGreaterThan(0);
        expect(i.label.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run tests/nav.test.js`
Expected: FAIL — cannot resolve `../src/lib/nav.js`.

- [ ] **Step 3: Create the nav model**

Create `client/src/lib/nav.js`:
```js
// Single source of truth for the sidebar navigation. Pure data + a role
// filter so the structure is unit-testable and AppLayout stays a renderer.
// Role gating is moved verbatim from the former inline groups in
// AppLayout.vue: `admin` => ADMIN only; `write` => canWrite (ADMIN|
// LEASING_OFFICER); otherwise visible to everyone in that role's nav.

export const STAFF_NAV = [
  { label: "Overview", sections: [
    { items: [{ to: "/app", label: "Dashboard", icon: "grid" }] },
  ] },
  { label: "Leasing Operations", sections: [
    { label: "Units", items: [
      { to: "/app/units", label: "Unit List", icon: "building" },
      { to: "/app/approvals", label: "Approvals", icon: "check", write: true },
      { to: "/app/import", label: "Import Portfolio", icon: "download", admin: true },
    ] },
    { label: "Inquiries", items: [
      { to: "/app/inquiries", label: "Inquiry List", icon: "message" },
    ] },
    { label: "Leasing Management", items: [
      { to: "/app/transactions", label: "Leasing Tracker", icon: "activity" },
      { to: "/app/leases", label: "Leases & Contracts", icon: "file" },
    ] },
    { label: "Requirements & Documents", items: [
      { to: "/app/requirements", label: "Requirements Tracking", icon: "folder", write: true },
      { to: "/app/lessor-sheets", label: "Lessor Sheets", icon: "clipboard", write: true },
      { to: "/app/lessee-sheets", label: "Lessee Sheets", icon: "clipboard", write: true },
    ] },
  ] },
  { label: "People & Accounts", sections: [
    { label: "Unit Owners", items: [
      { to: "/app/owners", label: "Owner Directory", icon: "users" },
    ] },
    { label: "Prospects & Tenants", items: [
      { to: "/app/tenants", label: "Tenant Records", icon: "user" },
    ] },
    { label: "Account Approvals", items: [
      { to: "/app/account-approvals", label: "Account Approvals", icon: "shield", write: true },
    ] },
  ] },
  { label: "Communication", sections: [
    { items: [{ to: "/app/email-settings", label: "Email Configuration", icon: "message", admin: true }] },
  ] },
  { label: "Administration", sections: [
    { items: [
      { to: "/app/users", label: "System Users & Roles", icon: "shield", admin: true },
      { to: "/app/content", label: "Content Manager", icon: "columns", write: true },
      { to: "/app/audit", label: "Audit Trail", icon: "list", admin: true },
    ] },
  ] },
];

// Portals — one unlabelled group each, moved verbatim from AppLayout.
export const OWNER_NAV = [
  { label: null, sections: [{ items: [
    { to: "/app/my-units", label: "My Units", icon: "building" },
    { to: "/app/leasing-progress", label: "Leasing Progress", icon: "activity" },
    { to: "/app/info-sheet", label: "Acceptance Form", icon: "clipboard" },
    { to: "/app/lessor-requirements", label: "Requirements", icon: "folder" },
    { to: "/app/my-leases", label: "My Leases", icon: "file" },
    { to: "/app/my-profile", label: "My Profile", icon: "user" },
  ] }] },
];
export const TENANT_NAV = [
  { label: null, sections: [{ items: [
    { to: "/app/my-lease", label: "My Lease", icon: "file" },
    { to: "/app/browse-units", label: "Available Units", icon: "building" },
    { to: "/app/leasing-progress", label: "Leasing Progress", icon: "activity" },
    { to: "/app/info-sheet-tenant", label: "Acceptance Form", icon: "clipboard" },
    { to: "/app/requirements", label: "Requirements", icon: "folder" },
    { to: "/app/my-profile", label: "My Profile", icon: "user" },
  ] }] },
];

export function visibleNav(role, canWrite) {
  const base = role === "UNIT_OWNER" ? OWNER_NAV : role === "TENANT" ? TENANT_NAV : STAFF_NAV;
  const allow = (i) => (i.admin ? role === "ADMIN" : i.write ? !!canWrite : true);
  return base
    .map((g) => ({
      label: g.label,
      sections: g.sections
        .map((s) => ({ label: s.label ?? null, items: s.items.filter(allow) }))
        .filter((s) => s.items.length),
    }))
    .filter((g) => g.sections.length);
}

export function navItems(nav) {
  return nav.flatMap((g) => g.sections.flatMap((s) => s.items));
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd client && npx vitest run tests/nav.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing router-consistency tests**

Append to `client/tests/router.test.js` (add the import at the top with the others, then the two `it` blocks inside the `describe("router", …)`):
```js
import { STAFF_NAV, OWNER_NAV, TENANT_NAV, navItems } from "../src/lib/nav.js";
```
```js
  it("every sidebar destination resolves to a real, role-gated app route", () => {
    for (const nav of [STAFF_NAV, OWNER_NAV, TENANT_NAV]) {
      for (const item of navItems(nav)) {
        const r = router.resolve(item.to);
        expect(r.matched.length, `${item.to} should match a route`).toBeGreaterThan(0);
        expect(r.meta.roles, `${item.to} should be role-gated`).toBeTruthy();
      }
    }
  });

  it("admin/write sidebar items point at correctly-gated routes", () => {
    for (const item of navItems(STAFF_NAV)) {
      const roles = router.resolve(item.to).meta.roles;
      if (item.admin) {
        expect(roles, item.to).toContain("ADMIN");
        expect(roles, item.to).not.toContain("LEASING_OFFICER");
        expect(roles, item.to).not.toContain("VIEWER");
      } else if (item.write) {
        expect(roles, item.to).toContain("ADMIN");
        expect(roles, item.to).toContain("LEASING_OFFICER");
      }
    }
  });
```

- [ ] **Step 6: Run the router tests to verify they pass**

Run: `cd client && npx vitest run tests/router.test.js`
Expected: PASS — all existing router tests plus the two new ones (every current nav `to` already maps to a defined `/app` route with the expected gating).

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/nav.js client/tests/nav.test.js client/tests/router.test.js
git commit -m "feat(nav): extract sidebar model to lib/nav.js with role filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: AppLayout renders the new grouped, collapsible nav + 3-level breadcrumb

**Files:**
- Modify: `client/src/components/AppLayout.vue` (the nav data in `<script setup>`, the `<nav class="sidebar__nav">` and `<div class="crumbs">` template blocks, and `<style>` additions)
- Test: `client/tests/AppLayout.test.js` (update the stale label list; add collapse + breadcrumb tests)

**Interfaces:**
- Consumes: `visibleNav(role, canWrite)` and `navItems(nav)` from `../lib/nav.js` (Task 1).
- Preserves (unchanged public behavior other tests rely on): classes `.sidebar__nav`, `.navlink`, `.navlink__badge`, `.crumbs__here`, `.userchip`, `.bell`, `button.logout`; the `pendingFor`/`badge` account-approvals badge; `isActive`; `onNav`; the whole top bar (bell, user menu) and `<main>`.

- [ ] **Step 1: Update the stale nav-label test (expected to fail against current code)**

In `client/tests/AppLayout.test.js`, replace the label array in the "lists the staff functions in the sidebar" test (currently line ~40):
```js
  it("lists the staff functions in the sidebar", async () => {
    const nav = mountAs("LEASING_OFFICER").find(".sidebar__nav").text();
    for (const label of ["Dashboard", "Inquiry List", "Owner Directory", "Unit List", "Tenant Records", "Leases & Contracts", "Approvals", "Lessor Sheets", "Lessee Sheets"]) {
      expect(nav).toContain(label);
    }
  });
```

- [ ] **Step 2: Add the collapse + breadcrumb tests**

Add these inside the top-level `describe("AppLayout (sidebar shell)", …)` in `client/tests/AppLayout.test.js`:
```js
  it("groups the sidebar and shows a group's section labels", () => {
    const nav = mountAs("ADMIN").find(".sidebar__nav").text();
    expect(nav).toContain("Leasing Operations"); // group header
    expect(nav).toContain("Requirements & Documents"); // section sub-label
    expect(nav).toContain("Communication");
  });

  it("collapses a group on click and remembers it", async () => {
    const w = mountAs("ADMIN"); // active route is /app (Overview), so other groups may collapse
    const group = w.findAll(".navgroup").find((g) => g.text().includes("Leasing Operations"));
    const toggle = group.find(".navgroup__toggle");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(group.find(".navgroup__items").isVisible()).toBe(false);
    expect(JSON.parse(localStorage.getItem("rbu.nav.collapsedGroups"))).toContain("Leasing Operations");
  });

  it("keeps the active group expanded even if stored collapsed", async () => {
    localStorage.setItem("rbu.nav.collapsedGroups", JSON.stringify(["Leasing Operations"]));
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "T", role: "ADMIN" } });
    const router = makeRouter(); router.push("/app/units"); await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    const group = w.findAll(".navgroup").find((g) => g.text().includes("Leasing Operations"));
    expect(group.find(".navgroup__items").isVisible()).toBe(true);
  });

  it("shows a group › page breadcrumb", async () => {
    const auth = useAuthStore();
    auth.setSession({ token: "t", user: { name: "T", role: "ADMIN" } });
    const router = makeRouter(); router.push("/app/units"); await router.isReady();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find(".crumbs__group").text()).toBe("Leasing Operations");
    expect(w.find(".crumbs__here").text()).toBe("Unit List");
  });
```

- [ ] **Step 3: Run the AppLayout tests to verify the new ones fail**

Run: `cd client && npx vitest run tests/AppLayout.test.js`
Expected: FAIL — new labels/`.navgroup__toggle`/`.crumbs__group`/section labels don't exist yet (and the updated label list fails against the old nav).

- [ ] **Step 4: Rewrite the nav data + logic in `AppLayout.vue`'s `<script setup>`**

In `client/src/components/AppLayout.vue`: **delete** the inline `const STAFF_GROUPS = […]`, `const OWNER_GROUPS = […]`, `const TENANT_GROUPS = […]`, the `const groups = computed(…)` and `const allItems = computed(…)` blocks. Add the import near the other imports:
```js
import { visibleNav, navItems } from "../lib/nav.js";
```
Replace them with:
```js
const groups = computed(() => visibleNav(auth.role, auth.canWrite));
const allItems = computed(() => navItems(groups.value));

// --- Collapsible groups (persisted per viewer) ---
const COLLAPSE_KEY = "rbu.nav.collapsedGroups";
function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); }
  catch { return new Set(); }
}
const collapsedGroups = ref(loadCollapsed());
function persistCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedGroups.value])); }
  catch { /* storage unavailable — collapse is per-session only */ }
}
function groupHasActive(group) {
  return group.sections.some((s) => s.items.some((i) => isActive(i.to)));
}
function isCollapsed(group) {
  if (!sidebarOpen.value || !group.label) return false; // icon-rail & portals never collapse
  if (groupHasActive(group)) return false;              // the active group stays open
  return collapsedGroups.value.has(group.label);
}
function toggleGroup(label) {
  if (!label) return;
  const next = new Set(collapsedGroups.value);
  next.has(label) ? next.delete(label) : next.add(label);
  collapsedGroups.value = next;
  persistCollapsed();
}
const currentGroup = computed(() => groups.value.find(groupHasActive)?.label || "");
```
Keep the existing `isActive`, `currentLabel` (it already reads `allItems`), `pendingFor`, `badge`, `onNav`, `brandName`, etc. unchanged. Ensure `ref`/`computed` are already imported (they are).

- [ ] **Step 5: Replace the `<nav class="sidebar__nav">` block in the template**

Replace the entire existing `<nav class="sidebar__nav"> … </nav>` with:
```html
      <nav class="sidebar__nav">
        <div v-for="(g, gi) in groups" :key="g.label ?? gi" class="navgroup">
          <button
            v-if="g.label && sidebarOpen"
            type="button" class="navgroup__toggle"
            :aria-expanded="!isCollapsed(g)"
            @click="toggleGroup(g.label)"
          >
            <span class="navgroup__label">{{ g.label }}</span>
            <AppIcon name="chevron-down" :size="14" class="navgroup__caret" :class="{ 'is-collapsed': isCollapsed(g) }" />
          </button>
          <div v-else-if="g.label && gi > 0" class="navgroup__rule"></div>
          <div v-show="!isCollapsed(g)" class="navgroup__items">
            <template v-for="(s, si) in g.sections" :key="si">
              <p v-if="s.label && sidebarOpen" class="navsection__label">{{ s.label }}</p>
              <RouterLink
                v-for="l in s.items" :key="l.to" :to="l.to"
                class="navlink" :class="{ active: isActive(l.to) }"
                :title="!sidebarOpen ? l.label : undefined" @click="onNav"
              >
                <span class="navlink__icon"><AppIcon :name="l.icon" :size="18" /></span>
                <span v-if="sidebarOpen" class="navlink__label">{{ l.label }}</span>
                <span
                  v-if="canAct && pendingFor(l.to) > 0"
                  class="navlink__badge"
                  :title="`${pendingFor(l.to)} awaiting action`"
                >{{ badge(pendingFor(l.to)) }}</span>
              </RouterLink>
            </template>
          </div>
        </div>
      </nav>
```

- [ ] **Step 6: Replace the `<div class="crumbs">` block in the template**

Replace the existing crumbs block with:
```html
        <div class="crumbs">
          <span class="crumbs__root">{{ brandName }}</span>
          <template v-if="currentGroup">
            <AppIcon name="chevron" :size="13" class="crumbs__sep" />
            <span class="crumbs__group">{{ currentGroup }}</span>
          </template>
          <AppIcon name="chevron" :size="13" class="crumbs__sep" />
          <span class="crumbs__here">{{ currentLabel }}</span>
        </div>
```

- [ ] **Step 7: Add styles for the toggle, caret, and section label**

Add to the component's `<style scoped>` (near the existing `.navgroup__label`/`.navgroup__rule` rules; reuse their look):
```css
.navgroup__toggle {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 0; margin: 0; background: none; border: 0;
  color: inherit; font: inherit; cursor: pointer;
}
.navgroup__caret { opacity: .6; transition: transform .15s ease; }
.navgroup__caret.is-collapsed { transform: rotate(-90deg); }
.navgroup__items { display: flex; flex-direction: column; }
.navsection__label {
  margin: .5rem 0 .15rem; padding-left: .25rem;
  font-size: .68rem; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; opacity: .55;
}
.crumbs__group { opacity: .75; }
```

- [ ] **Step 8: Run the AppLayout tests to verify they pass**

Run: `cd client && npx vitest run tests/AppLayout.test.js`
Expected: PASS — all existing tests (bell/badge/logout/owner-tenant/CMS-label/breadcrumb-rename) plus the new group/collapse/breadcrumb tests.

- [ ] **Step 9: Run the full client suite + build**

Run: `cd client && npx vitest run` then `cd client && npm run build`
Expected: all suites green; build succeeds. If any other test referenced an old nav label, update that assertion to the new label (see Global Constraints) — do not change page internals.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/AppLayout.vue client/tests/AppLayout.test.js
git commit -m "feat(nav): grouped collapsible sidebar + group>page breadcrumb

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verify (controller-run — no new code)

**Files:** none (verification only).

- [ ] **Step 1: Full client suite**

Run: `cd client && npx vitest run`
Expected: all files green (prior baseline 431/431 plus the new nav/collapse/breadcrumb tests; the two added router tests).

- [ ] **Step 2: Production build**

Run: `cd client && npm run build`
Expected: `vite build` succeeds (pre-existing >500 kB chunk warning is unrelated).

- [ ] **Step 3: Browser smoke of the new navigation**

Start the dev preview and, signed in as ADMIN, confirm: the five groups render with section sub-labels; collapsing a group persists across a reload; the active page's group auto-expands; breadcrumb reads brand › group › page; every sidebar link navigates to its existing page (no 404, no redirect-to-home); the Owner and Tenant portals are unchanged. Capture one screenshot of the ADMIN sidebar for the record.

- [ ] **Step 4: Confirm no permission drift**

Signed in as VIEWER: the Administration and Communication groups do not appear, and `write` items (Approvals, Requirements Tracking, Content Manager, Account Approvals, Sheets) are hidden — matching pre-SP1 behavior.

---

## Self-Review

**1. Spec coverage** — five-group collapsible permission-aware nav (Task 2), section sub-labels (Task 2), re-home every staff route + consolidate Leasing Tracker/Transactions (Task 1 model + Task 2 render), 3rd breadcrumb level (Task 2), valid routes for all nav items (Task 1 router test), portals untouched (model moves them verbatim), no route-path/permission/data change (Global Constraints; verified Task 3 Step 4), nav model testable in isolation (Task 1). Deferred destinations intentionally excluded (Global Constraints). Covered.

**2. Placeholder scan** — every code step contains complete code; test commands have explicit expected outcomes. None.

**3. Type/name consistency** — `visibleNav(role, canWrite)` and `navItems(nav)` are produced in Task 1 and consumed with the same signatures in Task 2; the nav item shape `{ to, label, icon, admin?, write? }` and group/section shape are identical across the module, the renderer, and the tests; preserved classes (`.navlink__badge`, `.crumbs__here`, etc.) match the untouched top-bar/badge logic and the existing tests. `localStorage` key `rbu.nav.collapsedGroups` is identical in the component and its test. Consistent.

## Execution Handoff

Recommended: **superpowers:subagent-driven-development** — fresh implementer per task + a task review (spec + quality) after each, then a final whole-branch review, exactly as the email-settings feature was built.
