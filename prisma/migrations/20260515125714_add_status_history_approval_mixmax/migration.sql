-- AlterTable
ALTER TABLE "MailingRecipient" ADD COLUMN "mixmaxMessageId" TEXT;

-- CreateTable
CREATE TABLE "ApplicationStatusChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ApplicationStatusChange_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PlanningApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlanningApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "council" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "applicant" TEXT,
    "architect" TEXT,
    "submittedAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "decisionAlertSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PlanningApplication" ("address", "alertSent", "applicant", "architect", "council", "createdAt", "decidedAt", "description", "id", "reference", "status", "submittedAt", "units", "updatedAt") SELECT "address", "alertSent", "applicant", "architect", "council", "createdAt", "decidedAt", "description", "id", "reference", "status", "submittedAt", "units", "updatedAt" FROM "PlanningApplication";
DROP TABLE "PlanningApplication";
ALTER TABLE "new_PlanningApplication" RENAME TO "PlanningApplication";
CREATE UNIQUE INDEX "PlanningApplication_reference_key" ON "PlanningApplication"("reference");
CREATE TABLE "new_SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewNote" TEXT,
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_SocialPost" ("content", "createdAt", "engagements", "id", "imageUrl", "platform", "publishedAt", "reach", "scheduledAt", "status") SELECT "content", "createdAt", "engagements", "id", "imageUrl", "platform", "publishedAt", "reach", "scheduledAt", "status" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
