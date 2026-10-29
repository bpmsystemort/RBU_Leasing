import { prisma } from "../lib/prisma.js";
import { key, leaseStatus } from "../lib/importClean.js";
import { towerNameFor } from "../lib/towerMap.js";
import { parseFromBuffer } from "../lib/importParse.js";

const JOINT = /\b and \b|&|\bspouses?\b|\/|\bc\/o\b|\bet al\b/i;
const ownerNeedsReview = (name) => !name || JOINT.test(name);

// Classify one parsed row. Returns { kind: "skip"|"fail"|"ok", reasons?, key? }
function classify(row, seen) {
  const blank = !row.unitNumber && !row.lessee && !row.lessor && row.rawStart == null && row.rawEnd == null && row.monthlyRent == null;
  if (blank) return { kind: "skip" };
  const reasons = [];
  if (!row.unitNumber) reasons.push("missing Unit");
  if (!row.lessee) reasons.push("missing Lessee");
  if (row.rawStart == null) reasons.push("missing Start date"); else if (!row.startDate) reasons.push("unparseable Start date");
  if (row.rawEnd == null) reasons.push("missing End date"); else if (!row.endDate) reasons.push("unparseable End date");
  if (row.monthlyRent == null) reasons.push("missing/invalid Monthly Rent");
  if (row.startDate && row.endDate && row.startDate.getTime() > row.endDate.getTime()) reasons.push("Start date after End date");
  if (reasons.length) return { kind: "fail", reasons };
  const dupKey = `${key(row.property)}|${key(row.unitNumber)}|${key(row.lessee)}|${row.startDate.toISOString()}|${row.endDate.toISOString()}`;
  if (seen.has(dupKey)) return { kind: "fail", reasons: ["duplicate row within file"] };
  seen.add(dupKey);
  return { kind: "ok" };
}

async function loadParse(buffer) {
  const { sheets } = await parseFromBuffer(buffer);
  const sheetMeta = sheets.map((s) => ({ name: s.name, ok: s.ok, error: s.error }));
  const rows = sheets.filter((s) => s.ok).flatMap((s) => s.rows);
  return { sheetMeta, rows };
}

export async function analyzeWorkbook(buffer) {
  const { sheetMeta, rows } = await loadParse(buffer);
  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const totals = { willCreate: 0, willUpdate: 0, skipped: 0, failed: 0 };
  const failures = [];
  const ownerKeys = new Set(); const unitKeysActive = new Map(); const seen = new Set();
  for (const row of rows) {
    const c = classify(row, seen);
    if (c.kind === "skip") { totals.skipped++; continue; }
    if (c.kind === "fail") { totals.failed++; failures.push({ sheet: row.sheet, row: row.row, reasons: c.reasons }); continue; }
    const towerId = towerByName.get(towerNameFor(row.property)) ?? null;
    const unitKey = `${key(row.property)}|${key(row.unitNumber)}|${towerId ?? ""}`;
    const existing = await prisma.lease.findFirst({ where: { unit: { unitKey }, tenant: { nameKey: key(row.lessee) }, startDate: row.startDate, endDate: row.endDate }, select: { id: true } });
    if (existing) totals.willUpdate++; else totals.willCreate++;
    if (ownerNeedsReview(row.lessor)) ownerKeys.add(`REVIEW:${key(row.lessor || "unknown owner")}`);
    const active = row.startDate <= new Date() && row.endDate >= new Date();
    const prev = unitKeysActive.get(unitKey) || false; unitKeysActive.set(unitKey, prev || active);
  }
  const unitsNeedingStatusReview = [...unitKeysActive.values()].filter((v) => !v).length;
  return { totals, sheets: sheetMeta, failures, ownersNeedingReview: ownerKeys.size, unitsNeedingStatusReview };
}

export async function commitWorkbook(buffer) {
  const { sheetMeta, rows } = await loadParse(buffer);
  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const owners = new Map(); const tenants = new Map(); const units = new Map();
  const summary = { created: 0, updated: 0, skipped: 0, failed: 0, ownersFlagged: 0, unitsFlagged: 0, failures: [], sheets: sheetMeta };
  const seen = new Set(); const affectedUnitIds = new Set();

  for (const row of rows) {
    const c = classify(row, seen);
    if (c.kind === "skip") { summary.skipped++; continue; }
    if (c.kind === "fail") { summary.failed++; summary.failures.push({ sheet: row.sheet, row: row.row, reasons: c.reasons }); continue; }

    const ownerName = row.lessor || "Unknown Owner";
    const ownerKey = key(ownerName);
    let ownerId = owners.get(ownerKey);
    if (ownerId === undefined) {
      let owner = await prisma.unitOwner.findUnique({ where: { nameKey: ownerKey } });
      const needsReview = ownerNeedsReview(row.lessor);
      if (!owner) { owner = await prisma.unitOwner.create({ data: { name: ownerName, nameKey: ownerKey, needsReview } }); if (needsReview) summary.ownersFlagged++; }
      else if (needsReview && !owner.needsReview) { await prisma.unitOwner.update({ where: { id: owner.id }, data: { needsReview: true } }); summary.ownersFlagged++; }
      ownerId = owner.id; owners.set(ownerKey, ownerId);
    }

    const tKey = key(row.lessee);
    let tenantId = tenants.get(tKey);
    if (tenantId === undefined) {
      let tenant = await prisma.tenant.findUnique({ where: { nameKey: tKey } });
      if (!tenant) tenant = await prisma.tenant.create({ data: { name: row.lessee, nameKey: tKey } });
      tenantId = tenant.id; tenants.set(tKey, tenantId);
    }

    const towerId = towerByName.get(towerNameFor(row.property)) ?? null;
    const unitKey = `${key(row.property)}|${key(row.unitNumber)}|${towerId ?? ""}`;
    const uMapKey = `${ownerId}|${unitKey}`;
    let unitId = units.get(uMapKey);
    if (unitId === undefined) {
      let unit = await prisma.unit.findUnique({ where: { ownerId_unitKey: { ownerId, unitKey } } });
      const descriptive = Object.fromEntries(Object.entries({ floor: row.floor, slotNo: row.slotNo, type: row.unitType, baseRent: row.monthlyRent }).filter(([, v]) => v != null));
      if (unit) await prisma.unit.update({ where: { id: unit.id }, data: descriptive });
      else unit = await prisma.unit.create({ data: { ownerId, unitKey, unitNumber: row.unitNumber, building: row.property, towerId, status: "OCCUPIED", ...descriptive } });
      unitId = unit.id; units.set(uMapKey, unitId);
    }
    affectedUnitIds.add(unitId);

    const leaseData = { monthlyRent: row.monthlyRent, status: leaseStatus(row.endDate, new Date()), advanceRent: row.advanceRent, securityDeposit: row.securityDeposit, modeOfPayment: row.modeOfPayment, serviceFee: row.serviceFee, source: row.source, remarks: row.remarks, renewalPeriod: row.renewalText, managedBy: row.managedBy };
    const existing = await prisma.lease.findUnique({ where: { unitId_tenantId_startDate_endDate: { unitId, tenantId, startDate: row.startDate, endDate: row.endDate } }, select: { id: true } });
    if (existing) { await prisma.lease.update({ where: { id: existing.id }, data: leaseData }); summary.updated++; }
    else { await prisma.lease.create({ data: { unitId, tenantId, startDate: row.startDate, endDate: row.endDate, ...leaseData } }); summary.created++; }
  }

  // Status pass: never auto-VACANT. Active lease (now within [start,end]) -> OCCUPIED; else flag for review.
  const now = new Date();
  for (const unitId of affectedUnitIds) {
    const leases = await prisma.unit.findUnique({ where: { id: unitId }, select: { leases: { select: { startDate: true, endDate: true } } } });
    const active = leases.leases.some((l) => l.startDate <= now && l.endDate >= now);
    if (active) await prisma.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED", needsStatusReview: false } });
    else { await prisma.unit.update({ where: { id: unitId }, data: { needsStatusReview: true } }); summary.unitsFlagged++; }
  }
  return summary;
}

export async function commitFromFile(path) {
  const { readFile } = await import("fs/promises");
  return commitWorkbook(await readFile(path));
}
