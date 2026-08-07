-- The council's own planning reference (PLD `lpa_app_no`, e.g. "26/01804/FUL").
-- `reference` holds the GLA document id, which council portals don't recognise.
ALTER TABLE "PlanningApplication" ADD COLUMN "lpaReference" TEXT;
