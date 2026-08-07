// Measures how many agents can be read straight off the council register, before
// committing to it as the primary contact source. Read-only — writes nothing.
// Usage: node scripts/probe-portal-extract.mjs [sampleSize]
import Database from "better-sqlite3";

const N = Number(process.argv[2] ?? 25);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const dec = (v) => v.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();

const contactsUrl = (u) => !/online-applications\/applicationDetails\.do/i.test(u) ? null
  : u.replace(/([?&])activeTab=[^&]*/gi, "$1activeTab=contacts");

function parse(html) {
  const block = html.match(/<div class="agents">([\s\S]*?)<\/div>/i)?.[1];
  if (!block) return null;
  const name = dec(block.match(/<h3>\s*Agent\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null;
  const f = new Map();
  for (const r of block.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) f.set(dec(r[1]).toLowerCase(), dec(r[2]));
  const pick = (...ks) => { for (const k of ks) for (const [key,v] of f) if (key.includes(k)) return v; return null; };
  const email = pick("company email","email"), phone = pick("company phone","phone","mobile");
  if (!name && !email && !phone) return null;
  return { name, email, phone };
}

const db = new Database("prisma/dev.db");
const rows = db.prepare(
  `SELECT council, address, councilUrl FROM PlanningApplication
   WHERE councilUrl LIKE '%online-applications/applicationDetails.do%'
     AND status != 'decided' ORDER BY leadScore DESC LIMIT ?`
).all(N);

console.log(`probing ${rows.length} Idox leads\n`);
let withName=0, withEmail=0, withPhone=0, none=0, failed=0;
for (const r of rows) {
  const u = contactsUrl(r.councilUrl);
  let html = null;
  try {
    const res = await fetch(u, { headers:{ "User-Agent":UA }, signal: AbortSignal.timeout(25000) });
    if (res.ok) html = await res.text();
  } catch {}
  if (!html) { failed++; console.log(`  ✗ fetch failed  ${r.council}`); continue; }
  const c = parse(html);
  if (!c) { none++; console.log(`  – no agent named  ${r.council}  ${r.address.slice(0,40)}`); continue; }
  if (c.name) withName++;
  if (c.email) withEmail++;
  if (c.phone) withPhone++;
  console.log(`  ✓ ${(c.name??"(no name)").padEnd(26)} ${(c.email??"—").padEnd(34)} ${c.phone??"—"}`);
  await new Promise(r => setTimeout(r, 1500));
}
console.log(`\nnamed agent: ${withName}/${rows.length} · with EMAIL: ${withEmail} · with phone: ${withPhone} · no agent listed: ${none} · fetch failed: ${failed}`);
db.close();
