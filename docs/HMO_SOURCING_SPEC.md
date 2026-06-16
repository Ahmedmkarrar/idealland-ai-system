# HMO Acquisition Sourcing — Spec & Cost (v1)

**Goal:** Build a list of HMO (House in Multiple Occupation) properties and their
owners across target London boroughs, scored by *likelihood to sell*, so James's
buyers can approach owners about an individual or portfolio acquisition.

**Decision locked (2026-06-16):** v1 uses **free data sources only** — no paid
owner lookups, no paid data provider. Owner names come from council licensing
registers + Companies House. Individual owners who don't appear in either stay
"unnamed (address only)" until/unless we approve paid HMLR title lookups later.

---

## 1. What an HMO is (for filtering)

A property let to **3+ unrelated tenants** sharing kitchen/bathroom. Larger HMOs
(5+ occupants, 2+ storeys) are **mandatorily licensed**; smaller ones may need a
licence only under a borough's *additional licensing* scheme. We key off the
**licensing registers**, so we capture every licensed HMO by definition.

---

## 2. Data sources (all free)

### Layer 1 — Find the HMOs → council HMO licensing registers
Every council must keep a **public register of licensed HMOs** (Housing Act 2004,
s.232). Each record typically gives:
- Property address + postcode
- **Licence holder name** (often the owner; sometimes a managing agent)
- Max permitted occupants / number of households (size signal)
- Licence start + expiry dates

Coverage is uneven — three tiers:
- **Tier A (open data):** borough publishes a downloadable CSV/Excel or open-data
  API. Ingest directly. *(Fastest — v1 starts here.)*
- **Tier B (web register):** searchable online register only → scrape.
- **Tier C (FOI only):** no public file → submit a Freedom of Information request
  (councils must respond in 20 working days). One-off, then periodic refresh.

Also check the **London Datastore** / **data.gov.uk** for any consolidated
multi-borough licensed-HMO dataset to seed Tier A fast.

### Layer 2 — Enrich the owner (free)
- **Companies House API** (free key) — for company landlords: directors, their
  **age** (DOB month/year is public → retirement signal), and other companies they
  control → portfolio mapping.
- **Land Registry "Price Paid" data** (free open data) — last sale price + date per
  address → **long-ownership** flag (e.g. >15 yrs, or no sale since 1995).
- **HMLR CCOD / OCOD** (free bulk datasets) — UK-company-owned and overseas-owned
  titles → catches portfolio landlords holding via Ltd companies / offshore.

> Individual (non-company) owners' names/addresses are **not** free at scale —
> they need £3/title HMLR lookups, which v1 deliberately excludes. For those we
> hold the property + licence-holder name (where given) and flag "owner not
> enriched" until paid lookups are approved.

### Layer 3 — Score & draft outreach (reuses existing system)
Same pipeline as the planning module: DB → Claude scoring → dashboard → Telegram/
email alerts → draft approach letters.

---

## 3. "Likely to sell" scoring (1–10)

| Signal | Source | Weight |
|---|---|---|
| Owns multiple HMOs (portfolio) | Group by licence holder / company no. | High |
| Older / likely retiring (60+) | Companies House director DOB | High |
| Long ownership (>15 yrs) | Land Registry Price Paid | High |
| Licence near expiry / lapsed | Licensing register dates | Medium |
| Borough adding regulation (Article 4 / selective licensing) | Council notices | Medium |
| Below-market rent / poor mgmt | SpareRoom/OpenRent scrape (optional, later) | Low–Med |

Claude combines these into a score + one-line reason, exactly like the existing
`intelligence.ts` lead scoring.

**Portfolio detection** = group by owner → owners with 3 / 5 / 10+ HMOs surfaced
as priority targets (matches the "portfolio acquisition" objective).

---

## 4. Build phases

- **Phase 1 — HMO master list (Tier A boroughs).** Ingest open-data registers →
  `HmoProperty` table → dashboard list + filters. *Deliverable: a real, viewable
  list to show James.*
- **Phase 2 — Owner enrichment.** Companies House + Price Paid + CCOD/OCOD →
  portfolio grouping + ownership-length flags.
- **Phase 3 — Scoring + outreach.** Claude score + draft approach letters →
  Telegram/email alerts → dashboard "Approach" workflow.
- **Phase 4 — Expand coverage.** Add Tier B (scrape) + Tier C (FOI) boroughs;
  optional SpareRoom rent signal; optional paid owner lookups for top leads.

---

## 5. Cost

| Item | Cost |
|---|---|
| Council licensing registers | £0 (public) |
| Companies House API | £0 (free key) |
| Land Registry Price Paid / CCOD / OCOD | £0 (open data) |
| AI scoring + drafting | Pennies — same Anthropic key already in use |
| Hosting | £0 extra — runs on the existing droplet |
| **v1 total** | **£0 / month** |

Optional later: HMLR title lookups ~£3 each (only top leads), or a commercial
property-data provider (monthly) — both require James's sign-off first.

---

## 6. Legal / GDPR

- Approaching owners about selling is permissible under **legitimate interest** —
  the same basis estate agents use to canvass. **Direct mail (letters)** is the
  safest channel; recommend that over cold email/calls to individuals.
- Public registers (licensing, Companies House, Land Registry) are lawful sources.
- Keep a suppression list for anyone who asks not to be contacted.

---

## 7. What we need from Lucy / James to start

1. **Target boroughs/areas** James's buyers want (drives which registers first).
2. **Buyer appetite:** single HMOs, portfolios, or both? Any **minimum size**
   (e.g. 5+ bedrooms) or location/price criteria?
3. **Confirm free-only** for now (no paid data spend) — assumed yes.
4. **Outreach channel:** direct-mail letters (recommended) vs other?
5. **Companies House API key** (free — Lucy/James register at
   developer.company-information.service.gov.uk) so we can enrich company owners.
6. Rough **target volume / timeline** (e.g. "200 leads in 4 weeks").
