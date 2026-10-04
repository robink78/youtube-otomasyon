#!/usr/bin/env node
"use strict";

// BEHIND THE ORDINARY — automated, evidence-first research of the question
// backlog. Turns a QUESTION_ONLY inventory record into a researched record
// ONLY when every claim survives the same checks as hand-researched records.
//
//   node scripts/bto-research.js [--limit 3] [--slug <question-slug>] [--write]
//
// Per question:
//   1. Wikipedia search → the best one or two articles; their plain text is
//      the only evidence the writer sees (relevant excerpt, not the web).
//   2. The article's own cited external links, filtered to primary hosts
//      (standards bodies, manufacturers, government, museums, universities)
//      and checked reachable, become the topic-level sources.
//   3. The configured long-form provider (Groq by default, see
//      core/llm/longform-provider.js) drafts a seed record from that excerpt:
//      facts must carry a verbatim quote; narration lines cite fact ids. It may
//      answer "not answerable" — the question then stays in the backlog.
//   4. Local checks: every narration line cites facts and shares content words
//      with them; then scripts/ib-ct-library/build.js run(): verbatim quotes
//      found in the source text, numbers traced, narration/hook/opening limits,
//      primary + reachable sources, channel quality gate. One repair round
//      feeds the errors back. Anything still failing is NOT written.
//
// Attempts are recorded in the channel state (research-attempts.json) so a
// failed question is not retried for 60 days. Without a configured provider
// the script exits 0 and changes nothing.

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const Channel = require(path.join(ROOT, "core", "channel-context"));
const Provider = require(path.join(ROOT, "core", "llm", "longform-provider"));
const Builder = require(path.join(ROOT, "scripts", "ib-ct-library", "build"));
const FR = require(path.join(ROOT, "scripts", "fr-library", "build"));

const SLUG = "behind-the-ordinary";
const RETRY_AFTER_DAYS = 60;
// Groq's free tier allows ~8,000 tokens per minute for openai/gpt-oss-120b
// and counts the requested completion budget too. Excerpts share one budget
// (~10,000 characters ≈ 2,500 tokens) and questions are spaced apart.
const EXCERPT_BUDGET_CHARS = Number(process.env.BTO_RESEARCH_EXCERPT_CHARS) || 10000;
const MAX_EXCERPT_CHARS = EXCERPT_BUDGET_CHARS;
const COMPLETION_TOKENS = Number(process.env.BTO_RESEARCH_MAX_TOKENS) || 3000;
const PAUSE_MS = process.env.BTO_RESEARCH_PAUSE_MS != null ? Number(process.env.BTO_RESEARCH_PAUSE_MS) : 65000;
const STOP = new Set(("that this with from were was have has had they them their there which what when where while would could should about into than then " +
  "also because these those every only just more most some such very been being over under after before other its it's your you are the and for but not " +
  "can get got has had all any one two how why who out use now new old yet way may did does let own off too")
  .split(/\s+/));

// Library authority records and catalogue entries are identifiers, not evidence.
const CATALOGUE = /id\.loc\.gov\/authorities|lux\.collections\.yale\.edu|viaf\.org|worldcat\.org|d-nb\.info|catalogue\.bnf\.fr|wikidata\.org/i;
const words = (text) => String(text || "").split(/\s+/).filter(Boolean);
const contentWords = (text) => [...new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
  .filter((word) => word.length >= 3 && !STOP.has(word)))];
const slugify = (value) => String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 86);
const sentences = (text) => String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);

function attemptsFile(channel) { return path.join(channel.paths.state, "research-attempts.json"); }
function readAttempts(channel) {
  try { return JSON.parse(fs.readFileSync(attemptsFile(channel), "utf8")); } catch (error) { return { channel: channel.slug, attempts: {} }; }
}
function writeAttempts(channel, data) {
  fs.mkdirSync(path.dirname(attemptsFile(channel)), { recursive: true });
  fs.writeFileSync(attemptsFile(channel), JSON.stringify({ ...data, channel: channel.slug }, null, 2) + "\n");
}

// Research priority among unresearched questions; questions attempted within
// RETRY_AFTER_DAYS are skipped. Real analytics later re-rank topic families.
function candidates(universe, attempts, { limit = 3, slug = null, now = new Date() } = {}) {
  const recent = (topic) => {
    const at = attempts.attempts && attempts.attempts[topic.slug] && attempts.attempts[topic.slug].at;
    return at && (now - new Date(at)) / 86400000 < RETRY_AFTER_DAYS;
  };
  const pool = universe.topics.filter((topic) => topic.researchStatus === "QUESTION_ONLY" && topic.productionReady !== true);
  if (slug) return pool.filter((topic) => topic.slug === slug);
  const priority = (topic) => (topic.curiosityScore || 0) + ((topic.visualPotential || {}).score || 0) + (topic.evergreenScore || 0) + ((topic.shortPotential || {}).score || 0);
  // One question per object per run keeps a batch varied.
  const seen = new Set();
  return pool.filter((topic) => !recent(topic)).sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id))
    .filter((topic) => (seen.has(topic.object) ? false : seen.add(topic.object))).slice(0, limit);
}

async function wikiJson(get, params) {
  const query = Object.entries({ format: "json", ...params }).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const response = await get(`https://en.wikipedia.org/w/api.php?${query}`, { json: true });
  return response && response.body;
}

// An article counts only when its title names the object (a singular or
// plural word of it) and it is not a list/timeline page. Unrelated search hits
// ("Windows 8" for airplane windows is still caught by the writer, which must
// then answer "not answerable") never contribute sources on their own.
function relevantTitle(title, object) {
  if (/^(list|lists|timeline|index|outline|glossary) of\b/i.test(title)) return false;
  // "barcodes" and "Barcode" must meet: drop a plural ending, then a final e.
  const stem = (word) => word.toLowerCase().replace(/(es|s)$/, "").replace(/e$/, "");
  const titleWords = String(title).split(/[\s(),-]+/).filter(Boolean);
  const own = new Set(titleWords.map(stem));
  const objectWords = words(String(object).replace(/^the\s+/i, "")).map(stem).filter((word) => word.length >= 3);
  const hits = objectWords.filter((word) => own.has(word)).length;
  // A two-word object needs both words unless the title is one matching word
  // ("QWERTY" for QWERTY keyboards): "Windows 8" is not about airplane windows.
  return hits >= Math.min(2, objectWords.length) || (titleWords.length === 1 && hits === 1);
}

// The object's own article first ("barcodes" → Barcode, "QWERTY keyboards" →
// QWERTY keyboard → redirect QWERTY), then search hits for object + detail.
function directTitles(object) {
  const base = String(object).replace(/^the\s+/i, "").trim();
  const singular = base.replace(/(ch|sh|x|ss)es$/i, "$1").replace(/ies$/i, "y").replace(/([^s])s$/i, "$1");
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  return [...new Set([cap(singular), cap(base)])];
}

async function articles(topic, get) {
  const search = await wikiJson(get, { action: "query", list: "search", srsearch: `${topic.object} ${topic.designDetail}`, srlimit: 5 });
  const hits = ((search && search.query && search.query.search) || []).map((hit) => hit.title).filter((title) => relevantTitle(title, topic.object));
  const titles = [...new Set([...directTitles(topic.object), ...hits])].slice(0, 4);
  const out = [];
  for (const title of titles) {
    const data = await wikiJson(get, { action: "query", prop: "extracts", explaintext: 1, redirects: 1, titles: title });
    const page = data && data.query && Object.values(data.query.pages || {})[0];
    // A direct title can redirect to a disambiguation or unrelated page; the
    // resolved title must still name the object.
    if (page && page.extract && page.extract.length > 500 && relevantTitle(page.title, topic.object) && !out.some((doc) => doc.title === page.title) && !/may refer to/i.test(page.extract.slice(0, 300))) {
      out.push({ title: page.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, text: page.extract });
    }
    if (out.length >= 2) break;
  }
  return out;
}

// The article's own cited links on primary hosts — never a web search result.
async function primaryLinks(title, get, hosts = Builder.BTO_PRIMARY_HOSTS) {
  const data = await wikiJson(get, { action: "query", prop: "extlinks", ellimit: 500, titles: title });
  const page = data && data.query && Object.values(data.query.pages || {})[0];
  const links = ((page && page.extlinks) || []).map((item) => item["*"] || item.url).filter((url) => /^https?:\/\//.test(url || ""));
  return [...new Set(links.map((url) => url.replace(/^http:\/\//, "https://")).filter((url) => {
    try {
      const parsed = new URL(url);
      return Builder.hostAllowed(parsed.hostname, hosts) && parsed.pathname.length > 1 && !/\.pdf($|\?)/i.test(url) && !CATALOGUE.test(url);
    } catch (error) { return false; }
  }))];
}

// Cited links rot; keep the ones that still answer (same probe as the
// builder: HEAD, then a browser-like GET), at most `want` of them.
async function reachableLinks(links, get, want = 3, maxProbes = 12) {
  const out = [];
  for (const url of links.slice(0, maxProbes)) {
    if (out.length >= want) break;
    let response = await get(url, { head: true }).catch(() => null);
    if (!(response && response.status >= 200 && response.status < 400)) response = await get(url, { browser: true }).catch(() => null);
    if (response && response.status >= 200 && response.status < 400) out.push(url);
  }
  return out;
}

// Sentences around the object/detail keywords, so the writer sees the
// relevant evidence within the token budget.
function excerpt(text, keywords, maxChars = MAX_EXCERPT_CHARS) {
  const list = sentences(String(text).replace(/\n+/g, " "));
  const keys = keywords.map((key) => key.toLowerCase()).filter((key) => key.length >= 4);
  const keep = new Set();
  list.forEach((sentence, index) => {
    if (keys.some((key) => sentence.toLowerCase().includes(key))) for (const i of [index - 1, index, index + 1]) if (i >= 0 && i < list.length) keep.add(i);
  });
  const chosen = keep.size ? [...keep].sort((a, b) => a - b).map((i) => list[i]) : list;
  let out = "";
  for (const sentence of chosen) { if (out.length + sentence.length > maxChars) break; out += sentence + " "; }
  return out.trim();
}

const SYSTEM = [
  "You research one question for The Hidden Logic of Things, a channel explaining the documented reason behind one ordinary object or design detail.",
  "Use ONLY the supplied source excerpts. Never use outside knowledge. If the excerpts do not clearly answer the question, return {\"answerable\":false,\"reason\":\"...\"}.",
  "Every fact needs a quote copied EXACTLY, character for character, from its source excerpt (at least 6 consecutive words), and the sourceId it came from.",
  "Narration: 5 to 8 short spoken lines, 55 to 90 words in total, no sentence longer than 16 words, plain English, curious and precise, no filler, no 'Did you know'.",
  "Line 1 is the hook and openingLine: at most 9 words, a surprising visual statement. Lines 1 and 2 together: at most 18 words. The last line is the specific payoff.",
  "Every narration line lists the fact ids it is based on and must not add any detail that is not in those facts. Only use numbers that appear in a cited fact.",
  "thumbnailText: 1 to 3 words, capital letters, no apostrophes. Titles must be accurate and supported by the facts.",
  "Return JSON only: {\"answerable\":true,\"title\":\"...\",\"coreQuestion\":\"...?\",\"openingLine\":\"...\",\"secondBeat\":\"...\",\"mechanism\":\"...\",\"expectedConsequence\":\"...\",\"payoff\":\"...\",\"misconception\":\"...\",",
  "\"thumbnailText\":\"...\",\"editorialTitles\":[10 distinct accurate titles, each using only words supported by the facts],\"visualScenes\":[5 short shot descriptions],",
  "\"facts\":[{\"id\":\"F1\",\"role\":\"origin|context|problem|explanation|surprising-detail|consequence|payoff\",\"claim\":\"...\",\"quote\":\"exact words\",\"sourceId\":\"S1\"}],",
  "\"narration\":[{\"role\":\"VISUAL_MYSTERY|CLEAR_PROMISE|ORIGIN|EXPLANATION|SURPRISING_DETAIL|CONSEQUENCE|PAYOFF\",\"text\":\"...\",\"facts\":[\"F1\"]}]}",
].join("\n");

// A narration line must cite facts and share at least two content words with
// them — a cheap guard against a line drifting away from its evidence.
function narrationSupport(narration, facts) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const errors = [];
  narration.forEach((line, index) => {
    const cited = (line.facts || []).map((id) => byId.get(id)).filter(Boolean);
    if (!cited.length) { errors.push(`narration line ${index + 1} cites no fact`); return; }
    const evidence = new Set(contentWords(cited.map((fact) => `${fact.claim} ${fact.quote}`).join(" ")));
    const own = contentWords(line.text);
    const shared = own.filter((word) => evidence.has(word) || evidence.has(word.replace(/s$/, "")) || evidence.has(word + "s"));
    // The two hook lines are short and rhetorical: one shared word suffices.
    if (own.length >= 3 && shared.length < (index < 2 ? 1 : 2)) errors.push(`narration line ${index + 1} is not supported by its cited facts`);
  });
  return errors;
}

function toSeedRecord(topic, draft, sources) {
  if (!draft || draft.answerable !== true) return { skip: (draft && draft.reason) || "provider returned no answer" };
  const sourceById = new Map(sources.map((source, index) => [`S${index + 1}`, source]));
  const facts = (Array.isArray(draft.facts) ? draft.facts : []).filter((fact) => sourceById.has(fact.sourceId) && fact.claim && fact.quote);
  const narration = (Array.isArray(draft.narration) ? draft.narration : []).filter((line) => line && line.text).map((line) => ({
    role: String(line.role || "EXPLANATION").toUpperCase(), layer: "VERIFIED FACT", text: String(line.text).trim(), facts: Array.isArray(line.facts) ? line.facts : [],
  }));
  const supportErrors = narrationSupport(narration, facts);
  const cited = [...new Set(facts.map((fact) => fact.sourceId))].map((id) => sourceById.get(id));
  const links = [...new Set(cited.flatMap((source) => source.links || []))];
  if (links.length < 2) supportErrors.push("the cited articles have fewer than 2 reachable primary references");
  const opening = narration[0] ? narration[0].text : String(draft.openingLine || "");
  const title = String(draft.title || "").trim();
  const record = {
    replaces: topic.slug,
    slug: slugify(title || topic.slug),
    category: topic.category,
    topic: title, title,
    coreQuestion: String(draft.coreQuestion || topic.coreQuestion).trim(),
    hook: opening, openingLine: opening,
    secondBeat: narration[1] ? narration[1].text : String(draft.secondBeat || ""),
    mechanism: String(draft.mechanism || "").replace(/\.$/, ""),
    expectedConsequence: String(draft.expectedConsequence || "").replace(/\.$/, ""),
    misconception: draft.misconception || undefined,
    payoff: draft.payoff || (narration[narration.length - 1] || {}).text,
    thumbnailText: String(draft.thumbnailText || "").toUpperCase().replace(/['\\]/g, "").trim(),
    // Ten fact-worded titles: the template titles alone can fall under the
    // 20 truthful candidates the package gate requires.
    editorialTitles: [...new Set((Array.isArray(draft.editorialTitles) ? draft.editorialTitles : [title]).map(String))].slice(0, 10),
    visualScenes: (Array.isArray(draft.visualScenes) ? draft.visualScenes : []).map(String).slice(0, 5),
    narration: narration.map(({ facts: cited, ...line }) => ({ ...line, factIds: cited })),
    facts: facts.map((fact) => ({ role: fact.role || "evidence", layer: "VERIFIED FACT", claim: String(fact.claim).trim(), quote: String(fact.quote).trim(),
      source: `Wikipedia — ${sourceById.get(fact.sourceId).title}`, url: sourceById.get(fact.sourceId).url, factId: fact.id })),
    sources: links.slice(0, 3).map((url) => ({ name: new URL(url).hostname.replace(/^www\./, ""), url, type: "primary source cited by the Wikipedia article" })),
    researchMethod: "automated: provider draft from Wikipedia text; verbatim quotes, numbers and sources verified by scripts/ib-ct-library/build.js",
  };
  if (!record.visualScenes.length) delete record.visualScenes;
  return { record, supportErrors };
}

async function researchOne(topic, deps) {
  const docs = await articles(topic, deps.get);
  if (!docs.length) return { status: "NO_SOURCE", reason: "no Wikipedia article found" };
  // Each article keeps its own reachable primary references; a record cites
  // only the references of the articles its facts actually quote.
  // Links whose address names the object or detail are probed first.
  const hints = contentWords(`${topic.object} ${topic.designDetail}`).map((word) => word.replace(/(es|s)$/, "")).filter((word) => word.length >= 4);
  const relevance = (url) => hints.filter((word) => url.toLowerCase().includes(word)).length;
  for (const doc of docs) {
    const links = (await primaryLinks(doc.title, deps.get)).map((url, index) => ({ url, index })).sort((a, b) => relevance(b.url) - relevance(a.url) || a.index - b.index).map((item) => item.url);
    doc.links = await reachableLinks(links, deps.get);
  }
  if (!docs.some((doc) => doc.links.length >= 2) && docs.reduce((sum, doc) => sum + doc.links.length, 0) < 2) {
    return { status: "NO_PRIMARY_SOURCE", reason: `fewer than 2 reachable primary-host references cited by ${docs.map((doc) => doc.title).join(", ")}` };
  }
  const keys = [...words(topic.object), ...words(topic.designDetail)];
  // An article that never mentions the design detail cannot answer the question.
  const detailWords = contentWords(topic.designDetail).map((word) => word.replace(/(es|s)$/, "")).filter((word) => word.length >= 4);
  const mentionsDetail = (doc) => !detailWords.length || detailWords.some((word) => doc.text.toLowerCase().includes(word));
  const relevant = docs.filter(mentionsDetail);
  const share = Math.floor(EXCERPT_BUDGET_CHARS / Math.max(1, relevant.length));
  const sources = relevant.map((doc) => ({ title: doc.title, url: doc.url, text: excerpt(doc.text, keys, share), links: doc.links }));
  if (!sources.length) return { status: "NO_SOURCE", reason: `no article mentions "${topic.designDetail}"` };
  const user = { question: topic.coreQuestion, object: topic.object, designDetail: topic.designDetail, pillar: topic.category,
    sources: sources.map((source, index) => ({ id: `S${index + 1}`, title: source.title, excerpt: source.text })) };
  let feedback = null;
  for (let round = 0; round < 2; round += 1) {
    const response = await deps.generate({ stage: "bto-research", maxTokens: COMPLETION_TOKENS, system: SYSTEM,
      user: JSON.stringify(feedback ? { ...user, previous_errors: feedback } : user) });
    const built = toSeedRecord(topic, response.json, sources);
    if (built.skip) return { status: "NOT_ANSWERABLE", reason: String(built.skip).slice(0, 200) };
    const result = built.supportErrors.length ? { report: [{ slug: built.record.slug, errors: built.supportErrors }] }
      : await deps.verify({ channel: SLUG, records: [built.record] });
    const row = result.report[0];
    if (!row.errors.length) return { status: "VERIFIED", record: built.record, slug: built.record.slug };
    feedback = row.errors.slice(0, 12);
    if (round === 1) return { status: "FAILED_CHECKS", reason: feedback.slice(0, 4).join("; ") };
  }
  return { status: "FAILED_CHECKS" };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const channel = Channel.getChannel(SLUG);
  const valueAfter = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : null; };
  const write = argv.includes("--write");
  if (!deps.generate && !Provider.available()) {
    console.log("The Hidden Logic of Things research: no long-form provider configured (LONGFORM_LLM_PROVIDER + its key); nothing to do.");
    return { skipped: true };
  }
  const universePath = channel.paths.topicUniverse;
  const universe = JSON.parse(fs.readFileSync(universePath, "utf8"));
  const attempts = readAttempts(channel);
  const list = candidates(universe, attempts, { limit: Number(valueAfter("--limit")) || 3, slug: valueAfter("--slug") });
  const get = deps.get || FR.get;
  const generate = deps.generate || ((input) => Provider.generateJson(input));
  const verify = deps.verify || ((seed) => Builder.run(seed, { write: false, log: () => {} }));
  const outcomes = [];
  for (const [index, topic] of list.entries()) {
    // Space provider calls so one run stays inside the per-minute token limit.
    if (index > 0 && PAUSE_MS > 0 && !deps.generate) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    let outcome;
    try { outcome = await researchOne(topic, { get, generate, verify }); }
    catch (error) {
      // A provider rate limit or outage defers the batch; attempts are not
      // recorded, so the same questions are tried on the next run.
      if (error instanceof Provider.LongformProviderError && error.defer) {
        console.log(`provider deferred (${error.code}${error.status ? ` HTTP ${error.status}` : ""}${error.retryAfterMs ? `, retry after ${Math.round(error.retryAfterMs / 1000)}s` : ""}); stopping this batch`);
        break;
      }
      outcome = { status: "ERROR", reason: String(error.code || error.message).slice(0, 200) };
    }
    outcomes.push({ question: topic.slug, ...outcome });
    console.log(`${outcome.status === "VERIFIED" ? "✓" : "✗"} ${topic.slug}: ${outcome.status}${outcome.reason ? " — " + outcome.reason : ""}`);
    attempts.attempts[topic.slug] = { at: new Date().toISOString(), status: outcome.status, reason: outcome.reason || null, slug: outcome.slug || null };
  }
  const verified = outcomes.filter((item) => item.status === "VERIFIED");
  if (write && verified.length) {
    const seed = { channel: SLUG, note: "Automated research batch (scripts/bto-research.js).", records: verified.map((item) => item.record) };
    const result = await Builder.run(seed, { write: true });
    const file = path.join(ROOT, "channels", SLUG, "topics", "research-seeds", `auto-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
    console.log(`written: ${result.changed} researched record(s); seed kept at ${path.relative(ROOT, file)}`);
  }
  if (write) writeAttempts(channel, attempts);
  return { outcomes, verified: verified.length };
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { relevantTitle, directTitles, articles, candidates, excerpt, primaryLinks, reachableLinks, narrationSupport, toSeedRecord, researchOne, main, SYSTEM, RETRY_AFTER_DAYS };
