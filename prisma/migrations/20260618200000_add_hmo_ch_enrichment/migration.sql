-- Companies House enrichment fields for HMO properties (Phase 2). Additive, nullable.
ALTER TABLE "HmoProperty" ADD COLUMN "companyNumber" TEXT;
ALTER TABLE "HmoProperty" ADD COLUMN "companyStatus" TEXT;
ALTER TABLE "HmoProperty" ADD COLUMN "incorporationDate" DATETIME;
ALTER TABLE "HmoProperty" ADD COLUMN "maxDirectorAge" INTEGER;
ALTER TABLE "HmoProperty" ADD COLUMN "directorSummary" TEXT;
ALTER TABLE "HmoProperty" ADD COLUMN "enrichedAt" DATETIME;
