import { prisma } from "../lib/prisma.js";
import { NotFoundError, InvalidReferenceError, ConflictError } from "../lib/errors.js";
import { ensureForInquiry, assertUnitFreeForInquiry } from "./leasingTransactionService.js";

const assigneeInclude = {
  assignedTo: { select: { id: true, name: true, email: true } },
  unit: { select: { id: true, unitNumber: true, building: true } },
};

export async function createInquiry(data) {
  const { unitId, ...rest } = data;
  // Only keep the unit link if it resolves to a real unit; a stale/invalid id
  // must never block a public inquiry.
  let linkedUnitId = null;
  if (unitId) {
    const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
    if (unit) linkedUnitId = unit.id;
  }
  return prisma.inquiry.create({ data: { ...rest, unitId: linkedUnitId } });
}

// ADMIN and VIEWER see every inquiry. An O-Lease (LEASING_OFFICER) sees the
// inquiries assigned to their own account PLUS the unassigned pool, so they can
// accept new inquiries themselves without an admin assigning them first.
export function listInquiries(user) {
  const where = user?.role === "LEASING_OFFICER"
    ? { OR: [{ assignedToId: user.userId }, { assignedToId: null }] }
    : {};
  return prisma.inquiry.findMany({ where, orderBy: { createdAt: "desc" }, include: assigneeInclude });
}

// Admin assigns an inquiry to an O-Lease (LEASING_OFFICER), or null to unassign.
export async function assignInquiry(id, assignedToId) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Inquiry not found");
  if (assignedToId) {
    const user = await prisma.user.findUnique({ where: { id: assignedToId } });
    if (!user || user.role !== "LEASING_OFFICER") {
      throw new InvalidReferenceError("assignedToId must reference an O-Lease (LEASING_OFFICER)");
    }
  }
  return prisma.inquiry.update({ where: { id }, data: { assignedToId }, include: assigneeInclude });
}

// An O-Lease accepts (self-assigns) an inquiry — allowed only if it is currently
// unassigned or already theirs, so they can't take another officer's inquiry.
export async function acceptInquiry(user, id) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Inquiry not found");
  if (inquiry.assignedToId && inquiry.assignedToId !== user.userId) {
    throw new ConflictError("This inquiry has already been accepted by another O-Lease");
  }
  // Refuse before assigning, so a conflicting acceptance leaves the inquiry untouched.
  await assertUnitFreeForInquiry(inquiry);
  const updated = await prisma.inquiry.update({ where: { id }, data: { assignedToId: user.userId }, include: assigneeInclude });
  // Accepting an inquiry opens the end-to-end leasing transaction (idempotent).
  await ensureForInquiry(updated, user);
  return updated;
}

// Release an inquiry back to the unassigned pool. An O-Lease may release only
// their own; an admin may release any.
export async function releaseInquiry(user, id) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Inquiry not found");
  if (user.role !== "ADMIN" && inquiry.assignedToId !== user.userId) {
    throw new ConflictError("You can only release an inquiry assigned to you");
  }
  return prisma.inquiry.update({ where: { id }, data: { assignedToId: null }, include: assigneeInclude });
}

export async function updateInquiryStatus(id, status) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Inquiry not found");
  return prisma.inquiry.update({ where: { id }, data: { status } });
}

export async function deleteInquiry(id) {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Inquiry not found");
  await prisma.inquiry.delete({ where: { id } });
}
