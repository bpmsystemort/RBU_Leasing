import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, InvalidReferenceError } from "../lib/errors.js";
import { ensureForUnit, activeDealForUnit } from "./leasingTransactionService.js";
import { UNIT_HIERARCHY_INCLUDE } from "../lib/unitInclude.js";

const withHierarchy = UNIT_HIERARCHY_INCLUDE;
// Staff additionally see whether the owner record still needs verification
// (owner.needsReview). Owners themselves keep the plain { id, name } shape.
const withHierarchyStaff = { tower: { include: { estate: true } }, owner: { select: { id: true, name: true, needsReview: true } } };
const STAFF_ROLES = ["ADMIN", "LEASING_OFFICER", "VIEWER"];
const includeFor = (user) => (user && STAFF_ROLES.includes(user.role) ? withHierarchyStaff : withHierarchy);

async function assertOwnerExists(ownerId) {
  const owner = await prisma.unitOwner.findUnique({ where: { id: ownerId } });
  if (!owner) throw new InvalidReferenceError("ownerId does not reference an existing owner");
}

async function assertTowerExists(towerId) {
  const tower = await prisma.tower.findUnique({ where: { id: towerId } });
  if (!tower) throw new InvalidReferenceError("towerId does not reference an existing tower");
}

export function listUnits({ ownerId, status, estateId, towerId, approvalStatus, assignedOfficerId, needsStatusReview } = {}, include = withHierarchy) {
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
  return prisma.unit.findMany({ where, include, orderBy: { createdAt: "desc" } });
}

// A UNIT_OWNER only ever sees their own owner's units. A LEASING_OFFICER sees
// units belonging to owners assigned to them.
export function listUnitsForUser(user, filters = {}) {
  const f = { ...filters };
  if (user.role === "UNIT_OWNER") f.ownerId = user.unitOwnerId || "__none__";
  else if (user.role === "LEASING_OFFICER") f.assignedOfficerId = user.userId;
  return listUnits(f, includeFor(user));
}

export async function createUnitForUser(user, data) {
  const { submit, ...fields } = data;
  const payload = { ...fields };
  if (payload.baseRent == null) payload.baseRent = 0; // base rent lives on the lease
  if (user.role === "UNIT_OWNER") {
    payload.ownerId = user.unitOwnerId; // force own owner
    delete payload.status;              // owners never set availability
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

export async function getUnit(id, include = withHierarchy) {
  const unit = await prisma.unit.findUnique({ where: { id }, include });
  if (!unit) throw new NotFoundError("Unit not found");
  return unit;
}

export async function getUnitForUser(user, id) {
  const unit = await getUnit(id, includeFor(user));
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

// Staff may only move a unit between VACANT and UNAVAILABLE by hand. BLOCKED and
// OCCUPIED are driven by the leasing pipeline, so a unit in either is never
// flipped manually (release the block / finish the deal first). Returns false
// when the unit is already in the target state (nothing to do).
function assertManualChange(unit, target) {
  if (!["VACANT", "UNAVAILABLE"].includes(target)) {
    throw new InvalidReferenceError("Availability can only be set to VACANT or UNAVAILABLE");
  }
  if (unit.status === target) return false;
  if (unit.status === "BLOCKED" || unit.status === "OCCUPIED") {
    throw new ConflictError(`Release or finish the ${unit.status} unit first`);
  }
  return true;
}

async function assertNoActiveDeal(unitId) {
  if (await activeDealForUnit(unitId)) {
    throw new ConflictError("Unit has an active deal; release it first");
  }
}

// Conditional write: only succeeds while the unit is still in the status we
// checked, so a concurrent change surfaces as a 409 instead of being overwritten.
async function changeAvailability(id, from, to) {
  const { count } = await prisma.unit.updateMany({ where: { id, status: from }, data: { status: to } });
  if (count === 0) throw new ConflictError("Unit status changed; reload and try again");
  return getUnit(id);
}

export async function setUnavailable(user, id) {
  void user;
  const unit = await getUnit(id);
  if (!assertManualChange(unit, "UNAVAILABLE")) return unit;
  await assertNoActiveDeal(id);
  return changeAvailability(id, "VACANT", "UNAVAILABLE");
}

export async function restoreUnit(user, id) {
  void user;
  const unit = await getUnit(id);
  if (!assertManualChange(unit, "VACANT")) return unit;
  return changeAvailability(id, "UNAVAILABLE", "VACANT");
}

// Staff's decision on an imported unit whose leases have all ended: it is empty,
// so make it available. Import never does this itself (an ended lease does not
// prove the unit is empty); only a flagged OCCUPIED unit with no current lease
// qualifies, and the write is pinned to that state so a concurrent change is a 409.
export async function markVacant(user, id) {
  const unit = await getUnit(id);
  if (!unit.needsStatusReview) throw new ConflictError("Unit is not flagged for status review");
  if (unit.status !== "OCCUPIED") throw new ConflictError(`Only an OCCUPIED unit can be marked vacant; this one is ${unit.status}`);
  const now = new Date();
  if (await prisma.lease.findFirst({ where: { unitId: id, startDate: { lte: now }, endDate: { gte: now } }, select: { id: true } })) {
    throw new ConflictError("Unit has a current lease; it cannot be marked vacant");
  }
  const { count } = await prisma.unit.updateMany({ where: { id, status: "OCCUPIED", needsStatusReview: true }, data: { status: "VACANT", needsStatusReview: false } });
  if (count === 0) throw new ConflictError("Unit status changed; reload and try again");
  return prisma.unit.findUnique({ where: { id }, include: includeFor(user) });
}

export async function updateUnit(user, id, data) {
  const unit = await getUnit(id);
  const { submit, ...fields } = data;
  void submit;
  if (user && user.role === "UNIT_OWNER") {
    delete fields.status;              // owners never change availability
    if (unit.ownerId !== user.unitOwnerId) throw new NotFoundError("Unit not found");
    if (!["DRAFT", "REJECTED"].includes(unit.approvalStatus)) {
      throw new ConflictError("This unit can no longer be edited");
    }
    fields.ownerId = user.unitOwnerId; // never let an owner reassign
    delete fields.approvalStatus;      // status changes only via submit/approve/reject
  } else if (fields.ownerId !== undefined) {
    // The edit form re-sends the unchanged owner; moving the unit to another
    // owner goes through reassignment so the history is always written.
    if (fields.ownerId === unit.ownerId) delete fields.ownerId;
    else throw new ConflictError("Use Reassign owner to move a unit to another owner");
  }
  // Never re-write the status the unit already has: an echo must not clobber a
  // concurrent pipeline change (e.g. BLOCKED) made since we read the row.
  if (fields.status !== undefined && fields.status === unit.status) delete fields.status;
  if (fields.status !== undefined) {
    assertManualChange(unit, fields.status);
    if (fields.status === "UNAVAILABLE") await assertNoActiveDeal(id);
  }
  if (fields.ownerId) await assertOwnerExists(fields.ownerId);
  if (fields.towerId) await assertTowerExists(fields.towerId);
  if (fields.status !== undefined) {
    // Conditional write: only succeeds while the status is still the one we checked.
    const { count } = await prisma.unit.updateMany({ where: { id, status: unit.status }, data: fields });
    if (count === 0) throw new ConflictError("Unit status changed; reload and try again");
    return getUnit(id);
  }
  return prisma.unit.update({ where: { id }, data: fields, include: withHierarchy });
}

// Clears the "needs a status decision" flag import v2 raised. Staff's way to
// say the unit's current status is right; the status itself is never changed.
export async function markReviewed(user, id) {
  await getUnit(id);
  // Same shape the list and detail endpoints give this user (staff also see owner.needsReview).
  return prisma.unit.update({ where: { id }, data: { needsStatusReview: false }, include: includeFor(user) });
}

export async function removeUnit(id) {
  await getUnit(id);
  const leases = await prisma.lease.count({ where: { unitId: id } });
  if (leases > 0) throw new ConflictError(`Unit has ${leases} lease(s); remove them first`);
  await prisma.unit.delete({ where: { id } });
}
