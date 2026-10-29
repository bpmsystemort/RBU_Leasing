import { createRequire } from "module";
import { prisma } from "../lib/prisma.js";
import { text, money, toDate, leaseStatus, key } from "../lib/importClean.js";
import { towerNameFor } from "../lib/towerMap.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const isYearSheet = (name) => /^\d{4}$/.test(String(name).trim());

export async function importWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const towerByName = new Map((await prisma.tower.findMany()).map((t) => [t.name, t.id]));
  const owners = new Map();  // nameKey -> ownerId
  const tenants = new Map();  // nameKey -> tenantId
  const units = new Map();   // `${ownerId}|${unitKey}` -> unitId
  const summary = { owners: 0, units: 0, tenants: 0, leases: 0, skipped: 0, skips: [] };
  const now = new Date();

  for (const ws of wb.worksheets.filter((w) => isYearSheet(w.name))) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values; // exceljs 1-indexed; v[1] ignored
      const building = text(v[3]);
      const unitNumber = text(v[4]);
      const unitType = text(v[5]) || "OTHER";
      const floor = text(v[6]);
      const slotNo = text(v[7]);
      const lessor = text(v[8]);
      const lessee = text(v[9]);
      const startDate = toDate(v[10]);
      const endDate = toDate(v[11]);
      const monthlyRent = money(v[13]);

      if (!lessee || !unitNumber || !startDate || !endDate || monthlyRent == null) {
        if (lessee || unitNumber) { summary.skipped++; summary.skips.push({ sheet: ws.name, row: r, lessee, unitNumber }); }
        continue;
      }

      // Owner — matched by normalized name; NEVER creates a User.
      const ownerName = lessor || "Unknown Owner";
      const ownerKey = key(ownerName);
      let ownerId = owners.get(ownerKey);
      if (ownerId === undefined) {
        let owner = await prisma.unitOwner.findUnique({ where: { nameKey: ownerKey } });
        if (!owner) { owner = await prisma.unitOwner.create({ data: { name: ownerName, nameKey: ownerKey } }); summary.owners++; }
        ownerId = owner.id; owners.set(ownerKey, ownerId);
      }

      // Tenant — matched by normalized name (keeps tenantId stable across re-imports).
      const tKey = key(lessee);
      let tenantId = tenants.get(tKey);
      if (tenantId === undefined) {
        let tenant = await prisma.tenant.findUnique({ where: { nameKey: tKey } });
        if (!tenant) { tenant = await prisma.tenant.create({ data: { name: lessee, nameKey: tKey } }); summary.tenants++; }
        tenantId = tenant.id; tenants.set(tKey, tenantId);
      }

      // Unit — matched by owner + normalized building/unit/tower.
      const towerId = towerByName.get(towerNameFor(building)) ?? null;
      const unitKey = `${key(building)}|${key(unitNumber)}|${towerId ?? ""}`;
      const uMapKey = `${ownerId}|${unitKey}`;
      let unitId = units.get(uMapKey);
      if (unitId === undefined) {
        let unit = await prisma.unit.findUnique({ where: { ownerId_unitKey: { ownerId, unitKey } } });
        const descriptive = { floor, slotNo, type: unitType, baseRent: monthlyRent }; // key fields never change
        if (unit) {
          // Only apply non-null values: a blank cell on re-import must never erase a
          // previously populated (or portal-edited) field.
          const updates = Object.fromEntries(Object.entries(descriptive).filter(([, v]) => v != null));
          if (Object.keys(updates).length) await prisma.unit.update({ where: { id: unit.id }, data: updates });
        } else {
          unit = await prisma.unit.create({ data: { ownerId, unitKey, unitNumber, building, towerId, status: "OCCUPIED", ...descriptive } });
          summary.units++;
        }
        unitId = unit.id; units.set(uMapKey, unitId);
      }

      // Lease — natural key (unit, tenant, start, end).
      const leaseData = {
        monthlyRent, status: leaseStatus(endDate, now),
        advanceRent: text(v[14]), securityDeposit: text(v[15]), modeOfPayment: text(v[16]),
        serviceFee: text(v[17]), source: text(v[18]), remarks: text(v[19]),
        renewalPeriod: text(v[12]), managedBy: text(v[2]),
      };
      const existing = await prisma.lease.findUnique({
        where: { unitId_tenantId_startDate_endDate: { unitId, tenantId, startDate, endDate } },
        select: { id: true },
      });
      if (existing) {
        await prisma.lease.update({ where: { id: existing.id }, data: leaseData });
      } else {
        await prisma.lease.create({ data: { unitId, tenantId, startDate, endDate, ...leaseData } });
        summary.leases++;
      }
    }
  }
  return summary;
}

export async function importFromFile(path) {
  const { readFile } = await import("fs/promises");
  return importWorkbook(await readFile(path));
}
