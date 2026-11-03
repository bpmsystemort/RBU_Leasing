// The registration-first lessor journey, end to end, against a live API:
// apply with a unit, read your own status on a restricted session, be sent back
// for revision, correct and resubmit, then be approved — and land with an
// APPROVED unit and an open onboarding transaction.
//
// Run against a throwaway server on the TEST database, never the dev one —
// export .env.test into the shell first (dotenvx ignores DOTENV_CONFIG_PATH), and
// start the server on :5091. It seeds its own estate and tower, because the unit
// suites wipe reference data, and removes everything it created when it is done.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { issueToken } from "../src/services/authService.js";

const BASE = process.env.E2E_BASE || "http://localhost:5091/api";
let pass = 0, fail = 0;
const ok = (l, d = "") => { pass++; console.log(`   PASS  ${l}${d ? `  ·  ${d}` : ""}`); };
const bad = (l, d = "") => { fail++; console.log(`   FAIL  ${l}  ·  ${d}`); };
const step = (t) => console.log(`\n-- ${t}`);

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const S = Math.floor(Math.random() * 900000 + 100000);
const email = `sim.lessor.${S}`;
const contact = `sim.lessor.${S}@example.com`;
const password = "strong-pass-8";

const simEstate = await prisma.estate.create({ data: { name: `Sim Estate ${S}` } });
const simTower = await prisma.tower.create({ data: { estateId: simEstate.id, name: `Sim Tower ${S}` } });

step("A signed-out visitor reads the reference data the form needs");
const est = await req("GET", "/public/estates");
const estate = (est.data || []).find((e) => e.id === simEstate.id);
if (est.status === 200 && estate) ok("estates readable with no token", `${est.data.length} on file`);
else bad("estates should be public", JSON.stringify(est).slice(0, 140));
if (Object.keys(estate || {}).sort().join(",") === "id,name") ok("estates expose id and name only");
else bad("estates leak fields", Object.keys(estate || {}).join(","));
const tw = await req("GET", `/public/towers?estateId=${simEstate.id}`);
if (tw.status === 200 && tw.data.some((t) => t.id === simTower.id)) ok("towers readable, scoped to the estate");
else bad("towers should be public and scoped", JSON.stringify(tw).slice(0, 140));
if ((await req("GET", "/public/towers")).status === 400) ok("towers refuse an unscoped listing", "400");
else bad("unscoped towers should be 400");

step("The lessor applies, unit first");
const signup = await req("POST", "/auth/signup", {
  body: {
    name: "Sim Lessor", email, contactEmail: contact, password, role: "UNIT_OWNER", consent: true,
    unit: { estateId: simEstate.id, towerId: simTower.id, unitNumber: `SIM-${S}`, floor: "19", type: "1 Bedroom", baseRent: 25000 },
  },
});
if (signup.status === 201 && !signup.data.token) ok("application accepted, no session handed out", signup.data.status);
else bad("signup should be an application", JSON.stringify(signup).slice(0, 180));
const applicant = await prisma.user.findUnique({ where: { email } });
if (applicant?.pendingUnit?.unitNumber === `SIM-${S}`) ok("the unit rides along on the application");
else bad("pendingUnit not stored", JSON.stringify(applicant?.pendingUnit));
if (!(await prisma.unitOwner.findFirst({ where: { email: contact } }))) ok("no UnitOwner yet, so the Owners list stays vetted");
else bad("an unvetted UnitOwner was created at signup");

step("A waiting applicant gets a restricted session, not a door slam");
const login1 = await req("POST", "/auth/login", { body: { email, password } });
const rtok = login1.data?.token;
if (login1.status === 200 && rtok) ok("pending applicant can sign in", `account ${login1.data.user?.status}`);
else bad("a pending login should yield a restricted session", `${login1.status}`);
const app1 = await req("GET", "/auth/application", { token: rtok });
if (app1.status === 200 && app1.data.status === "PENDING" && app1.data.pendingUnit?.unitNumber === `SIM-${S}`)
  ok("they can read their own application", `${app1.data.status}, unit ${app1.data.pendingUnit.unitNumber}`);
else bad("application status should be readable", JSON.stringify(app1).slice(0, 180));
if (!JSON.stringify(app1.data).includes("passwordHash")) ok("the password hash never leaves the server");
else bad("password hash leaked on the status page");
for (const [label, path] of [["the transaction list", "/leasing-transactions"], ["the account queue", "/auth/pending"]]) {
  const r = await req("GET", path, { token: rtok });
  if (r.status === 403) ok(`the restricted token is refused on ${label}`, "403");
  else bad(`restricted token should be refused on ${label}`, `${r.status}`);
}

step("The officer sends it back for revision");
const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
const adminTok = issueToken({ id: admin.id, role: "ADMIN" });
const queued = await req("GET", "/auth/pending", { token: adminTok });
if ((queued.data || []).some((r) => r.email === email)) ok("the application is in the officer's queue");
else bad("application missing from the queue");
const noRemarks = await req("PATCH", `/auth/pending/${applicant.id}/revise`, { token: adminTok, body: { remarks: "" } });
if (noRemarks.status === 400) ok("revision without remarks is refused", "400 — the applicant must know what to change");
else bad("empty remarks should be refused", `${noRemarks.status}`);
const revised = await req("PATCH", `/auth/pending/${applicant.id}/revise`, { token: adminTok, body: { remarks: "Tower does not match the unit number" } });
if (revised.status === 200) ok("sent back for revision with remarks", "200"); else bad("revise failed", JSON.stringify(revised).slice(0, 180));

step("The applicant is told why, corrects it, and resubmits");
const app2 = await req("GET", "/auth/application", { token: rtok });
if (app2.data?.status === "FOR_REVISION" && app2.data?.remarks === "Tower does not match the unit number")
  ok("the remarks reach the applicant", `"${app2.data.remarks}"`);
else bad("remarks should be readable", JSON.stringify(app2.data).slice(0, 180));
const resub = await req("PATCH", "/auth/application", {
  token: rtok,
  // The whole unit, as the status page sends it: resubmission REPLACES
  // pendingUnit rather than merging, so a partial body would silently drop the
  // tower and rent. The escalation keys are here to prove they are stripped.
  body: {
    unit: {
      estateId: simEstate.id, towerId: simTower.id, unitNumber: `SIM-${S}-B`, floor: "20",
      type: "1 Bedroom", baseRent: 25000, ownerId: "x", approvalStatus: "APPROVED",
    },
    role: "ADMIN", status: "APPROVED", unitOwnerId: "x",
  },
});
if (resub.status === 200 && resub.data.status === "PENDING") ok("resubmission returns it to Pending Review", resub.data.status);
else bad("resubmit failed", JSON.stringify(resub).slice(0, 180));
const afterResub = await prisma.user.findUnique({ where: { id: applicant.id } });
if (afterResub.role === "UNIT_OWNER" && afterResub.status === "PENDING" && !afterResub.unitOwnerId)
  ok("role, status and owner link cannot be escalated through the body");
else bad("escalation got through", `${afterResub.role}/${afterResub.status}/${afterResub.unitOwnerId}`);
const pu = afterResub.pendingUnit;
if (pu.unitNumber === `SIM-${S}-B` && pu.floor === "20" && !("ownerId" in pu) && !("approvalStatus" in pu))
  ok("the corrected unit is stored, whitelisted", `${pu.unitNumber}, floor ${pu.floor}`);
else bad("unit whitelist failed", JSON.stringify(pu));

step("Approval turns the application into a unit and a pipeline");
const appr = await req("PATCH", `/auth/pending/${applicant.id}/approve`, { token: adminTok });
if (appr.status === 200) ok("account approved", "200"); else bad("approve failed", JSON.stringify(appr).slice(0, 180));
const after = await prisma.user.findUnique({ where: { id: applicant.id } });
if (after.status === "APPROVED" && after.unitOwnerId && after.pendingUnit === null)
  ok("owner created and the held unit consumed");
else bad("approval state wrong", `${after.status}/${after.unitOwnerId}/${JSON.stringify(after.pendingUnit)}`);
const unit = await prisma.unit.findFirst({ where: { ownerId: after.unitOwnerId } });
if (unit?.unitNumber === `SIM-${S}-B`) ok("the corrected unit is the one created", unit.unitNumber);
else bad("wrong or missing unit", JSON.stringify(unit));
if (unit?.approvalStatus === "APPROVED") ok("created APPROVED, not DRAFT", "the officer reviewed it as part of this decision");
else bad("unit should be APPROVED", unit?.approvalStatus);
if (unit?.towerId === simTower.id && Number(unit?.baseRent) === 25000) ok("tower and rent carried through", `PHP ${Number(unit.baseRent).toLocaleString("en-PH")}`);
else bad("unit details lost", `${unit?.towerId} / ${unit?.baseRent}`);
const txn = await prisma.leasingTransaction.findFirst({ where: { unitId: unit.id } });
if (txn) ok("the onboarding transaction is open", `${txn.reference} at ${txn.stage}`);
else bad("no onboarding transaction opened");

step("The approved lessor is no longer restricted, and still reaches only their own records");
const login2 = await req("POST", "/auth/login", { body: { email, password } });
const full = login2.data?.token;
if (login2.status === 200 && login2.data.user?.status === "APPROVED") ok("signs in as an approved owner");
else bad("approved login failed", `${login2.status}`);
const mine = await req("GET", "/units", { token: full });
if (mine.status === 200 && mine.data.some((u) => u.unitNumber === `SIM-${S}-B`)) ok("their unit is listed under My Units");
else bad("unit not visible to its owner", `${mine.status}`);
const own = await req("GET", `/units/${unit.id}`, { token: full });
if (own.status === 200) ok("they can open their own unit by id", "200"); else bad("owner should read their own unit", `${own.status}`);
const dash = await req("GET", "/dashboard", { token: full });
if (dash.status === 403) ok("but not the portfolio dashboard", "403"); else bad("owner should not read the dashboard", `${dash.status}`);

// Leave the test database as found.
if (txn) { await prisma.transactionEvent.deleteMany({ where: { transactionId: txn.id } }); await prisma.leasingTransaction.deleteMany({ where: { id: txn.id } }); }
await prisma.unit.deleteMany({ where: { id: unit.id } });
await prisma.user.deleteMany({ where: { id: applicant.id } });
await prisma.unitOwner.deleteMany({ where: { id: after.unitOwnerId } });
await prisma.tower.deleteMany({ where: { id: simTower.id } });
await prisma.estate.deleteMany({ where: { id: simEstate.id } });

console.log(`\n   ${pass} passed, ${fail} failed, ${pass + fail} checks\n`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
