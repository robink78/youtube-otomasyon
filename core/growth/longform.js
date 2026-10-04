"use strict";

// LONG-FORM CONTENT ENGINE (PHASE 32–32T). An extension of the existing
// pipeline, not a second generator: it reuses the normalized topic model,
// source tiers, hook engine, title engine, first-seconds planner, funnel and
// readiness gate, and hands rendering to the existing long-video chain
// (seslendir.js → gorsel-bul.js → video-yap.js) and upload to youtube-yukle.js.
//
//   ResearchPackage → outline → cold opens → script (+claim/source map) →
//   scene plan → asset plan → thumbnails → titles → derived Shorts →
//   related-video mapping → next video / end screen → cost → quality gate
//
// Quality over cadence: the gate never relaxes because seven days passed.

const crypto = require("crypto");
const M = require("../../lib/metin");
const Config = require("./config");
const Store = require("./store");
const Model = require("./topic-model");
const Sources = require("./sources");
const Hooks = require("./hooks");
const Titles = require("./titles");
const FirstSeconds = require("./first-seconds");
const Funnel = require("./funnel");
const Readiness = require("./readiness");
const Research = require("./research");
const Provider = require("../llm/longform-provider");

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
const words = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
const finish = (text) => { const value = Model.clean(text); return !value ? "" : /[.!?]$/.test(value) ? value : value + "."; };

// ---------------------------------------------------------------------------
// RESEARCH PACKAGE (PHASE 32S) — reused by long-form, derived Shorts,
// metadata and fact checks; every claim keeps its source.
function topicHash(topic) {
  return crypto.createHash("sha1").update(JSON.stringify(topic.raw || topic)).digest("hex").slice(0, 12);
}

function researchPackage(channel, topic, options = {}) {
  const file = `research/${topic.slug}.json`;
  const existing = options.fresh ? null : Store.readState(channel, "longform", file, null);
  const deep = options.deep && Array.isArray(options.deep.claims) ? options.deep : null;
  const hash = topicHash(topic) + (deep ? `+deep${deep.claims.length}` : "");
  if (existing && existing.topicHash === hash && existing.channel === channel.slug) {
    existing.reuseCount = (existing.reuseCount || 0) + 1;
    if (options.write !== false) Store.writeState(channel, "longform", file, existing);
    return existing;
  }
  const sourceQuality = Sources.sourceQuality(topic.sources);
  const claims = [];
  const seen = new Set();
  const add = (text, layer, source, role, extra = {}) => {
    const value = finish(Hooks.sentenceCase ? Hooks.sentenceCase(text) : text);
    const key = value.toLowerCase();
    if (!value || seen.has(key) || words(value) < 3) return;
    seen.add(key);
    claims.push({ id: `C${claims.length + 1}`, text: Model.capital(value), class: Sources.classifyClaim(layer), layer, source: source || (topic.sources[0] && topic.sources[0].name) || "topic record", role, ...extra });
  };
  const primary = topic.sources[0] ? topic.sources[0].name : "topic record";
  if (topic.consequence) add(topic.consequence, "CONFIRMED FACT", primary, "consequence");
  if (topic.trigger) add(topic.kind === "case" ? `The trigger: ${topic.trigger}` : `Assume ${Model.lower(topic.trigger)}`, topic.kind === "case" ? "CONFIRMED FACT" : "SPECULATIVE SCENARIO", primary, "trigger");
  if (topic.mechanism) add(topic.kind === "case" ? `The mechanism: ${topic.mechanism}` : topic.channel === "critical-thread" ? topic.mechanism : `The governing physics: ${topic.mechanism}`, topic.channel === "critical-thread" ? "VERIFIED FACT" : "CONFIRMED FACT", primary, "mechanism");
  if (topic.number) add(`The key figure: ${topic.number}`, "CONFIRMED FACT", primary, "number");
  for (const sentence of M.cumleler(topic.misconception || "")) add(sentence, "CONFIRMED FACT", primary, "misconception");
  for (const [index, step] of (topic.chain || []).entries()) add(`Step ${index + 1} of the failure chain: ${Model.lower(Hooks.sentenceCase(step))}`, "CONFIRMED FACT", primary, "chain");
  for (const item of topic.timeline || []) add(`${item.t}: ${item.event}`, "CONFIRMED FACT", primary, "timeline");
  for (const line of topic.narration || []) add(line, "CONFIRMED FACT", "editorial narration (case file)", "narration");
  for (const item of topic.evidence || []) if (item.source !== "editorial narration" && item.source !== "case file") add(item.claim, item.layer || item.confidence, item.source, item.role || "evidence", { url: item.url || null });
  if (topic.dependency) add(topic.dependency, "VERIFIED FACT", primary, "dependency");
  if (topic.bottleneck) add(topic.bottleneck, "MODEL", primary, "bottleneck");
  if (topic.channel === "critical-thread" && topic.consequence) add(topic.raw.failureConsequence, "MODEL", "CriticalThread bounded dependency model", "failure-scenario");
  if (topic.resilience) add(topic.resilience, "VERIFIED FACT", primary, "resilience");
  if (topic.lesson && topic.kind === "case") add(`What changed: ${topic.lesson}`, "INTERPRETATION", primary, "lesson");
  if (topic.debate) add(topic.debate, "INTERPRETATION", primary, "debate");
  if (topic.channel === "impossible-brief") add("The exact timeline depends on how the impossible change happens; the order of effects is what established physics constrains.", "SPECULATIVE SCENARIO", "ImpossibleBrief claim framework", "limits");
  // Deep research (encyclopedia sentences): facts for the LLM writer only —
  // verbatim:false keeps them out of the deterministic narration (CC BY-SA).
  for (const claim of deep ? deep.claims : []) add(claim.text, "CONFIRMED FACT", claim.source, claim.role, { verbatim: false, url: claim.url, section: claim.section, licence: claim.licence });
  const deepSources = deep && deep.article && !(topic.sources || []).some((source) => Research.wikiTitleFromUrl(source.url) === deep.article)
    ? [{ name: `Wikipedia — ${deep.article}`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(deep.article.replace(/ /g, "_"))}`, type: "encyclopedia" }] : [];
  const value = {
    schema: "research-package/1",
    id: `${channel.slug}:${topic.slug}`,
    channel: channel.slug,
    topicId: topic.id,
    slug: topic.slug,
    subject: topic.subject,
    cluster: topic.cluster,
    topicHash: hash,
    createdAt: (options.now || new Date()).toISOString(),
    reuseCount: 0,
    reusableFor: ["long-form", "derived-shorts", "metadata", "fact-check", "visual-sourcing", "follow-up-episodes"],
    sources: deepSources.length ? Sources.sourceQuality([...(topic.sources || []), ...deepSources]).tiers : sourceQuality.tiers,
    deepResearch: deep ? { article: deep.article, via: deep.via, claims: deep.claims.length, status: deep.status, licence: deep.licence } : null,
    sourceQuality: sourceQuality.score,
    primarySources: sourceQuality.primaryCount,
    claims,
    visualLeads: [
      ...(topic.visualScenes || []).map((scene) => ({ text: scene.text, source: scene.source || null, start: scene.start, origin: "case-file" })),
      ...((deep && deep.images) || []).map((file) => ({ text: file.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " "), source: `Commons: ${file}`, origin: "article-image (licence check pending)" })),
    ],
    footage: topic.footageSources || [],
    gaps: [
      ...(sourceQuality.primaryCount === 0 ? ["no primary/authoritative source — add an official investigation, agency or academic source"] : []),
      ...((topic.sources || []).length < 3 ? [`${(topic.sources || []).length} source(s); long-form needs ≥ 3`] : []),
      ...(claims.filter((claim) => claim.class === "CONFIRMED_FACT").length < 12 ? ["fewer than 12 confirmed claims — not enough evidence for 8–12 minutes without padding"] : []),
      ...(!deep || !deep.claims.length ? ["no deep research — long-form depth limited to the Shorts case file"] : []),
    ],
  };
  if (options.write !== false) Store.writeState(channel, "longform", file, value);
  return value;
}

// ---------------------------------------------------------------------------
// OUTLINE (PHASE 32A): channel structure, sections open only if evidence exists.
const SECTION_ROLES = {
  COLD_OPEN: ["consequence", "narration"], CONSEQUENCE: ["consequence", "number"], WHAT_HAPPENED: ["timeline", "narration", "event"], SYSTEM: ["mechanism", "dependency", "background"],
  HIDDEN_WEAKNESS: ["trigger", "misconception"], EARLY_WARNING: ["misconception"], FAILURE_CHAIN: ["chain"], CRITICAL_MOMENT: ["narration", "timeline"],
  ENGINEERING_EXPLANATION: ["mechanism", "number", "evidence", "cause"], AFTERMATH: ["narration", "aftermath"], WHAT_CHANGED: ["lesson"], FINAL_TAKEAWAY: ["debate", "lesson"],
  IMPOSSIBLE_QUESTION: ["consequence"], INITIAL_CONDITIONS: ["trigger", "background"], FIRST_EFFECT: ["evidence", "narration", "event"], SECOND_ORDER_EFFECT: ["consequence", "aftermath"],
  SYSTEM_WIDE_CONSEQUENCE: ["consequence", "evidence"], SCIENCE_EXPLANATION: ["mechanism", "evidence", "cause"], LIMITS_UNCERTAINTIES: ["limits"], FINAL_SCIENTIFIC_PAYOFF: ["limits", "consequence"],
  INVISIBLE_SYSTEM: ["dependency", "evidence", "background"], WHERE_IT_EXISTS: ["evidence", "event"], HOW_IT_WORKS: ["mechanism", "evidence", "cause"], WHAT_DEPENDS_ON_IT: ["dependency"],
  BOTTLENECK: ["bottleneck", "evidence"], WHY_THE_BOTTLENECK_EXISTS: ["bottleneck"], FAILURE_SCENARIO: ["failure-scenario"], CASCADING_CONSEQUENCES: ["failure-scenario", "consequence", "aftermath"],
  REDUNDANCY_ALTERNATIVES: ["resilience"], FINAL_SYSTEM_INSIGHT: ["resilience"],
  THE_QUESTION: ["question", "narration"], ORIGIN_CONTEXT: ["origin", "context"], THE_PROBLEM: ["problem"], THE_EXPLANATION: ["explanation", "mechanism", "evidence"],
  SURPRISING_DETAIL: ["surprising-detail", "misconception"], REAL_WORLD_CONSEQUENCE: ["consequence"], FINAL_PAYOFF: ["payoff", "lesson"], NEXT_CURIOSITY_BRIDGE: ["payoff"],
};

const SECTION_QUESTION = {
  COLD_OPEN: "What is the unresolved consequence the viewer sees first?", CONSEQUENCE: "What was lost?", WHAT_HAPPENED: "In what order did it happen?",
  SYSTEM: "How was the machine/structure supposed to work?", HIDDEN_WEAKNESS: "Where was the weakness hiding?", FAILURE_CHAIN: "Which step led to which?",
  CRITICAL_MOMENT: "What was the point of no return?", ENGINEERING_EXPLANATION: "What is the physical mechanism?", AFTERMATH: "What happened next?",
  WHAT_CHANGED: "What do engineers do differently now?", FINAL_TAKEAWAY: "What should the viewer remember?",
  IMPOSSIBLE_QUESTION: "What exactly is being asked?", INITIAL_CONDITIONS: "What do we assume?", FIRST_EFFECT: "What changes first?",
  SECOND_ORDER_EFFECT: "What does that trigger?", SYSTEM_WIDE_CONSEQUENCE: "How far does it spread?", SCIENCE_EXPLANATION: "What physics governs it?",
  LIMITS_UNCERTAINTIES: "What can science not predict here?", FINAL_SCIENTIFIC_PAYOFF: "What is the answer?",
  INVISIBLE_SYSTEM: "What is it?", WHERE_IT_EXISTS: "Where is it?", HOW_IT_WORKS: "How does it work?", WHAT_DEPENDS_ON_IT: "What depends on it?",
  BOTTLENECK: "Where is the chokepoint?", WHY_THE_BOTTLENECK_EXISTS: "Why can't it be replaced quickly?", FAILURE_SCENARIO: "What if it fails?",
  CASCADING_CONSEQUENCES: "What fails next?", REDUNDANCY_ALTERNATIVES: "What protects the system?", FINAL_SYSTEM_INSIGHT: "What does this reveal about the modern world?",
  THE_QUESTION: "What familiar detail are we actually explaining?", ORIGIN_CONTEXT: "Where did this design come from?", THE_PROBLEM: "What practical problem shaped it?",
  THE_EXPLANATION: "What does the documented evidence show?", SURPRISING_DETAIL: "Which detail changes the obvious explanation?", REAL_WORLD_CONSEQUENCE: "How did the design persist or change?",
  FINAL_PAYOFF: "What is the precise answer to the opening question?", NEXT_CURIOSITY_BRIDGE: "Which related ordinary detail follows naturally?",
};

function outline(channel, topic, pkg, config) {
  const structure = (config.story && config.story.longform) || [];
  const used = new Set();
  const sections = structure.map((name, index) => {
    const roles = SECTION_ROLES[name] || [];
    const claims = pkg.claims.filter((claim) => roles.includes(claim.role) && (!used.has(claim.id) || name === "COLD_OPEN"));
    if (name !== "COLD_OPEN") claims.forEach((claim) => used.add(claim.id));
    return { order: index + 1, section: name, question: SECTION_QUESTION[name] || null, claimIds: claims.map((claim) => claim.id), evidence: claims.length ? "available" : "MISSING" };
  });
  const missing = sections.filter((section) => section.evidence === "MISSING" && section.section !== "COLD_OPEN");
  return { structure, sections, missingSections: missing.map((section) => section.section), coverage: Math.round((sections.length - missing.length) / Math.max(1, sections.length) * 100) };
}

// COLD OPENS: ≥ 5 candidates, longer than a Shorts hook (≤ 20 s).
function coldOpens(topic, config, templatedFields = []) {
  const longConfig = { ...config, hooks: { ...config.hooks, maxSpokenWords: 22, minimumCandidates: config.longform.coldOpenCandidates } };
  const bundle = Hooks.generate(topic, longConfig, { templatedFields });
  const families = new Set();
  const picked = [];
  for (const hook of bundle.candidates) {
    if (hook.blocked || families.has(hook.family)) continue;
    families.add(hook.family);
    picked.push({ type: hook.family, text: hook.spoken, score: hook.adjustedTotal, estimatedSeconds: hook.estimatedSeconds });
  }
  for (const hook of bundle.candidates) if (picked.length < config.longform.coldOpenCandidates && !hook.blocked && !picked.some((item) => item.text === hook.spoken)) picked.push({ type: hook.family, text: hook.spoken, score: hook.adjustedTotal, estimatedSeconds: hook.estimatedSeconds });
  return { candidates: picked, selected: picked[0] || null, meetsMinimum: picked.length >= config.longform.coldOpenCandidates, bundle };
}

// ---------------------------------------------------------------------------
// SCRIPT (PHASE 32K). Deterministic evidence script by default: one paragraph
// per section, every sentence traced to a claim id. It never pads; the gate
// compares its real length with the target and blocks honestly.
const BRIDGES = {
  "failure-reconstructed": ["But that was only the visible part.", "To see why, look at the structure itself.", "And the warning signs were already there.", "Then the chain began.", "This is the moment it could no longer be stopped.", "So what actually failed?", "The consequences didn't end there.", "Engineers did not forget it.", "Which leaves one question."],
  "impossible-brief": ["Start with the assumption.", "That is the first effect — but not the biggest.", "The second-order effect is stranger.", "Now zoom out.", "Here is the physics underneath it.", "And here is where science stops being certain.", "So what is the answer?"],
  "critical-thread": ["Most people never see it.", "Here is where it sits.", "Here is how it works.", "And here is what depends on it.", "That is the bottleneck.", "Why can't it be replaced quickly?", "Now imagine it fails.", "The failure would not stay contained.", "So what protects the system?", "Which says something bigger about the modern world."],
  "behind-the-ordinary": ["Start with the detail itself.", "Its history begins with a practical problem.", "That problem shaped the design.", "The documentation makes the purpose clearer.", "But one detail complicates the familiar story.", "The design did not stop changing there.", "Now the opening question has a precise answer.", "And it points to another ordinary mystery."],
};

function deterministicScript(channel, topic, pkg, plan, cold, config) {
  const byId = new Map(pkg.claims.map((claim) => [claim.id, claim]));
  const bridges = BRIDGES[channel.slug] || [];
  const sections = plan.sections.map((section, index) => {
    const paragraphs = [];
    if (section.section === "COLD_OPEN" && cold.selected) {
      paragraphs.push({ text: finish(cold.selected.text), claims: [], role: "cold-open" });
    } else {
      const lead = index > 0 && bridges[(index - 1) % bridges.length];
      const sentences = section.claimIds.map((id) => byId.get(id)).filter((claim) => claim && claim.verbatim !== false);
      if (sentences.length) paragraphs.push({ text: [lead, ...sentences.map((claim) => claim.text)].filter(Boolean).join(" "), claims: sentences.map((claim) => claim.id), role: "evidence" });
    }
    return { section: section.section, paragraphs };
  });
  return { generator: "deterministic-evidence", sections };
}

// ---------------------------------------------------------------------------
// STRUCTURED CLOUD WRITER. The provider boundary supports Groq and the existing
// Anthropic provider. The pipeline checkpoints the fact pack, angle, section
// plan and every completed section so a quota pause never discards prior work.
function llmAvailable() { return Provider.available(); }

function providerEvent(channel, event, options = {}) {
  if (options.write === false) return;
  const rows = Store.readState(channel, "longform", "provider-events.json", []);
  rows.push({ at: (options.now || new Date()).toISOString(), channel: channel.slug, ...event });
  Store.writeState(channel, "longform", "provider-events.json", rows.slice(-500));
}

function generationFile(topic) { return `generation/${topic.slug}.json`; }

function writeGeneration(channel, topic, value, options = {}) {
  if (options.write !== false) Store.writeState(channel, "longform", generationFile(topic), value);
  return value;
}

function factPack(topic, pkg) {
  return {
    topic: topic.title,
    central_question: topic.question || topic.coreQuestion || topic.title,
    audience_promise: `Answer one precise question about ${topic.subject} using only documented evidence.`,
    verified_facts: pkg.claims.filter((claim) => claim.class === "CONFIRMED_FACT").map((claim) => ({ id: claim.id, text: claim.text, source: claim.source, rewrite: claim.verbatim === false })),
    bounded_interpretations: pkg.claims.filter((claim) => claim.class !== "CONFIRMED_FACT").map((claim) => ({ id: claim.id, text: claim.text, class: claim.class, source: claim.source })),
    uncertain_claims: [],
    visual_leads: pkg.visualLeads.slice(0, 20),
  };
}

function validateBlueprint(json, plan, cold, topic) {
  const hooks = Array.isArray(json.hook_candidates) ? json.hook_candidates.map(finish).filter(Boolean).slice(0, 8) : [];
  const beats = Array.isArray(json.retention_beats) ? json.retention_beats.map(finish).filter(Boolean).slice(0, 20) : [];
  return {
    central_question: finish(json.central_question || topic.question || topic.title),
    audience_promise: finish(json.audience_promise || `Answer the central question about ${topic.subject}.`),
    narrative_angle: finish(json.narrative_angle || "Move from the visible mystery to the documented design reason and a precise payoff."),
    hook_candidates: hooks.length ? hooks : [cold.selected && cold.selected.text].filter(Boolean),
    retention_beats: beats,
    uncertain_claims: Array.isArray(json.uncertain_claims) ? json.uncertain_claims.map(String).slice(0, 20) : [],
    section_plan: plan.sections.map((section) => ({ section: section.section, question: section.question, claimIds: section.claimIds })),
  };
}

function validateGeneratedSection(json, section) {
  const allowed = new Set(section.claimIds || []);
  const body = json && json.section && typeof json.section === "object" ? json.section : json;
  const paragraphs = (body && Array.isArray(body.paragraphs) ? body.paragraphs : []).map((paragraph) => ({
    text: finish(paragraph && paragraph.text),
    claims: [...new Set((paragraph && Array.isArray(paragraph.claims) ? paragraph.claims : []).filter((id) => allowed.has(id)))],
    role: "evidence",
  })).filter((paragraph) => paragraph.text && paragraph.claims.length);
  if (section.claimIds.length && !paragraphs.length) throw new Provider.LongformProviderError("INVALID_SECTION", `provider returned no claim-mapped paragraphs for ${section.section}`, { stage: `section:${section.section}`, retryable: true, defer: true });
  return { section: section.section, paragraphs };
}

function continuityAndRetention(sections, plan, config) {
  const seenText = new Set();
  const duplicateSections = [];
  const repeatedPhrases = [];
  const cleaned = [];
  const sectionNames = new Set();
  for (const section of sections) {
    if (sectionNames.has(section.section)) { duplicateSections.push(section.section); continue; }
    sectionNames.add(section.section);
    const paragraphs = [];
    for (const paragraph of section.paragraphs || []) {
      const key = paragraph.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seenText.has(key)) { if (key) repeatedPhrases.push(paragraph.text.slice(0, 80)); continue; }
      seenText.add(key);
      paragraphs.push(paragraph);
    }
    cleaned.push({ section: section.section, paragraphs });
  }
  const text = cleaned.flatMap((section) => section.paragraphs.map((paragraph) => paragraph.text)).join(" ");
  const first = cleaned.flatMap((section) => section.paragraphs).find(Boolean);
  const wordsTotal = words(text);
  const introWords = cleaned.slice(0, 2).flatMap((section) => section.paragraphs).reduce((sum, paragraph) => sum + words(paragraph.text), 0);
  const filler = (text.match(/\b(in today'?s video|as you can see|needless to say|it is important to note|in conclusion|let'?s dive in)\b/gi) || []);
  const payoff = cleaned.filter((section) => /PAYOFF|TAKEAWAY|INSIGHT|ANSWER/.test(section.section)).some((section) => section.paragraphs.length);
  const weakHook = !first || Hooks.FORBIDDEN.test(first.text) || words(first.text) > 55;
  const missingPlanSections = plan.sections.filter((section) => section.claimIds.length && !cleaned.some((item) => item.section === section.section && item.paragraphs.length)).map((section) => section.section);
  const hardFails = [];
  if (duplicateSections.length) hardFails.push(`duplicate sections: ${duplicateSections.join(", ")}`);
  if (weakHook) hardFails.push("weak or excessive cold open");
  if (!payoff) hardFails.push("missing final payoff");
  if (/\b(impossible scenario|global infrastructure collapse|disaster reconstruction)\b/i.test(text) && config.channel === "behind-the-ordinary") hardFails.push("incorrect channel identity");
  if (missingPlanSections.length) hardFails.push(`missing evidence sections: ${missingPlanSections.join(", ")}`);
  const notes = [];
  if (wordsTotal && introWords / wordsTotal > 0.25) notes.push("introduction exceeds 25% of the script");
  if (filler.length) notes.push(`generic filler: ${[...new Set(filler)].join(", ")}`);
  if (repeatedPhrases.length) notes.push(`${repeatedPhrases.length} repeated paragraph(s) removed`);
  return { sections: cleaned, quality: { duplicateSections, repeatedPhrases, weakHook, payoff, filler, introShare: wordsTotal ? Math.round(introWords / wordsTotal * 100) / 100 : 0, missingPlanSections, hardFails, notes } };
}

async function llmScript(channel, topic, pkg, plan, cold, config, options = {}) {
  const configured = Provider.configuration();
  const hash = topicHash(topic) + `:${pkg.claims.length}`;
  const existing = Store.readState(channel, "longform", generationFile(topic), null);
  const state = existing && existing.channel === channel.slug && existing.topicHash === hash ? existing : {
    schema: "longform-generation/2",
    channel: channel.slug,
    slug: topic.slug,
    topicHash: hash,
    status: "RUNNING",
    createdAt: (options.now || new Date()).toISOString(),
    updatedAt: (options.now || new Date()).toISOString(),
    provider: { primary: configured.primary.name, fallback: configured.fallback && configured.fallback.name || null },
    factPack: factPack(topic, pkg),
    blueprint: null,
    sections: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const onEvent = (event) => providerEvent(channel, event, options);
  const call = async (input) => {
    const response = await Provider.generateJson(input, { config: configured, onEvent, dependencies: options.providerDependencies || {} });
    state.providerUsed = response.provider;
    state.model = response.model;
    state.usage.input_tokens += response.usage && response.usage.input_tokens || 0;
    state.usage.output_tokens += response.usage && response.usage.output_tokens || 0;
    return response.json;
  };
  try {
    if (!state.blueprint) {
      const json = await call({
        stage: "narrative-angle",
        maxTokens: 3000,
        system: [
          `You plan evidence-led narration for ${channel.name}, a ${config.identity}.`,
          "Use only the supplied claims. Do not answer with outside knowledge. Put anything unsupported in uncertain_claims.",
          "Return JSON only with central_question, audience_promise, narrative_angle, hook_candidates, retention_beats, uncertain_claims.",
        ].join("\n"),
        user: JSON.stringify({ fact_pack: state.factPack, outline: plan.sections, selected_cold_open: cold.selected && cold.selected.text }),
      });
      state.blueprint = validateBlueprint(json, plan, cold, topic);
      state.updatedAt = (options.now || new Date()).toISOString();
      writeGeneration(channel, topic, state, options);
    }
    for (const section of plan.sections) {
      if (state.sections.some((item) => item.section === section.section)) continue;
      if (section.section === "COLD_OPEN") {
        state.sections.push({ section: section.section, paragraphs: cold.selected ? [{ text: finish(cold.selected.text), claims: [], role: "cold-open" }] : [] });
      } else if (!section.claimIds.length) state.sections.push({ section: section.section, paragraphs: [] });
      else {
        const claims = pkg.claims.filter((claim) => section.claimIds.includes(claim.id)).map((claim) => ({ id: claim.id, text: claim.text, class: claim.class, rewrite: claim.verbatim === false, source: claim.source }));
        const targetWords = Math.max(90, Math.round(config.longform.targetMinutes[0] * config.longform.wordsPerMinute / Math.max(1, plan.sections.filter((item) => item.claimIds.length).length)));
        const json = await call({
          stage: `section:${section.section}`,
          maxTokens: 5000,
          system: [
            `Write one section for ${channel.name}. Use only the claim IDs provided for this section.`,
            "Every paragraph must list the claim IDs that support it. Never add an unsupported fact, number, date, quote, cause, or purpose.",
            "Rewrite claims marked rewrite:true; do not copy an eight-word phrase. Preserve MODEL/SPECULATION labels. No filler, recap, CTA, or invented connective fact.",
            `Aim for at most ${targetWords} words, and write less when evidence is thin.`,
            'Return JSON only: {"section":{"name":"SECTION_NAME","paragraphs":[{"text":"...","claims":["C1"]}]},"depth_note":"..."}',
          ].join("\n"),
          user: JSON.stringify({ topic: topic.title, narrative_angle: state.blueprint.narrative_angle, section, claims, previous_section: state.sections[state.sections.length - 1] || null }),
        });
        state.sections.push(validateGeneratedSection(json, section));
        if (json.depth_note) state.depthNote = [state.depthNote, String(json.depth_note)].filter(Boolean).join(" ");
      }
      state.updatedAt = (options.now || new Date()).toISOString();
      writeGeneration(channel, topic, state, options);
    }
    const checked = continuityAndRetention(state.sections, plan, config);
    state.sections = checked.sections;
    state.quality = checked.quality;
    state.status = checked.quality.hardFails.length ? "QUALITY_REVIEW" : "COMPLETE";
    state.updatedAt = (options.now || new Date()).toISOString();
    writeGeneration(channel, topic, state, options);
    return {
      generator: `llm:${state.providerUsed || configured.primary.name}:${state.model || configured.primary.model}`,
      provider: state.providerUsed || configured.primary.name,
      model: state.model || configured.primary.model,
      status: state.status,
      pipeline: ["TOPIC", "RESEARCH_EVIDENCE", "FACT_PACK", "NARRATIVE_ANGLE", "OUTLINE", "SECTION_PLAN", "SECTION_GENERATION", "CONTINUITY_PASS", "RETENTION_PASS", "FACTUAL_CONSISTENCY_CHECK", "FINAL_VOICEOVER_SCRIPT"],
      factPack: state.factPack,
      blueprint: state.blueprint,
      sections: state.sections,
      quality: state.quality,
      depthNote: state.depthNote || null,
      usage: state.usage,
      checkpoint: generationFile(topic),
    };
  } catch (error) {
    state.status = error.defer ? "DEFERRED" : "FAILED";
    state.error = { code: error.code || "UNKNOWN", provider: error.provider || configured.primary.name, stage: error.stage || null, retryable: !!error.retryable, retryAfterMs: error.retryAfterMs || null };
    state.updatedAt = (options.now || new Date()).toISOString();
    writeGeneration(channel, topic, state, options);
    throw error;
  }
}

function claimSourceMap(script, pkg, topic) {
  const byId = new Map(pkg.claims.map((claim) => [claim.id, claim]));
  const rows = [];
  let unsupportedParagraphs = 0;
  let unsupportedNumbers = [];
  const copyRisks = [];
  const evidenceTopic = { ...topic, evidence: pkg.claims.map((claim) => ({ claim: claim.text, layer: claim.layer })) };
  for (const section of script.sections) {
    for (const paragraph of section.paragraphs || []) {
      const claims = (paragraph.claims || []).map((id) => byId.get(id)).filter(Boolean);
      const numeric = Sources.numericSupport(paragraph.text, evidenceTopic);
      if (!claims.length && paragraph.role !== "cold-open") unsupportedParagraphs += 1;
      if (!numeric.supported) unsupportedNumbers = unsupportedNumbers.concat(numeric.unsupported);
      const copied = Research.copyRisk(paragraph.text, pkg.claims);
      if (copied) copyRisks.push({ section: section.section, overlap: copied.overlap });
      rows.push({ section: section.section, excerpt: paragraph.text.slice(0, 90), claims: claims.map((claim) => ({ id: claim.id, class: claim.class, source: claim.source })) });
    }
  }
  return { rows, unsupportedParagraphs, unsupportedNumbers, copyRisks };
}

function scriptStats(script, config) {
  const text = script.sections.flatMap((section) => (section.paragraphs || []).map((paragraph) => paragraph.text)).join(" ");
  const count = words(text);
  const minutes = Math.round(count / config.longform.wordsPerMinute * 10) / 10;
  const paragraphs = script.sections.reduce((sum, section) => sum + (section.paragraphs || []).length, 0);
  const secondsPerParagraph = paragraphs ? count / config.longform.wordsPerMinute * 60 / paragraphs : 0;
  return { words: count, estimatedMinutes: minutes, paragraphs, secondsPerNewBeat: Math.round(secondsPerParagraph), text };
}

// ---------------------------------------------------------------------------
// SCENE + ASSET PLAN (PHASE 32L).
function visualTypeFor(section, channelSlug) {
  if (channelSlug === "behind-the-ordinary") {
    if (/EXPLANATION|PROBLEM/.test(section)) return "TECHNICAL_ILLUSTRATION";
    if (/ORIGIN|CONTEXT/.test(section)) return "MUSEUM_ARCHIVE";
    if (/SURPRISING_DETAIL|QUESTION|COLD_OPEN/.test(section)) return "REAL_OBJECT";
    return "MACRO_DETAIL";
  }
  if (/CHAIN|MECHANISM|EXPLANATION|HOW_IT_WORKS|SCIENCE/.test(section)) return channelSlug === "critical-thread" ? "PROCESS_DIAGRAM" : "DIAGRAM";
  if (/WHERE|DEPENDS|CASCADING/.test(section)) return "MAP";
  if (/CONSEQUENCE|WHAT_HAPPENED|CRITICAL|AFTERMATH|COLD_OPEN/.test(section)) return channelSlug === "failure-reconstructed" ? "REAL_ARCHIVAL" : channelSlug === "critical-thread" ? "REAL_INFRASTRUCTURE" : "SIMULATION";
  if (/CHANGED|REDUNDANCY|BOTTLENECK/.test(section)) return channelSlug === "impossible-brief" ? "DIAGRAM" : "TECHNICAL_ILLUSTRATION";
  return channelSlug === "impossible-brief" ? "ILLUSTRATION" : "TECHNICAL_ILLUSTRATION";
}

function scenePlan(channel, topic, script, pkg, config) {
  const scenes = [];
  let cursor = 0;
  const leads = pkg.visualLeads.length ? pkg.visualLeads : [{ text: topic.subject }];
  let leadIndex = 0;
  for (const section of script.sections) {
    for (const paragraph of section.paragraphs || []) {
      const seconds = words(paragraph.text) / config.longform.wordsPerMinute * 60;
      const parts = Math.max(1, Math.ceil(seconds / config.pacing.longform.maxSceneSeconds));
      for (let part = 0; part < parts; part += 1) {
        const type = visualTypeFor(section.section, channel.slug);
        // Explanatory scenes are labelled diagrams of the claim they carry;
        // only evidence scenes consume archival / infrastructure leads.
        const explanatory = /DIAGRAM|MAP|PROCESS|TECHNICAL_ILLUSTRATION/.test(type);
        const claimId = (paragraph.claims || [])[part % Math.max(1, (paragraph.claims || []).length)] || null;
        const claim = claimId ? pkg.claims.find((item) => item.id === claimId) : null;
        const lead = explanatory ? null : leads[leadIndex++ % leads.length];
        const subject = explanatory ? (claim ? claim.text.split(/\s+/).slice(0, 14).join(" ") : section.section) : lead.text;
        const asset = explanatory ? `diagram:${section.section}:${claimId || scenes.length}` : (lead.source || lead.text);
        scenes.push({
          scene: scenes.length + 1,
          narrationSpan: [Math.round(cursor), Math.round(cursor + seconds / parts)],
          section: section.section,
          visualPurpose: /DIAGRAM|MAP|PROCESS/.test(type) ? "explain mechanism" : /ARCHIVAL|INFRASTRUCTURE/.test(type) ? "show evidence" : "visualise scenario",
          visualType: type,
          subject,
          asset,
          sourceRequirement: type === "REAL_ARCHIVAL" ? "public-domain / licensed archival with attribution" : type === "REAL_INFRASTRUCTURE" ? "government/manufacturer media or licensed industrial footage" : "procedural render, labelled on screen",
          durationEstimateSeconds: Math.round(seconds / parts * 10) / 10,
          motion: part % 3 === 0 ? "slow push-in to detail" : part % 3 === 1 ? "lateral reframe / crop to evidence" : "hold, animated highlight on the claimed element",
          claimSupported: claimId,
          fallbackAssetStrategy: type === "REAL_ARCHIVAL" ? "labelled reconstruction diagram (never presented as archive)" : "labelled procedural diagram",
          disclosure: /RECONSTRUCTION|ILLUSTRATION|SIMULATION|AI_GENERATED|TECHNICAL_ILLUSTRATION/.test(type) ? "on-screen label required" : null,
        });
        cursor += seconds / parts;
      }
    }
  }
  const reuse = {};
  for (const scene of scenes) reuse[scene.asset] = (reuse[scene.asset] || 0) + 1;
  const overused = Object.entries(reuse).filter(([, count]) => count > config.pacing.longform.maxAssetReuse).map(([asset, count]) => ({ asset, count }));
  const assetPlan = {
    byType: scenes.reduce((out, scene) => { out[scene.visualType] = (out[scene.visualType] || 0) + 1; return out; }, {}),
    distinctSubjects: Object.keys(reuse).length,
    archivalLeads: leads.length,
    articleImageCandidates: leads.filter((lead) => lead.origin && lead.origin.startsWith("article-image")).length,
    overused,
    licensing: "record source, licence and URL per asset in GORSEL-KAYNAKLARI.txt (existing ledger)",
  };
  return { scenes, assetPlan };
}

// ---------------------------------------------------------------------------
// THUMBNAILS (PHASE 32I): ≥ 5 concepts, scored; reuses CriticalThread's
// existing concept set (core/visuals) and Failure Reconstructed's editorial
// thumbnail texts instead of a parallel system.
function thumbnails(channel, topic, config) {
  const texts = [...(topic.thumbnailTexts || [])];
  const shortSubject = (topic.subject || "").split(/\s+/).slice(0, 3).join(" ").toUpperCase();
  const number = Model.numbersIn([topic.number, ...(topic.evidence || []).map((item) => item.claim)].join(" ")).find((value) => /[a-z%]/i.test(value) || /\d{3,}/.test(value));
  const base = [];
  if (channel.slug === "critical-thread") {
    const Visuals = require("../visuals");
    const concepts = (Visuals.thumbnail(topic.raw).concepts || []);
    for (const concept of concepts) base.push({ id: concept.id, primarySubject: topic.subject, background: concept.consequence, visualHierarchy: concept.composition, emotion: "quiet tension / dependency", text: texts[0] || "ONE MACHINE" });
  } else if (channel.slug === "behind-the-ordinary") {
    base.push({ id: "single-object-detail", primarySubject: topic.subject, background: "warm charcoal field", visualHierarchy: `one object, one amber marker on ${topic.designDetail || "the detail"}`, emotion: "curiosity", text: texts[0] || "HIDDEN PURPOSE" });
    base.push({ id: "macro-detail", primarySubject: topic.designDetail || topic.subject, background: "softly blurred object", visualHierarchy: "macro detail fills 70% of frame", emotion: "discovery", text: texts[1] || "LOOK CLOSER" });
    base.push({ id: "then-now", primarySubject: topic.subject, background: "restrained historical-modern split", visualHierarchy: "same detail aligned across both halves", emotion: "continuity", text: texts[2] || "STILL HERE" });
    base.push({ id: "purpose-callout", primarySubject: topic.subject, background: "clean cutaway", visualHierarchy: "one teal arrow to the functional element", emotion: "explanation", text: "WHY THIS?" });
    base.push({ id: "misconception", primarySubject: topic.subject, background: "warm neutral surface", visualHierarchy: "assumed use dimmed; documented purpose highlighted", emotion: "reversal", text: "NOT WHAT YOU THINK" });
  } else if (channel.slug === "failure-reconstructed") {
    base.push({ id: "evidence-frame", primarySubject: topic.object || topic.subject, background: "real archival frame of the failure", visualHierarchy: "subject 60% of frame, text top-left", emotion: "consequence", text: texts[0] || shortSubject });
    base.push({ id: "mechanism-callout", primarySubject: topic.object || topic.subject, background: "desaturated archival still", visualHierarchy: "one amber arrow to the failed component", emotion: "hidden cause", text: texts[1] || "THE FLAW" });
    base.push({ id: "number-contrast", primarySubject: number || topic.number || shortSubject, background: "dark field, subject silhouette", visualHierarchy: "large number left, subject right", emotion: "contradiction", text: number || topic.number || shortSubject });
    base.push({ id: "before-after", primarySubject: topic.subject, background: "split frame intact vs failed (both real)", visualHierarchy: "50/50 split, thin divider", emotion: "loss", text: texts[2] || "BEFORE / AFTER" });
    base.push({ id: "chain-diagram", primarySubject: "failure chain", background: "technical drawing overlay on archival still", visualHierarchy: "3 linked nodes, last one red", emotion: "inevitability", text: "THE CHAIN" });
  } else {
    base.push({ id: "impossible-visual", primarySubject: topic.subject, background: "dark cosmic field", visualHierarchy: "single impossible change centred", emotion: "awe", text: (topic.thumbnailTexts[0] || shortSubject) });
    base.push({ id: "scale", primarySubject: topic.subject, background: "Earth for scale", visualHierarchy: "tiny Earth, huge subject", emotion: "scale", text: "" });
    base.push({ id: "before-after", primarySubject: topic.subject, background: "split normal vs changed (labelled illustration)", visualHierarchy: "50/50 split", emotion: "unease", text: "WHAT CHANGES?" });
    base.push({ id: "first-effect", primarySubject: "first measurable effect", background: "labelled diagram", visualHierarchy: "arrow from cause to effect", emotion: "curiosity", text: "FIRST EFFECT" });
    base.push({ id: "countdown", primarySubject: topic.subject, background: "dark field with timer", visualHierarchy: "timer top-right", emotion: "urgency", text: number || "T+1s" });
  }
  const concepts = base.map((concept) => {
    const textWords = words(concept.text);
    const supported = !concept.text || Sources.numericSupport(concept.text, topic).supported;
    const misleading = channel.slug === "failure-reconstructed" && /REAL|archival/i.test(concept.background) && !topic.archival;
    const scores = {
      Clarity: clamp(95 - Math.max(0, textWords - 3) * 12),
      Curiosity: clamp(60 + (/\?|THE FLAW|CHAIN|WHAT|ONE|FIRST/.test(concept.text) ? 20 : 5) + (concept.emotion.includes("contradiction") || concept.emotion.includes("hidden") ? 10 : 0)),
      VisualImpact: clamp(70 + (/split|number|arrow|silhouette|timer/.test(concept.visualHierarchy) ? 15 : 5)),
      TopicRecognition: clamp(55 + (M.icerikKelimeleri(concept.primarySubject).some((word) => M.icerikKelimeleri(topic.subject).includes(word)) ? 35 : 10)),
      MobileReadability: clamp(100 - Math.max(0, textWords - 3) * 20 - Math.max(0, concept.text.length - 14) * 3),
      Truthfulness: clamp(100 - (supported ? 0 : 60) - (misleading ? 60 : 0)),
      ChannelFit: clamp(80 + (channel.slug === "failure-reconstructed" && /archival|technical/.test(concept.background) ? 12 : channel.slug === "behind-the-ordinary" && /object|macro|neutral|charcoal|cutaway/.test(concept.background + " " + concept.visualHierarchy) ? 12 : 6)),
    };
    const total = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return { ...concept, textLength: concept.text.length, textWords, contrast: "light subject on dark field; single accent colour", truthfulness: scores.Truthfulness >= 80 ? "evidence-consistent" : "REJECT — misleading", mobileReadability: scores.MobileReadability, scores, total };
  }).sort((a, b) => b.total - a.total);
  return { concepts, selected: concepts.find((concept) => concept.scores.Truthfulness >= 80) || null, meetsMinimum: concepts.length >= config.longform.thumbnailConceptsMinimum };
}

// ---------------------------------------------------------------------------
// DERIVED SHORTS (PHASE 32C): each with its own hook, first 3 s, mini
// narrative and payoff — not clips of the long video.
function derivedShorts(channel, topic, pkg, plan, config) {
  const out = [];
  const byId = new Map(pkg.claims.map((claim) => [claim.id, claim]));
  for (const section of plan.sections) {
    if (section.section === "COLD_OPEN" || section.claimIds.length < 2) continue;
    const claims = section.claimIds.map((id) => byId.get(id)).filter(Boolean);
    const sub = { ...topic, id: `${topic.id}#${section.section}`, narration: claims.map((claim) => claim.text), evidence: claims.map((claim) => ({ claim: claim.text, layer: claim.layer, source: claim.source })), openingLine: claims[0].text };
    const hooks = Hooks.generate(sub, config, {});
    if (!hooks.selected) continue;
    const first = FirstSeconds.plan(sub, hooks, config, {});
    out.push({
      angle: section.section.toLowerCase().replace(/_/g, "-"),
      hook: hooks.selected.spoken,
      hookFamily: hooks.selected.family,
      hookScore: hooks.selectedScore,
      first3SecondPlan: first.First3SecondPlan,
      miniNarrative: claims.slice(0, 4).map((claim) => claim.text),
      payoff: claims[claims.length - 1].text,
      captionPlan: "semantic 2–3 word chunks, ≤ 2 lines, raised above Shorts UI (config.captions)",
      visualRhythm: "cut ≤ 1.4 s in the first 3 s, 1.6–2.4 s to 10 s, then 2.6–3.5 s",
      standalone: true,
      longformBridge: config.longform.shortCta || null,
      claimIds: section.claimIds,
    });
  }
  out.sort((a, b) => b.hookScore - a.hookScore);
  const [low, high] = config.longform.derivedShorts;
  return { shorts: out.slice(0, high), count: Math.min(out.length, high), meetsMinimum: out.length >= low };
}

// ---------------------------------------------------------------------------
function costEstimate(stats, scenes, options, config) {
  const c = config.cost;
  const tokens = options.llmUsage ? (options.llmUsage.input_tokens || 0) + (options.llmUsage.output_tokens || 0) : 0;
  const minutes = stats.estimatedMinutes;
  return {
    estimated_production_cost: Math.round((tokens / 1000 * c.llmPer1kTokens + minutes * c.ttsPerMinute + minutes * c.renderPerMinuteCpu * 3 + 0.5 * c.storagePerGbMonth) * 100) / 100,
    currency: "USD",
    breakdown: { llmTokens: tokens, ttsMinutes: minutes, renderMinutesCpu: Math.round(minutes * 3 * 10) / 10, assets: scenes.length, youtubeQuotaUnits: c.youtubeQuotaUnitsUpload + 50 },
    note: "approximate; update config/growth-engine.json cost units from invoices",
  };
}

function gate(inputs, config) {
  const { potential, pkg, plan, cold, script, stats, map, scenes, thumbs, titles, endScreen, derived, integrity } = inputs;
  const target = config.longform.targetMinutes;
  const hardFails = [];
  const notes = [];
  if (potential.bucket === "D") hardFails.push("LongFormPotential bucket D: " + potential.reasons.join("; "));
  // Source policy: < minimumSourcesHard independent sources or no primary /
  // authoritative source is a hard block; below the preferred minimumSources
  // lowers SourceCoverage and asks for a third source, but does not block.
  const sourceCount = (pkg.sources || []).length;
  const hardMinimum = config.longform.minimumSourcesHard || config.longform.minimumSources;
  if (sourceCount < hardMinimum) hardFails.push(`insufficient source coverage: ${sourceCount} < ${hardMinimum}`);
  if ((pkg.primarySources || 0) < (config.longform.minimumPrimarySources || 0)) hardFails.push("insufficient source coverage: no primary/authoritative source (official investigation, agency, standards body or peer-reviewed work)");
  if (sourceCount >= hardMinimum && sourceCount < config.longform.minimumSources) notes.push(`${sourceCount} sources (preferred ${config.longform.minimumSources}): add an independent source before the next revision`);
  if (map.copyRisks && map.copyRisks.length) hardFails.push(`COPY_RISK: ${map.copyRisks.length} paragraph(s) reproduce encyclopedia wording (e.g. "${map.copyRisks[0].overlap}")`);
  if (map.unsupportedNumbers.length) hardFails.push("unsupported central claim/number: " + [...new Set(map.unsupportedNumbers)].join(", "));
  if (stats.estimatedMinutes < target[0] * 0.85) hardFails.push(`INSUFFICIENT_DEPTH: evidence supports ~${stats.estimatedMinutes} min; target ${target[0]}–${target[1]} min — not padded`);
  if (inputs.duplicate) hardFails.push("duplicate episode: " + inputs.duplicate);
  if (!thumbs.selected) hardFails.push("no truthful thumbnail concept");
  if (integrity && integrity.hardFails.length) hardFails.push(...integrity.hardFails);
  if (inputs.render && inputs.render.failed) hardFails.push("render failure: " + inputs.render.reason);
  const claimsPerMinute = stats.estimatedMinutes ? pkg.claims.length / stats.estimatedMinutes : 0;
  const d = {
    TopicDepth: potential.factors.DepthPotential.value,
    NarrativeQuality: clamp(plan.coverage * 0.8 + (cold.meetsMinimum ? 20 : 5)),
    Hook: cold.selected ? cold.selected.score : 0,
    ResearchQuality: clamp(pkg.sourceQuality * 0.7 + Math.min(30, pkg.claims.length)),
    SourceCoverage: clamp(Math.min(100, (pkg.sources || []).length / config.longform.minimumSources * 70 + pkg.primarySources * 10)),
    FactualAccuracy: clamp(100 - map.unsupportedParagraphs * 10 - map.unsupportedNumbers.length * 30),
    ScriptRetention: clamp(100 - Math.max(0, stats.secondsPerNewBeat - 60) * 1.2 - (stats.estimatedMinutes < target[0] ? (target[0] - stats.estimatedMinutes) * 8 : 0) - (claimsPerMinute < config.longform.minimumClaimsPerMinute ? 15 : 0)),
    VisualCoverage: clamp(60 + Math.min(30, scenes.assetPlan.distinctSubjects * 5) - scenes.assetPlan.overused.length * 10),
    AudioQuality: inputs.render && inputs.render.completed ? 85 : null,
    Editing: inputs.render && inputs.render.completed ? 80 : null,
    Thumbnail: thumbs.selected ? thumbs.selected.total : 0,
    Title: titles.selectedScore,
    CopyrightSafety: 90,
    Disclosure: scenes.scenes.every((scene) => !scene.disclosure || scene.disclosure === "on-screen label required") ? 95 : 40,
    EndScreenPlan: endScreen.primary_next_video ? 90 : 55,
    ShortFunnelPotential: clamp(40 + derived.count * 10),
  };
  const rewriteOnly = pkg.claims.filter((claim) => claim.verbatim === false).length;
  if (rewriteOnly && script.generator === "deterministic-evidence") notes.push(`${rewriteOnly} deep-research claims need the LLM writer via a configured long-form provider (LONGFORM_LLM_PROVIDER + provider key); the deterministic writer never narrates encyclopedia text verbatim`);
  if (script.llmStatus === "DEFERRED") {
    hardFails.push(`LLM generation deferred safely (${script.llmErrorCode || "TRANSIENT"}); do not render or publish until the checkpoint resumes`);
    notes.push(`LLM generation safely deferred at ${script.llmErrorStage || "an intermediate stage"}; resume from ${script.checkpoint || "the channel checkpoint"}`);
  }
  if (script.llmStatus === "FAILED") hardFails.push(`LLM generation failed safely (${script.llmErrorCode || "UNKNOWN"}); deterministic evidence draft retained`);
  if (!endScreen.primary_next_video) notes.push("no same-channel next episode yet; end screen points to playlist + subscribe");
  return Readiness.longform({ dimensions: d, hardFails, notes }, config);
}

// ---------------------------------------------------------------------------
async function buildPackage(channel, topicOrId, options = {}) {
  const Context = require("./context");
  const ctx = options.context || Context.build(channel);
  const config = ctx.config;
  const topic = typeof topicOrId === "string" ? ctx.inventory.find((item) => item.id === topicOrId || item.slug === topicOrId) : topicOrId;
  if (!topic) throw new Error("long-form topic not found: " + topicOrId);
  if (topic.channel !== channel.slug) throw new Error(`CROSS_CHANNEL_LONGFORM_BLOCKED: ${topic.id} belongs to ${topic.channel}`);
  const boilerplate = Model.boilerplate(topic, ctx.index);
  const potential = options.potential || Context.evaluateLong(topic, ctx, options);
  const deep = options.research === false ? null : await Research.deepen(channel, topic, { offline: options.offline, write: options.write, now: options.now });
  const pkg = researchPackage(channel, topic, { write: options.write, now: options.now, deep });
  const plan = outline(channel, topic, pkg, config);
  const cold = coldOpens(topic, config, boilerplate.templatedFields);
  let script = deterministicScript(channel, topic, pkg, plan, cold, config);
  let llmUsage = null;
  if (options.llm) {
    // options.llm may be a writer function (tests, alternative writers) with
    // the same contract as llmScript: { generator, sections:[{section, paragraphs:[{text, claims}]}] }.
    try {
      script = typeof options.llm === "function"
        ? await options.llm({ channel, topic, pkg, plan, cold, config })
        : await llmScript(channel, topic, pkg, plan, cold, config, {
          write: options.write,
          now: options.now,
          providerDependencies: options.providerDependencies,
        });
      llmUsage = script.usage || null;
    } catch (error) {
      // Keep the deterministic, claim-mapped script as a safe preview. The
      // checkpoint records every completed cloud stage and is resumed later.
      script.llmError = error.message;
      script.llmStatus = error.defer ? "DEFERRED" : "FAILED";
      script.llmErrorCode = error.code || "UNKNOWN";
      script.llmErrorStage = error.stage || null;
      script.provider = error.provider || null;
      script.checkpoint = generationFile(topic);
    }
  }
  const stats = scriptStats(script, config);
  const map = claimSourceMap(script, pkg, topic);
  const scenes = scenePlan(channel, topic, script, pkg, config);
  const thumbs = thumbnails(channel, topic, config);
  const titles = Titles.generate(topic, config, "long", { extra: topic.editorialTitles || [], publishedTitles: ctx.history.publishedTitles });
  const episodes = Store.readState(channel, "longform", "episodes.json", []);
  const library = [
    ...episodes.map((item) => ({ ...item, channel: channel.slug })),
    ...ctx.inventory.filter((item) => item.id !== topic.id).map((item) => ({ slug: item.slug, title: item.title, subject: item.subject, cluster: item.cluster, mechanism: item.mechanism, channel: channel.slug, planned: true })),
  ];
  const next = Funnel.nextVideos(channel, { ...topic }, library);
  const endScreen = Funnel.endScreenPlan(channel, topic, next, { durationSeconds: Math.round(stats.estimatedMinutes * 60), playlist: topic.cluster });
  const derived = derivedShorts(channel, topic, pkg, plan, config);
  const publishedShorts = ctx.history.published.filter((row) => (row.format || "short") === "short");
  const relatedShorts = publishedShorts.map((row) => {
    const shortTopic = ctx.inventory.find((item) => item.slug === row.slug || item.id === row.topicId) || { slug: row.slug, title: row.baslik || row.title || "", subject: row.baslik || "", cluster: null, channel: channel.slug };
    const rel = Funnel.relate({ ...shortTopic, channel: channel.slug }, { ...topic, derivedShortSlugs: [] });
    return rel && rel.score >= config.funnel.minimumRelationshipScore ? { short_video_id: row.videoId || null, short_slug: row.slug, relationship_type: rel.type, relationship_reason: rel.reason, score: rel.score } : null;
  }).filter(Boolean);
  const integrity = require("./integrity").visual({ ...topic, visualScenes: scenes.scenes.map((scene) => ({ text: scene.subject, synthetic: !!scene.disclosure })) }, config, {});
  const duplicate = episodes.some((item) => item.slug === topic.slug && item.status === "PUBLISHED") ? `episode ${topic.slug} already published` : null;
  const readiness = gate({ potential, pkg, plan, cold, script, stats, map, scenes, thumbs, titles, endScreen, derived, integrity, duplicate, render: options.render || null }, config);
  const cost = costEstimate(stats, scenes.scenes, { llmUsage }, config);
  const result = {
    schema: "growth-longform-package/1",
    channel: channel.slug,
    channelName: channel.name,
    contentType: "long",
    createdAt: (options.now || new Date()).toISOString(),
    topic: { id: topic.id, slug: topic.slug, title: topic.title, subject: topic.subject, cluster: topic.cluster },
    LongFormPotential: potential,
    researchPackage: { id: pkg.id, sources: pkg.sources, claims: pkg.claims.length, deepResearch: pkg.deepResearch || null, gaps: pkg.gaps, reuseCount: pkg.reuseCount },
    outline: plan,
    coldOpens: { candidates: cold.candidates, selected: cold.selected },
    script: {
      generator: script.generator,
      provider: script.provider || null,
      model: script.model || null,
      status: script.status || script.llmStatus || "DETERMINISTIC_PREVIEW",
      pipeline: script.pipeline || null,
      blueprint: script.blueprint || null,
      quality: script.quality || null,
      checkpoint: script.checkpoint || null,
      llmError: script.llmError || null,
      llmErrorCode: script.llmErrorCode || null,
      llmErrorStage: script.llmErrorStage || null,
      depthNote: script.depthNote || null,
      sections: script.sections,
      ...stats,
      text: undefined,
    },
    claimSourceMap: map,
    scenePlan: scenes.scenes,
    assetPlan: scenes.assetPlan,
    thumbnails: thumbs,
    titles: { selected: titles.selected, selectedScore: titles.selectedScore, count: titles.count, candidates: titles.candidates },
    derivedShorts: derived,
    relatedShorts,
    nextVideos: next,
    endScreenPlan: endScreen,
    cost,
    readiness,
    targetMinutes: config.longform.targetMinutes,
  };
  result.summary = summary(result);
  if (options.write !== false) Store.writeState(channel, "longform", `packages/${topic.slug}.json`, result);
  return result;
}

function summary(pkg) {
  return {
    Channel: pkg.channelName,
    "Content Type": "LONG_FORM",
    Topic: pkg.topic.title,
    LongFormPotentialScore: pkg.LongFormPotential.LongFormPotentialScore,
    "Topic Bucket": pkg.LongFormPotential.bucket,
    "Cold Open": pkg.coldOpens.selected ? pkg.coldOpens.selected.text : null,
    "Target Duration": `${pkg.targetMinutes[0]}–${pkg.targetMinutes[1]} min`,
    "Actual Duration": `~${pkg.script.estimatedMinutes} min (script estimate, ${pkg.script.generator})`,
    Scenes: pkg.scenePlan.length,
    "Thumbnail Score": pkg.thumbnails.selected ? pkg.thumbnails.selected.total : 0,
    "Title Score": pkg.titles.selectedScore,
    LongFormProductionReadinessScore: `${pkg.readiness.LongFormProductionReadinessScore} → ${pkg.readiness.decision}`,
    "Related Shorts": pkg.relatedShorts.length ? pkg.relatedShorts.map((row) => row.short_slug).join(", ") : "none published yet",
    "Primary Next Video": pkg.nextVideos.primary_next_video ? pkg.nextVideos.primary_next_video.title : "none",
  };
}

module.exports = {
  researchPackage, outline, coldOpens, deterministicScript, llmScript, claimSourceMap, scriptStats, scenePlan,
  thumbnails, derivedShorts, costEstimate, gate, buildPackage, summary, topicHash, SECTION_ROLES, llmAvailable,
};
