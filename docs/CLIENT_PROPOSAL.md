# IdealLand — Automation System Proposal

Hi team,

Below is the full picture of what we're building together — the 6 automations, what each one does, what you'll need to set up on your side, what it'll cost monthly, and what we need from you to switch it on.

The system is built and ready to go live. It's blocked only on you creating a handful of API accounts (most are instant; two — HMLR and Meta — take a few days to approve, so please start those today).

Once we have your keys, **each automation goes live within 30 minutes** of receiving its credentials. You'll start seeing real planning alerts hitting your inbox within hours.

---

## Part 1 — The 6 Automations

### What you're getting

| # | Automation | The promise |
|---|---|---|
| 1 | **Sourcing Engine** | Live alerts when any 10+ unit residential development is submitted to a UK council. Deals come to you. |
| 2 | **Document Fetcher** | Bots automatically pull the Design & Access Statement and Land Registry documents for every new property. Zero manual searching. |
| 3 | **AI Content Factory** | AI reads every PDF and writes your developer emails, LinkedIn posts, and Instagram captions automatically. You just review and send. |
| 4 | **Smart Mailing** | One click sends your deal email to 100+ developers through Mixmax. No manual list selection. |
| 5 | **Social Autopilot** | When a deal goes live, LinkedIn and Instagram posts are auto-scheduled. Consistent presence without you touching anything. |
| 6 | **Automated Invoicing** | When a deal closes, the invoice is generated and sent to Xero automatically. No chasing, no errors. |

---

### 1. Sourcing Engine — Live Planning Alerts

| | |
|---|---|
| **What it does** | Continuously scrapes 27 London council planning portals (Camden, Hackney, Islington, Tower Hamlets, Southwark, Westminster, Lambeth, Lewisham, Greenwich, Wandsworth, Hammersmith & Fulham, Kensington & Chelsea, Haringey, Barnet, Enfield, Waltham Forest, Redbridge, Havering, Bexley, Bromley, Croydon, Sutton, Merton, Kingston, Richmond, Hounslow, Newham). Detects every new residential planning application with **10+ units**. |
| **When it runs** | Every 15 minutes, around the clock. |
| **Trigger** | A new application appears on a council portal that isn't already in your database. |
| **What you get** | An email lands in your inbox within 15 min of submission. Includes: reference number, address, council, unit count, brief description, submission date, and a direct link to the council page. |
| **Where you see it** | **Sourcing** tab on the dashboard — table of all detected applications, filterable by council / unit count / date / status. |
| **Time saved vs manual** | ~10-15 hours/week of checking 27 portals by hand. |
| **What you still do** | Decide which applications are worth pursuing. We surface every deal — you triage. |
| **Status indicators** | New → Reviewing → Pursuing → Won / Passed. |
| **Limitations** | Currently covers the 27 London councils above. Adding more councils outside London is straightforward — ~2 hours per council. |

---

### 2. Document Fetcher — Auto-Pulls Every Document

| | |
|---|---|
| **What it does** | For every new application detected by the Sourcing Engine, the bot automatically downloads:<br>• **Design & Access Statement** (from the council's planning portal)<br>• **Site plans** and **elevation drawings** (if attached to the application)<br>• **Land Registry title** + **title plan** (from HMLR) for the property address |
| **When it runs** | The moment a new application appears in the Sourcing Engine. Retries hourly if any document fails. |
| **Trigger** | A new application enters the system, OR a document retrieval failed previously. |
| **What you get** | All documents stored against the application record. Click the application in the dashboard → see every document attached, ready to download or view in-browser. |
| **Where you see it** | **Documents** tab — list of all retrieved files, filterable by application or type. Each application's detail page also shows its full document set. |
| **Time saved vs manual** | ~2-3 hours per deal of clicking through council portals and HMLR. Across 50 deals/month, that's ~120 hours/month. |
| **What you still do** | Read the documents and form a view. We fetch — you analyse. |
| **Status indicators** | Pending → Retrieving → Retrieved → Failed (flagged in Errors tab for manual fetch). |
| **Limitations** | Some councils have anti-bot measures — for those, the bot flags the doc as "manual fetch needed." HMLR title pulls cost ~£3 per title (paid via your HMLR account, not us). |

---

### 3. AI Content Factory — AI Writes Your Outreach

| | |
|---|---|
| **What it does** | For every application, the AI reads the full Design & Access Statement PDF and produces:<br>• **A developer outreach email** — personalised opener, deal pitch, your contact info<br>• **A LinkedIn post** — professional tone, 200-300 chars, 2-3 hashtags<br>• **An Instagram caption** — casual, emoji-friendly, 150-220 chars, 3-5 hashtags<br>• **A TikTok caption** — punchy, trend-style, 4-6 hashtags<br>• **A Facebook post** — conversational, 150-250 chars |
| **When it runs** | Triggered when the Document Fetcher finishes pulling the Design & Access Statement. Usually within 5 min of the original alert. |
| **Trigger** | New application + documents successfully retrieved. |
| **AI model used** | Claude (Anthropic) — primary. OpenAI as fallback if Claude is down. |
| **What you get** | All 5 pieces of copy sitting in a review queue, tied to the application. You read, tweak if needed, approve. |
| **Where you see it** | Each application's detail page → **AI Content** section. Also a cross-application **Review Queue** showing everything pending your approval. |
| **Time saved vs manual** | ~30-45 min per deal of writing emails + 4 social posts. Across 50 deals/month, ~30 hours/month. |
| **What you still do** | Review and approve. We draft — you have final say. You can edit any piece before it goes out. |
| **Status indicators** | Generating → Draft Ready → Approved → Sent. |
| **Limitations** | AI quality depends on PDF quality. Scanned/handwritten PDFs may produce weaker output — flagged for manual review. English only. |

---

### 4. Smart Mailing — One-Click Developer Outreach

| | |
|---|---|
| **What it does** | Sends your AI-drafted (or hand-written) developer email to a targeted list of contacts via Mixmax. Each email is personalised with the recipient's name + company. Opens, clicks, and replies tracked per recipient. |
| **When it runs** | On-demand — you trigger it from the dashboard. |
| **Trigger** | You click **Send Campaign** on an application, pick the audience (developer / architect / investor, or by tag like `north-london` or `1000+ units`), and confirm. |
| **What you get** | The email goes to every matching contact (100, 500, 1000+). Each one personalised. Mixmax tracks who opens, who clicks, who replies. |
| **Where you see it** | **Mailing** tab — campaigns list, recipient breakdown, open/click/reply rates per campaign. |
| **Time saved vs manual** | ~2-4 hours per campaign of copy-pasting into 100+ emails. |
| **What you still do** | Build your contact list once (we can help import from CSV or your existing CRM). Tag contacts by type/region/size so segmentation works. After that, send is one click. |
| **Status indicators** | Draft → Sending → Sent → Opens/Clicks tracked live. |
| **Limitations** | Mixmax Growth tier required for API access. Send rate is ~100 emails/min to avoid spam filters. For sends >1000, the campaign trickles out over an hour. |

---

### 5. Social Autopilot — Consistent Posting Without Lifting a Finger

| | |
|---|---|
| **What it does** | Auto-schedules the AI-drafted social posts (Instagram, LinkedIn, TikTok, Facebook) to publish on your connected accounts. Engagement metrics (likes, comments, shares) sync back into the dashboard. |
| **When it runs** | Posts publish on the schedule you set per platform. Engagement metrics refresh every hour. |
| **Trigger** | You approve a post in the AI Content Factory → it queues for scheduling → Ayrshare publishes it at the assigned time. |
| **What you get** | Posts appear on your real social accounts, on-brand and on-schedule. Live engagement (likes, comments, shares, link clicks) visible in the dashboard. |
| **Where you see it** | **Social** tab — calendar view of scheduled posts, plus an engagement table showing performance per post. |
| **Time saved vs manual** | ~3-5 hours/week of copy-pasting to each platform, picking times, watching analytics. |
| **What you still do** | Approve posts before they go live. Decide posting cadence (e.g. 2 deals/week → LinkedIn, 1/week → all 4 platforms). |
| **Status indicators** | Approved → Scheduled → Published → Engagement Synced. |
| **Limitations** | Ayrshare needs your social accounts authorised via OAuth (we set up once). Instagram requires a Business or Creator account (not personal). |

---

### 6. Automated Invoicing — Deal Closes, Invoice Sent *(Phase 2)*

| | |
|---|---|
| **What it does** | When you mark a deal as "Won" in the dashboard, the system auto-generates a Xero invoice with the agreed fee, line items, and your branding. Sends to the developer's billing contact. Tracks payment status. |
| **When it runs** | On-demand — triggered when you change a deal's status to "Won." |
| **Trigger** | You mark a deal closed in the dashboard. |
| **What you get** | Invoice appears in your Xero account, also emailed to the developer. Payment status (Sent → Viewed → Paid → Overdue) syncs back to the dashboard. |
| **Where you see it** | **Invoices** section — outstanding, paid, overdue. Click through to Xero for full accounting. |
| **Time saved vs manual** | ~20-30 min per invoice of manual entry, sending, and chasing. |
| **What you still do** | Set the fee per deal (or use a default). Optional approval step before invoice sends. |
| **Status indicators** | Draft → Sent → Viewed → Paid → Overdue. |
| **Build status** | **Phase 2 — queued.** Once the first 5 automations are live and producing deals, this is the next module. |

---

## Part 2 — The Dashboard

You log in once at the URL we'll give you (password-protected, mobile-friendly):

- **Home** — Today's alerts, pending approvals, recent activity
- **Sourcing** — All detected planning applications
- **Documents** — Every retrieved PDF, organised by application
- **Mailing** — Contact list + campaign history
- **Social** — Scheduled posts + live engagement
- **Advertising** — Meta ad campaigns + performance (bonus — see below)
- **Errors** — Anything the bot couldn't auto-handle, with one-click retry

**Bonus — Meta Ads management:** The dashboard can also create and manage Meta (Facebook + Instagram) ad campaigns from one screen — set audience, budget, creative, push to Meta. Metrics sync hourly. Not on the "6 automations" list but it's wired and ready when you want to scale with ads.

---

## Part 3 — What Runs How Often

| Automation | Frequency |
|---|---|
| Sourcing scan | Every 15 minutes |
| Document fetch | On new application; retries hourly |
| AI content generation | On document fetch complete |
| Smart Mailing send | On-demand (you click) |
| Social post publish | On your schedule |
| Engagement sync | Every hour |
| Ad metrics refresh | Every hour |
| Invoice send | On deal close (you click) |

---

## Part 4 — Total Time Saved (Conservative at 50 deals/month)

| Source | Hours saved/month |
|---|---|
| Sourcing (no more portal checking) | ~50 |
| Document Fetcher | ~120 |
| AI Content Factory | ~30 |
| Smart Mailing | ~16 |
| Social Autopilot | ~16 |
| Invoicing (Phase 2) | ~12 |
| **Total** | **~240 hrs/month — equivalent to ~1.5 full-time staff** |

---

## Part 5 — What You Need to Set Up

To switch the system on, you create **7 API accounts** (8th is for Phase 2 invoicing). Most are instant; HMLR + Meta take a few days for approval — **please start those today**.

### Why you (not us) own these accounts
- Your data, your billing, your ad spend — tied to your business identity.
- Meta in particular legally requires the ad account to be yours.
- If we ever stop working together, you keep everything.

### Account 1 — Resend (Planning Alert Emails)

| | |
|---|---|
| **Powers** | Sourcing Engine alert emails + mailing fallback |
| **Sign up** | https://resend.com/signup |
| **Plan** | Free tier (3,000 emails/month — plenty) |
| **Cost** | **£0/mo** |
| **Setup** | 1. Sign up<br>2. Verify your domain (e.g. `idealland.co.uk`) — add the DNS records they show you, takes ~10 min<br>3. API Keys → Create API Key with "Sending access" |
| **Send us** | `RESEND_API_KEY` (`re_...`)<br>`ALERT_EMAIL_FROM` (e.g. `alerts@idealland.co.uk`)<br>`ALERT_EMAIL_TO` (your address) |

### Account 2 — Anthropic (Claude AI)

| | |
|---|---|
| **Powers** | AI Content Factory — reads PDFs, writes copy |
| **Sign up** | https://console.anthropic.com/ |
| **Plan** | Pay-as-you-go |
| **Cost** | **~£20/mo** at 50 deals/month |
| **Setup** | 1. Sign up + verify phone<br>2. Billing → add card, deposit £20<br>3. Set monthly spend limit to £50 (Billing → Limits)<br>4. API Keys → Create Key |
| **Send us** | `ANTHROPIC_API_KEY` (`sk-ant-...`) |

### Account 3 — OpenAI (Fallback AI)

| | |
|---|---|
| **Powers** | Backup for Claude (rare) |
| **Sign up** | https://platform.openai.com/signup |
| **Plan** | Pay-as-you-go |
| **Cost** | **~£4/mo** (mostly idle) |
| **Setup** | 1. Sign up<br>2. Billing → add card, deposit £10<br>3. Set spend limit to £15/mo<br>4. API Keys → Create new secret key |
| **Send us** | `OPENAI_API_KEY` (`sk-...`) |

### Account 4 — HMLR (Land Registry) ⏰ START TODAY

| | |
|---|---|
| **Powers** | Document Fetcher — pulls Land Registry titles |
| **Sign up** | https://use-land-property-data.service.gov.uk/ |
| **Plan** | Pay-per-document (~£3 per title) |
| **Cost** | **~£150-300/mo** depending on volume |
| **Setup** | 1. Register on the portal<br>2. Apply for API access — **takes 3-5 business days**<br>3. Add a billing account<br>4. Once approved, generate API key |
| **Send us** | `HMLR_API_KEY` |
| **⚠️ Decision needed** | Do you need full Title Registers at the alert stage, or only when a deal is hot? If on-demand only, **we can save you ~£200/mo** by removing this from the auto-cron. Let us know your preference. |

### Account 5 — Ayrshare (Social Posting)

| | |
|---|---|
| **Powers** | Social Autopilot — posts to LinkedIn, Instagram, TikTok, Facebook |
| **Sign up** | https://www.ayrshare.com/ |
| **Plan** | Premium ($149/mo — free tier is only 20 posts/mo, too low) |
| **Cost** | **~£120/mo** |
| **Setup** | 1. Sign up<br>2. Connect your LinkedIn, Instagram, TikTok, Facebook accounts<br>3. Dashboard → API Keys → copy your key |
| **Send us** | `AYRSHARE_API_KEY` |
| **Cheaper option** | Buffer at $15/mo if you can drop TikTok — saves ~£100/mo. Let us know. |

### Account 6 — Meta (Facebook Ads) ⏰ START TODAY

| | |
|---|---|
| **Powers** | Ad campaign creation, audience targeting, metrics |
| **Sign up** | https://business.facebook.com/ + https://developers.facebook.com/ |
| **Plan** | API is free; ad spend separate |
| **Cost** | **£0 API** (your ad budget is separate) |
| **Setup** | 1. Create Meta Business Manager<br>2. Verify your business (passport / utility bill — takes a few days)<br>3. Create a Facebook Page for IdealLand if not already<br>4. Set up an Ad Account with billing<br>5. developers.facebook.com → Create App (Business type) → add "Marketing API"<br>6. Generate long-lived access token with `ads_management`, `pages_manage_posts`, `business_management` scopes |
| **Send us** | `META_ACCESS_TOKEN`<br>`META_AD_ACCOUNT_ID` (format: `act_123456789`)<br>`META_PAGE_ID`<br>`META_WEBSITE_URL` |
| **Hardest step** | The long-lived token. We'll do a screen-share to walk through this — it's fiddly. |

### Account 7 — Mixmax (Smart Mailing)

| | |
|---|---|
| **Powers** | Smart Mailing — sends + tracks developer outreach |
| **Sign up** | https://mixmax.com/ |
| **Plan** | Growth ($69/user/mo — API access required) |
| **Cost** | **~£55/mo** |
| **Setup** | 1. Sign up with your work email<br>2. Connect Gmail or Outlook<br>3. Upgrade to Growth<br>4. Settings → API & Integrations → Generate API key<br>5. Webhooks → Create webhook (we'll send the URL) → copy signing secret |
| **Send us** | `MIXMAX_API_KEY`<br>`MIXMAX_WEBHOOK_SECRET` |
| **Cheaper option** | We can send via Resend instead and skip Mixmax — saves £55/mo but you lose Mixmax's open/click tracking UI. Let us know. |

### Account 8 — Xero (Phase 2 — Invoicing)

| | |
|---|---|
| **Powers** | Automated Invoicing |
| **Sign up** | https://www.xero.com/uk/signup/ |
| **Plan** | Standard (£33/mo) |
| **Cost** | **~£33/mo** |
| **Setup** | 1. Sign up for Standard<br>2. Set up company + bank details<br>3. https://developer.xero.com/ → My Apps → New App (web)<br>4. Provide redirect URI (we'll send)<br>5. Copy Client ID + Client Secret<br>6. Connect to your organisation via OAuth — we'll guide |
| **Send us** | `XERO_CLIENT_ID`<br>`XERO_CLIENT_SECRET`<br>`XERO_TENANT_ID` (you'll get this after first OAuth — we'll help) |
| **Status** | Phase 2. Sign up whenever, no rush. |

---

## Part 6 — Monthly Cost Summary

| Service | Cost (£/mo) |
|---|---|
| Resend | £0 |
| Anthropic | ~£20 |
| OpenAI | ~£4 |
| HMLR | ~£200 *(or £0 if dropped from auto-cron)* |
| Ayrshare | ~£120 *(or £12 with Buffer)* |
| Meta API | £0 *(ad spend separate)* |
| Mixmax | ~£55 *(or £0 with Resend instead)* |
| Xero (Phase 2) | ~£33 |
| Hosting (DigitalOcean) | ~£8 |
| **Full stack total** | **~£440/mo** |
| **Cost-trimmed total** | **~£100/mo** (drop HMLR auto-pull, swap Ayrshare→Buffer, swap Mixmax→Resend) |

**Excluded:** Meta ad spend (your call, depends on campaigns).

---

## Part 7 — Priority Setup Order

Start with the slowest approvals first:

1. **HMLR** — 3-5 day approval. **Start today.**
2. **Meta Business verification** — a few days. **Start today.**
3. **Resend** — instant
4. **Anthropic** — instant
5. **Ayrshare** — instant
6. **Mixmax** — instant
7. **OpenAI** — instant (low priority — fallback only)
8. Xero — whenever (Phase 2)

---

## Part 8 — Three Decisions We Need From You

Before final pricing locks in, please confirm:

1. **HMLR auto-pull or on-demand?** Full automatic title pulls = ~£200/mo. On-demand pulls only when a deal is hot = ~£0/mo. Which?
2. **Ayrshare or Buffer?** Ayrshare covers TikTok (~£120/mo). Buffer skips TikTok (~£12/mo). Which?
3. **Mixmax or Resend-only for mailing?** Mixmax = tracking UI (~£55/mo). Resend-only = no tracking UI but free. Which?

---

## Part 9 — How to Send Keys Back

- **Preferred:** Shared 1Password vault — we'll set this up and invite you.
- **Backup:** Encrypted message via Signal, or a shared encrypted Google Doc we delete after wiring.
- **Never:** Plain email, SMS, or Slack DMs.

---

## Part 10 — What Happens Once You Send Keys

1. We paste each key into the system as it arrives.
2. Each automation goes live within **30 minutes per key**.
3. Within hours of HMLR + Resend + Anthropic being in, **you'll see real planning alerts in your inbox**.
4. We do a walkthrough call to show you the dashboard and answer questions.
5. Phase 2 (Xero invoicing) starts once you've used the system for 2-3 weeks and we have feedback.

---

## Summary — Your Action List

- [ ] **Today:** Apply for HMLR API access (3-5 day approval)
- [ ] **Today:** Start Meta Business verification (few days)
- [ ] **This week:** Sign up for Resend, Anthropic, OpenAI, Ayrshare, Mixmax
- [ ] **Decide:** HMLR auto vs on-demand / Ayrshare vs Buffer / Mixmax vs Resend
- [ ] **Confirm:** which AK email to add to the shared 1Password vault
- [ ] **Once keys are ready:** drop them in the vault, ping us, automations go live

Any questions, send them over — happy to jump on a quick call.
