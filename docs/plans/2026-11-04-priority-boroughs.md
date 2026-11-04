# More sites from the priority boroughs — plan (4 Nov 2026)

Lucy, 4 Nov: "not a lot of schemes are coming up in our preferred boroughs" —
Merton, Lambeth, Hammersmith & Fulham and Wandsworth ("our actual borough").
James worried "the ratings might be too severe". Also: a Hammersmith lead rated
8 never reached her list.

## What was wrong
1. **Wandsworth had sent nothing since ~11 Sep.** The council moved its register
   from Northgate to Agile Applications; the London DataHub and PlanIt both
   stopped. Old Northgate links 404, so agent research failed on every older
   Wandsworth lead (16 scored 7+ stuck on "not found").
2. **Merton's DataHub feed stalled on 21 Oct** (PlanIt has had almost nothing
   since July). Merton's own register sits behind a bot challenge.
3. **The rubric capped 1-2 home schemes at 4-6** and marked down "mid-tier"
   postcodes. Most priority-borough schemes are 1-2 homes, and research/letters
   need 6-7+. October: 37 priority leads, 8 worked.
4. **A lead with no agent found never reaches Ready to Send**, silently.
   81 Blythe Road W14 (8, H&F) is one.
5. Nothing noticed a borough going quiet (second time after 10-21 Oct).

## Phase 1 — shipped on branch feat/borough-coverage
- `lib/coverage.ts`: `priority` flag on the four boroughs; `worthWorking()` —
  priority boroughs researched and drafted from score 5 (`PRIORITY_MIN_LEAD_SCORE`).
- Daily contact research takes priority boroughs first.
- New rubric (`lib/services/intelligence.ts`): scores "how worth a letter", no
  postcode snobbery, priority boroughs named. `scripts/rescore-recent.ts`
  re-scores unsent leads (Oct test: Merton avg 4.6 -> 7.8, Lambeth 3.9 -> 7.1,
  H&F 4.3 -> 7.7; Surrey roughly +1).
- Wandsworth from its own register: `lib/services/agile-api.ts`,
  `lib/services/agile.ts` (daily scan, cron), register reader in
  `portal-extract.ts` (agent name, firm, email straight from the council).
  UK-only API — works from the droplet. `scripts/backfill-wandsworth-register.ts`
  repoints 47 old links and re-researches stuck leads (test: 16/16 agents found
  with email, 16 letters drafted).
- London scan dedupes on council reference so Wandsworth isn't stored twice.
- Self-check flags any covered council with no new lead in 14 days
  (`SELF_CHECK_QUIET_FEED_DAYS`). Today it flags Wandsworth and Elmbridge.

## Phase 2 — next
- **"Needs an agent" list on Ready** for priority leads where research failed,
  with the council link and case officer, so Lucy/James can phone or WhatsApp
  (Blythe Road case). Requeue priority not_found leads once for re-research.
- **Merton direct source**: headless-browser read of rspandlp.merton.gov.uk (bot
  challenge), or email the GLA DataHub team about the stalled Merton connector.
- **Elmbridge**: PlanIt has nothing since 30 Sep — check its register (Astun).
- Coverage strip on the dashboard: last new lead per borough, so Lucy can see
  every feed is alive.
- Wider net in priority boroughs: refused 1-9 home schemes (frustrated owners),
  and 10-12 home schemes that could be trimmed under the threshold — ask Lucy.
- Unit reader read "1 x 2-bed and 1 x 3-bed flats" as 1 home (Wandsworth
  2026/2771) — tighten the prompt.
