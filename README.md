# Autom — IdealLand Automation Dashboard

Internal dashboard for tracking planning applications, managing social posts, running ad campaigns, and sending mailing campaigns.

---

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Git](https://git-scm.com/)
- A [Railway](https://railway.app/) account

---

## Local Development Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd autom
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment file

Create `.env.local` in the project root:

```env
# Auth
DASHBOARD_PASSWORD=choose_a_strong_password

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Email (Resend)
RESEND_API_KEY=re_...
ALERT_EMAIL_FROM=alerts@yourdomain.com
ALERT_EMAIL_TO=you@yourdomain.com

# Social (Ayrshare)
AYRSHARE_API_KEY=...

# Meta Ads
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=act_...
META_PAGE_ID=...
META_WEBSITE_URL=https://yourdomain.com

# Mailing (Mixmax)
MIXMAX_API_KEY=...
MIXMAX_WEBHOOK_SECRET=...

# Land Registry
HMLR_API_KEY=...

# Cron security (any random secret string)
CRON_SECRET=generate_random_string_here
```

> Only `DASHBOARD_PASSWORD` is required to run the app locally. All other keys enable specific features.

### 4. Set up the database

```bash
npx prisma migrate deploy
```

This creates `prisma/dev.db` (SQLite file).

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Login with the `DASHBOARD_PASSWORD` you set.

---

## Deploy to Railway

Railway supports persistent volumes, which is required for SQLite.

### Step 1 — Create Railway project

1. Go to [railway.app](https://railway.app/) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Connect your GitHub account and select this repo
4. Railway will detect Next.js automatically

### Step 2 — Add a persistent volume (required for SQLite)

SQLite writes to disk. Without a volume, data resets on every deploy.

1. In your Railway project, click your service
2. Go to **Volumes** tab → **Add Volume**
3. Set **Mount Path** to `/app/prisma`
4. Click **Add**

This mounts persistent storage at `/app/prisma`, keeping `dev.db` across deploys.

### Step 3 — Set environment variables

In Railway: **Service → Variables** tab, add all variables from the `.env.local` template above.

**Required for production:**

| Variable | Value |
|---|---|
| `DASHBOARD_PASSWORD` | Strong password for login |
| `NODE_ENV` | `production` |
| `CRON_SECRET` | Random secret string |

Add any other keys for the features you want enabled.

### Step 4 — Set build and start commands

In Railway: **Service → Settings → Deploy**

- **Build Command:** `npm run build`
- **Start Command:** `npm start`

Or add a `railway.toml` to the repo root:

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npx prisma migrate deploy && npm start"
restartPolicyType = "on_failure"
```

Using `railway.toml` is recommended — it runs migrations automatically before each deploy.

### Step 5 — Deploy

Push to your connected branch (usually `main`). Railway builds and deploys automatically.

First deploy: Railway runs `npx prisma migrate deploy` (via the start command above), creating the database schema.

### Step 6 — Access your app

Railway provides a public URL under **Service → Settings → Networking → Generate Domain**.

Login with your `DASHBOARD_PASSWORD`.

---

## Setting Up on a New Machine

```bash
# 1. Clone
git clone <your-repo-url>
cd autom

# 2. Install
npm install

# 3. Create .env.local (copy template from above, fill in values)

# 4. Init database
npx prisma migrate deploy

# 5. Run
npm run dev
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DASHBOARD_PASSWORD` | Yes | Password to access the dashboard |
| `CRON_SECRET` | Yes (prod) | Secures cron job API endpoints |
| `ANTHROPIC_API_KEY` | For AI features | Claude API key |
| `OPENAI_API_KEY` | For AI features | OpenAI API key |
| `RESEND_API_KEY` | For email alerts | Resend API key |
| `ALERT_EMAIL_FROM` | For email alerts | Sender address |
| `ALERT_EMAIL_TO` | For email alerts | Recipient address |
| `AYRSHARE_API_KEY` | For social posting | Ayrshare API key |
| `META_ACCESS_TOKEN` | For Meta ads | Meta Graph API token |
| `META_AD_ACCOUNT_ID` | For Meta ads | Ad account ID (format: `act_123`) |
| `META_PAGE_ID` | For Meta ads | Facebook Page ID |
| `META_WEBSITE_URL` | For Meta ads | Your website URL |
| `MIXMAX_API_KEY` | For mailing | Mixmax API key |
| `MIXMAX_WEBHOOK_SECRET` | For mailing webhooks | Mixmax webhook secret |
| `HMLR_API_KEY` | For land registry | HMLR API key |

---

## Database Notes

- Uses SQLite via `prisma/dev.db`
- On Railway: must have a persistent volume mounted at `/app/prisma`
- Migrations live in `prisma/migrations/` — run `npx prisma migrate deploy` to apply
- To inspect the DB locally: `npx prisma studio`

---

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** SQLite + Prisma ORM
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **AI:** Anthropic Claude + OpenAI
- **Email:** Resend
- **Social:** Ayrshare
- **Charts:** Recharts
