// Reads the agent straight off the council's planning register for every lead on
// a supported portal — name, email and phone together, published by the council.
//
// Scheduling matters more than speed here. A first attempt ordered by lead score
// happened to put 290 Greenwich applications in a row, hammered one council and
// earned a 429 after ~130 requests. So this rotates between councils, never
// touching the same host twice within HOST_GAP_MS, and backs a host off entirely
// when it signals it has had enough. Being a good guest is the difference between
// this working next month and getting the droplet blocked.
//
// Usage: node scripts/backfill-portal-contacts.mjs [--dry] [--force] [--limit N]

import Database from "better-sqlite3";

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const li = process.argv.indexOf("--limit");
const LIMIT = li > -1 ? Number(process.argv[li + 1]) : Infinity;

const HOST_GAP_MS = Number(process.env.PORTAL_HOST_GAP_MS ?? 6000); // per council
const GLOBAL_GAP_MS = Number(process.env.PORTAL_GLOBAL_GAP_MS ?? 900); // overall
const COOLDOWN_MS = Number(process.env.PORTAL_COOLDOWN_MS ?? 15 * 60 * 1000); // after a 429
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dec = (v) =>
  v.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
   .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
   .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function cleanName(raw) {
  if (!raw) return null;
  const w = raw.trim().split(/\s+/)
    .filter((x, i) => !(i === 0 && /^(mr|mrs|ms|miss|dr|prof|sir|rev)\.?$/i.test(x)));
  const out = [];
  for (const x of w) {
    const p = out[out.length - 1];
    if (p && p.toLowerCase() === x.toLowerCase()) {
      if (p === p.toUpperCase() && x !== x.toUpperCase()) out[out.length - 1] = x;
      continue;
    }
    out.push(x);
  }
  const n = out.join(" ").trim();
  return n.length > 1 ? n : null;
}

const contactsUrl = (u) =>
  !/online-applications\/applicationDetails\.do/i.test(u)
    ? null
    : u.replace(/([?&])activeTab=[^&]*/gi, "$1activeTab=contacts");

function firmFromAddress(addr, name) {
  if (!addr) return null;
  const f = addr.split(",")[0]?.trim();
  if (!f) return null;
  if (/^\d+[a-z]?\s/i.test(f) || /\b(road|street|lane|avenue|close|way|drive|court)\b/i.test(f)) return null;
  if (name && f.toLowerCase() === name.toLowerCase()) return null;
  return f;
}

function parse(html) {
  const b = html.match(/<div class="agents">([\s\S]*?)<\/div>/i)?.[1];
  if (!b) return null;
  const name = cleanName(dec(b.match(/<h3>\s*Agent\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""));
  const f = new Map();
  for (const r of b.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    f.set(dec(r[1]).toLowerCase(), dec(r[2]));
  }
  const pick = (...ks) => { for (const k of ks) for (const [key, v] of f) if (key.includes(k)) return v; return null; };
  const raw = pick("company email", "email");
  const email =
    raw && /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i.test(raw.trim()) &&
    !/^(firstname|name|surname|initial|first\.last)@/i.test(raw.trim())
      ? raw.trim()
      : null;
  const phone = pick("company phone", "phone", "mobile", "telephone");
  if (!name && !email && !phone) return null;
  return { name, firm: firmFromAddress(pick("address"), name), email, phone };
}

const db = new Database("prisma/dev.db");
const where = FORCE ? `contactStatus IS NULL OR contactStatus = 'not_found'` : `contactStatus IS NULL`;
let rows = db.prepare(
  `SELECT id, council, councilUrl FROM PlanningApplication
   WHERE councilUrl LIKE '%online-applications/applicationDetails.do%'
     AND publicOwner = 0 AND (${where})
   ORDER BY (status != 'decided') DESC, leadScore DESC`
).all();
if (LIMIT !== Infinity) rows = rows.slice(0, LIMIT);

// Bucket by host, then interleave so consecutive requests hit different councils.
const byHost = new Map();
for (const r of rows) {
  let host;
  try { host = new URL(r.councilUrl).hostname; } catch { continue; }
  if (!byHost.has(host)) byHost.set(host, []);
  byHost.get(host).push(r);
}
console.log(`${rows.length} leads across ${byHost.size} councils`);
for (const [h, list] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}  ${h}`);
}
console.log();

const upd = db.prepare(
  `UPDATE PlanningApplication SET agentName=?, agentFirm=?, agentEmail=?, agentPhone=?,
     contactNotes=?, contactStatus='found', contactResearchedAt=CURRENT_TIMESTAMP WHERE id=?`
);

// A council that keeps refusing is telling us something. Rather than retry it all
// night, give up on that host after MAX_BACKOFFS and leave its remaining leads to
// the daily job, which picks them up a handful at a time and never bursts.
const MAX_BACKOFFS = Number(process.env.PORTAL_MAX_BACKOFFS ?? 3);

const lastHit = new Map();   // host -> timestamp
const coolUntil = new Map(); // host -> timestamp, set on 429
const backoffs = new Map();  // host -> count
const stats = new Map();     // host -> {found, email, none, failed, blocked}
const stat = (h) => {
  if (!stats.has(h)) stats.set(h, { found: 0, email: 0, none: 0, failed: 0, blocked: 0 });
  return stats.get(h);
};

const queues = [...byHost.entries()].map(([host, list]) => ({ host, list, i: 0 }));
let processed = 0, found = 0, withEmail = 0;
const started = Date.now();

// Round-robin until every queue is drained.
while (queues.some((q) => q.i < q.list.length)) {
  for (const q of queues) {
    if (q.i >= q.list.length) continue;

    const now = Date.now();
    if ((coolUntil.get(q.host) ?? 0) > now) continue; // still backing off

    const wait = (lastHit.get(q.host) ?? 0) + HOST_GAP_MS - now;
    if (wait > 0) continue; // another council's turn

    const r = q.list[q.i++];
    lastHit.set(q.host, Date.now());
    processed++;

    let html = null, status = 0;
    try {
      const res = await fetch(contactsUrl(r.councilUrl), {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(25000),
      });
      status = res.status;
      if (res.ok) html = await res.text();
    } catch { /* unreachable */ }

    if (status === 429 || status === 503) {
      const n = (backoffs.get(q.host) ?? 0) + 1;
      backoffs.set(q.host, n);
      stat(q.host).blocked++;
      q.i--; // put it back rather than losing the lead
      if (n >= MAX_BACKOFFS) {
        const left = q.list.length - q.i;
        q.i = q.list.length; // drop out of this run
        console.log(`  ✋ ${q.host} refused ${n} times — leaving its remaining ${left} leads to the daily job`);
      } else {
        coolUntil.set(q.host, Date.now() + COOLDOWN_MS);
        console.log(`  ⏸  ${q.host} asked us to slow down (${status}) — backing off ${Math.round(COOLDOWN_MS / 60000)}m`);
      }
      continue;
    }

    if (!html) { stat(q.host).failed++; }
    else {
      const c = parse(html);
      if (!c) stat(q.host).none++;
      else {
        stat(q.host).found++;
        found++;
        if (c.email) { stat(q.host).email++; withEmail++; }
        if (!DRY) upd.run(c.name, c.firm, c.email, c.phone, "Council planning register (Idox contacts tab)", r.id);
      }
    }

    if (processed % 25 === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`  ${processed}/${rows.length} · found ${found} (${withEmail} with email) · ${mins}m elapsed`);
    }
    await sleep(GLOBAL_GAP_MS);
  }

  // Every queue is either drained or waiting out its gap.
  const pending = queues.filter((q) => q.i < q.list.length);
  if (pending.length > 0) {
    const soonest = Math.min(
      ...pending.map((q) => Math.max((lastHit.get(q.host) ?? 0) + HOST_GAP_MS, coolUntil.get(q.host) ?? 0) - Date.now())
    );
    if (soonest > 0) await sleep(Math.min(soonest + 100, 30000));
  }
}

console.log(`\n${DRY ? "[dry run] would store" : "stored"} ${found} agent contact(s), ${withEmail} with a usable email\n`);
console.log("per council:");
for (const [h, s] of [...stats].sort((a, b) => b[1].found - a[1].found)) {
  console.log(`  ${h.padEnd(42)} found ${String(s.found).padStart(3)} (${s.email} email) · none ${s.none} · unreachable ${s.failed}${s.blocked ? ` · rate-limited ${s.blocked}` : ""}`);
}
db.close();
