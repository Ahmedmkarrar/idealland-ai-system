# IdealLand — API Account Setup Checklist

Hi — this is the list of accounts we need you to create so we can wire up the automation dashboard. Each one powers one or more of the 6 automations we agreed on (Sourcing Engine, Document Fetcher, AI Content Factory, Smart Mailing, Social Autopilot, Automated Invoicing).

**How this works:**
1. You sign up for each service below using your IdealLand business email + card.
2. After signup, find the API key / credentials shown in the "What to send back" column.
3. Paste them into the shared 1Password / Bitwarden vault (or send via encrypted channel — *never* plain email).
4. We wire them into the dashboard. The automation goes live within ~30 min per key.

**Why you (the client) own these accounts:**
- The data, billing, and ad spend are tied to your business identity — Meta in particular legally requires it.
- If you ever stop working with us, the accounts and data stay yours.
- You get full transparency on what each automation costs.

---

## 1. Resend — Planning Alert Emails

| | |
|---|---|
| **Powers** | Sourcing Engine (alert emails when 10+ unit developments are filed) + mailing fallback |
| **Sign up** | https://resend.com/signup |
| **Plan** | **Free tier is enough** (3,000 emails/month) |
| **Cost** | **£0/mo** initially. £18/mo if you cross 3k emails. |
| **Setup steps** | 1. Sign up<br>2. Verify your domain (`idealland.co.uk` or similar) — DNS records to add, takes ~10 min<br>3. Generate an API key under **API Keys** → **Create API Key** with "Sending access" permission |
| **What to send back** | `RESEND_API_KEY` (starts with `re_...`)<br>`ALERT_EMAIL_FROM` (e.g. `alerts@idealland.co.uk`)<br>`ALERT_EMAIL_TO` (your address that receives alerts) |

---

## 2. Anthropic (Claude) — AI Content Generation

| | |
|---|---|
| **Powers** | AI Content Factory — reads planning PDFs, writes LinkedIn + Instagram + email copy |
| **Sign up** | https://console.anthropic.com/ |
| **Plan** | Pay-as-you-go (no monthly fee) |
| **Cost** | **~£15-25/mo** at 50 deals/month |
| **Setup steps** | 1. Sign up + verify phone<br>2. Add billing card (Settings → Billing → Add payment method)<br>3. Add £20 credit to start<br>4. Settings → API Keys → Create Key |
| **What to send back** | `ANTHROPIC_API_KEY` (starts with `sk-ant-...`) |
| **Tip** | Set a **monthly spend limit** of £50 under Billing → Limits so it can never run away. |

---

## 3. OpenAI — Fallback AI

| | |
|---|---|
| **Powers** | Backup for AI Content Factory if Claude fails (rare) |
| **Sign up** | https://platform.openai.com/signup |
| **Plan** | Pay-as-you-go |
| **Cost** | **~£3-5/mo** (mostly idle — only fires on Claude failure) |
| **Setup steps** | 1. Sign up<br>2. Settings → Billing → Add payment method, deposit £10<br>3. Settings → API Keys → Create new secret key |
| **What to send back** | `OPENAI_API_KEY` (starts with `sk-...`) |
| **Tip** | Set spend limit of £15/mo under Usage Limits. |

---

## 4. HMLR (Land Registry) — Title Documents

| | |
|---|---|
| **Powers** | Document Fetcher — pulls the Land Registry title for each property |
| **Sign up** | https://use-land-property-data.service.gov.uk/ |
| **Plan** | Pay-per-document — most titles ~£3 each |
| **Cost** | **~£150-300/mo** depending on deal volume. *This is the biggest API cost — see note below.* |
| **Setup steps** | 1. Register on the portal<br>2. Apply for API access (the "Use land and property data" API). Approval takes **3-5 business days**.<br>3. Add a billing account<br>4. Once approved, generate API key under your dashboard |
| **What to send back** | `HMLR_API_KEY` |
| **⚠️ Decision needed** | Do you actually need full Title Registers at the alert stage, or only when a deal is hot? If only for hot deals, **we can drop this from the auto-cron and save ~£200/mo** by pulling titles manually on demand. **Tell us your preference.** |

---

## 5. Ayrshare — Multi-Platform Social Posting

| | |
|---|---|
| **Powers** | Social Autopilot — schedules posts to LinkedIn, Instagram, TikTok, Facebook |
| **Sign up** | https://www.ayrshare.com/ |
| **Plan** | **Premium** at $149/mo (free tier is only 20 posts/mo — too low) |
| **Cost** | **~£120/mo** ($149) |
| **Setup steps** | 1. Sign up<br>2. Connect your LinkedIn, Instagram, TikTok, Facebook accounts under **Social Accounts**<br>3. Dashboard → API Keys → copy your key |
| **What to send back** | `AYRSHARE_API_KEY` |
| **Cheaper alternative** | Buffer at $15/mo, but only covers LinkedIn + IG + FB (no TikTok). If TikTok isn't a priority, we'd save ~£100/mo. |

---

## 6. Meta (Facebook) Ads — Ad Campaign Automation

| | |
|---|---|
| **Powers** | Automated ad campaign creation, audience targeting, metrics sync |
| **Sign up** | https://business.facebook.com/ (Business Manager) + https://developers.facebook.com/ (App) |
| **Plan** | The API itself is **free**. Ad spend is separate. |
| **Cost** | **£0 for the API.** Ad budget is whatever you choose per campaign. |
| **Setup steps** | 1. Create Meta Business Manager (or use existing)<br>2. Verify your business (passport/utility bill — takes a few days)<br>3. Create a Facebook Page for IdealLand if not already<br>4. Set up an Ad Account with billing card<br>5. Go to developers.facebook.com → Create App (Business type) → add "Marketing API" product<br>6. Generate a long-lived access token via Graph API Explorer with `ads_management`, `pages_manage_posts`, `business_management` scopes |
| **What to send back** | `META_ACCESS_TOKEN` (long string)<br>`META_AD_ACCOUNT_ID` (format: `act_123456789`)<br>`META_PAGE_ID` (numeric, from your Page's About section)<br>`META_WEBSITE_URL` (e.g. `https://idealland.co.uk`) |
| **⚠️ Hardest step** | The long-lived token. We can do a screen-share to walk through this — it's fiddly. |

---

## 7. Mixmax — Smart Mailing to Developers

| | |
|---|---|
| **Powers** | Smart Mailing — sends deal emails to 100+ developers per click, tracks opens |
| **Sign up** | https://mixmax.com/ |
| **Plan** | **Growth** at $69/user/mo (API access required — Starter doesn't include it) |
| **Cost** | **~£55/mo** ($69) |
| **Setup steps** | 1. Sign up with your work email (must be a real mailbox — Gmail/Outlook/etc.)<br>2. Connect Gmail or Outlook<br>3. Upgrade to Growth plan<br>4. Settings → API & Integrations → Generate API key<br>5. Settings → Webhooks → Create webhook → set the URL we'll provide → copy webhook signing secret |
| **What to send back** | `MIXMAX_API_KEY`<br>`MIXMAX_WEBHOOK_SECRET` |
| **Cheaper alternative** | We can send the same mailing via Resend (already in your account) without Mixmax. You lose Mixmax's open/click tracking UI but save ~£55/mo. |

---

## 8. Xero — Automated Invoicing (when we build this — not live yet)

| | |
|---|---|
| **Powers** | Automated Invoicing — generates and sends invoices when a deal closes |
| **Sign up** | https://www.xero.com/uk/signup/ |
| **Plan** | **Standard** at £33/mo (Starter is too limited for our integration) |
| **Cost** | **~£33/mo** |
| **Setup steps** | 1. Sign up for Xero Standard<br>2. Set up your company details + bank account<br>3. Go to https://developer.xero.com/ → My Apps → New App (web app type)<br>4. Provide it the redirect URI we'll send you<br>5. Copy Client ID + Client Secret<br>6. Connect to your Xero organisation via OAuth — we'll guide you through this |
| **What to send back** | `XERO_CLIENT_ID`<br>`XERO_CLIENT_SECRET`<br>`XERO_TENANT_ID` (you'll get this after first OAuth connection — we'll help) |
| **Status** | Build queued — not started yet. Sign up whenever, no rush. |

---

## Total monthly cost estimate

| Service | Monthly cost |
|---|---|
| Resend | £0 |
| Anthropic | ~£20 |
| OpenAI | ~£4 |
| HMLR | ~£200 *(or £0 if we drop from auto-cron)* |
| Ayrshare | ~£120 *(or £12 if we use Buffer)* |
| Meta API | £0 *(ad spend separate)* |
| Mixmax | ~£55 *(or £0 if we use Resend instead)* |
| Xero | ~£33 |
| Hosting (DigitalOcean Droplet) | ~£8 |
| **Total — full stack** | **~£440/mo** |
| **Total — cost-trimmed** | **~£100/mo** (drop HMLR auto-pull, swap Ayrshare→Buffer, swap Mixmax→Resend) |

Excluded: Meta ad spend (your call, depends on campaigns), domain renewal, any client-specific add-ons.

---

## Order to set up (priority — sign up in this order)

1. **Resend** (instant, free, unblocks Sourcing Engine alerts)
2. **Anthropic** (instant, ~£5 to start, unblocks AI Content Factory)
3. **HMLR** (apply NOW — takes 3-5 days for approval, will be the bottleneck)
4. **Ayrshare** (instant, unblocks Social Autopilot)
5. **Mixmax** (instant, unblocks Smart Mailing)
6. **Meta** (slowest — business verification takes a few days)
7. **OpenAI** (low priority — fallback only)
8. **Xero** (after we build the invoicing module)

---

## How to send keys back to us

**Preferred:** Shared 1Password vault — we'll set this up and invite you.

**Backup:** Encrypted message via Signal, or copy/paste into a shared encrypted Google Doc that we delete after wiring it up.

**Never:** Plain email, Slack DMs to AK's personal account, or SMS.
