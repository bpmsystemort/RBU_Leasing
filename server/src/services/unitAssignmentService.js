import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, InvalidReferenceError } from "../lib/errors.js";

// Moves a unit to another owner and records who did it. Deliberately touches
// only Unit.ownerId and the history: User logins, open LeasingTransactions
// (unitOwnerId) and Leases keep pointing at whoever they pointed at.
export async function reassignOwner(actor, unitId, { toOwnerId, reason }) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new NotFoundError("Unit not found");
  if (unit.ownerId === toOwnerId) throw new ConflictError("The unit already belongs to that owner");
  const target = await prisma.unitOwner.findUnique({ where: { id: toOwnerId } });
  if (!target) throw new InvalidReferenceError("toOwnerId does not reference an existing owner");
  if (unit.unitKey) {
    const clash = await prisma.unit.findFirst({
      where: { ownerId: toOwnerId, unitKey: unit.unitKey, id: { not: unitId } },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`${target.name} already has a unit with the same unit key`);
  }
  const who = actor?.userId
    ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } })
    : null;
  try {
    return await prisma.$transaction(async (tx) => {
      // Conditional on the owner we validated against, so a concurrent
      // reassignment surfaces as a 409 instead of being silently overwritten.
      const moved = await tx.unit.updateMany({ where: { id: unitId, ownerId: unit.ownerId }, data: { ownerId: toOwnerId } });
      if (!moved.count) throw new ConflictError("The unit's owner changed while reassigning; reload and try again");
      await tx.unitAssignmentEvent.create({
        data: {
          unitId, fromOwnerId: unit.ownerId, toOwnerId, reason: reason || null,
          actorId: actor?.userId ?? null, actorName: who?.name || who?.email || null,
        },
      });
      return tx.unit.findUnique({
        where: { id: unitId },
        include: { tower: { include: { estate: true } }, owner: { select: { id: true, name: true } } },
      });
    });
  } catch (e) {
    if (e?.code === "P2002") throw new ConflictError(`${target.name} already has a unit with the same unit key`);
    throw e;
  }
}

export async function listAssignments(unitId) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw new NotFoundError("Unit not found");
  return prisma.unitAssignmentEvent.findMany({
    where: { unitId }, orderBy: { createdAt: "desc" },
    include: { fromOwner: { select: { id: true, name: true } }, toOwner: { select: { id: true, name: true } } },
  });
}
