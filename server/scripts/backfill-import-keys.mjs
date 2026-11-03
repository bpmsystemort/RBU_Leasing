import "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { key } from "../src/lib/importClean.js";

async function main() {
  const owners = await prisma.unitOwner.findMany({ select: { id: true, name: true } });
  for (const o of owners) await prisma.unitOwner.update({ where: { id: o.id }, data: { nameKey: key(o.name) } });

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) await prisma.tenant.update({ where: { id: t.id }, data: { nameKey: key(t.name) } });

  const units = await prisma.unit.findMany({ select: { id: true, building: true, unitNumber: true, towerId: true } });
  for (const u of units) {
    const unitKey = `${key(u.building)}|${key(u.unitNumber)}|${u.towerId ?? ""}`;
    await prisma.unit.update({ where: { id: u.id }, data: { unitKey } });
  }

  // A unique index cannot be created while duplicates exist — surface any before Step 7.
  const ownerDups = await prisma.$queryRawUnsafe(`SELECT "nameKey", COUNT(*) FROM "UnitOwner" WHERE "nameKey" IS NOT NULL GROUP BY "nameKey" HAVING COUNT(*) > 1`);
  const tenantDups = await prisma.$queryRawUnsafe(`SELECT "nameKey", COUNT(*) FROM "Tenant" WHERE "nameKey" IS NOT NULL GROUP BY "nameKey" HAVING COUNT(*) > 1`);
  const unitDups = await prisma.$queryRawUnsafe(`SELECT "ownerId", "unitKey", COUNT(*) FROM "Unit" WHERE "unitKey" IS NOT NULL GROUP BY "ownerId", "unitKey" HAVING COUNT(*) > 1`);
  const leaseDups = await prisma.$queryRawUnsafe(`SELECT "unitId", "tenantId", "startDate", "endDate", COUNT(*) FROM "Lease" GROUP BY "unitId", "tenantId", "startDate", "endDate" HAVING COUNT(*) > 1`);

  console.log(`backfilled: owners=${owners.length} tenants=${tenants.length} units=${units.length}`);
  const dups = { owners: ownerDups.length, tenants: tenantDups.length, units: unitDups.length, leases: leaseDups.length };
  console.log("duplicate groups (must all be 0):", dups);
  if (ownerDups.length || tenantDups.length || unitDups.length || leaseDups.length) {
    console.error("DUPLICATES present — resolve them before creating the unique indexes (Step 7).");
    console.error({ ownerDups, tenantDups, unitDups, leaseDups });
    process.exitCode = 2;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
