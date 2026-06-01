# IdealLand Automation Dashboard

Internal dashboard that runs IdealLand's planning-sourcing pipeline end-to-end: scrapes 27 London borough planning portals daily, drafts AI social content + outreach copy, sends segmented email campaigns, and auto-invoices clients monthly.

## What runs in here

| Surface | What it does | Status today |
|---|---|---|
| **Sourcing** | Auto-scrapes 27 London borough planning portals for ≥10-unit applications | live |
| **Decisions** | Polls tracked applications for status changes (approved/refused) | live |
| **Documents** | Pulls planning PDFs from council portals + (optional) Land Registry titles via HMLR | live (HMLR needs key) |
| **AI Content Factory** | Claude drafts per-platform social copy; DALL·E generates images; PDF text from documents enriches the prompt | live |
| **Social posting** | Draft-only mode — staff reviews drafts on the dashboard, approves, copies/pastes manually to their socials. No third-party publisher | live |
| **Mailing** | Segmented outreach to architects/developers/investors. Resend by default; falls back to Mixmax if `MIXMAX_API_KEY` is set | live (via Resend) |
| **Invoicing** | Monthly auto-bill IdealLand's own clients. Xero stubbed — marks sent locally without `XERO_CLIENT_ID`; pushes to Xero with it | live (stub mode) |
| **Cron** | Single `/api/cron` endpoint runs sourcing + decisions + documents on a schedule. Bearer-auth via `CRON_SECRET` | live |

## Local development

```bash
git clone https://github.com/Ahmedmkarrar/idealland-ai-system.git
cd idealland-ai-system
npm install
cp deploy/env.template .env.local   # fill in keys
npx prisma migrate dev
npm run dev -- --webpack            # NOT plain `npm run dev` — see below
```

Open http://localhost:3000 and login with `DASHBOARD_PASSWORD`.

> **Why `--webpack`?** The Turbopack native binary `@next/swc-darwin-arm64` is corrupted in some installs (segfault on load). Webpack mode bypasses it. If you want Turbopack back, try `rm -rf node_modules/@next/swc-* && npm install`.

## Production deploy

**Target:** $6/mo DigitalOcean droplet (Ubuntu 24.04). See **[`deploy/README.md`](deploy/README.md)** for the full runbook.

TL;DR:

```bash
# On a fresh droplet, as root:
bash deploy/setup-droplet.sh

# Then as the idealland user:
git clone https://github.com/Ahmedmkarrar/idealland-ai-system.git
cd idealland-ai-system
cp deploy/env.template .env.local && nano .env.local
bash deploy/deploy.sh                        # first deploy
sudo bash -c 'cp deploy/nginx.conf.template /etc/nginx/sites-available/idealland'
# edit nginx file to set SERVER_NAME, symlink, reload nginx
sudo certbot --nginx -d your-domain.tld      # HTTPS
bash deploy/install-cron.sh                  # 4-hourly cron
```

Future deploys are one command: `bash deploy/deploy.sh` (git pull, prisma generate, prisma migrate deploy, next build, pm2 reload).

## Environment variables

Only **two are strictly required** to boot. Everything else is feature-gated — services short-circuit gracefully when their key isn't set.

| Variable | Required? | What it unlocks |
|---|---|---|
| `DASHBOARD_PASSWORD` | yes | Login |
| `CRON_SECRET` | yes (prod) | Authorizes `/api/cron` |
| `ANTHROPIC_API_KEY` | for AI | Claude (social drafts, PDF-aware content) |
| `OPENAI_API_KEY` | for AI | DALL·E images |
| `RESEND_API_KEY` | for email | Planning alerts + outreach mail (covers mailing if Mixmax absent) |
| `ALERT_EMAIL_FROM` | for email | Sender address (must match a verified Resend domain in prod) |
| `ALERT_EMAIL_TO` | for email | Where alerts land |
| `HMLR_API_KEY` | for HMLR | Land Registry title pulls |
| `MIXMAX_API_KEY` | optional | Outreach mailer with open/click tracking (Resend covers if blank) |
| `MIXMAX_WEBHOOK_SECRET` | optional | Mixmax webhook signing |
| `XERO_CLIENT_ID` + 5 more | optional | Real Xero invoice pushes. Without these, invoices mark sent locally |

Full template: [`deploy/env.template`](deploy/env.template).

## Stack

- **Next.js 16** (App Router, webpack mode in dev — see note above)
- **Prisma 7.8** + **SQLite** (`better-sqlite3` driver adapter, no driverAdapters preview)
- **Tailwind v4** + **shadcn/ui** (base-ui under the hood — NOT Radix; no `asChild` pattern)
- **Anthropic Claude** (`claude-haiku-4-5`) for content drafting
- **OpenAI** (`gpt-4o-mini`, DALL·E 3) for fallback + images
- **Resend** for transactional + outreach email
- **unpdf** for PDF text extraction → Claude context
- **PM2** + **Nginx** + **Let's Encrypt** + **Linux cron** in production

## Repo conventions

- **Branches**: `main` is the production line. Feature work goes on `feat/*` or `mvp/*` branches.
- **Memory of decisions**: see `docs/` — `AUTOMATIONS_OVERVIEW.md` (what each surface does), `CLIENT_API_SETUP.md` (key procurement), `CLIENT_PROPOSAL.md` (sales pitch), `LUCY_NEXT_MESSAGE.md` (current client comms draft).
- **Pre-Next-16 patterns will not work**: this is Next 16, App Router. Read `AGENTS.md` before writing routing/middleware code.

## Operations

| Want to | On the droplet (`idealland` user) |
|---|---|
| See live logs | `pm2 logs idealland` |
| Health check | `bash deploy/healthcheck.sh` |
| Manual cron | `bash deploy/run-cron.sh` |
| Redeploy | `bash deploy/deploy.sh` |
| Restore DB | `cp /var/backups/idealland/dev-YYYY-MM-DD.db prisma/dev.db && pm2 restart idealland` |
