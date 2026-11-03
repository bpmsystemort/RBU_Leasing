import { hashPassword, SUPER_ADMIN_EMAIL } from "../src/services/authService.js";

// Super admin: always guaranteed present with an ADMIN role. Only the password
// *hash* is stored — no readable copy of the starting password is kept, so a
// database seeded from scratch holds nothing that can be read back.
export async function ensureSuperAdmin(prisma, email = SUPER_ADMIN_EMAIL) {
  return prisma.user.upsert({
    where: { email },
    // Only the ADMIN role is re-asserted on an existing account. The password is
    // deliberately NOT reset here: re-seeding used to clobber a changed admin
    // password back to the default, which browsers flag as breached. Use
    // scripts/set-admin-password.js to change it.
    update: { role: "ADMIN" },
    create: { name: "Super Admin", email, passwordHash: await hashPassword("admin123"), role: "ADMIN" },
  });
}
