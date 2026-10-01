-- Lucy's own note on a site and the date she wants to follow it up.
ALTER TABLE "PlanningApplication" ADD COLUMN "staffNote" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "followUpAt" DATETIME;
