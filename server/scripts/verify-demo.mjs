// Signs in as every seeded account and checks what that role actually sees.
//
// Read-only: the only writes are logins. Safe to run against the live system.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { issueToken } from "../src/services/authService.js";

const BASE = process.env.VERIFY_BASE || "http://localhost:5050/api";
let pass = 0, fail = 0;
const fails = [];
const log = (...a) => console.log(...a);
const section = (t) => log(`\n${"═".repeat(70)}\n  ${t}\n${"═".repeat(70)}`);

function ok(label, detail = "") { pass++; log(`   PASS  ${label}${detail ? `  ·  ${detail}` : ""}`); }
function bad(label, detail = "") { fail++; fails.push(`${label} — ${detail}`); log(`   FAIL  ${label}  ·  ${detail}`); }
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) ok(label, String(actual)); else bad(label, `expected ${e}, got ${a}`);
}

async function raw(method, path, token) {
  const res = await fetch(`${BASE}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const get = async (path, token) => {
  const r = await raw("GET", path, token);
  if (r.status >= 400) throw new Error(`GET ${path} -> ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`);
  return r.data;
};
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ───────────────────────────────────────────────────────── public visitor
section("PUBLIC VISITOR — no account");
const listings = await get("/public/units");
check("published listings visible", listings.length, 4);
const withPhotos = listings.filter((u) => (u.photoIds || []).length > 0).length;
check("every listing carries photos", withPhotos, listings.length);
const priced = listings.filter((u) => Number.isFinite(Number(u.details?.rentalRate))).length;
check("every listing has a numeric rental rate", priced, listings.length);
const leaked = listings.filter((u) => u.details?.availabilityStatus === "Leased").length;
check("leased units are not advertised", leaked, 0);
log(`   listings: ${listings.map((l) => l.headline).join(" · ")}`);

// ─────────────────────────────────────────────────────────────────── admin
section("ADMIN — Super Admin");
const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true } });
const adminTok = issueToken({ id: admin.id, role: "ADMIN" });
// The Users list holds approved accounts only — pending applications live in
// Account Approvals, and rejected ones are deleted outright.
check("system users (approved only)", (await get("/auth/users", adminTok)).length, 8);
check("  plus one pending, 9 accounts in total", await prisma.user.count(), 9);
const pending = await get("/auth/pending", adminTok);
check("accounts awaiting approval", pending.length, 1);
check("the pending applicant is Rosa Mendoza", pending[0]?.name, "Rosa Mendoza");
check("all inquiries visible", (await get("/inquiries", adminTok)).length, 4);
// 3 are the hand-walked demo transactions (A/B/C); the other 6 are the
// onboarding transactions approving each of the 6 approved units opens
// automatically (one per unit: u1, u2, u4, u6, u7, u8).
check("all transactions visible", (await get("/leasing-transactions", adminTok)).length, 9);
check("owners", (await get("/owners", adminTok)).length, 2);
check("tenants", (await get("/tenants", adminTok)).length, 2);
check("leases", (await get("/leases", adminTok)).length, 2);
const units = await get("/units", adminTok);
check("units", units.length, 8);
const byStatus = units.reduce((m, u) => ((m[u.approvalStatus] = (m[u.approvalStatus] || 0) + 1), m), {});
check("units span every approval status", Object.keys(byStatus).sort(), ["APPROVED", "DRAFT", "REJECTED"]);
log(`   unit states: ${JSON.stringify(byStatus)}`);
const rejected = units.find((u) => u.approvalStatus === "REJECTED");
if (rejected?.reviewRemarks) ok("the rejected unit carries a remark", `"${rejected.reviewRemarks.slice(0, 52)}…"`);
else bad("rejected unit should carry a remark", JSON.stringify(rejected?.reviewRemarks));
const audit = await get("/audit", adminTok);
check("audit trail is populated", audit.length > 100, true);

// ───────────────────────────────────────────────────────────────── officers
section("LEASING OFFICERS");
const cruz = (await login("officer.cruz", "Leasing2026!")).body.token;
const reyes = (await login("officer.reyes", "Leasing2026!")).body.token;
if (cruz && reyes) ok("both officers sign in"); else bad("officer login failed");

const cruzInq = await get("/inquiries", cruz);
const cruzTxn = await get("/leasing-transactions", cruz);
log(`   Cruz  — ${cruzInq.length} inquiries in view, ${cruzTxn.length} transactions`);
const reyesTxn = await get("/leasing-transactions", reyes);
log(`   Reyes — ${reyesTxn.length} transactions`);
// An officer sees their own plus the unassigned pool, never another's alone.
const cruzOwn = cruzTxn.filter((t) => t.assignedOfficer?.name === "Ramon Cruz").length;
const reyesOwn = reyesTxn.filter((t) => t.assignedOfficer?.name === "Elena Reyes").length;
if (cruzOwn && reyesOwn) ok("each officer holds their own transactions", `Cruz ${cruzOwn}, Reyes ${reyesOwn}`);
else bad("officers should each own transactions", `Cruz ${cruzOwn}, Reyes ${reyesOwn}`);

const all = await get("/leasing-transactions", adminTok);
const stages = all.map((t) => `${t.reference} ${t.stage}/${t.status}`).sort();
log(`   pipeline:`);
stages.forEach((s) => log(`     ${s}`));
const signed = all.find((t) => t.stage === "CONTRACT_SIGNING");
check("one transaction reached Contract Signing", signed?.status, "Signed");
check("  and its finalStatus is written", signed?.finalStatus, "Signed");
const signedFull = await get(`/leasing-transactions/${signed.id}`, adminTok);
const docTypes = (signedFull.documents || []).map((d) => d.docType).sort();
check("  with both typed documents on file", docTypes, ["LETTER_OF_INTENT", "SIGNED_CONTRACT"]);
check("  and an event history", signedFull.events.length > 10, true);
const approval = all.find((t) => t.stage === "APPROVAL");
const steps = await get(`/leasing-transactions/${approval.id}/approval-steps`, adminTok);
check("the mid-approval transaction has 2 of 4 signed", steps.filter((s) => s.status === "Approved").length, 2);

// An officer's dashboard is scoped to units whose owner is assigned to them;
// admin and viewer see the whole portfolio. Cruz holds Maria Santos (5 units).
const dashCruz = await get("/dashboard/executive", cruz);
const dashAdmin = await get("/dashboard/executive", adminTok);
check("officer dashboard is scoped to their assigned owner", dashCruz.all.length, 5);
check("admin dashboard sees the whole portfolio", dashAdmin.all.length, 8);
// The expected counts come from the lease data itself, by the dashboard's own
// rule (a lease counts while it has not ended and is not terminated). Fixed
// numbers were true only on the day the demo data was seeded, and fail as the
// calendar moves past its lease dates — which says nothing about the dashboard.
const leaseRows = await get("/leases", adminTok);
const nowMs = Date.now();
const running = leaseRows.filter((l) => new Date(l.endDate).getTime() >= nowMs && l.status !== "TERMINATED");
const endingSoon = running.filter((l) => (new Date(l.endDate).getTime() - nowMs) / 86400000 <= 30);
check("dashboard counts every lease still running", dashAdmin.leased.length, new Set(running.map((l) => l.unitId)).size);
check("near-expiry bucket matches the leases ending within 30 days", dashAdmin.summary.buckets.within30, new Set(endingSoon.map((l) => l.unitId)).size);
log(`   occupancy ${dashAdmin.summary.occupancyRate}% · monthly active rent PHP ${Number(dashAdmin.summary.monthlyActiveRent).toLocaleString("en-PH")}`);

// ─────────────────────────────────────────────────────────────────── viewer
section("VIEWER — read-only staff");
const viewer = (await login("viewer.audit", "Viewer2026!")).body.token;
check("viewer signs in", !!viewer, true);
check("viewer reads the dashboard", (await get("/dashboard/executive", viewer)).all.length, 8);
check("viewer sees every transaction unscoped", (await get("/leasing-transactions", viewer)).length, 9);
for (const [label, path] of [["advance a transaction", `/leasing-transactions/${all[0].id}/advance`], ["approve a unit", `/units/${units[0].id}/approve`]]) {
  const r = await raw("PATCH", path, viewer);
  if (r.status === 403) ok(`viewer cannot ${label}`, "403"); else bad(`viewer should not ${label}`, `${r.status}`);
}
const rAudit = await raw("GET", "/audit", viewer);
if (rAudit.status === 403) ok("viewer cannot read the audit trail", "403"); else bad("viewer should not read audit", `${rAudit.status}`);

// ─────────────────────────────────────────────────────────────────── lessors
section("LESSORS");
for (const [user, pw, name, expectUnits] of [["lessor.santos", "Lessor2026!", "Maria Santos", 5], ["lessor.tan", "Lessor2026!", "Benjamin Tan", 3]]) {
  const t = (await login(user, pw)).body.token;
  const mine = await get("/units", t);
  const reqs = await get("/lessor-requirements/mine", t);
  const approved = reqs.filter((r) => r.status === "Approved").length;
  const rejectedReq = reqs.find((r) => r.status === "Rejected");
  check(`${name} sees only their own units`, mine.length, expectUnits);
  check(`${name} checklist is the full seven`, reqs.length, 7);
  log(`     ${name}: ${approved} approved, ${reqs.filter((r) => r.status === "Submitted").length} submitted, ${reqs.filter((r) => r.status === "Required").length} outstanding${rejectedReq ? `, 1 rejected — "${rejectedReq.remarks.slice(0, 44)}…"` : ""}`);
  const others = await raw("GET", "/owners", t);
  if (others.status === 403) ok(`${name} cannot reach staff lists`, "403"); else bad(`${name} should not list owners`, `${others.status}`);
}

// ─────────────────────────────────────────────────────────────────── lessees
section("LESSEES");
for (const [user, pw, name] of [["lessee.garcia", "Lessee2026!", "Ana Garcia"], ["lessee.delacruz", "Lessee2026!", "Paolo Dela Cruz"]]) {
  const t = (await login(user, pw)).body.token;
  const reqs = await get("/lessee-requirements/mine", t);
  const mineTxn = await get("/leasing-transactions/mine", t);
  const rejectedReq = reqs.find((r) => r.status === "Rejected");
  check(`${name} checklist is the full seven`, reqs.length, 7);
  check(`${name} sees their own transaction`, mineTxn.length, 1);
  log(`     ${name}: ${reqs.filter((r) => r.status === "Approved").length} approved, ${reqs.filter((r) => r.status === "Submitted").length} submitted${rejectedReq ? `, 1 rejected — "${rejectedReq.remarks.slice(0, 44)}…"` : ""}  ·  ${mineTxn[0].reference} ${mineTxn[0].stage}/${mineTxn[0].status}`);
  const peek = await raw("GET", "/lessor-requirements/mine", t);
  if (peek.status === 403) ok(`${name} cannot reach the lessor checklist`, "403"); else bad(`${name} should not see lessor reqs`, `${peek.status}`);
}

section("PENDING APPLICANT");
const rosa = await login("lessee.pending", "Lessee2026!");
// A waiting applicant is no longer refused outright — they get a RESTRICTED
// session so they can read their own application status and resubmit. The
// restriction is the part worth checking: that token must reach nothing else.
if (rosa.status === 200 && rosa.body.token) ok("Rosa Mendoza gets a restricted session", `200, account ${rosa.body.user?.status}`);
else bad("a pending account should receive a restricted session", `${rosa.status}`);
for (const [label, path] of [["the owners list", "/owners"], ["the account queue", "/auth/pending"]]) {
  const r = await raw("GET", path, rosa.body?.token);
  if (r.status === 403) ok(`  and that token is refused on ${label}`, "403");
  else bad(`a restricted token should be refused on ${label}`, `${r.status}`);
}

// ─────────────────────────────────────────────────────────────────── summary
section("SUMMARY");
log(`\n   ${pass} passed, ${fail} failed, ${pass + fail} checks\n`);
if (fail) { log("   FAILURES:"); fails.forEach((f) => log(`     · ${f}`)); log(""); }
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
