// Reads the agent straight off the council's planning register for every lead on
// a supported portal. This is the work Lucy does by hand, and it returns name +
// email + phone together — the AI researcher managed ~15% and rarely an email.
//
// Only touches leads with no contact yet (or --force to redo not_found ones).
// Polite by design: one request at a time, 1.5s apart, real User-Agent.
//
// Usage: node scripts/backfill-portal-contacts.mjs [--dry] [--force] [--limit N]
import Database from "better-sqlite3";

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const li = process.argv.indexOf("--limit");
const LIMIT = li > -1 ? Number(process.argv[li + 1]) : Infinity;
const DELAY = 1500;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const dec = (v) => v.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();

function cleanName(raw) {
  if (!raw) return null;
  let w = raw.trim().split(/\s+/).filter((x,i)=>!(i===0 && /^(mr|mrs|ms|miss|dr|prof|sir|rev)\.?$/i.test(x)));
  const out = [];
  for (const x of w) {
    const p = out[out.length-1];
    if (p && p.toLowerCase() === x.toLowerCase()) { if (p===p.toUpperCase() && x!==x.toUpperCase()) out[out.length-1]=x; continue; }
    out.push(x);
  }
  const n = out.join(" ").trim();
  return n.length > 1 ? n : null;
}
const contactsUrl = (u) => !/online-applications\/applicationDetails\.do/i.test(u) ? null
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
  for (const r of b.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) f.set(dec(r[1]).toLowerCase(), dec(r[2]));
  const pick = (...ks) => { for (const k of ks) for (const [key,v] of f) if (key.includes(k)) return v; return null; };
  const rawEmail = pick("company email","email");
  const email = rawEmail && /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i.test(rawEmail.trim())
    && !/^(firstname|name|surname|initial|first\.last)@/i.test(rawEmail.trim()) ? rawEmail.trim() : null;
  const phone = pick("company phone","phone","mobile","telephone");
  const addr = pick("address");
  if (!name && !email && !phone) return null;
  return { name, firm: firmFromAddress(addr, name), email, phone };
}

const db = new Database("prisma/dev.db");
const where = FORCE ? `contactStatus IS NULL OR contactStatus = 'not_found'` : `contactStatus IS NULL`;
const rows = db.prepare(
  `SELECT id, council, address, councilUrl FROM PlanningApplication
   WHERE councilUrl LIKE '%online-applications/applicationDetails.do%'
     AND publicOwner = 0 AND (${where})
   ORDER BY (status != 'decided') DESC, leadScore DESC`
).all().slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`${rows.length} leads on a readable council register\n`);
const upd = db.prepare(
  `UPDATE PlanningApplication SET agentName=?, agentFirm=?, agentEmail=?, agentPhone=?,
     contactNotes=?, contactStatus='found', contactResearchedAt=CURRENT_TIMESTAMP WHERE id=?`
);

let found=0, withEmail=0, none=0, failed=0, n=0;
for (const r of rows) {
  n++;
  let html = null;
  try {
    const res = await fetch(contactsUrl(r.councilUrl), { headers:{ "User-Agent":UA }, signal: AbortSignal.timeout(25000) });
    if (res.ok) html = await res.text();
  } catch {}
  if (!html) { failed++; }
  else {
    const c = parse(html);
    if (!c) none++;
    else {
      found++; if (c.email) withEmail++;
      if (!DRY) upd.run(c.name, c.firm, c.email, c.phone, "Council planning register (Idox contacts tab)", r.id);
    }
  }
  if (n % 40 === 0 || n === rows.length) {
    console.log(`  ${n}/${rows.length} · found ${found} (${withEmail} with email) · no agent ${none} · unreachable ${failed}`);
  }
  await new Promise((res) => setTimeout(res, DELAY));
}
console.log(`\n${DRY ? "[dry run] would store" : "stored"} ${found} agent contact(s), ${withEmail} with a usable email`);
db.close();
