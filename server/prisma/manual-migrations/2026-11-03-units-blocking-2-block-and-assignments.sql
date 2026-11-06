-- SP2 part 2: the block pointer and the assignment history.
ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "blockedByTransactionId" TEXT;
CREATE INDEX IF NOT EXISTS "Unit_blockedByTransactionId_idx" ON "Unit"("blockedByTransactionId");
DO $$ BEGIN
  ALTER TABLE "Unit" ADD CONSTRAINT "Unit_blockedByTransactionId_fkey"
    FOREIGN KEY ("blockedByTransactionId") REFERENCES "LeasingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "UnitAssignmentEvent" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "fromOwnerId" TEXT,
  "toOwnerId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnitAssignmentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UnitAssignmentEvent_unitId_idx" ON "UnitAssignmentEvent"("unitId");
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_fromOwnerId_fkey" FOREIGN KEY ("fromOwnerId") REFERENCES "UnitOwner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UnitAssignmentEvent" ADD CONSTRAINT "UnitAssignmentEvent_toOwnerId_fkey" FOREIGN KEY ("toOwnerId") REFERENCES "UnitOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
