import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { SUPER_ADMIN_EMAIL } from "../src/services/authService.js";
import { ensureSuperAdmin } from "./seedAdmin.js";
import { seedEstates } from "./estatesSeed.js";

async function main() {
  await ensureSuperAdmin(prisma);
  // The starting password is the documented default; change it with
  // scripts/set-admin-password.js before the app is reachable by anyone else.
  console.log(`seeded super admin ${SUPER_ADMIN_EMAIL} (change its password with scripts/set-admin-password.js)`);

  await seedEstates(prisma);
  console.log("seeded estate/tower hierarchy");
}
main().finally(() => prisma.$disconnect());
