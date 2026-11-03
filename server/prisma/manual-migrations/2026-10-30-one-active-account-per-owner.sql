-- Enforce at most one active login per owner (backstops the app-level guard against races).
CREATE UNIQUE INDEX IF NOT EXISTS "User_unitOwnerId_active_key"
  ON "User"("unitOwnerId")
  WHERE "unitOwnerId" IS NOT NULL AND "status" IN ('APPROVED','PENDING','FOR_REVISION','SUSPENDED');
