# IdealLand AI Automation System — Developer Handoff

> An internal intelligence dashboard that sources off-market London property opportunities — planning applications and HMO acquisitions — and drafts the AI outreach around them. This doc orients a new developer to the codebase, how to run and ship it, and exactly where it stands.

| | |
|---|---|
| **Status** | 🟢 Live & healthy |
| **Deployed commit** | `c9ed5d0` |
| **Prod URL** | https://143-110-168-225.nip.io |
| **Last verified** | 18 Jul 2026 |

---

## ⚠️ Read this first — where the code lives

**The default branch `main` is a near-empty shell.** All real work (20 commits, and what production runs) lives on **`feat/deploy-digitalocean`**. Clone and switch to it immediately, or you'll be looking at a bare Create-Next-App.

```bash
git clone https://github.com/Ahmedmkarrar/idealland-ai-system.git
cd idealland-ai-system
git checkout feat/deploy-digitalocean   # <-- the real code
```

- **Repo (public):** https://github.com/Ahmedmkarrar/idealland-ai-system
- **Working branch:** `feat/deploy-digitalocean`
- **Node:** 20 LTS
- **Recent changes (18 Jul):** `c9ed5d0` outreach outcome tracking · local AI-image persistence · mobile-first dashboard · copy/accuracy fixes

---

## 1. What it does

Two product lines on one dashboard, both feeding a shared AI layer. Everything is feature-gated — a service short-circuits gracefully when its API key is absent.

**Planning sourcing.** Scans all 33 London planning authorities daily for residential schemes in the **1–9 unit** band (deliberately sub-threshold — 10+ units triggers affordable-housing obligations developers avoid). Claude scores each as a lead (1–10) with a "why this matters" brief, then drafts personalised outreach email to the best-fit contacts. A historical mode backfills decided applications for research.

**HMO acquisition.** Ingests council HMO licensing registers → deterministic sell-likelihood score → **Companies House** owner enrichment (director ages as a retirement/exit signal) → Claude writes an acquisition brief and a ready-to-post direct-mail approach letter, tuned for company vs. private owners.

**Supporting surfaces:** Documents (planning PDFs + optional Land Registry titles), Mailing (segmented outreach via Resend), Invoicing (monthly auto-bill, Xero stubbed), and Social (draft-only — staff copy/paste, no third-party publisher).

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.2.6 | App Router, React 19 |
| Data | Prisma 7.8 + SQLite | `better-sqlite3` driver adapter, single file at `prisma/dev.db` |
| UI | Tailwind v4 + shadcn | base-ui under the hood — **not Radix**, no `asChild` |
| AI — text | Anthropic Claude | `claude-haiku-4-5` — scoring, briefs, letters, outreach |
| AI — image | OpenAI | `gpt-4o-mini` fallback + DALL·E 3 |
| Email | Resend | alerts + outreach + daily digest |
| PDF | unpdf | extracts planning-doc text into Claude context |
| Prod | PM2 · Nginx · cron | $6 DigitalOcean droplet, Ubuntu 24.04, London region |

> ⚠️ **Run dev with `npm run dev -- --webpack`, not plain `npm run dev`.** The `@next/swc-darwin-arm64` Turbopack binary segfaults in this install; webpack mode bypasses it. To attempt a fix: `rm -rf node_modules/@next/swc-* && npm install`.

---

## 3. Run it locally

Two env vars boot it (`DASHBOARD_PASSWORD`, `CRON_SECRET`); the rest unlock features.

```bash
# after checking out feat/deploy-digitalocean (see top of doc)
npm install
cp deploy/env.template .env.local   # fill in keys — shared separately
npx prisma migrate dev

# NOTE the --webpack flag
npm run dev -- --webpack
```

Open `http://localhost:3000`, log in with `DASHBOARD_PASSWORD`. Read `AGENTS.md` before writing routing/middleware code — it flags Next 16 breaking changes.

---

## 4. Deploy

One idempotent command: pull → build → zero-downtime PM2 reload.

```bash
# from your Mac, once your SSH key is on the droplet
ssh idealland@143.110.168.225 'cd ~/idealland-ai-system && bash deploy/deploy.sh'
```

Production is a $6 DigitalOcean droplet (`143.110.168.225`) behind Nginx + Let's Encrypt. PM2 keeps the process alive; two cron jobs run `/api/cron` every 4 hours (sourcing + decisions + documents) and an `08:00` digest email. The full runbook — bootstrap, backups, healthcheck, restore — is in [`deploy/README.md`](../deploy/README.md).

- DB backed up daily to `/var/backups/idealland/` (14-day retention)
- Manual scan: `bash deploy/run-cron.sh`
- Logs: `pm2 logs idealland`

---

## 5. The data source (recently rebuilt)

For weeks the pipeline silently returned **zero live leads**. Two prior sources had died quietly: direct council scrapes (Idox/Northgate) were Cloudflare-blocking the droplet IP, and the `planning.data.gov.uk` dataset silently narrowed to a single non-London authority with stale, already-decided data.

`lib/services/sourcing.ts` was rewritten onto the **GLA Planning London DataHub** — a free guest ElasticSearch API (`planningdata.london.gov.uk`) covering all 33 London LPAs with a _structured_ proposed-unit count. A live scan on deploy pulled **686 real leads**; the decided-applications backfill found **1,128** (the old feed found 2).

Guardrails: `MAX_ALERTS_PER_RUN` caps outbound; `PLANNING_AUTO_OUTREACH` gates external mail off by default; dedup on `reference` keeps re-scans idempotent.

---

## 6. Current state — full test pass

Every surface exercised end-to-end against the live droplet on 16 Jul 2026, including real Claude and Companies House calls. DB holds 1,865 applications (735 live + 1,130 decided).

| Surface | Check | Result |
|---|---|---|
| Health / DB | `/api/health` | ✅ ok · 4ms |
| Public HTTPS | nginx + Let's Encrypt | ✅ 200 |
| Sourcing scan | GLA DataHub | ✅ 686 found |
| Idempotency | re-scan | ✅ 0 dupes |
| AI lead scoring | real Claude | ✅ scores persist |
| AI outreach | real Claude | ✅ drafts ok |
| HMO brief | real Claude | ✅ ok |
| HMO enrichment | Companies House | ✅ 0 unmatched |
| Decisions backfill | 3-yr window | ✅ 1,128 found |
| Cron jobs | 4-hourly + digest | ✅ registered |
| Keys wired | resend · anthropic · openai | ✅ live |
| HMLR · Mixmax · Xero | optional integrations | ⚪ off (by design) |

---

## 7. Known issues & tech debt

Nothing here blocks the running system — these are the honest edges to pick up.

- **[SRC] Branch topology.** Everything lives on `feat/deploy-digitalocean`; `main` and the client upstream (`heyitsmohdd/autom`) are bare. Decide a source-of-truth and merge — no clean release line exists today.
- **[SEC] Secret hygiene.** Some API keys were historically shared in plaintext chat. Rotate `ANTHROPIC` / `OPENAI` / `RESEND` / `COMPANIES_HOUSE` and stand up a shared secrets vault. Set monthly spend caps on the Anthropic + OpenAI dashboards.
- **[FEAT] Partial features.** Xero invoicing runs in stub mode (marks sent locally without `XERO_CLIENT_ID`); `per_application` billing is in the schema but not implemented; HMLR document pull needs the client's `HMLR_API_KEY`.

**Resolved in `c9ed5d0` (18 Jul):**
- ~~**[BUG] DALL·E image expiry.**~~ Fixed — images are now fetched as bytes at generation time, persisted to a gitignored `storage/` dir, and served from `/api/images/[file]`. The dashboard renders `imagePath`, never the expiring URL; pre-persistence posts show a "regenerate" note.
- ~~**[UI] Stale dashboard label.**~~ Fixed — Overview now reports `N opportunities across M borough(s)`; sourcing returns `boroughsWithMatches` instead of the misleading `scanned/blocked` framing.

---

## 8. Access you'll need

Reading the code needs nothing — the repo is public. These unlock pushing and shipping:

- **Push access** — collaborator invite on `Ahmedmkarrar/idealland-ai-system` (or work from your own fork + PR).
- **Deploy access** — your SSH public key added to the droplet's `idealland` user.
- **Secrets** — the `.env.local` values (dashboard password, API keys, `CRON_SECRET`), shared over a secure channel — deliberately not in this document.
- **Dashboard login** — the prod URL above + `DASHBOARD_PASSWORD`, if you want to see the running product.

---

## Repo map

```
app/(dashboard)/     dashboard pages (sourcing, hmo, mailing, invoicing, social, documents…)
app/api/             route handlers (cron, sourcing, hmo, outreach, decisions, stats, health…)
lib/services/        the real logic — sourcing.ts, intelligence.ts, hmo.ts,
                     hmo-intelligence.ts, companies-house.ts, outreach.ts, email.ts, …
lib/db/, lib/retry.ts, lib/rate-limit.ts
prisma/schema.prisma migrations + SQLite schema
deploy/              droplet runbook + scripts (deploy.sh, setup-droplet.sh, cron, nginx)
docs/                specs, client comms, this handoff
```

_Prepared for handoff · verified live 16 Jul 2026 · deployed commit `7502877`. Design decisions trace back to `docs/` and the commit messages on `feat/deploy-digitalocean`._
