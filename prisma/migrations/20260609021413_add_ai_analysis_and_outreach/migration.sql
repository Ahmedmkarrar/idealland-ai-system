-- AlterTable
ALTER TABLE "PlanningApplication" ADD COLUMN "analyzedAt" DATETIME;
ALTER TABLE "PlanningApplication" ADD COLUMN "intelligenceSummary" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "leadScore" INTEGER;
ALTER TABLE "PlanningApplication" ADD COLUMN "leadScoreReason" TEXT;

-- CreateTable
CREATE TABLE "OutreachEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" DATETIME,
    "resendId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachEmail_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PlanningApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OutreachEmail_applicationId_idx" ON "OutreachEmail"("applicationId");

-- CreateIndex
CREATE INDEX "OutreachEmail_status_idx" ON "OutreachEmail"("status");
