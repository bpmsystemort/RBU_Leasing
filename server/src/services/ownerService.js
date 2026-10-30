import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, InvalidReferenceError } from "../lib/errors.js";

const officerInclude = { assignedOfficer: { select: { id: true, name: true, email: true } } };

// ADMIN/VIEWER see every owner; a LEASING_OFFICER sees only owners assigned to
// their own account.
export function listOwners(user) {
  const where = user?.role === "LEASING_OFFICER" ? { assignedOfficerId: user.userId } : {};
  return prisma.unitOwner.findMany({ where, orderBy: { createdAt: "desc" }, include: officerInclude });
}

// Every owner, deliberately unscoped — for the account-approval link-picker
// (AccountApprovalsView), where an officer must be able to link an applicant
// to ANY imported owner, not just the ones already assigned to them. Scoping
// this the way listOwners does would hide an unassigned imported owner from
// the very picker meant to let staff link to it, pushing them toward minting
// a duplicate owner instead. Minimal shape — the picker needs nothing else.
export function listOwnersForLinking() {
  return prisma.unitOwner.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true },
  });
}

// Assign an owner to an O-Lease (LEASING_OFFICER), or null to unassign.
export async function assignOwner(id, assignedOfficerId) {
  await getOwner(id);
  if (assignedOfficerId) {
    const officer = await prisma.user.findUnique({ where: { id: assignedOfficerId } });
    if (!officer || officer.role !== "LEASING_OFFICER") {
      throw new InvalidReferenceError("assignedOfficerId must reference an O-Lease (LEASING_OFFICER)");
    }
  }
  return prisma.unitOwner.update({ where: { id }, data: { assignedOfficerId }, include: officerInclude });
}

export async function getOwner(id) {
  const owner = await prisma.unitOwner.findUnique({ where: { id } });
  if (!owner) throw new NotFoundError("Owner not found");
  return owner;
}

// The owner record linked to the calling UNIT_OWNER account.
export async function getOwnerMe(user) {
  if (!user.unitOwnerId) throw new NotFoundError("No owner record linked to this account");
  return getOwner(user.unitOwnerId);
}

export function createOwner(data) {
  return prisma.unitOwner.create({ data });
}

export async function updateOwner(id, data) {
  await getOwner(id);
  return prisma.unitOwner.update({ where: { id }, data });
}

export async function removeOwner(id) {
  await getOwner(id);
  const units = await prisma.unit.count({ where: { ownerId: id } });
  if (units > 0) throw new ConflictError(`Owner has ${units} unit(s); remove them first`);
  await prisma.unitOwner.delete({ where: { id } });
}
