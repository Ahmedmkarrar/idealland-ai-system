-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageGeneratedAt" DATETIME,
    "status" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewNote" TEXT,
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT,
    CONSTRAINT "SocialPost_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PlanningApplication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SocialPost" ("approvalStatus", "content", "createdAt", "engagements", "id", "imageUrl", "platform", "publishedAt", "reach", "reviewNote", "scheduledAt", "status") SELECT "approvalStatus", "content", "createdAt", "engagements", "id", "imageUrl", "platform", "publishedAt", "reach", "reviewNote", "scheduledAt", "status" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
