-- Owner Portal Accounts (Step 2): a SUSPENDED account status plus an invite
-- table so an officer can email a lessor a one-time link to activate their
-- portal account. Additive and idempotent, in line with the other manual
-- migrations here — the committed Prisma history has drifted on the deployed
-- databases.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that then
-- reads the new value, so this runs on its own (see 2026-09-14 for the same
-- pattern). IF NOT EXISTS makes a second run a no-op.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

CREATE TABLE IF NOT EXISTS "OwnerInvite" (
  "id" TEXT PRIMARY KEY,
  "unitOwnerId" TEXT NOT NULL REFERENCES "UnitOwner"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OwnerInvite_tokenHash_key" ON "OwnerInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "OwnerInvite_unitOwnerId_idx" ON "OwnerInvite"("unitOwnerId");
