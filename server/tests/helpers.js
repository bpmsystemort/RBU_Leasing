import { prisma } from "../src/lib/prisma.js";
import { issueToken } from "../src/services/authService.js";

// Delete in FK-safe order (children before parents). Removes every test-created
// login (the seeded ADMIN is the only ADMIN, so it survives).
export async function resetCrudTables() {
  await prisma.unitAssignmentEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  // Leasing transactions reference inquiries/units/users, so clear them first.
  await prisma.transactionEvent.deleteMany();
  await prisma.leasingTransaction.deleteMany();
  await prisma.inquiry.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
  await prisma.unit.deleteMany();
  await prisma.lesseeInfoSheet.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.lessorInfoSheet.deleteMany();
  await prisma.lessorRequirement.deleteMany();
  await prisma.unitOwner.deleteMany();
  await prisma.tower.deleteMany();
  await prisma.estate.deleteMany();
  // No FK relations — standalone singleton row. Cleared so every test starts
  // with no EmailSettings row (service falls back to env config).
  await prisma.emailSettings.deleteMany();
}

export const tokens = {
  admin: () => issueToken({ id: "test-admin", role: "ADMIN" }),
  officer: (id = "test-officer") => issueToken({ id, role: "LEASING_OFFICER" }),
  viewer: () => issueToken({ id: "test-viewer", role: "VIEWER" }),
  owner: (unitOwnerId) => issueToken({ id: "test-owner", role: "UNIT_OWNER", unitOwnerId }),
  tenant: (tenantId) => issueToken({ id: "test-tenant", role: "TENANT", tenantId }),
};

// Direct-to-DB record factories for cross-entity test setup.
export const factory = {
  owner: (over = {}) => prisma.unitOwner.create({ data: { name: "Owner", ...over } }),
  tenant: (over = {}) => prisma.tenant.create({ data: { name: "Tenant", ...over } }),
  estate: (over = {}) => prisma.estate.create({ data: { name: "Estate", ...over } }),
  tower: (estateId, over = {}) => prisma.tower.create({ data: { estateId, name: "Tower", ...over } }),
  requirement: (tenantId, over = {}) =>
    prisma.requirement.create({
      data: { tenantId, filename: "doc.pdf", mimeType: "application/pdf", size: 3, data: Buffer.from("abc"), ...over },
    }),
  unit: (ownerId, over = {}) =>
    prisma.unit.create({ data: { ownerId, unitNumber: "101", baseRent: 25000, ...over } }),
  lease: (unitId, tenantId, over = {}) =>
    prisma.lease.create({
      data: {
        unitId, tenantId,
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        monthlyRent: 25000, ...over,
      },
    }),
};
