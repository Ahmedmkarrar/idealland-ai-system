# IdealLand — Automation Dashboard Overview

The dashboard runs **6 automations** in the background, hands-off, 24/7. Each one replaces hours of manual work per week. Here's exactly what each does, how it triggers, and what you'll see.

---

## 1. Sourcing Engine — Live Planning Alerts

| | |
|---|---|
| **What it does** | Continuously scrapes 27 London council planning portals (Camden, Hackney, Islington, Tower Hamlets, Southwark, Westminster, Lambeth, Lewisham, Greenwich, Wandsworth, Hammersmith & Fulham, Kensington & Chelsea, Haringey, Barnet, Enfield, Waltham Forest, Redbridge, Havering, Bexley, Bromley, Croydon, Sutton, Merton, Kingston, Richmond, Hounslow, Newham). Detects every new residential planning application with **10+ units**. |
| **When it runs** | Every 15 minutes, around the clock. |
| **Trigger** | New application detected on a council portal that isn't already in your database. |
| **What you get** | An email lands in your inbox within 15 min of a new 10+ unit submission. Email includes: reference number, address, council, unit count, brief description, submission date, and a direct link to the council page. |
| **Where you see it** | **Sourcing** tab on the dashboard — table of all detected applications, filterable by council / unit count / date / status. |
| **Time saved vs manual** | ~10-15 hours/week of checking 27 portals by hand. |
| **What you still do** | Decide which applications are worth pursuing. The dashboard surfaces every deal — you triage. |
| **Status indicators on dashboard** | New (just detected) → Reviewing (you opened it) → Pursuing (you're chasing) → Won / Passed (deal outcome). |
| **Limitations** | Only covers the 27 London councils currently wired. Adding more councils outside London takes ~2 hours per council. |

---

## 2. Document Fetcher — Auto-Pulls Every Document

| | |
|---|---|
| **What it does** | For every new application in the Sourcing Engine, the bot automatically downloads:<br>• **Design & Access Statement** (from the council's planning portal)<br>• **Site plans** and **elevation drawings** (if attached to the application)<br>• **Land Registry title** + **title plan** (from HMLR) for the property address |
| **When it runs** | Triggered the moment a new application appears in the Sourcing Engine. Runs again every hour to retry anything that failed. |
| **Trigger** | A new application enters the system, OR a document retrieval failed previously and is queued for retry. |
| **What you get** | All documents stored against the application record. Click the application in the dashboard → see every document attached, ready to download or view in-browser. |
| **Where you see it** | **Documents** tab — list of all retrieved files, filterable by application or type. Each application's detail page also shows its full document set. |
| **Time saved vs manual** | ~2-3 hours per deal of clicking through council portals and HMLR. Across 50 deals/month, that's ~120 hours/month. |
| **What you still do** | Read the documents and form a view. The bot fetches — you analyse. |
| **Status indicators** | Pending (queued) → Retrieving (in progress) → Retrieved (success) → Failed (3 retries exhausted — flagged in Errors tab). |
| **Limitations** | Some councils have anti-bot measures — for those, the bot falls back to flagging the doc as "manual fetch needed." HMLR title pulls cost ~£3 per title (paid via your HMLR account). |

---

## 3. AI Content Factory — AI Writes Your Outreach

| | |
|---|---|
| **What it does** | For every application, the AI reads the full Design & Access Statement PDF and produces:<br>• **A developer outreach email** — personalised opener, deal pitch, your contact info<br>• **A LinkedIn post** — professional tone, 200-300 chars, 2-3 hashtags<br>• **An Instagram caption** — casual, emoji-friendly, 150-220 chars, 3-5 hashtags<br>• **A TikTok caption** — punchy, trend-style, 4-6 hashtags<br>• **A Facebook post** — conversational, 150-250 chars |
| **When it runs** | Triggered when the Document Fetcher finishes pulling the Design & Access Statement. Usually within 5 min of the original alert. |
| **Trigger** | New application + documents successfully retrieved. |
| **AI model used** | Claude (Anthropic) — primary. OpenAI as fallback if Claude is down. |
| **What you get** | All 5 pieces of copy sitting in a review queue, tied to the application. You read, tweak if needed, approve. |
| **Where you see it** | Each application's detail page → **AI Content** section. Also a cross-application **Review Queue** showing everything pending your approval. |
| **Time saved vs manual** | ~30-45 min per deal of writing emails + 4 social posts. Across 50 deals/month, ~30 hours/month. |
| **What you still do** | Review and approve. The AI drafts — you have final say. You can edit any piece before it goes out. |
| **Status indicators** | Generating → Draft Ready → Approved → Sent. |
| **Limitations** | AI quality depends on PDF quality. Scanned/handwritten PDFs may produce weaker output — flagged for manual review. Generates in English only. |

---

## 4. Smart Mailing — One-Click Developer Outreach

| | |
|---|---|
| **What it does** | Sends your AI-drafted (or hand-written) developer email to a targeted list of contacts via Mixmax. Each email is personalised with the recipient's name + company. Opens, clicks, and replies are tracked per recipient. |
| **When it runs** | On-demand — you trigger it from the dashboard. |
| **Trigger** | You click **Send Campaign** on an application, pick the audience (developer / architect / investor, or by tag like `north-london` or `1000+ units`), and confirm. |
| **What you get** | The email goes to every matching contact (could be 100, 500, 1000+). Each one personalised. Mixmax tracks who opens, who clicks, who replies. |
| **Where you see it** | **Mailing** tab — campaigns list, recipient breakdown, open/click/reply rates per campaign. |
| **Time saved vs manual** | ~2-4 hours per campaign of copy-pasting into 100+ emails. |
| **What you still do** | Build your contact list once (we can help import from a CSV or your existing CRM). Tag contacts by type/region/size so segmentation works. After that, send is one click. |
| **Status indicators** | Draft → Sending → Sent → Opens/Clicks tracked live. |
| **Limitations** | Mixmax Growth tier required for API access. Send rate is rate-limited to ~100 emails/min to avoid spam filters. For sends >1000, the campaign is queued and trickles out over an hour. |

---

## 5. Social Autopilot — Consistent Posting Without Lifting a Finger

| | |
|---|---|
| **What it does** | Auto-schedules the AI-drafted social posts (Instagram, LinkedIn, TikTok, Facebook) to publish on your connected accounts. Engagement metrics (likes, comments, shares) sync back into the dashboard. |
| **When it runs** | Posts publish on the schedule you set (per platform). Engagement metrics refresh every hour. |
| **Trigger** | You approve a post in the AI Content Factory → it queues for scheduling → Ayrshare publishes it at the assigned time. |
| **What you get** | Posts appear on your real social accounts, on-brand and on-schedule. You see live engagement (likes, comments, shares, link clicks) in the dashboard. |
| **Where you see it** | **Social** tab — calendar view of scheduled posts, plus an engagement table showing performance per post. |
| **Time saved vs manual** | ~3-5 hours/week of copy-pasting to each platform, picking times, watching analytics. |
| **What you still do** | Approve posts before they go live. Decide posting cadence (e.g. 2 deals/week → LinkedIn, 1/week → all 4 platforms). |
| **Status indicators** | Approved → Scheduled → Published → Engagement Synced. |
| **Limitations** | Ayrshare needs your social accounts authorised via OAuth (we set up once). If a platform's API changes, posting may pause for that platform until we update the integration (rare — Ayrshare handles most of this). Instagram requires a Business or Creator account (not personal). |

---

## 6. Automated Invoicing — Deal Closes, Invoice Sent *(coming soon)*

| | |
|---|---|
| **What it does** | When you mark a deal as "Won" in the dashboard, the system auto-generates a Xero invoice with the agreed fee, line items, and your branding. Sends to the developer's billing contact. Tracks payment status. |
| **When it runs** | On-demand — triggered when you change a deal's status to "Won." |
| **Trigger** | You mark a deal closed in the dashboard. |
| **What you get** | Invoice appears in your Xero account, also emailed to the developer. Payment status (Sent → Viewed → Paid → Overdue) syncs back to the dashboard so you can see what's outstanding at a glance. |
| **Where you see it** | **Invoices** section (new, coming with this build) — outstanding invoices, paid, overdue. Click through to Xero for full accounting. |
| **Time saved vs manual** | ~20-30 min per invoice of manual entry, sending, and chasing. |
| **What you still do** | Set the fee per deal (or use a default). Approve the invoice before it sends if you want a sanity-check step. |
| **Status indicators** | Draft → Sent → Viewed → Paid → Overdue. |
| **Build status** | **Not built yet — queued.** Once the first 5 automations are live and we have momentum, this is the next module. |
| **Limitations** | Requires Xero Standard plan (£33/mo). Currency defaults to GBP. Multi-currency available if needed. |

---

## How the dashboard ties it all together

You log in once at the dashboard URL we'll give you (password-protected). You see:

- **Home** — Today's new alerts, pending approvals, recent activity
- **Sourcing** — All detected planning applications
- **Documents** — Every retrieved PDF, organised by application
- **Mailing** — Contact list + campaign history
- **Social** — Scheduled posts + engagement
- **Advertising** — Meta ad campaigns + performance *(see note below)*
- **Errors** — Anything the bot couldn't auto-handle, with a one-click retry

Everything works on your phone too.

---

## Bonus: Meta Ads management *(included in the dashboard, separate from the 6 automations)*

The dashboard can also create and manage Meta (Facebook + Instagram) ad campaigns from a single screen — set audience, budget, creative, and the system pushes it to Meta. Metrics (spend, impressions, clicks, leads) sync back hourly. This isn't on the "6 automations" list but it's wired up — when you're ready to scale with ads, it's there.

---

## What runs how often — summary

| Automation | Frequency |
|---|---|
| Sourcing scan | Every 15 minutes |
| Document fetch | On new application, retries hourly |
| AI content generation | On document fetch complete |
| Smart Mailing send | On-demand (you click) |
| Social post publish | On your schedule |
| Engagement sync | Every hour |
| Ad metrics refresh | Every hour |
| Invoice send | On deal close (you click) |

---

## Total time saved per month (conservative estimate at 50 deals/month)

| Source | Hours saved |
|---|---|
| Sourcing (no more portal checking) | ~50 hrs |
| Document Fetcher | ~120 hrs |
| AI Content Factory | ~30 hrs |
| Smart Mailing | ~16 hrs |
| Social Autopilot | ~16 hrs |
| Invoicing (when live) | ~12 hrs |
| **Total** | **~240 hrs/month** — equivalent to ~1.5 full-time staff |

---

## What we need from you to switch it all on

See `CLIENT_API_SETUP.md` — the 7 API accounts you need to create. Slowest approvals (HMLR + Meta) should be started today; everything else is instant.

Once keys are in, each automation goes live within ~30 min of receiving its key. You'll start seeing real planning alerts within hours.
