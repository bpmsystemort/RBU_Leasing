import "../src/env.js";
import { importFromFile } from "../src/services/portfolioImportService.js";
import { prisma } from "../src/lib/prisma.js";

const file = process.argv[2] || "\\\\tsclient\\C\\Users\\taguicmja\\Downloads\\Unit Lease_Residential Leasing.xlsx";

importFromFile(file)
  .then((s) => {
    console.log(`Imported (idempotent): ${s.owners} new owners, ${s.tenants} new tenants, ${s.units} new units, ${s.leases} new leases. Skipped ${s.skipped} incomplete rows.`);
    if (s.skips.length) console.log("First skips:", s.skips.slice(0, 8));
  })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
