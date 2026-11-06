-- Remembers that staff reviewed an import's "needs a status decision" flag, so a re-import does not raise it again.
ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "statusReviewedAt" TIMESTAMP(3);

-- Units reviewed before this column existed: the import flags every OCCUPIED unit without a current lease,
-- so one that is unflagged and still has no current lease can only have been marked reviewed by staff.
UPDATE "Unit" u
SET "statusReviewedAt" = NOW()
WHERE u.status = 'OCCUPIED'
  AND NOT u."needsStatusReview"
  AND u."statusReviewedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "Lease" l WHERE l."unitId" = u.id)
  AND NOT EXISTS (SELECT 1 FROM "Lease" l WHERE l."unitId" = u.id AND l."startDate" <= NOW() AND l."endDate" >= NOW());
