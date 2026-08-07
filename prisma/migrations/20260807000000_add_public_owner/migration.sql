-- Council/public-body ownership: these sites can't be brokered, so they are set
-- aside from the working list. `ownershipStatus` is PLD's own field; `publicOwner`
-- is the derived flag with `publicOwnerReason` recording why.
ALTER TABLE "PlanningApplication" ADD COLUMN "ownershipStatus" TEXT;
ALTER TABLE "PlanningApplication" ADD COLUMN "publicOwner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanningApplication" ADD COLUMN "publicOwnerReason" TEXT;
