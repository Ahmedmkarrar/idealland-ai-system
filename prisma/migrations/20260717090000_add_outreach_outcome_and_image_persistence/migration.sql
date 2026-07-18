-- Local persistence for generated social images. The DALL-E URL in imageUrl
-- expires after ~1 hour; imagePath points at bytes we own. Additive, nullable.
ALTER TABLE "SocialPost" ADD COLUMN "imagePath" TEXT;

-- Outreach outcome tracking. Deliberately a separate column from `status`:
-- status is delivery state (did it send), outcome is what came back. Recording
-- a reply must never overwrite the record of the send. Additive, nullable.
ALTER TABLE "OutreachEmail" ADD COLUMN "outcome" TEXT;
ALTER TABLE "OutreachEmail" ADD COLUMN "outcomeAt" DATETIME;

-- One draft per contact per application. Also closes the check-then-write race
-- where two concurrent POSTs for the same app each drafted a full set of five.
CREATE UNIQUE INDEX "OutreachEmail_applicationId_contactEmail_key" ON "OutreachEmail"("applicationId", "contactEmail");

-- Backs the per-contact cooldown lookup in pickContacts().
CREATE INDEX "OutreachEmail_contactEmail_createdAt_idx" ON "OutreachEmail"("contactEmail", "createdAt");

CREATE INDEX "OutreachEmail_outcome_idx" ON "OutreachEmail"("outcome");
