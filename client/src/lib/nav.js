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
      { to: "/app/unit-assignments", label: "Unit-Owner Assignments", icon: "users", admin: true },
    ] },
    { label: "Inquiries", items: [
      { to: "/app/inquiries", label: "Inquiry List", icon: "message" },
    ] },
    { label: "Leasing Management", items: [
      { to: "/app/transactions", label: "Leasing Tracker", icon: "activity" },
      { to: "/app/unit-blocking", label: "Unit Blocking", icon: "activity", write: true },
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
