-- The council's actual decision ("Approved" / "Refused" / "Withdrawn" / ...).
-- status="decided" only means a decision exists, not that it was granted, and the
-- approach email wording depends on which it was.
ALTER TABLE "PlanningApplication" ADD COLUMN "decision" TEXT;
