"use strict";

// TITLE ENGINES (PHASE 21 Shorts, PHASE 32J long-form). Separate generators
// and separate weights; long-form favours search intent and evergreen value,
// Shorts favour curiosity and specificity. Truthfulness dominates both: a title
// whose content words are not supported by the topic record is penalised hard.
// Patterns are not hard-coded winners — the pattern of every candidate is
// stored so this channel's learning can discover which ones work.

const M = require("../../lib/metin");
const Model = require("./topic-model");
const Sources = require("./sources");

const CLICKBAIT = /\b(shocking|insane|unbelievable|you won'?t believe|mind[- ]blowing|terrifying truth|exposed|gone wrong|must see)\b/i;
const CURIOSITY = /\?|\b(why|how|what|real|hidden|nobody|never|only|inside|first|behind|quietly|actually)\b/gi;
// Structural title vocabulary: these words frame a question, they do not make
// a factual claim. Claim-bearing words (killed, doomed, nobody…) are excluded.
const TEMPLATE_WORDS = new Set(("the a an of in on to and how why what that this its it is was inside behind real first one really actually engineering failure failed fail fails " +
  "chain reason science scientific physics system hidden explained story episode full happen happens happened break breaks breaking second last final works work " +
  "hard replace replacement change changes changed depends depend stop stops stopped timeline complete known speculation vs predicts predict thought experiment " +
  "minute seconds sequence cause consequence consequences reconstructing reconstructed investigation documentary modern life world key effect effects outcome " +
  "breakdown simulated every next day notice fast handle earth humanity survive last long follows led map mapping explained learned engineers solved weakness flaw " +
  "bottleneck dependency critical infrastructure matters think backup plan who makes few can can't doesn't wouldn't would could should never-happened purpose ordinary object detail design origin pocket coins mystery choice familiar").split(/\s+/));

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
const RECENT_PATTERN_WINDOW = 3;

function pattern(title) {
  const t = title.toLowerCase();
  if (/\?$/.test(t)) return /^what if/.test(t) ? "what-if-question" : "question";
  if (/^why\b/.test(t)) return "why";
  if (/^how\b/.test(t)) return "how";
  if (/^inside\b/.test(t)) return "inside";
  if (/^the \w+(?:[\s-]\w+)? that\b/.test(t)) return "the-x-that";
  if (/^\d/.test(t)) return "number-led";
  if (/:\s/.test(t)) return "label-colon";
  if (/—|\. /.test(t)) return "two-beat";
  return "statement";
}

function add(list, text, source) {
  const value = Model.clean(text).replace(/\s+([?.!,:])/g, "$1").replace(/\.$/, "");
  if (!value || /undefined|null/.test(value) || value.length > 100) return;
  if (list.some((item) => item.title.toLowerCase() === value.toLowerCase())) return;
  list.push({ title: M.baslikBicim ? M.baslikBicim(value) : value, source, pattern: pattern(value) });
}

function shortCandidates(topic, extra = []) {
  const list = [];
  const S = topic.subject;
  const cap = Model.capital;
  for (const title of topic.editorialTitles || []) add(list, title, "editorial");
  if (topic.title) add(list, topic.title, "current");
  for (const title of extra) add(list, title, "legacy-generator");
  if (topic.channel === "failure-reconstructed") {
    const object = topic.object || "System";
    if (topic.result) {
      add(list, `The ${object} That ${cap(topic.result)}`, "the-x-that");
      add(list, `Why ${S} ${topic.result.replace(/^(lost|was|were)\b/, (m) => m)}`, "why");
      add(list, `What Really Happened to ${S}`, "what-really");
    }
    if (topic.trigger) { add(list, `How ${cap(topic.trigger)} Brought Down ${S}`, "how-trigger"); add(list, `The Trigger Behind ${S}`, "trigger"); }
    if (topic.number) add(list, `${topic.number}: The Detail That Doomed ${S}`, "number-led");
    if (topic.mechanism) { const mech = (topic.mechanism.match(/\(([^)]+)\)/) || [])[1] || topic.mechanism.split(/[,;]/)[0]; if (mech.split(" ").length <= 5) add(list, `${cap(mech)}: What Destroyed ${S}`, "mechanism-label"); }
    if ((topic.chain || []).length >= 3) add(list, `${S}: ${topic.chain.length} Failures in Sequence`, "failure-count");
    if (topic.misconception) add(list, `What Everyone Gets Wrong About ${S}`, "misconception");
    if (topic.lesson) add(list, `What Engineers Changed After ${S}`, "lesson");
    add(list, `${S}: What Failed First`, "failed-first");
    add(list, `Inside ${S}: The Failure Chain`, "inside-chain");
    add(list, `The First Crack in ${S}`, "first-crack");
    add(list, `${S}: Cause, Chain, Consequence`, "cause-chain-consequence");
    add(list, `How ${S} Really Failed`, "how-really");
    add(list, `The Hidden Flaw Inside ${S}`, "hidden-flaw");
    add(list, `The Seconds That Decided ${S}`, "seconds");
    add(list, `${S}: The Engineering Behind the Disaster`, "engineering-behind");
    add(list, `Why Nobody Saw ${S} Coming`, "nobody-saw");
    add(list, `${S} Explained in One Chain Reaction`, "one-chain");
    add(list, `${S}: The Failure Reconstructed`, "brand");
  } else if (topic.channel === "impossible-brief") {
    const E = topic.event || S;
    add(list, `If ${E}, What Happens First?`, "what-happens-first");
    add(list, `${cap(S)}: What Changes First?`, "changes-first");
    add(list, `What Breaks First If ${E}?`, "breaks-first");
    add(list, `How Fast Would We Notice If ${E}?`, "how-fast");
    add(list, `Could Earth Handle It If ${E}?`, "could-earth");
    add(list, `The Hidden Consequence If ${E}`, "hidden-consequence");
    add(list, `What Science Actually Predicts If ${E}`, "science-predicts");
    add(list, `If ${E}: Known Science vs. Speculation`, "known-vs-speculation");
    add(list, `The First Thing to Change If ${E}`, "first-thing");
    add(list, `What Breaks Second If ${E}`, "breaks-second");
    add(list, `If ${E}: The First 60 Seconds`, "first-minute");
    add(list, `What Would Stay the Same If ${E}?`, "what-stays");
    add(list, `The Immediate Effect If ${E}`, "immediate-effect");
    add(list, `If ${E}: Cause to Consequence`, "cause-to-consequence");
    add(list, `How ${cap(S)} Would Unfold`, "how-unfolds");
    add(list, `${cap(S)}: The Mechanism Explained`, "mechanism-explained");
    add(list, `What We Know About ${cap(S)}`, "what-we-know");
    add(list, `${cap(S)}: What Happens Next?`, "happens-next");
    add(list, `What If ${cap(topic.scenario)}?`, "what-if");
    if (topic.mechanism) add(list, `${cap(topic.mechanism.split(/[,;]/)[0])}: The Key to ${cap(S)}`, "mechanism-key");
    if (topic.consequence) add(list, `If ${E}, ${topic.consequence.split(/[,;]/)[0]}`, "consequence-led");
  } else if (topic.channel === "behind-the-ordinary") {
    const detail = topic.designDetail || "This Detail";
    add(list, `Why ${Model.capital(S)} Have ${Model.capital(detail)}`, "why");
    add(list, `The Hidden Purpose of ${Model.capital(detail)}`, "hidden-purpose");
    add(list, `What ${Model.capital(detail)} Were Actually Made For`, "actual-purpose");
    add(list, `This ${Model.capital(detail)} Wasn't Added by Accident`, "not-accident");
    add(list, `The Design Reason Behind ${Model.capital(detail)}`, "design-reason");
    add(list, `Why This Detail Still Exists on ${Model.capital(S)}`, "still-exists");
    add(list, `The Original Job of ${Model.capital(detail)}`, "original-job");
    add(list, `${Model.capital(S)}: The Detail Everyone Overlooks`, "overlooked-detail");
    add(list, `How ${Model.capital(detail)} Became Part of ${Model.capital(S)}`, "how-became");
    add(list, `What Problem Did ${Model.capital(detail)} Solve?`, "problem-solved");
    add(list, `The Tiny Design Choice on ${Model.capital(S)}`, "tiny-choice");
    add(list, `Why ${Model.capital(S)} Still Use This Old Detail`, "old-detail");
    add(list, `${Model.capital(detail)}: Function or Leftover?`, "function-leftover");
    add(list, `The Everyday Engineering of ${Model.capital(S)}`, "everyday-engineering");
    add(list, `Look Closely at ${Model.capital(S)}`, "look-closely");
    add(list, `The Reason ${Model.capital(detail)} Look Like This`, "shape-reason");
    add(list, `${Model.capital(S)} Hide a Piece of Design History`, "design-history");
    add(list, `Why Designers Kept ${Model.capital(detail)}`, "designers-kept");
    add(list, `The Ordinary Detail With an Older Purpose`, "older-purpose");
    add(list, `${Model.capital(S)} Explained Through One Small Detail`, "one-detail");
  } else {
    const target = topic.dependencyTarget || topic.category.toLowerCase();
    add(list, `The World Quietly Depends on ${S}`, "quiet-dependency");
    add(list, `Why ${cap(S)} Is So Hard to Replace`, "hard-to-replace");
    add(list, `What Stops If ${S} Stops`, "what-stops");
    add(list, `The Bottleneck Nobody Sees: ${S}`, "bottleneck");
    add(list, `${cap(target)} Runs Through ${S}`, "runs-through");
    add(list, `Inside ${S}: The Hidden Dependency`, "inside");
    add(list, `The ${S} Problem`, "the-x-problem");
    add(list, `Can We Replace ${S} Fast Enough?`, "replace-fast");
    add(list, `Why There Is No Quick Substitute for ${S}`, "no-substitute");
    add(list, `The Fragile Chain Behind ${S}`, "fragile-chain");
    add(list, `What Depends on ${S}?`, "what-depends");
    add(list, `${S}: The System Behind the System`, "system-behind-system");
    add(list, `Why ${cap(S)} Became Irreplaceable`, "became-irreplaceable");
    add(list, `The Chain Reaction If ${S} Fails`, "failure-chain");
    add(list, `How ${cap(S)} Holds the Chain Together`, "holds-chain");
    add(list, `${cap(S)}: One Bottleneck, Global Consequences`, "global-consequences");
    add(list, `Where the ${S} Dependency Starts`, "dependency-start");
    add(list, `${cap(S)}: The Risk Hidden in Plain Sight`, "hidden-risk");
    for (const claim of (topic.evidence || []).filter((item) => /VERIFIED/.test(item.layer)).slice(0, 2)) {
      const number = Model.numbersIn(claim.claim)[0];
      if (number) add(list, `${number}: Inside ${S}`, "number-led");
    }
  }
  return list;
}

function longCandidates(topic, extra = []) {
  const list = [];
  const S = topic.subject;
  const cap = Model.capital;
  for (const title of extra) add(list, title, "editorial");
  if (topic.channel === "failure-reconstructed") {
    add(list, `Why ${S} Failed`, "why-failed");
    add(list, `The Failure Chain That Destroyed ${S}`, "failure-chain");
    if (topic.trigger) add(list, `How One Weakness Brought Down ${S}`, "one-weakness");
    add(list, `Inside the Engineering Failure of ${S}`, "inside-engineering");
    add(list, `${S}: The Full Failure Reconstructed`, "full-reconstruction");
    add(list, `What Really Destroyed ${S} — The Complete Investigation`, "complete-investigation");
    add(list, `The Engineering Mistakes Behind ${S}`, "engineering-mistakes");
    add(list, `${S}: From First Warning to Final Failure`, "warning-to-failure");
    add(list, `How ${S} Changed Engineering Forever`, "changed-engineering");
    add(list, `${S}: Every Link in the Failure Chain`, "every-link");
    if (topic.mechanism) add(list, `${cap((topic.mechanism.match(/\(([^)]+)\)/) || [])[1] || topic.mechanism.split(/[,;]/)[0])}: How It Destroyed ${S}`, "mechanism-long");
    add(list, `The ${topic.year || ""} Disaster Engineers Still Study: ${S}`.replace("The  ", "The "), "still-study");
    add(list, `Why ${S} Should Never Have Happened`, "never-happened");
    add(list, `Reconstructing ${S}: Cause, Chain, Consequence`, "reconstructing");
    add(list, `${S}: The Investigation, Explained`, "investigation-explained");
    add(list, `The Hidden Weakness Inside ${S}`, "hidden-weakness");
    add(list, `How Engineers Solved the ${S} Failure`, "engineers-solved");
    add(list, `${S}: What Failed, Why, and What Changed`, "what-why-changed");
    add(list, `The Physics Behind the ${S} Disaster`, "physics-behind");
    add(list, `${S} — A Forensic Engineering Documentary`, "documentary");
    add(list, `Could ${S} Have Been Prevented?`, "prevented");
  } else if (topic.channel === "impossible-brief") {
    const E = topic.event || S;
    add(list, `What Would Really Happen If ${E}?`, "what-would-happen");
    add(list, `If ${E}: The Complete Scientific Timeline`, "timeline");
    add(list, `What If ${cap(topic.scenario || E)}? The Full Scenario`, "full-scenario");
    add(list, `If ${E}, Minute by Minute`, "minute-by-minute");
    add(list, `If ${E}: First Effect to Final Outcome`, "first-to-final");
    add(list, `How Long Would Earth Last If ${E}?`, "how-long");
    add(list, `If ${E} — What Physics Says Happens Next`, "physics-next");
    add(list, `Could Humanity Survive If ${E}?`, "survive");
    add(list, `If ${E}: Known Science, Estimates and Speculation`, "known-estimates");
    add(list, `The Chain Reaction That Follows If ${E}`, "chain-reaction");
    add(list, `Every Consequence If ${E}, Explained`, "every-consequence");
    add(list, `${cap(S)}: A Scientific Thought Experiment`, "thought-experiment");
    add(list, `What Scientists Can and Can't Predict If ${E}`, "can-cant-predict");
    add(list, `The Second-Order Effects If ${E}`, "second-order");
    add(list, `If ${E}: The Full Breakdown`, "full-breakdown");
    add(list, `If ${E}: What Breaks First, and What Breaks Last`, "first-last");
    add(list, `The Real Physics If ${E}`, "real-physics");
    add(list, `If ${E} — Simulated With Real Science`, "simulated");
    add(list, `The Day After ${cap(E)}`, "day-after");
    add(list, `What Changes — and What Doesn't — If ${E}`, "change-everything");
  } else if (topic.channel === "behind-the-ordinary") {
    const detail = topic.designDetail || "This Detail";
    add(list, `Why ${Model.capital(S)} Have ${Model.capital(detail)}`, "why");
    add(list, `The Hidden Design History of ${Model.capital(S)}`, "design-history");
    add(list, `Inside ${Model.capital(S)}: The Purpose of ${Model.capital(detail)}`, "inside-purpose");
    add(list, `How ${Model.capital(detail)} Became an Everyday Standard`, "became-standard");
    add(list, `${Model.capital(S)}: Origin, Design and Hidden Purpose`, "origin-design-purpose");
    add(list, `The Engineering Behind One Ordinary Detail`, "ordinary-engineering");
    add(list, `What ${Model.capital(detail)} Reveal About ${Model.capital(S)}`, "detail-reveals");
    add(list, `The Problem ${Model.capital(detail)} Were Designed to Solve`, "problem-solved");
    add(list, `Why This Old Detail Survived on Modern ${Model.capital(S)}`, "survived");
    add(list, `The Complete Story of ${Model.capital(detail)}`, "complete-story");
    add(list, `How ${Model.capital(S)} Got Their Most Overlooked Detail`, "how-got-detail");
    add(list, `${Model.capital(detail)}: Function, History and Modern Use`, "function-history-use");
    add(list, `The Small Choice That Shaped ${Model.capital(S)}`, "small-choice");
    add(list, `What Changed — and What Stayed — in ${Model.capital(S)}`, "changed-stayed");
    add(list, `The Everyday Object Designed Around ${Model.capital(detail)}`, "designed-around");
    add(list, `Why ${Model.capital(detail)} Are Still There`, "still-there");
    add(list, `From Original Purpose to Modern ${Model.capital(S)}`, "origin-to-modern");
    add(list, `${Model.capital(S)} and the Design Detail We Stopped Noticing`, "stopped-noticing");
    add(list, `The Evidence Behind ${Model.capital(detail)}`, "evidence-behind");
    add(list, `One Familiar Object, One Unexpected Design Story`, "object-story");
  } else {
    add(list, `The Hidden System Behind ${S}`, "hidden-system");
    add(list, `How the World Depends on ${S}`, "world-depends");
    add(list, `${cap(S)}: The Bottleneck Holding Up Modern Life`, "bottleneck");
    add(list, `What Happens If ${S} Fails?`, "what-if-fails");
    add(list, `Why ${cap(S)} Is So Hard to Replace`, "hard-to-replace");
    add(list, `Inside ${S}: The Complete System Map`, "system-map");
    add(list, `${cap(S)}: Where It Is, How It Works, What Depends on It`, "where-how-what");
    add(list, `The Single Point of Failure: ${S}`, "single-point");
    add(list, `How ${cap(S)} Became Critical Infrastructure`, "became-critical");
    add(list, `The Global Chain Built on ${S}`, "global-chain");
    add(list, `${cap(S)} Explained: Dependency, Bottleneck, Resilience`, "explained-dbr");
    add(list, `If ${S} Stopped Tomorrow`, "stopped-tomorrow");
    add(list, `The Cascading Failure Hidden in ${S}`, "cascade");
    add(list, `Who Makes ${S} — and Why So Few Can`, "who-makes");
    add(list, `The Invisible Infrastructure of ${S}`, "invisible");
    add(list, `${cap(S)}: Redundancy, Risk and Recovery`, "redundancy");
    add(list, `Mapping the ${S} Dependency Chain`, "mapping");
    add(list, `Why ${cap(S)} Matters More Than You Think`, "matters-more");
    add(list, `${cap(S)} — A Critical Systems Documentary`, "documentary");
    add(list, `The Backup Plan for ${S}`, "backup-plan");
    add(list, `What Depends on ${S}?`, "what-depends");
    add(list, `${S}: The System Behind the System`, "system-behind-system");
    add(list, `Why ${cap(S)} Became Irreplaceable`, "became-irreplaceable");
    add(list, `The Chain Reaction If ${S} Fails`, "failure-chain");
    add(list, `How ${cap(S)} Holds the Chain Together`, "holds-chain");
    add(list, `${cap(S)}: One Bottleneck, Global Consequences`, "global-consequences");
    add(list, `Where the ${S} Dependency Starts`, "dependency-start");
    add(list, `${cap(S)}: The Risk Hidden in Plain Sight`, "hidden-risk");
  }
  if (topic.title) add(list, topic.title, "current");
  return list;
}

function vocabulary(topic) {
  const text = [topic.title, topic.subject, topic.object, topic.consequence, topic.trigger, topic.mechanism, topic.misconception, topic.lesson,
    topic.dependency, topic.bottleneck, topic.scenario, topic.category, topic.cluster, topic.number, topic.year, ...(topic.chain || []),
    ...(topic.narration || []), ...(topic.editorialTitles || []), ...(topic.evidence || []).map((item) => item.claim)].join(" ");
  return new Set(M.icerikKelimeleri(text).map((word) => word.slice(0, 6)));
}

function scoreOne(candidate, topic, config, kind, context = {}) {
  const title = candidate.title;
  const words = title.split(/\s+/).length;
  const chars = title.length;
  const vocab = vocabulary(topic);
  const content = M.icerikKelimeleri(title).filter((word) => !TEMPLATE_WORDS.has(word));
  const unsupported = content.filter((word) => !vocab.has(word.slice(0, 6)));
  const superlatives = Sources.unsupportedSuperlatives(title, topic);
  const numeric = Sources.numericSupport(title, topic);
  const subjectWords = M.icerikKelimeleri(topic.subject);
  const hasSubject = subjectWords.length && subjectWords.every((word) => title.toLowerCase().includes(word));
  const curiosity = new Set((title.toLowerCase().match(CURIOSITY) || [])).size;
  const lexicon = (config.lexicon || []).filter((stem) => title.toLowerCase().includes(stem)).length;
  const similarity = (context.publishedTitles || []).length ? Math.max(...context.publishedTitles.map((other) => M.kelimeBenzerlik(other, title))) : 0;
  const idealChars = kind === "long" ? [40, 70] : [28, 60];
  const s = {
    clarity: clamp(100 - Math.max(0, chars - idealChars[1]) * 1.5 - Math.max(0, idealChars[0] - chars) * 1.5 - Math.max(0, words - 11) * 5 - ((title.match(/[:—]/g) || []).length > 1 ? 10 : 0)),
    curiosity: clamp(40 + Math.min(2, curiosity) * 18 + (/\?$/.test(title) ? 8 : 0)),
    specificity: clamp(35 + (hasSubject ? 30 : 0) + (/\d/.test(title) ? 15 : 0) + Math.min(2, content.length) * 6),
    truthfulness: clamp(100 - unsupported.length * 15 - superlatives.length * 30 - numeric.unsupported.length * 40 - (CLICKBAIT.test(title) ? 40 : 0)),
    searchIntent: clamp(30 + (hasSubject ? 45 : 0) + (/^(why|how|what)\b/i.test(title) ? 12 : 0) + (title.toLowerCase().indexOf(subjectWords[0] || "\u0000") >= 0 && title.toLowerCase().indexOf(subjectWords[0]) < 20 ? 8 : 0)),
    channelIdentity: clamp(50 + Math.min(3, lexicon) * 12 + (candidate.source === "editorial" ? 10 : 0)),
    ctrPotential: clamp(35 + Math.min(2, curiosity) * 12 + (/\d/.test(title) ? 10 : 0) + (hasSubject ? 10 : 0) + (chars <= idealChars[1] ? 10 : 0) + (/\b(destroy|fail|collapse|explod|depend|stop|vanish|break|killed|doom|never)\w*/i.test(title) ? 8 : 0)),
    novelty: clamp(100 - similarity * 80),
    evergreenPotential: clamp(60 + (/\b(today|this week|breaking|new|latest|2026)\b/i.test(title) ? -30 : 15) + (hasSubject ? 10 : 0)),
  };
  const consequenceWords = /\b(fail|collapse|destroy|break|stop|sink|sank|burn|explode|kill|without|depend|consequence|disaster|doomed?)\w*/i.test(title);
  s.consequence = clamp(42 + (consequenceWords ? 38 : 0) + (topic.consequence && M.kelimeBenzerlik(title, topic.consequence) >= 0.15 ? 15 : 0));
  s.compactness = clamp(100 - Math.max(0, chars - 60) * 2 - Math.max(0, words - 10) * 7);
  s.recognizability = clamp(38 + (hasSubject ? 42 : 0) + ((topic.signals || {}).priority || 0) * 0.2);
  s.nonRedundancy = s.novelty;
  s.factualIntegrity = s.truthfulness;
  s.historicalPerformanceSimilarity = clamp(50 + ((context.learnedPatternBonus || {})[candidate.pattern] || 0) * 5);
  const weights = kind === "long" ? config.titles.longform.weights : config.titles.shorts.weights;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const total = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + (s[key] || 0) * weight, 0) / totalWeight);
  const learnedBonus = (context.learnedPatternBonus || {})[candidate.pattern] || 0;
  // Generic CT templates become visibly machine-written when a long technical
  // noun phrase is inserted verbatim (for example, "What Depends on
  // Uninterruptible Power Supply?"). Keep them available for audit, but apply
  // a bounded naturalness penalty so a strong researched title can win.
  const longTechnicalSubject = topic.channel === "critical-thread" && subjectWords.length >= 3;
  const templateNaturalnessPenalty = longTechnicalSubject && candidate.source !== "editorial" && candidate.source !== "current"
    && String(topic.subject || "").length && title.toLowerCase().includes(String(topic.subject).toLowerCase()) ? 10 : 0;
  // Pattern freshness: word similarity alone let four titles in a row share
  // one shape ("Eastern 212: What Failed First", "Inside Van Norman Dam: The
  // Failure Chain"...). A pattern used in the last three published titles
  // loses up to 12 points, a little more if it was the very last one.
  const recentPatterns = (context.publishedTitles || []).slice(-RECENT_PATTERN_WINDOW).map(pattern);
  const repeats = recentPatterns.filter((item) => item === candidate.pattern).length;
  const patternPenalty = Math.min(12, repeats * 4 + (recentPatterns[recentPatterns.length - 1] === candidate.pattern ? 3 : 0));
  s.patternFreshness = clamp(100 - repeats * 30);
  return { ...candidate, scores: s, total, patternPenalty, templateNaturalnessPenalty,
    adjustedTotal: Math.max(0, Math.min(100, total + learnedBonus - patternPenalty - templateNaturalnessPenalty)),
    unsupportedWords: unsupported, misleading: s.truthfulness < 60 };
}

function generate(topic, config, kind = "short", context = {}) {
  const pool = kind === "long" ? longCandidates(topic, context.extra || []) : shortCandidates(topic, context.extra || []);
  // Researched records (editorial narration) carry titles written and
  // fact-checked with the research ("The Fire That Closed the Mont Blanc
  // Tunnel"). Keyword templates out-score them on literal subject matching
  // ("What Depends on Road Tunnel Ventilation System?") yet read as
  // machine-made, so the best editorial title leads when one is truthful.
  const editorialFirst = kind === "short" && (topic.narrationBeats || []).length > 0;
  // Researched/editorial titles receive only a small provenance tie-break.
  // They no longer override a materially stronger truthful title candidate.
  const rankScore = (candidate) => candidate.adjustedTotal + (editorialFirst && candidate.source === "editorial" ? 3 : 0);
  const scored = pool.map((candidate) => scoreOne(candidate, topic, config, kind, context))
    .sort((a, b) => Number(a.misleading) - Number(b.misleading) || rankScore(b) - rankScore(a) || b.adjustedTotal - a.adjustedTotal);
  const selected = scored.find((item) => !item.misleading) || null;
  const minimum = kind === "long" ? config.titles.longform.minimumCandidates : config.titles.shorts.minimumCandidates;
  return {
    kind,
    candidates: scored,
    count: scored.length,
    meetsMinimum: scored.length >= minimum,
    selected,
    selectedScore: selected ? selected.adjustedTotal : 0,
    patterns: [...new Set(scored.map((item) => item.pattern))],
  };
}

module.exports = { RECENT_PATTERN_WINDOW, generate, scoreOne, shortCandidates, longCandidates, pattern };
