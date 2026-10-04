"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Research = require("../../scripts/bto-research");
const Provider = require("../../core/llm/longform-provider");

const topic = (id, object, detail, extra = {}) => ({ id, slug: `${object}-${detail}`.replace(/\s+/g, "-"), object, designDetail: detail, category: "HIDDEN ENGINEERING",
  coreQuestion: `${object}: what explains ${detail}?`, researchStatus: "QUESTION_ONLY", productionReady: false, curiosityScore: 90, evergreenScore: 90,
  visualPotential: { score: 90 }, shortPotential: { score: 90 }, ...extra });

test("research candidates: question-only, one per object, recently failed questions wait 60 days", () => {
  const universe = { topics: [topic("BTO-1", "zippers", "teeth"), topic("BTO-2", "zippers", "sliders"), topic("BTO-3", "keys", "teeth"),
    topic("BTO-4", "bridges", "gaps", { researchStatus: "VERIFIED", productionReady: true })] };
  const now = new Date("2026-10-03T00:00:00Z");
  assert.deepEqual(Research.candidates(universe, { attempts: {} }, { limit: 5, now }).map((item) => item.id), ["BTO-1", "BTO-3"]);
  const attempts = { attempts: { "zippers-teeth": { at: "2026-09-20T00:00:00Z", status: "NOT_ANSWERABLE" } } };
  assert.deepEqual(Research.candidates(universe, attempts, { limit: 5, now }).map((item) => item.id), ["BTO-2", "BTO-3"]);
  assert.deepEqual(Research.candidates(universe, attempts, { limit: 5, now: new Date("2026-12-01T00:00:00Z") }).map((item) => item.id), ["BTO-1", "BTO-3"]);
});

test("only articles named after the object count as evidence", () => {
  assert.equal(Research.relevantTitle("Bicycle helmet", "bicycle helmets"), true);
  assert.equal(Research.relevantTitle("List of films in the Criterion Collection", "bicycle helmets"), false);
  assert.equal(Research.relevantTitle("Fallingwater", "office chairs"), false);
  assert.equal(Research.relevantTitle("Ampersand", "the ampersand"), true);
  assert.equal(Research.relevantTitle("Barcode", "barcodes"), true);
  assert.equal(Research.relevantTitle("Windows 8", "airplane windows"), false, "one shared word is not enough for a two-word object");
  assert.equal(Research.relevantTitle("QWERTY", "QWERTY keyboards"), true);
  assert.equal(Research.relevantTitle("Road surface marking", "road markings"), true);
});

test("the object's own article is tried first", () => {
  assert.deepEqual(Research.directTitles("barcodes"), ["Barcode", "Barcodes"]);
  assert.deepEqual(Research.directTitles("QWERTY keyboards"), ["QWERTY keyboard", "QWERTY keyboards"]);
  assert.deepEqual(Research.directTitles("the ampersand"), ["Ampersand"]);
  assert.deepEqual(Research.directTitles("road reflectors"), ["Road reflector", "Road reflectors"]);
});

test("narration lines must cite facts and share their content", () => {
  const facts = [{ id: "F1", claim: "Comb plates minimize the gap between stairs and landing.", quote: "help to minimize the gap between the stairs and landing" }];
  assert.deepEqual(Research.narrationSupport([{ text: "Combs close the gap.", facts: ["F1"] }, { text: "x", facts: ["F1"] }, { text: "The comb plates minimize the landing gap.", facts: ["F1"] }], facts), []);
  const errors = Research.narrationSupport([{ text: "Hook.", facts: ["F1"] }, { text: "Promise.", facts: ["F1"] }, { text: "Engineers painted them yellow in Paris.", facts: ["F1"] }, { text: "Uncited line here.", facts: [] }], facts);
  assert.match(errors.join(" "), /line 3 is not supported/);
  assert.match(errors.join(" "), /line 4 cites no fact/);
});

test("a draft becomes a seed record citing only the references of articles its facts quote", () => {
  const sources = [{ title: "Zipper", url: "https://en.wikipedia.org/wiki/Zipper", links: ["https://a.edu/1", "https://b.gov/2"] },
    { title: "Button", url: "https://en.wikipedia.org/wiki/Button", links: ["https://c.edu/3"] }];
  const draft = { answerable: true, title: "Why Zippers Lock", coreQuestion: "Why do zippers lock?", thumbnailText: "IT'S A LOCK",
    facts: [{ id: "F1", claim: "Zipper sliders can lock.", quote: "the slider can lock in place", sourceId: "S1" }],
    narration: [{ role: "visual_mystery", text: "Zipper sliders lock in place.", facts: ["F1"] }] };
  const { record, supportErrors } = Research.toSeedRecord(topic("BTO-9", "zippers", "locking sliders"), draft, sources);
  assert.deepEqual(record.sources.map((item) => item.url), ["https://a.edu/1", "https://b.gov/2"], "Button's reference is not cited");
  assert.equal(record.replaces, "zippers-locking-sliders");
  assert.equal(record.thumbnailText, "ITS A LOCK", "apostrophes break the ffmpeg drawtext filter");
  assert.equal(record.facts[0].source, "Wikipedia — Zipper");
  assert.equal(record.narration[0].role, "VISUAL_MYSTERY");
  assert.deepEqual(supportErrors, []);
  assert.deepEqual(Research.toSeedRecord(topic("BTO-9", "zippers", "x"), { answerable: false, reason: "excerpt does not say" }, sources), { skip: "excerpt does not say" });
});

test("without a configured provider the research job changes nothing", async () => {
  const saved = process.env.LONGFORM_LLM_PROVIDER;
  delete process.env.LONGFORM_LLM_PROVIDER;
  try { assert.deepEqual(await Research.main([]), { skipped: true }); }
  finally { if (saved !== undefined) process.env.LONGFORM_LLM_PROVIDER = saved; }
});

test("a provider rate limit defers the batch without recording attempts", async () => {
  const get = async (url) => {
    if (/list=search/.test(url)) return { status: 200, body: { query: { search: [{ title: "Zipper" }] } } };
    if (/prop=extracts/.test(url)) return { status: 200, body: { query: { pages: { 1: { title: "Zipper", extract: "A zipper slider locks the teeth. ".repeat(40) } } } } };
    if (/prop=extlinks/.test(url)) return { status: 200, body: { query: { pages: { 1: { extlinks: [{ "*": "https://www.nist.gov/zip" }, { "*": "https://mit.edu/zip" }] } } } } };
    return { status: 200, body: "" };
  };
  const generate = async () => { throw new Provider.LongformProviderError("RATE_LIMIT", "limited", { provider: "groq", defer: true, retryable: true }); };
  const result = await Research.main(["--slug", "zippers-what-explains-locking-sliders"], { get, generate, verify: async () => ({ report: [{ errors: [] }] }) });
  assert.deepEqual(result.outcomes, [], "no attempt recorded, so the question is retried next run");
});
