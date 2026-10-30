-- Configurable Email Settings (Task 1): a singleton EmailSettings row for
-- admin-managed, non-secret outbound-email config (enabled/host/port/secure/
-- fromAddress/fromName). MAIL_USER/MAIL_PASS stay in server/.env and are
-- never stored here. Additive and idempotent, in line with the other manual
-- migrations here — the committed Prisma history has drifted on the deployed
-- databases.
CREATE TABLE IF NOT EXISTS "EmailSettings" (
  "id" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "host" TEXT,
  "port" INTEGER NOT NULL DEFAULT 587,
  "secure" BOOLEAN NOT NULL DEFAULT false,
  "fromAddress" TEXT,
  "fromName" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
