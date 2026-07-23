-- IdealLand's real sourcing workflow: once the AI surfaces a suitable planning
-- application, staff must reach the AGENT who filed it (architect / planning
-- consultant, sometimes the owner) to ask whether the owner would sell — then
-- IdealLand introduces the off-market site to their developers. The contact is
-- almost never in the GLA feed; it lives on the council portal + the firm's
-- site/LinkedIn, which is the labour this module collapses. All columns are
-- additive and nullable, so this applies cleanly to the existing table.

-- Link back to the council's own planning-portal page (PLD url_planning_app).
-- The agent/applicant identity lives there, not in the GLA structured feed.
ALTER TABLE "PlanningApplication" ADD COLUMN "councilUrl" TEXT;

-- Contact discovery — who filed the application and how to reach them.
ALTER TABLE "PlanningApplication" ADD COLUMN "agentName" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "agentFirm" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "agentEmail" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "agentPhone" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "agentWebsite" TEXT;
-- null | "researching" | "found" | "not_found"
ALTER TABLE "PlanningApplication" ADD COLUMN "contactStatus" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "contactNotes" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "contactResearchedAt" DATETIME;

-- Seller-approach email drafted to the agent ("is the owner open to selling?").
-- approachStatus is delivery state; approachOutcome is what came back — kept
-- separate so recording a reply never overwrites the record of the send.
ALTER TABLE "PlanningApplication" ADD COLUMN "approachSubject" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "approachBody" TEXT;
-- null | "drafted" | "sent"
ALTER TABLE "PlanningApplication" ADD COLUMN "approachStatus" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "approachSentAt" DATETIME;
-- null | "replied" | "interested" | "dead" | "won"
ALTER TABLE "PlanningApplication" ADD COLUMN "approachOutcome" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "approachOutcomeAt" DATETIME;
