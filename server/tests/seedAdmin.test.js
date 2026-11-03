import { describe, it, expect, afterEach } from "vitest";
import { hashPassword, verifyPassword } from "../src/services/authService.js";
import { prisma } from "../src/lib/prisma.js";
import { ensureSuperAdmin } from "../prisma/seedAdmin.js";

// The seed is how a brand-new database gets its first login. It must not leave
// a readable copy of that password behind: a fresh database is exactly where
// a leftover would sit unnoticed.
const EMAIL = "Seed Test Admin";
afterEach(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); });

describe("ensureSuperAdmin", () => {
  it("creates the admin with a hashed password and no readable copy", async () => {
    await ensureSuperAdmin(prisma, EMAIL);
    const row = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(row.role).toBe("ADMIN");
    expect(row.passwordPlain).toBeNull();
    expect(await verifyPassword("admin123", row.passwordHash)).toBe(true);
  });

  it("leaves a changed password alone when the seed runs again", async () => {
    await ensureSuperAdmin(prisma, EMAIL);
    const changed = await hashPassword("a-newer-passphrase");
    await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash: changed, role: "VIEWER" } });
    await ensureSuperAdmin(prisma, EMAIL);
    const row = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(row.passwordHash).toBe(changed);
    expect(row.role).toBe("ADMIN");
  });
});
