import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, InvalidReferenceError } from "../lib/errors.js";
import { ensureForUnit } from "./leasingTransactionService.js";

const withHierarchy = { tower: { include: { estate: true } }, owner: { select: { id: true, name: true } } };

async function assertOwnerExists(ownerId) {
  const owner = await prisma.unitOwner.findUnique({ where: { id: ownerId } });
  if (!owner) throw new InvalidReferenceError("ownerId does not reference an existing owner");
}

async function assertTowerExists(towerId) {
  const tower = await prisma.tower.findUnique({ where: { id: towerId } });
  if (!tower) throw new InvalidReferenceError("towerId does not reference an existing tower");
}

export function listUnits({ ownerId, status, estateId, towerId, approvalStatus, assignedOfficerId, needsStatusReview } = {}) {
  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (status) where.status = status;
  if (towerId) where.towerId = towerId;
  if (estateId) where.tower = { estateId };
  if (approvalStatus) where.approvalStatus = approvalStatus;
  if (assignedOfficerId) where.owner = { assignedOfficerId };
  // Import v2 leaves a unit's status as-is (never auto-VACANT) when all its
  // leases have ended, flagging it here instead — this lets staff pull up
  // just the rows that need a manual status decision.
  if (needsStatusReview === "true" || needsStatusReview === true) where.needsStatusReview = true;
  return prisma.unit.findMany({ where, include: withHierarchy, orderBy: { createdAt: "desc" } });
}

// A UNIT_OWNER only ever sees their own owner's units. A LEASING_OFFICER sees
// units belonging to owners assigned to them.
export function listUnitsForUser(user, filters = {}) {
  const f = { ...filters };
  if (user.role === "UNIT_OWNER") f.ownerId = user.unitOwnerId || "__none__";
  else if (user.role === "LEASING_OFFICER") f.assignedOfficerId = user.userId;
  return listUnits(f);
}

export async function createUnitForUser(user, data) {
  const { submit, ...fields } = data;
  const payload = { ...fields };
  if (payload.baseRent == null) payload.baseRent = 0; // base rent lives on the lease
  if (user.role === "UNIT_OWNER") {
    payload.ownerId = user.unitOwnerId; // force own owner
  }
  // Every API-created unit enters the approval workflow — staff-created units are
  // no exception (they must be submitted and approved, not silently APPROVED).
  payload.approvalStatus = submit ? "SUBMITTED" : "DRAFT";
  await assertOwnerExists(payload.ownerId);
  if (payload.towerId) await assertTowerExists(payload.towerId);
  return prisma.unit.create({ data: payload, include: withHierarchy });
}

export async function submitUnit(user, id) {
  const unit = await getUnit(id);
  if (user && user.role === "UNIT_OWNER" && unit.ownerId !== user.unitOwnerId) {
    throw new NotFoundError("Unit not found");
  }
  if (!["DRAFT", "REJECTED"].includes(unit.approvalStatus)) {
    throw new ConflictError("Only a draft or rejected unit can be submitted");
  }
  return prisma.unit.update({
    where: { id }, data: { approvalStatus: "SUBMITTED", reviewRemarks: null }, include: withHierarchy,
  });
}

// A review decision can only be made on a unit that is awaiting one. Approving a
// DRAFT would skip the submit step; approving/rejecting an already-decided
// (APPROVED/REJECTED) unit would re-open a terminal state. A rejected unit must
// be resubmitted by the owner before it can be approved.
export async function approveUnit(id, actor) {
  const unit = await getUnit(id);
  if (unit.approvalStatus !== "SUBMITTED") {
    throw new ConflictError("Only a submitted unit can be approved");
  }
  const approved = await prisma.unit.update({
    where: { id }, data: { approvalStatus: "APPROVED", reviewRemarks: null }, include: withHierarchy,
  });
  // Approval is what puts the unit into the pipeline — this is where its
  // photoshoot becomes schedulable. Never let a failure here undo the
  // approval: a unit approved without a transaction is recoverable, a
  // half-applied approval is not.
  try {
    await ensureForUnit(approved, actor);
  } catch (e) {
    console.error(`Unit ${approved.unitNumber} (${approved.id}) approved but its transaction could not be opened:`, e.message);
  }
  return approved;
}

export async function rejectUnit(id, remarks) {
  const unit = await getUnit(id);
  if (unit.approvalStatus !== "SUBMITTED") {
    throw new ConflictError("Only a submitted unit can be rejected");
  }
  return prisma.unit.update({
    where: { id }, data: { approvalStatus: "REJECTED", reviewRemarks: remarks }, include: withHierarchy,
  });
}

export async function getUnit(id) {
  const unit = await prisma.unit.findUnique({ where: { id }, include: withHierarchy });
  if (!unit) throw new NotFoundError("Unit not found");
  return unit;
}

export async function getUnitForUser(user, id) {
  const unit = await getUnit(id);
  if (user && user.role === "UNIT_OWNER" && unit.ownerId !== user.unitOwnerId) {
    throw new NotFoundError("Unit not found");
  }
  return unit;
}

export async function createUnit(data) {
  await assertOwnerExists(data.ownerId);
  if (data.towerId) await assertTowerExists(data.towerId);
  return prisma.unit.create({ data: { baseRent: 0, ...data } });
}

export async function updateUnit(user, id, data) {
  const unit = await getUnit(id);
  const { submit, ...fields } = data;
  void submit;
  if (user && user.role === "UNIT_OWNER") {
    if (unit.ownerId !== user.unitOwnerId) throw new NotFoundError("Unit not found");
    if (!["DRAFT", "REJECTED"].includes(unit.approvalStatus)) {
      throw new ConflictError("This unit can no longer be edited");
    }
    fields.ownerId = user.unitOwnerId; // never let an owner reassign
    delete fields.approvalStatus;      // status changes only via submit/approve/reject
  }
  if (fields.ownerId) await assertOwnerExists(fields.ownerId);
  if (fields.towerId) await assertTowerExists(fields.towerId);
  return prisma.unit.update({ where: { id }, data: fields, include: withHierarchy });
}

export async function removeUnit(id) {
  await getUnit(id);
  const leases = await prisma.lease.count({ where: { unitId: id } });
  if (leases > 0) throw new ConflictError(`Unit has ${leases} lease(s); remove them first`);
  await prisma.unit.delete({ where: { id } });
}
