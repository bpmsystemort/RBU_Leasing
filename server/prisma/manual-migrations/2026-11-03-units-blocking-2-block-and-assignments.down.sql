-- Down for SP2 part 2: removes the assignment history and the block pointer.
-- NOTE: the two UnitStatus enum values added by part 1 (BLOCKED, UNAVAILABLE)
-- cannot be removed by a down script: PostgreSQL has no DROP VALUE for enums.
-- Any unit still in BLOCKED/UNAVAILABLE status should be set back to VACANT or
-- OCCUPIED before relying on the old application code.
DROP TABLE IF EXISTS "UnitAssignmentEvent";
ALTER TABLE "Unit" DROP CONSTRAINT IF EXISTS "Unit_blockedByTransactionId_fkey";
DROP INDEX IF EXISTS "Unit_blockedByTransactionId_idx";
ALTER TABLE "Unit" DROP COLUMN IF EXISTS "blockedByTransactionId";
