#!/usr/bin/env node
// FR LIBRARY BUILDER — hand-written case seeds -> production topic specs.
//
//   icerik/kutuphane-tohum/<batch>.json  (seeds: case file + 8-line narration + sources)
//        │  1. uniqueness (slug, Wikipedia page, case name) vs. the whole library
//        │  2. retention rules (lib/tutunma): ≤ 80 words, 2nd beat is an event
//        │  3. fact check: every number in narration/case file must appear in the
//        │     Wikipedia article's full text (digits or spelled-out words)
//        │  4. every source URL must answer HTTP < 400
//        │  5. archival stills from Wikimedia Commons, licence PD / CC0 / CC BY only
//        ▼
//   icerik/konular/<slug>.json   (only if every check passes; otherwise reported)
//
// Usage:
//   node scripts/fr-library/build.js icerik/kutuphane-tohum/batch-01.json [--write] [--offline]
// Report: icerik/kutuphane-tohum/<batch>.report.json
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..", "..");
const TOPICS = path.join(ROOT, "icerik", "konular");
const UA = "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)";
const CLUSTER_TAG = {
  "bridge-failures": "#bridges", "structural-failures": "#structuralengineering", "aviation-failures": "#aviation",
  "spaceflight-disasters": "#spaceflight", "maritime-disasters": "#maritime", "nuclear-accidents": "#nuclear",
  "fire-and-explosions": "#firesafety", "industrial-disasters": "#industrial", "infrastructure-failures": "#infrastructure",
  "materials-failures": "#materials", "natural-hazards": "#disaster", "rail-disasters": "#railways", "software-and-control-failures": "#software",
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
// Wikimedia answers bursts with 429/503; back off and retry so a throttled
// request is never mistaken for "no article / no stills / no sources".
async function get(url, options = {}) {
  const wikimedia = /(^|\.)(wikipedia|wikimedia)\.org$/.test(new URL(url).hostname);
  for (let attempt = 0; ; attempt++) {
    const res = await getOnce(url, options);
    if (!wikimedia || ![0, 429, 503].includes(res.status) || attempt >= 5) return res;
    await sleep((res.retryAfter || 0) * 1000 || 2000 * 2 ** attempt);
  }
}
function getOnce(url, { json = false, binary = false, head = false, redirects = 5, browser = false } = {}) {
  return new Promise((resolve) => {
    const request = https.request(url, { method: head ? "HEAD" : "GET", headers: { "User-Agent": browser ? BROWSER_UA : UA, Accept: json ? "application/json" : "*/*", "Accept-Encoding": "identity" }, timeout: 25000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(getOnce(new URL(res.headers.location, url).toString(), { json, binary, head, redirects: redirects - 1, browser }));
      }
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => {
        const buffer = Buffer.concat(parts);
        const body = binary ? buffer : buffer.toString("utf8");
        const retryAfter = Number(res.headers["retry-after"]) || 0;
        if (binary) return resolve({ status: res.statusCode, body, retryAfter, contentType: res.headers["content-type"] || "" });
        if (!json) return resolve({ status: res.statusCode, body, retryAfter });
        try { resolve({ status: res.statusCode, body: JSON.parse(body), retryAfter }); } catch (e) { resolve({ status: res.statusCode, body: null, retryAfter }); }
      });
    });
    request.on("timeout", () => { request.destroy(); resolve({ status: 0, body: null }); });
    request.on("error", () => resolve({ status: 0, body: null }));
    request.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- numbers
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };

// Spelled-out numbers ("two hundred thousand", "thirty five") -> numbers.
// Small counting words (one..ten) alone are ignored: they are usually prose.
function spelledNumbers(text) {
  const words = String(text).toLowerCase().replace(/-/g, " ").split(/[^a-z0-9.]+/);
  const out = [];
  let current = null, total = 0, seen = 0;
  const flush = () => { if (current != null || total) { const value = total + (current || 0); if (seen > 1 || value > 10) out.push(value); } current = null; total = 0; seen = 0; };
  for (const w of words) {
    if (w in UNITS) { current = (current || 0) + UNITS[w]; seen++; }
    else if (w in TENS) { current = (current || 0) + TENS[w]; seen++; }
    else if (w === "hundred" && current != null) { current *= 100; seen++; }
    else if (w in SCALES && w !== "hundred") { total += (current == null ? 1 : current) * SCALES[w]; current = null; seen++; }
    else if (w === "and" && (current != null || total)) continue;
    else flush();
  }
  flush();
  return out;
}

function numbersIn(text) {
  const value = String(text);
  const digits = (value.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((d) => Number(d.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
  return [...new Set([...digits, ...spelledNumbers(value)])];
}

// A number is supported when the article contains it (as digits, with commas,
// or spelled out), or when it is a year/unit already in the seed's own source list.
function supported(n, articleNumbers) {
  if (articleNumbers.has(n)) return true;
  // rounded forms: "about 1,500" vs 1,517 — allow ±3% for n ≥ 100, never for small counts
  if (n >= 100) for (const a of articleNumbers) if (Math.abs(a - n) / n <= 0.03) return true;
  return false;
}

// ---------------------------------------------------------------- checks
const tutunma = require(path.join(ROOT, "lib", "tutunma.js"));
const wordCount = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

function existingLibrary() {
  const rows = [];
  for (const file of fs.readdirSync(TOPICS).filter((f) => f.endsWith(".json"))) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(TOPICS, file), "utf8"));
      const wiki = ((spec.vaka || {}).kaynakca || []).map((k) => k.url).find((u) => /wikipedia\.org\/wiki\//.test(u || "")) || null;
      rows.push({ slug: file.replace(/\.json$/, ""), ad: ((spec.vaka || {}).ad || "").toLowerCase(), wiki: wiki ? decodeURIComponent(wiki.split("/wiki/")[1]).toLowerCase() : null, fromSeed: spec.tohum || null });
    } catch (e) {}
  }
  return rows;
}

async function article(wiki) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(wiki);
  const r = await get(url, { json: true });
  const page = r.body && r.body.query ? Object.values(r.body.query.pages)[0] : null;
  if (!page || page.missing !== undefined || !page.extract) return null;
  return { title: page.title, text: page.extract };
}

// Official bodies whose reports Wikipedia cites. A cited URL is trusted
// provenance even when the site blocks automated requests.
const OFFICIAL = [
  [/(^|\.)ntsb\.gov$/, "NTSB"], [/(^|\.)bea\.aero$/, "BEA (French air accident bureau)"], [/(^|\.)aaib\.gov\.uk$/, "UK Air Accidents Investigation Branch"], [/^(www\.)?gov\.uk$|^assets\.publishing\.service\.gov\.uk$|^(www\.)?legislation\.gov\.uk$/, "UK Government"], [/(^|\.)grenfelltowerinquiry\.org\.uk$/, "Grenfell Tower Inquiry"],
  [/(^|\.)hse\.gov\.uk$/, "UK Health and Safety Executive"], [/(^|\.)csb\.gov$/, "US Chemical Safety Board"], [/(^|\.)nasa\.gov$/, "NASA"],
  [/(^|\.)nrc\.gov$/, "US Nuclear Regulatory Commission"], [/(^|\.)iaea\.org$/, "IAEA"], [/(^|\.)usgs\.gov$/, "USGS"], [/(^|\.)noaa\.gov$/, "NOAA"],
  [/(^|\.)nist\.gov$/, "NIST"], [/(^|\.)osti\.gov$/, "US DOE OSTI"], [/(^|\.)faa\.gov$/, "FAA"], [/(^|\.)tsb\.gc\.ca$|bst-tsb\.gc\.ca$/, "Transportation Safety Board of Canada"],
  [/(^|\.)atsb\.gov\.au$/, "Australian Transport Safety Bureau"], [/(^|\.)esa\.int$/, "ESA"], [/(^|\.)imo\.org$/, "IMO"], [/(^|\.)uscg\.mil$|(^|\.)dco\.uscg\.mil$/, "US Coast Guard"],
  [/(^|\.)maib\.gov\.uk$/, "UK Marine Accident Investigation Branch"], [/(^|\.)rail\.gov\.uk$|raib\.gov\.uk$/, "UK Rail Accident Investigation Branch"], [/(^|\.)fra\.dot\.gov$|railroads\.dot\.gov$/, "US Federal Railroad Administration"],
  [/(^|\.)dot\.gov$/, "US Department of Transportation"], [/(^|\.)energy\.gov$/, "US Department of Energy"], [/(^|\.)epa\.gov$/, "US EPA"], [/(^|\.)msha\.gov$/, "US Mine Safety and Health Administration"],
  [/(^|\.)usbr\.gov$/, "US Bureau of Reclamation"], [/(^|\.)usace\.army\.mil$/, "US Army Corps of Engineers"], [/(^|\.)fema\.gov$/, "FEMA"], [/(^|\.)cdc\.gov$/, "CDC"],
  [/(^|\.)europa\.eu$/, "European Union"], [/(^|\.)jtsb\.mlit\.go\.jp$|(^|\.)mlit\.go\.jp$/, "Japan Transport Safety Board / MLIT"], [/(^|\.)archives\.gov$|nationalarchives\.gov\.uk$/, "National Archives"], [/(^|\.)damfailures\.org$/, "ASDSO Dam Failures and Lessons Learned"], [/(^|\.)congress\.gov$|(^|\.)govinfo\.gov$/, "US Congress / GovInfo"],
  [/(^|\.)ntsb\.go\.kr$|araib\.molit\.go\.kr$/, "Korea Aviation and Railway Accident Investigation Board"], [/(^|\.)sust\.admin\.ch$/, "Swiss Transportation Safety Investigation Board"],
  [/(^|\.)bfu-web\.de$|(^|\.)bfu\.bund\.de$/, "German Federal Bureau of Aircraft Accident Investigation"], [/(^|\.)havarikommisjonen\.no$|nsia\.no$/, "Norwegian Safety Investigation Authority"],
  [/(^|\.)onderzoeksraad\.nl$/, "Dutch Safety Board"], [/(^|\.)skybrary\.aero$/, "SKYbrary (EUROCONTROL)"],
  // Second rank: other government, academic, engineering-institution, archive
  // and major-newsroom sources Wikipedia cites (still traceable, still strong).
  [/\.gov$|\.gov\.[a-z]{2}$|\.gc\.ca$|\.gouv\.fr$|\.go\.(jp|kr)$|\.govt\.nz$|\.admin\.ch$|\.bund\.de$|\.mil$/, "Government source", 1],
  [/(^|\.)doi\.org$|(^|\.)jstor\.org$|\.edu$|\.ac\.[a-z]{2}$|sciencedirect\.com$|springer\.com$|tandfonline\.com$|wiley\.com$|ascelibrary\.org$|icevirtuallibrary\.com$|ieee\.org$|nature\.com$|science\.org$|semanticscholar\.org$/, "Academic / engineering journal", 2],
  [/(^|\.)ice\.org\.uk$|(^|\.)istructe\.org$|(^|\.)asce\.org$|structuremag\.org$|(^|\.)nae\.edu$|engineering\.org\.au$|(^|\.)ieee\.org$/, "Engineering institution", 2],
  [/trove\.nla\.gov\.au$|chroniclingamerica\.loc\.gov$|nationalarchives|archives\.|(^|\.)bl\.uk$|newspapers\.library|museum/, "Archive / museum", 3],
  [/(^|\.)(nytimes|bbc|theguardian|reuters|apnews|washingtonpost|latimes|economist|ft|wsj|smh|abc\.net|cbc|lemonde|spiegel)\.(com|co\.uk|net\.au|ca|fr|de)$|(^|\.)bbc\.co\.uk$|(^|\.)abc\.net\.au$|(^|\.)cbc\.ca$/, "Major newspaper / broadcaster", 4],
];

async function citedOfficialLinks(wiki) {
  const links = [];
  let cont = "";
  for (let page = 0; page < 4; page++) {
    const r = await get("https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&ellimit=500&redirects=1&format=json&titles=" + encodeURIComponent(wiki) + cont, { json: true });
    const p = r.body && r.body.query ? Object.values(r.body.query.pages)[0] : null;
    for (const link of (p && p.extlinks) || []) links.push(link["*"] || link.url);
    if (!(r.body && r.body.continue)) break;
    cont = "&elcontinue=" + encodeURIComponent(r.body.continue.elcontinue);
  }
  const out = [];
  for (const url of links) {
    let host;
    try { host = new URL(url.startsWith("//") ? "https:" + url : url).hostname.toLowerCase(); } catch (e) { continue; }
    const match = OFFICIAL.find(([pattern]) => pattern.test(host));
    const rank = match ? (match[2] || 0) : 99;
    if (!match || /web\.archive\.org|JASC_Code|\/search\?|\/images?\//i.test(url)) continue;
    const full = url.startsWith("//") ? "https:" + url : url;
    const score = (/\.pdf($|\?)/i.test(full) ? 3 : 0) + (/report|final|investigat|inquiry|accident|findings|docket/i.test(full) ? 2 : 0) - (/news|press|photo|image|gallery/i.test(full) ? 1 : 0);
    out.push({ url: full, body: match[1], score, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || b.score - a.score);
}

const LICENCE_OK = (l) => /^(public domain|pd\b|pd-|cc0|cc by(?!-?(sa|nc|nd))\b)/i.test(String(l).trim()) && !/\b(sa|nc|nd)\b/i.test(String(l));
const SKIP_FILE = /\b(map|logo|flag|coat of arms|diagram|chart|signature|seal of|locator|icon|svg)\b/i;

const GENERIC = new Set("the of and a an in on at to for disaster disasters collapse collapses accident accidents crash flight airlines airline fire explosion bridge dam ship sinking tower building plant station nuclear space shuttle mission incident failure event events memorial".split(" "));
const JUNK = /\b(montage|collage|grid version|events? of|portrait|headshot|stamp|coin|banknote|postcard|dna|protein|mouse|aviacionavion|commons-logo|wikiquote|question book|ambox|nuvola|crystal clear|icon|symbol|emblem|insignia|patch)\b/i;

async function imageInfo(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const info = await get("https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json&titles=" + encodeURIComponent(batch.join("|")), { json: true });
    const pages = info.body && info.body.query ? Object.values(info.body.query.pages) : [];
    for (const title of batch) {
      const page = pages.find((p) => p.title === title);
      const ii = page && page.imageinfo && page.imageinfo[0];
      if (!ii) continue;
      const meta = ii.extmetadata || {};
      const licence = meta.LicenseShortName ? meta.LicenseShortName.value : "";
      const strip = (v) => String(v && v.value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600);
      out.push({ file: title.replace(/^File:/, ""), licence, width: ii.width, height: ii.height,
        categories: strip(meta.Categories), description: strip(meta.ImageDescription), taken: strip(meta.DateTimeOriginal).slice(0, 40),
        author: strip(meta.Artist) || strip(meta.Credit) || "Wikimedia Commons contributor",
        sourceUrl: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        imageUrl: ii.thumburl || ii.url });
    }
    await sleep(250);
  }
  return out;
}

const usable = (item) => LICENCE_OK(item.licence) && item.width >= 700 && item.height >= 450 && !SKIP_FILE.test(item.file) && !JUNK.test(item.file) && /\.(jpe?g|png)$/i.test(item.file);

// Stills: candidates are the images the case's own Wikipedia article uses
// (curated, on-topic) plus Commons search hits. Each is scored by how clearly
// its file name names THIS case: a distinctive keyword (e.g. "Hyatt") is not
// enough on its own — another Hyatt hotel is not evidence — so search hits also
// need the year or an event word (collapse, wreck, aftermath, debris…).
const UNSAFE = /\b(adult|porn\w*|erotic\w*|nude|nudity|naked|sexy?|xxx|avn|playboy|lingerie|bikini|topless|fetish|escort|stripper|hentai)\b/i;
const EVENT_WORDS = /\b(collapse\w*|disaster|crash\w*|wreck\w*|explo\w*|fire|burn\w*|fell|sink\w*|sank|debris|ruin\w*|aftermath|damage\w*|rescue\w*|victim\w*|memorial|remains|site|accident|failure|flood\w*|breach|investigat\w*|recovery|salvage|fragment|reconstruct\w*|report|figure|fig\d*|diagram)\b/i;
async function commonsStills(queries, need = 7, wiki = null, options = {}) {
  const list = (Array.isArray(queries) ? queries : [queries]).filter(Boolean);
  const words = (q) => String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
  const keywordSets = (options.keywords || list).filter((q) => !/^Category:/i.test(q)).map(words).filter((set) => set.length);
  const keywords = [...new Set(keywordSets.flat())];
  // Search terms may include richly described scenes. Those terms improve
  // discovery, but they must not prove relevance: a generic scene word such
  // as "grid" or "control" can otherwise admit an unrelated namesake. Only
  // the record/article anchors are allowed to clear the strict subject gate.
  const subjectSets = (options.anchorSubjects || options.subjects || []).map(words).filter((set) => set.length);
  const year = options.year ? String(options.year) : null;
  const exclude = options.exclude || new Set();
  // Editorial rejections (name collisions such as a namesake general or a later
  // ship that inherited the name): any listed fragment in the filename rejects it.
  const reject = (options.reject || []).map((r) => String(r).toLowerCase());
  const scored = [];
  const consider = (item, origin) => {
    if (!usable(item) || exclude.has(item.file) || scored.some((x) => x.file === item.file)) return;
    if (reject.some((r) => item.file.toLowerCase().includes(r))) return;
    const text = `${item.file} ${item.categories || ""} ${item.description || ""}`.toLowerCase();
    const namedText = `${item.file} ${item.description || ""}`.toLowerCase();
    // Never let a namesake search pull adult or otherwise unsafe material.
    if (UNSAFE.test(text)) return;
    // IB/CT production can require the record's subject to appear in the file
    // title or description. Categories alone are deliberately insufficient:
    // broad Commons categories often contain visually plausible namesakes.
    if (options.strictSubject && subjectSets.length && !subjectSets.some((set) => {
      const matches = set.filter((word) => namedText.includes(word)).length;
      return matches >= Math.min(3, set.length);
    })) return;
    const strong = keywords.filter((k) => text.includes(k)).length;
    const namedStrong = keywords.filter((k) => namedText.includes(k)).length;
    const fullMatch = keywordSets.some((set) => set.every((k) => text.includes(k)));
    const context = EVENT_WORDS.test(text) ? 1 : 0;
    const dated = year && (text.includes(year) || String(item.taken || "").includes(year)) ? 1 : 0;
    const takenYear = (String(item.taken || "").match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1];
    const otherYear = year && takenYear && takenYear !== year;
    // Article images are curated by Wikipedia editors. Search hits must name
    // the case in full (all words of one query) in name/categories/description,
    // and must not be a photo taken in another year unless dated to the event.
    const nearYear = !takenYear || !year || Math.abs(Number(takenYear) - Number(year)) <= 2;
    const searchMatch = options.strictSubject ? namedStrong >= 2 : fullMatch;
    const ok = origin === "wikipedia-article" || origin === "commons-category" ? (strong >= 1 || dated || origin === "commons-category") && !(origin === "commons-category" && otherYear && !dated)
      : searchMatch && (takenYear ? nearYear : (dated || context || options.strictSubject));
    if (!ok) return;
    // Strict mode (namesake-prone cases: ships named after people, towns that
    // share a name): anything the article itself doesn't show must be dated to
    // the event or describe the event.
    if (options.strict && origin !== "wikipedia-article" && !(dated || (context && (!takenYear || nearYear)))) return;
    scored.push({ ...item, origin, score: strong * 2 + (fullMatch ? 3 : 0) + context + dated * 2 + (origin === "wikipedia-article" || origin === "commons-category" ? 2 : 0) - (otherYear ? 2 : 0) });
  };
  if (wiki) {
    const r = await get("https://en.wikipedia.org/w/api.php?action=query&prop=images&imlimit=100&redirects=1&format=json&titles=" + encodeURIComponent(wiki), { json: true });
    const page = r.body && r.body.query ? Object.values(r.body.query.pages)[0] : null;
    const titles = ((page && page.images) || []).map((image) => image.title).filter((t) => /\.(jpe?g|png)$/i.test(t));
    for (const item of await imageInfo(titles)) consider(item, "wikipedia-article");
  }
  if (!options.articleOnly) {
    // Curated Commons categories: explicit "Category:…" seeds plus categories
    // whose title names the case (auto-discovered).
    const categories = list.filter((q) => /^Category:/i.test(q));
    for (const query of list.filter((q) => !/^Category:/i.test(q)).slice(0, 2)) {
      const r = await get("https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=14&srlimit=10&format=json&srsearch=" + encodeURIComponent(query), { json: true });
      for (const row of (r.body && r.body.query && r.body.query.search) || []) {
        const title = row.title.toLowerCase();
        // The category must carry the case's full name, generic words included
        // ("Schoharie Creek Bridge", not just "Schoharie Creek").
        const phrases = (options.phrases || []).map((p) => String(p).toLowerCase()).filter(Boolean);
        const named = phrases.length ? phrases.some((p) => title.includes(p)) : keywordSets.some((set) => set.every((k) => title.includes(k)));
        if (named && !categories.includes(row.title) && categories.length < 3) categories.push(row.title);
      }
      await sleep(200);
    }
    for (const query of categories) {
      const r = await get("https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtype=file&cmlimit=100&format=json&cmtitle=" + encodeURIComponent(query), { json: true });
      const titles = ((r.body && r.body.query && r.body.query.categorymembers) || []).map((row) => row.title).filter((t) => /\.(jpe?g|png)$/i.test(t));
      for (const item of await imageInfo(titles.slice(0, 60))) consider(item, "commons-category");
    }
    for (const query of list.filter((q) => !/^Category:/i.test(q))) {
      if (scored.length >= need) break;
      const search = await get("https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=50&format=json&srsearch=" + encodeURIComponent(query + " filetype:bitmap"), { json: true });
      const titles = ((search.body && search.body.query && search.body.query.search) || []).map((row) => row.title).filter((t) => /\.(jpe?g|png)$/i.test(t));
      for (const item of await imageInfo(titles)) consider(item, "commons-search");
    }
  }
  // At most two stills from the same series (e.g. "Anniversary Observance (1..4)").
  const prefix = (file) => file.toLowerCase().replace(/[\d()_.,-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
  const picked = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (picked.filter((x) => prefix(x.file) === prefix(item.file)).length >= 2) continue;
    picked.push(item);
    if (picked.length >= need) break;
  }
  return picked;
}

function lint(seed) {
  const errors = [];
  for (const key of ["slug", "wiki", "ad", "kisa", "nesne", "yil", "kume", "sonuc", "tetik", "mekanizma", "sayi", "ders", "zincir", "yanilgi", "tartisma", "basliklar", "kapak", "hook", "soru", "sahneler", "kaynakca", "baslik"]) {
    if (seed[key] == null || seed[key] === "" || (Array.isArray(seed[key]) && !seed[key].length)) errors.push("missing " + key);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(seed.slug || "")) errors.push("bad slug");
  if (!CLUSTER_TAG[seed.kume]) errors.push("unknown cluster " + seed.kume);
  if ((seed.sahneler || []).length < 6 || (seed.sahneler || []).length > 9) errors.push(`${(seed.sahneler || []).length} scenes (6–9)`);
  if ((seed.zincir || []).length < 3) errors.push("failure chain < 3 steps");
  if (!(seed.kaynakca || []).length) errors.push("no sources");
  if (wordCount(seed.hook) > 6) errors.push("on-screen hook > 6 words");
  for (const kapak of seed.kapak || []) if (wordCount(kapak) > 4 || kapak.length > 22) errors.push("thumbnail text too long: " + kapak);
  for (const t of seed.etiketler || []) if (/[,<>]/.test(t)) errors.push("bad tag " + t);
  const spec = { sahneler: (seed.sahneler || []).map((metin) => ({ metin, kaynak: "Footage/f1.jpg" })), tur: "arsiv" };
  for (const finding of tutunma.denetle(spec)) errors.push("retention: " + finding.mesaj);
  if (/\b(did you know|imagine|in this video|welcome|subscribe)\b/i.test((seed.sahneler || [])[0] || "")) errors.push("forbidden opening");
  return errors;
}

function toSpec(seed, stills) {
  // Unique footage names per case (the originality check compares scene sources).
  const stem = seed.slug.replace(/-(1[89]|20)\d\d$/, "").slice(0, 24);
  const files = stills.map((s, i) => ({ ad: `${stem}-${i + 1}.${/\.png$/i.test(s.file) ? "png" : "jpg"}`, wikimedia: s.file }));
  const tag = CLUSTER_TAG[seed.kume];
  const aciklama = `${seed.aciklama || `${seed.kisa} ${seed.sonuc}. The cause: ${seed.mekanizma}.`}\n\n#shorts #engineering ${tag}`;
  return {
    kanal: "Failure Reconstructed",
    ses: "en-US-AndrewNeural",
    sesHizi: "+6%",
    altyaziFont: "Arial Black",
    oncelik: seed.oncelik || 7,
    baslik: seed.baslik,
    kaynaklar: files,
    sahneler: seed.sahneler.map((metin, i) => ({ metin, kaynak: "Footage/" + files[i % files.length].ad })),
    aciklama,
    etiketler: (seed.etiketler && seed.etiketler.length ? seed.etiketler : [seed.kisa, String(seed.yil), seed.nesne.toLowerCase(), "engineering failure"]).slice(0, 10),
    hook: seed.hook,
    soru: seed.soru,
    vaka: {
      kume: seed.kume, tip: "vaka", ad: seed.ad, kisa: seed.kisa, nesne: seed.nesne, yil: seed.yil, sonuc: seed.sonuc, tetik: seed.tetik,
      mekanizma: seed.mekanizma, sayi: seed.sayi, ders: seed.ders, zincir: seed.zincir, zaman: seed.zaman || [], yanilgi: seed.yanilgi,
      tartisma: seed.tartisma, basliklar: seed.basliklar, kapak: seed.kapak, kaynakca: seed.kaynakca,
    },
    tohum: { batch: seed.__batch, wiki: seed.wiki, olusturuldu: new Date().toISOString().slice(0, 10), gorselLisanslari: stills.map((s) => `${s.file} [${s.licence}]`) },
  };
}

async function main() {
  const file = process.argv[2];
  const write = process.argv.includes("--write");
  const offline = process.argv.includes("--offline");
  if (!file) { console.error("usage: node scripts/fr-library/build.js <seed-batch.json> [--write] [--offline]"); process.exit(1); }
  const seeds = JSON.parse(fs.readFileSync(file, "utf8"));
  const batch = path.basename(file, ".json");
  const library = existingLibrary();
  const report = [];
  const seenSlugs = new Set(), seenWiki = new Set();
  // A still already used by another case is never reused (no shared icons,
  // no cross-case visual reuse).
  const usedFiles = new Set();
  for (const file of fs.readdirSync(TOPICS).filter((f) => f.endsWith(".json"))) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(TOPICS, file), "utf8"));
      if (seeds.some((seed) => seed.slug + ".json" === file)) continue;
      for (const k of spec.kaynaklar || []) if (k.wikimedia) usedFiles.add(k.wikimedia);
    } catch (e) {}
  }
  for (const raw of seeds) {
    const seed = { ...raw, __batch: batch };
    // Defaults keep seeds short: the Wikipedia article is always the first
    // source (the authoritative one is discovered from its citations), and the
    // chosen title leads the editorial title list.
    if (!seed.kaynakca && seed.wiki) seed.kaynakca = [{ ad: "Wikipedia — " + seed.wiki.replace(/_/g, " "), url: "https://en.wikipedia.org/wiki/" + seed.wiki }];
    if (!seed.basliklar && seed.baslik) seed.basliklar = [seed.baslik];
    if (seed.basliklar && seed.baslik && !seed.basliklar.includes(seed.baslik)) seed.basliklar.unshift(seed.baslik);
    const row = { slug: seed.slug, errors: lint(seed), warnings: [] };
    const norm = (value) => String(value || "").toLowerCase().replace(/ /g, "_");
    const wikiKey = norm(seed.wiki);
    // Rebuilding a spec that this builder generated earlier (same slug) is allowed.
    const clash = library.find((item) => (item.slug === seed.slug && !item.fromSeed)
      || (item.wiki && norm(item.wiki) === wikiKey && item.slug !== seed.slug)
      || (item.ad && item.ad === String(seed.ad).toLowerCase() && item.slug !== seed.slug));
    if (clash) row.errors.push(`duplicate of existing topic ${clash.slug}`);
    if (seenSlugs.has(seed.slug) || seenWiki.has(wikiKey)) row.errors.push("duplicate inside batch");
    seenSlugs.add(seed.slug); seenWiki.add(wikiKey);
    if (!offline && !row.errors.length) {
      const art = await article(seed.wiki);
      if (!art) row.errors.push("Wikipedia article not found: " + seed.wiki);
      else {
        const articleNumbers = new Set(numbersIn(art.text));
        const factText = [seed.sahneler.join(" "), seed.sonuc, seed.tetik, seed.mekanizma, seed.sayi, seed.yanilgi, ...seed.zincir, ...(seed.zaman || []).map((z) => z.olay), seed.baslik, ...seed.basliklar, ...seed.kapak].join(" ");
        const extraNumbers = new Set([...(seed.dogrulanmisSayilar || [])]);
        const bad = numbersIn(factText).filter((n) => n !== seed.yil && !supported(n, articleNumbers) && !extraNumbers.has(n));
        if (bad.length) row.errors.push("numbers not found in Wikipedia article: " + [...new Set(bad)].join(", "));
        if (!articleNumbers.has(seed.yil)) row.warnings.push("year not in article text");
      }
      const cited = await citedOfficialLinks(seed.wiki);
      const citedSet = new Set(cited.map((item) => item.url.replace(/^http:/, "https:")));
      const verified = [];
      for (const source of seed.kaynakca) {
        if (citedSet.has(source.url.replace(/^http:/, "https:"))) { verified.push({ ...source, dogrulama: "cited-in-wikipedia" }); continue; }
        let r = await get(source.url, { head: true });
        if (r.status === 405 || r.status === 403 || r.status === 0) r = await get(source.url);
        if (!(r.status >= 200 && r.status < 400)) r = await get(source.url, { browser: true });
        if (r.status >= 200 && r.status < 400 && /<title>\s*(page not found|404|not found)/i.test(String(r.body || "").slice(0, 3000))) r = { status: 404 };
        if (r.status >= 200 && r.status < 400) verified.push({ ...source, dogrulama: "http-" + r.status });
        else row.warnings.push(`dropped unverifiable source ${source.url} (HTTP ${r.status})`);
      }
      // Guarantee at least one authoritative (non-Wikipedia) source: take the
      // best official report cited by the article itself.
      const official = verified.filter((source) => !/wikipedia\.org/.test(source.url));
      const strong = /NTSB|BEA|Chemical Safety|NASA|Nuclear Regulatory|IAEA|Health and Safety|Accidents Investigation|Marine Accident|Rail Accident|Transportation Safety|Transport Safety|Safety Investigation|Safety Board|Grenfell/;
      for (const item of cited) {
        if (official.length >= 1 || verified.length >= 3) break;
        if (item.rank === 0 && item.score < 2 && !strong.test(item.body)) continue;
        if (item.rank >= 4 && cited.some((x) => x.rank < 4)) continue;
        if (verified.some((source) => source.url === item.url)) continue;
        const name = `${item.body} — ${decodeURIComponent(item.url.split("/").filter(Boolean).pop() || item.url).replace(/\.(pdf|html?|aspx?)$/i, "").replace(/[-_]+/g, " ").slice(0, 70)} (cited by Wikipedia)`;
        verified.push({ ad: name, url: item.url, dogrulama: "cited-in-wikipedia" });
        official.push(item);
      }
      if (!verified.some((source) => /wikipedia\.org/.test(source.url))) row.errors.push("Wikipedia source missing");
      if (!official.length) row.errors.push("no verifiable authoritative source (none reachable, none cited officially)");
      seed.kaynakca = verified.map(({ ad, url }) => ({ ad, url }));
      row.sources = verified;
      row.stills = await commonsStills([seed.commons, seed.kisa, seed.wiki.replace(/_/g, " ").replace(/\(.*\)/, "")].flat(), 7, seed.wiki,
        { keywords: [seed.commons, seed.kisa].flat(), year: seed.yil, exclude: usedFiles, reject: seed.excludeStills, strict: seed.strictStills,
          phrases: [seed.kisa, seed.wiki.replace(/_/g, " ").replace(/\s*\(.*\)/, ""), ...[seed.commons].flat().filter((q) => q && !/^Category:/i.test(q))] });
      for (const still of row.stills) usedFiles.add(still.file);
      if (row.stills.length < 3) row.errors.push(`only ${row.stills.length} licence-clean archival still(s) on Commons (PD/CC0/CC BY)`);
      await sleep(250);
    }
    // The legacy title engine (title-engine.js) needs a 20+ candidate pool.
    if (!row.errors.length) {
      try {
        const pool = require(path.join(ROOT, "title-engine.js")).adaylar({ ...toSpec(seed, row.stills || []), slug: seed.slug }).length;
        if (pool < 20) row.errors.push(`legacy title pool ${pool} < 20 — add editorial titles (basliklar)`);
      } catch (e) { row.warnings.push("title pool check skipped: " + e.message); }
    }
    if (write && !row.errors.length) {
      fs.writeFileSync(path.join(TOPICS, seed.slug + ".json"), JSON.stringify(toSpec(seed, row.stills), null, 2) + "\n");
      row.written = true;
    }
    report.push(row);
    console.log(`${row.errors.length ? "✗" : "✓"} ${seed.slug}${row.errors.length ? " — " + row.errors.join(" | ") : ` (${(row.stills || []).length} stills)`}${row.warnings.length ? " [" + row.warnings.join("; ") + "]" : ""}`);
  }
  fs.writeFileSync(file.replace(/\.json$/, ".report.json"), JSON.stringify(report, null, 2) + "\n");
  const ok = report.filter((r) => !r.errors.length).length;
  console.log(`\n${ok}/${report.length} passed${write ? `, ${report.filter((r) => r.written).length} written` : " (dry run; add --write)"}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { numbersIn, spelledNumbers, supported, get, lint, toSpec, commonsStills, citedOfficialLinks, LICENCE_OK };
