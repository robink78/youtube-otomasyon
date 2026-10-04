"use strict";

// One normalized topic model for all channels. Channel inventories keep their
// native shape (Failure Reconstructed case files, ImpossibleBrief what-if
// records, CriticalThread dependency records); the growth engine only reads
// this projection. Every field is copied from the source record — nothing is
// invented, so hooks/titles/scripts built from it stay traceable.

const fs = require("fs");
const Popularity = require("./popularity");
const Overrides = require("../topic-overrides");
const path = require("path");
const M = require("../../lib/metin");

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const firstSentence = (value) => clean(value).split(/(?<=[.!?])\s+/)[0] || "";
const stripEnd = (value) => clean(value).replace(/[.?!:;,]+$/, "");
const capital = (value) => { const text = clean(value); return text.charAt(0).toUpperCase() + text.slice(1); };
const lower = (value) => { const text = clean(value); return /^[A-Z]{2,}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1); };

function numbersIn(text) {
  return (String(text || "").match(/\d[\d,.]*(?:\s?(?:%|percent|mph|km\/h|nm|km|kg|kV|V|tons?|seconds?|minutes?|hours?|days?|years?|miles?|feet|°C|degrees|million|billion|thousand|m\b))?/gi) || [])
    .map((value) => value.replace(/[.,]$/, "").trim());
}

function sourceList(list) {
  return (Array.isArray(list) ? list : []).map((source) => ({
    name: clean(source.name || source.ad || source.title || ""),
    url: clean(source.url || ""),
    type: clean(source.type || source.tur || ""),
  })).filter((source) => source.url || source.name);
}

function fromFailureReconstructed(raw, slug) {
  const v = raw.vaka || {};
  const scenes = Array.isArray(raw.sahneler) ? raw.sahneler : [];
  const narration = scenes.map((scene) => clean(scene.metin)).filter(Boolean);
  const archival = (raw.kaynaklar || []).some((item) => item.wikimedia || item.archive);
  const archivalFilm = (raw.kaynaklar || []).some((item) => /\.(ogv|webm|mp4|mpg|mov)$/i.test(item.wikimedia || "") || item.archive);
  const facts = [];
  const pushFact = (layer, claim, source) => { if (clean(claim)) facts.push({ layer, claim: clean(claim), source: source || "case file" }); };
  pushFact("CONFIRMED FACT", v.ad && v.sonuc ? `${v.ad} ${v.sonuc}` : "");
  pushFact("CONFIRMED FACT", v.tetik);
  pushFact("CONFIRMED FACT", v.mekanizma);
  pushFact("CONFIRMED FACT", v.sayi);
  pushFact("INTERPRETATION", v.ders);
  pushFact("CONFIRMED FACT", v.yanilgi);
  for (const step of v.zincir || []) pushFact("CONFIRMED FACT", step);
  for (const moment of v.zaman || []) pushFact("CONFIRMED FACT", `${moment.t}: ${moment.olay}`);
  for (const line of narration) pushFact("CONFIRMED FACT", line, "editorial narration");
  const subject = clean(v.kisa || v.ad || raw.baslik || slug);
  return {
    channel: "failure-reconstructed",
    id: slug,
    slug,
    kind: v.tip === "vaka" ? "case" : "mechanism",
    title: clean(raw.baslik),
    subject,
    object: clean(v.nesne),
    year: v.yil || null,
    cluster: clean(v.kume || (raw.tur === "stok" ? "mechanism-explainers" : "uncategorized")),
    category: clean(v.kume),
    question: clean(raw.soru),
    hookText: clean(raw.hook),
    openingLine: narration[0] || "",
    secondBeat: narration[1] || "",
    consequence: v.ad && v.sonuc ? `${capital(v.ad)} ${stripEnd(v.sonuc)}` : "",
    result: stripEnd(v.sonuc),
    trigger: stripEnd(v.tetik),
    mechanism: stripEnd(v.mekanizma),
    number: clean(v.sayi),
    lesson: stripEnd(v.ders),
    misconception: clean(v.yanilgi),
    debate: clean(v.tartisma),
    chain: (v.zincir || []).map(clean),
    timeline: (v.zaman || []).map((item) => ({ t: clean(item.t), event: clean(item.olay) })),
    warning: [v.yanilgi, v.tartisma, ...(v.zincir || []), ...narration].map(clean).find((text) => /\bwarn|ignored|knew|complain|report(ed)? (cracks|leaks)|alarm/i.test(text)) || "",
    dependency: "",
    bottleneck: "",
    resilience: "",
    scenario: "",
    sources: sourceList(v.kaynakca),
    footageSources: (raw.kaynaklar || []).map((item) => item.wikimedia || item.archive || item.ad).filter(Boolean),
    evidence: facts,
    visualScenes: scenes.map((scene) => ({ text: clean(scene.metin), source: scene.kaynak || null, start: scene.baslangic == null ? null : scene.baslangic, synthetic: !!scene.sentetik })),
    narration,
    editorialTitles: (v.basliklar || []).map(clean),
    thumbnailTexts: (v.kapak || []).map(clean),
    archival,
    archivalFilm,
    stock: raw.tur === "stok",
    signals: {
      priority: Number.isFinite(+raw.oncelik) ? +raw.oncelik * 10 : null,
      curiosity: null, visual: null, sourceQuality: null, evergreen: null, shortPotential: null, longPotential: null,
      criticality: null, hookPotential: null, novelty: null, channelFit: null, audienceFit: null, searchDemand: null, depth: null,
    },
    format: raw.format === "long" || raw.aspect === "16:9" ? "long" : "short",
    raw,
  };
}

const IB_VERB = /\s(?:suddenly\s|gradually\s|exactly\s)?(vanish\w*|became|become\w*|moved|move\w*|was|were|is|changed|change\w*|doubl\w*|halv\w*|fell|reverse\w*|stopp?\w*|lost|had|disappear\w*|turn\w*|grew|shr\w*|froze|increas\w*|decreas\w*|rose|got|went|began|spun|collid\w*|explod\w*|expand\w*|cool\w*|heat\w*|replaced|split|merged|appeared|lasted|kept|ran|could|would)\b/i;

function impossibleSubject(raw) {
  const scenario = clean(raw.scenarioChange);
  const head = scenario.split(IB_VERB)[0];
  if (head && head.split(/\s+/).length <= 6) return head;
  return clean(raw.topic).replace(/^what if\s+/i, "").replace(/\?$/, "");
}

function impossibleEvent(raw) {
  const title = clean(raw.topic).replace(/\?$/, "");
  const match = title.match(/\bif\s+(.+)$/i);
  if (match) return match[1].replace(/,\s*(what|when|how|would|could).*$/i, "").trim();
  return title;
}

// Researched (editorial) records carry their own narration and sourced facts.
// Templated records have neither and fall back to the assembled script.
function editorialBeats(raw) {
  return (raw.narration || []).map((item) => typeof item === "string" ? { text: clean(item), layer: null, role: null } : { text: clean(item.text), layer: item.layer || null, role: item.role || null }).filter((item) => item.text);
}

function factEvidence(raw) {
  return (raw.facts || []).map((fact) => ({ layer: fact.layer || "VERIFIED FACT", confidence: fact.layer || "VERIFIED FACT", claim: clean(fact.claim), source: clean(fact.source), url: fact.url || null, role: fact.role || null }));
}

function fromImpossibleBrief(raw) {
  const subject = impossibleSubject(raw);
  const handcrafted = clean(raw.hook);
  return {
    channel: "impossible-brief",
    id: raw.id,
    slug: raw.slug,
    kind: "scenario",
    title: clean(raw.topic),
    subject,
    object: "",
    year: null,
    cluster: clean(raw.cluster || raw.category),
    category: clean(raw.category),
    question: clean(raw.topic),
    hookText: handcrafted,
    openingLine: clean(raw.openingLine),
    secondBeat: clean(raw.secondBeat),
    consequence: stripEnd(raw.expectedConsequence),
    result: stripEnd(raw.expectedConsequence),
    trigger: stripEnd(raw.scenarioChange),
    mechanism: stripEnd(raw.scientificMechanism),
    number: clean(raw.number) || numbersIn(handcrafted)[0] || "",
    lesson: clean(raw.payoff || ""),
    misconception: clean(raw.misconception) || (/\bnot\b|\bisn'?t\b|\bwouldn'?t\b/i.test(handcrafted) ? handcrafted.split(/(?<=[.!?])\s+/).find((s) => /\bnot\b|n'?t\b/i.test(s)) || "" : ""),
    debate: clean(raw.debate || ""),
    chain: [],
    timeline: [],
    warning: "",
    dependency: "",
    bottleneck: "",
    resilience: "",
    scenario: stripEnd(raw.scenarioChange),
    event: impossibleEvent(raw),
    coreQuestion: clean(raw.coreQuestion),
    sources: sourceList(raw.sources),
    footageSources: [],
    evidence: factEvidence(raw).concat((raw.claimFramework || []).map((claim) => ({ layer: claim.layer, confidence: claim.confidence, claim: clean(claim.claim || claim.rule), source: (raw.sources || [])[0] && raw.sources[0].name || "" })))
      .concat(handcrafted ? handcrafted.split(/(?<=[.!?])\s+/).map((sentence) => ({ layer: "ESTIMATED CONSEQUENCE", confidence: "SUPPORTED", claim: clean(sentence), source: "editorial brief" })) : []),
    visualScenes: ((raw.visualPotential || {}).scenes || []).map((text) => ({ text: clean(text), source: null, start: null, synthetic: true })),
    narration: editorialBeats(raw).map((beat) => beat.text),
    narrationBeats: editorialBeats(raw),
    editorialTitles: (raw.editorialTitles || []).map(clean),
    thumbnailTexts: raw.thumbnailText ? [clean(raw.thumbnailText)] : [],
    archival: false,
    archivalFilm: false,
    stock: false,
    signals: {
      priority: null,
      curiosity: raw.curiosityScore, visual: (raw.visualPotential || {}).score, sourceQuality: (raw.sourceQuality || {}).score,
      evergreen: raw.evergreenScore, shortPotential: (raw.shortPotential || {}).score, longPotential: (raw.longFormPotential || {}).score,
      criticality: null, hookPotential: null, novelty: (raw.quality || {}).distinctiveness, channelFit: (raw.quality || {}).channelFit,
      audienceFit: (raw.quality || {}).channelFit, searchDemand: null, depth: (raw.quality || {}).scienceDepth,
    },
    format: "short",
    raw,
  };
}

function fromCriticalThread(raw) {
  const dependencyTarget = clean(String(raw.dependency || "").replace(/^.*?\bsupports\s+/i, "").replace(/\.$/, ""));
  return {
    channel: "critical-thread",
    id: raw.id,
    slug: raw.slug,
    kind: "system",
    title: clean(raw.topic),
    subject: clean(raw.canonicalTopic),
    object: clean(raw.canonicalTopic),
    year: null,
    cluster: clean(raw.cluster || raw.category),
    category: clean(raw.category),
    question: clean(raw.coreQuestion),
    hookText: "",
    openingLine: clean(raw.openingLine),
    secondBeat: clean(raw.secondBeat),
    consequence: stripEnd(firstSentence(raw.failureConsequence)),
    result: stripEnd(raw.expectedConsequence),
    trigger: "",
    mechanism: stripEnd(raw.mechanism),
    number: clean(raw.number) || numbersIn((raw.researchEvidence || []).map((item) => item.claim).join(" "))[0] || "",
    lesson: stripEnd(raw.resilience),
    misconception: clean(raw.misconception || ""),
    debate: clean(raw.debate || ""),
    chain: [],
    timeline: [],
    warning: "",
    dependency: stripEnd(raw.dependency),
    dependencyTarget,
    bottleneck: stripEnd(raw.bottleneck),
    resilience: stripEnd(raw.resilience),
    scenario: "",
    sources: sourceList(raw.sources),
    footageSources: [],
    evidence: factEvidence(raw).concat((raw.researchEvidence || []).filter((item) => !(raw.facts || []).some((fact) => clean(fact.claim) === clean(item.claim))).map((item) => ({ layer: item.layer, confidence: item.layer, claim: clean(item.claim), source: clean(item.source) }))),
    visualScenes: ((raw.visualPotential || {}).scenes || []).map((text) => ({ text: clean(text), source: null, start: null, synthetic: true })),
    narration: editorialBeats(raw).map((beat) => beat.text),
    narrationBeats: editorialBeats(raw),
    editorialTitles: [clean(raw.topic), ...(raw.editorialTitles || []).map(clean)],
    thumbnailTexts: raw.thumbnailText ? [clean(raw.thumbnailText)] : [],
    archival: false,
    archivalFilm: false,
    stock: false,
    signals: {
      priority: null,
      curiosity: raw.curiosityScore, visual: (raw.visualPotential || {}).score, sourceQuality: (raw.sourceAvailability || {}).score,
      evergreen: raw.evergreenScore, shortPotential: (raw.shortPotential || {}).score, longPotential: (raw.longFormPotential || {}).score,
      criticality: (raw.criticality || {}).score, hookPotential: (raw.hookPotential || {}).score, novelty: (raw.novelty || {}).score,
      channelFit: (raw.quality || {}).channelFit, audienceFit: (raw.audienceFit || {}).score, searchDemand: (raw.searchDemand || {}).score, depth: null,
    },
    format: "short",
    raw,
  };
}

function fromHiddenLogicOfThings(raw) {
  const beats = editorialBeats(raw);
  return {
    channel: "behind-the-ordinary",
    id: raw.id,
    slug: raw.slug,
    kind: "everyday-design",
    title: clean(raw.topic || raw.title),
    subject: clean(raw.canonicalTopic || raw.object),
    object: clean(raw.object || raw.canonicalTopic),
    year: null,
    cluster: clean(raw.category),
    category: clean(raw.category),
    question: clean(raw.coreQuestion),
    coreQuestion: clean(raw.coreQuestion),
    designDetail: clean(raw.designDetail),
    hookText: clean(raw.hook),
    openingLine: clean(raw.openingLine),
    secondBeat: clean(raw.secondBeat),
    consequence: stripEnd(raw.expectedConsequence),
    result: stripEnd(raw.expectedConsequence),
    trigger: "",
    mechanism: stripEnd(raw.mechanism),
    number: clean(raw.number),
    lesson: stripEnd(raw.payoff),
    misconception: clean(raw.misconception),
    debate: clean(raw.debate),
    chain: [],
    timeline: [],
    warning: "",
    dependency: "",
    bottleneck: "",
    resilience: "",
    scenario: "",
    sources: sourceList(raw.sources),
    footageSources: [],
    evidence: factEvidence(raw),
    visualScenes: ((raw.visualPotential || {}).scenes || []).map((text) => ({ text: clean(text), source: null, start: null, synthetic: false })),
    narration: beats.map((beat) => beat.text),
    narrationBeats: beats,
    editorialTitles: (raw.editorialTitles || [raw.topic]).map(clean),
    thumbnailTexts: raw.thumbnailText ? [clean(raw.thumbnailText)] : [],
    archival: false,
    archivalFilm: false,
    stock: false,
    researchStatus: raw.researchStatus,
    productionReady: raw.productionReady === true,
    signals: {
      priority: null,
      curiosity: raw.curiosityScore,
      visual: (raw.visualPotential || {}).score,
      sourceQuality: (raw.sourceQuality || raw.sourceAvailability || {}).score,
      evergreen: raw.evergreenScore,
      shortPotential: (raw.shortPotential || {}).score,
      longPotential: (raw.longFormPotential || {}).score,
      criticality: null,
      hookPotential: (raw.shortPotential || {}).score,
      novelty: (raw.novelty || {}).score,
      channelFit: (raw.quality || {}).channelFit,
      audienceFit: (raw.audienceFit || {}).score,
      searchDemand: null,
      depth: (raw.longFormPotential || {}).score,
    },
    format: "short",
    raw,
  };
}

function normalize(channel, raw, slug) {
  const channelSlug = typeof channel === "string" ? channel : channel.slug;
  let topic;
  if (channelSlug === "failure-reconstructed") topic = fromFailureReconstructed(raw, slug || raw.slug);
  else if (channelSlug === "impossible-brief") topic = fromImpossibleBrief(raw);
  else if (channelSlug === "critical-thread") topic = fromCriticalThread(raw);
  else if (channelSlug === "behind-the-ordinary") topic = fromHiddenLogicOfThings(raw);
  else throw new Error("No growth topic adapter for channel: " + channelSlug);
  // Measured recognition: monthly Wikipedia pageviews of the topic's own
  // article (core/growth/popularity.js, refreshed by scripts/wiki-popularity.js).
  const popularity = Popularity.forTopic(channelSlug, raw);
  if (popularity) {
    topic.popularity = popularity;
    topic.signals.popularity = popularity.score;
  }
  return topic;
}

// ---------------------------------------------------------------------------
// Boilerplate detection. A field is "templated" when its sentence skeleton
// (topic-specific words removed) repeats across the channel's own inventory.
// This is measured from the data, not from a hard-coded phrase list.
const TEMPLATE_FIELDS = ["openingLine", "secondBeat", "mechanism", "bottleneck", "dependency", "consequence", "resilience", "hookText", "question"];

function specificWords(topic) {
  return new Set(M.icerikKelimeleri([topic.subject, topic.category, topic.cluster, topic.object, topic.dependencyTarget, topic.scenario, topic.mechanism].join(" ")));
}

// Skeleton = the sentence with topic-specific words and inventory-rare words
// masked. Templates share skeletons; genuinely written copy does not.
function skeleton(text, topic, rare) {
  const specific = specificWords(topic);
  return M.kelimeler(text).map((word) => specific.has(word) || (rare && rare.has(word)) ? "#" : word)
    .join(" ").replace(/#( #)+/g, "#").slice(0, 120);
}

function templateIndex(topics, options = {}) {
  const documentFrequency = new Map();
  for (const topic of topics) {
    const words = new Set(TEMPLATE_FIELDS.flatMap((field) => M.kelimeler(topic[field] || "")));
    for (const word of words) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }
  const rareLimit = Math.max(2, Math.ceil(topics.length * 0.01));
  const rare = new Set([...documentFrequency.entries()].filter(([, count]) => count <= rareLimit).map(([word]) => word));
  const counts = {};
  const exact = {};
  for (const field of TEMPLATE_FIELDS) { counts[field] = new Map(); exact[field] = new Map(); }
  for (const topic of topics) {
    for (const field of TEMPLATE_FIELDS) {
      if (!topic[field]) continue;
      const key = skeleton(topic[field], topic, rare);
      counts[field].set(key, (counts[field].get(key) || 0) + 1);
      const value = String(topic[field]).toLowerCase();
      exact[field].set(value, (exact[field].get(value) || 0) + 1);
    }
  }
  const minimumRepeats = Math.max(options.minimumRepeats || 5, Math.ceil((options.share || 0.02) * topics.length));
  return { counts, exact, rare, minimumRepeats, size: topics.length };
}

function boilerplate(topic, index) {
  if (!index) return { ratio: 0, templatedFields: [], checkedFields: 0 };
  const templatedFields = [];
  let checked = 0;
  for (const field of TEMPLATE_FIELDS) {
    if (!topic[field]) continue;
    checked += 1;
    const count = index.counts[field].get(skeleton(topic[field], topic, index.rare)) || 0;
    const verbatim = index.exact[field].get(String(topic[field]).toLowerCase()) || 0;
    if (count >= index.minimumRepeats || verbatim >= 3) templatedFields.push(field);
  }
  return { ratio: checked ? Math.round(templatedFields.length / checked * 100) / 100 : 0, templatedFields, checkedFields: checked };
}

// ---------------------------------------------------------------------------
// Inventory loading per channel (read-only).
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function inventory(channel) {
  if (channel.config.pathMode === "legacy-adapter") {
    const directory = channel.paths.topics;
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort().map((file) => {
      const slug = file.replace(/\.json$/, "");
      const raw = readJson(path.join(directory, file), null);
      return raw ? normalize(channel, raw, slug) : null;
    }).filter(Boolean);
  }
  const universe = readJson(channel.paths.topicUniverse, { topics: [] });
  return Overrides.apply(channel, universe.topics || [])
    .filter((topic) => topic.status === "qualified" && (channel.slug !== "behind-the-ordinary" || topic.productionReady === true))
    .map((raw) => normalize(channel, raw));
}

// Discovery inventory is deliberately separate from production inventory.
// A source-verified backlog record must not enter rendering until it has been
// researched into a full case file and passed the normal source/visual gates.
function durableInventory(channel) {
  const universe = readJson(channel.paths.topicUniverse, { topics: [] });
  return {
    schema: universe.schema || null,
    generatedAt: universe.generated_at || null,
    stats: universe.stats || { total: 0, qualified: 0, production_ready: 0, research_backlog: 0, used: 0 },
    topics: universe.topics || [],
  };
}

module.exports = {
  normalize, inventory, durableInventory, templateIndex, boilerplate, skeleton, numbersIn,
  clean, firstSentence, stripEnd, capital, lower, TEMPLATE_FIELDS,
};
