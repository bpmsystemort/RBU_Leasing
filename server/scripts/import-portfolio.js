import "../src/env.js";
import { commitFromFile } from "../src/services/portfolioImportService.js";
import { prisma } from "../src/lib/prisma.js";

const file = process.argv[2] || "\\\\tsclient\\C\\Users\\taguicmja\\Downloads\\Unit Lease_Residential Leasing.xlsx";

commitFromFile(file)
  .then((s) => {
    console.log(`Imported (idempotent): ${s.created} created, ${s.updated} updated, ${s.skipped} skipped, ${s.failed} failed. ${s.ownersFlagged} owner(s) flagged for review, ${s.unitsFlagged} unit(s) need status review.`);
    if (s.failed > 0) console.log("First failures:", s.failures.slice(0, 8));
  })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
