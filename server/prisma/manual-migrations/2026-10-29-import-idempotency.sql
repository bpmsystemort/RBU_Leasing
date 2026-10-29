-- DEPLOY ORDER (populated DB): do NOT run this whole file at once.
--   1. Apply the ALTER TABLE ... ADD COLUMN statements below.
--   2. Run: node server/scripts/backfill-import-keys.mjs  (once per target DB, with that DB's DATABASE_URL)
--      and confirm it prints "duplicate groups ... { owners:0, tenants:0, units:0, leases:0 }".
--   3. ONLY THEN apply the CREATE UNIQUE INDEX statements.
--   4. Run: npx prisma generate
-- On an empty DB the order does not matter. See README-portfolio-import-deploy.md in this folder.

-- Normalized keys for idempotent import. Nullable: a Postgres unique index
-- allows multiple NULLs (and, for a composite index, treats any-NULL rows as
-- distinct), so rows without a key never collide.
ALTER TABLE "UnitOwner" ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Tenant"    ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Unit"      ADD COLUMN IF NOT EXISTS "unitKey" TEXT;

-- Index names follow Prisma's @@unique convention so schema and DB agree.
CREATE UNIQUE INDEX IF NOT EXISTS "UnitOwner_nameKey_key" ON "UnitOwner"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_nameKey_key" ON "Tenant"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Unit_ownerId_unitKey_key" ON "Unit"("ownerId", "unitKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Lease_unitId_tenantId_startDate_endDate_key" ON "Lease"("unitId", "tenantId", "startDate", "endDate");
