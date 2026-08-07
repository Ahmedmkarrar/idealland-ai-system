-- Verified deep link to a third-party planning-register mirror (PlanIndex), used
-- when the council itself publishes no direct link. Only ever populated after a
-- request confirms the page exists, so it can never render as a dead link.
ALTER TABLE "PlanningApplication" ADD COLUMN "mirrorUrl" TEXT;
