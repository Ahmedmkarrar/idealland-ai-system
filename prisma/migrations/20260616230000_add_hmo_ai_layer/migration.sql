-- AI acquisition layer for HMO properties (Phase 3): refined Claude score,
-- draft approach letter, and its workflow status. Additive, nullable columns.
ALTER TABLE "HmoProperty" ADD COLUMN "aiScore" INTEGER;
ALTER TABLE "HmoProperty" ADD COLUMN "approachLetter" TEXT;
ALTER TABLE "HmoProperty" ADD COLUMN "approachStatus" TEXT;
ALTER TABLE "HmoProperty" ADD COLUMN "letterDraftedAt" DATETIME;
