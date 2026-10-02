// One-off: record every London decision the old checker missed, without the
// per-decision alert email (there are over a hundred). The 4-hourly cron keeps
// them current from here, with alerts.
//
// Usage: npx tsx scripts/catch-up-decisions.ts
import { prisma } from "@/lib/db/client";
import { checkDecisions } from "@/lib/services/decisions";

checkDecisions({ alert: false })
  .then((result) => console.log(result))
  .finally(() => prisma.$disconnect());
