"use strict";

const Scripting = require("../scripting");

const PILLARS = new Set(["EVERYDAY MYSTERIES", "HIDDEN ENGINEERING", "STRANGE ORIGINS", "DESIGN DECISIONS", "ORDINARY SYSTEMS"]);
const OTHER_CHANNEL = /\b(what if|impossible scenario|failure reconstructed|disaster reconstruction|global chokepoint|critical infrastructure dependency)\b/i;

function evaluateTopic(topic, allTopics = []) {
  const blockers = [];
  const exact = allTopics.filter((item) => item.id !== topic.id && String(item.topic).toLowerCase() === String(topic.topic).toLowerCase());
  if (!PILLARS.has(topic.category)) blockers.push("unknown editorial pillar");
  if (!topic.coreQuestion || !/\?$/.test(topic.coreQuestion)) blockers.push("missing one explicit central question");
  if (!topic.canonicalTopic || !topic.designDetail) blockers.push("missing ordinary object or design detail");
  if (!Array.isArray(topic.sourceRequirements) || topic.sourceRequirements.length < 2) blockers.push("fewer than two research-source requirements");
  if (!topic.quality || topic.quality.answerNotPreclaimed !== true) blockers.push("seed question preclaims an unverified answer");
  if (OTHER_CHANNEL.test([topic.topic, topic.coreQuestion, topic.whyInteresting].join(" "))) blockers.push("topic identity belongs to another channel");
  if (exact.length) blockers.push("exact duplicate topic");
  const verified = topic.productionReady === true && topic.researchStatus === "VERIFIED";
  if (verified) {
    if (!Array.isArray(topic.sources) || topic.sources.length < 2) blockers.push("production topic has fewer than two sources");
    if (!Array.isArray(topic.facts) || topic.facts.length < 5) blockers.push("production topic has fewer than five mapped facts");
    if (!Array.isArray(topic.narration) || topic.narration.length < 5) blockers.push("production topic has no evidence-led narration");
    if (!topic.openingLine || Scripting.FORBIDDEN_OPENINGS.test(topic.openingLine)) blockers.push("weak or forbidden opening");
  }
  const scores = {
    centralQuestion: topic.coreQuestion ? 96 : 30,
    channelFit: topic.quality && topic.quality.channelFit || 0,
    curiosity: topic.curiosityScore || 0,
    visualPotential: topic.visualPotential && topic.visualPotential.score || 0,
    evergreen: topic.evergreenScore || 0,
    novelty: topic.novelty && topic.novelty.score || 0,
    audienceBreadth: topic.audienceFit && topic.audienceFit.score || 0,
    researchability: topic.sourceAvailability && topic.sourceAvailability.score || 0,
    evidenceReadiness: verified ? 95 : 50,
    repetition: exact.length ? 0 : 100,
  };
  const total = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length);
  const decision = blockers.length ? "BLOCK" : verified && total >= 86 ? "PUBLISH" : "REVIEW";
  return { topicId: topic.id, decision, total, scores, blockers, productionReady: verified, note: verified ? "evidence mapped" : "validated research question; evidence required before production" };
}

function evaluatePackage(pkg) {
  const blockers = [];
  if (!pkg.topic || pkg.topic.productionReady !== true || pkg.topic.researchStatus !== "VERIFIED") blockers.push("unverified research question cannot become a package");
  if (!pkg.script || pkg.script.forbiddenOpening) blockers.push("forbidden or missing opening");
  if (!pkg.titles || pkg.titles.length < 20) blockers.push("fewer than 20 title candidates");
  if (!pkg.visuals || pkg.visuals.some((scene) => scene.changeRequiredWithinSeconds > 3.5)) blockers.push("visual pacing too slow");
  if (pkg.renderVisuals && pkg.renderVisuals.visualQuality && pkg.renderVisuals.visualQuality.decision === "BLOCK") {
    blockers.push(...pkg.renderVisuals.visualQuality.reasons.map((reason) => "rendered visuals: " + reason));
  }
  if (!pkg.sources || pkg.sources.length < 2) blockers.push("insufficient sources");
  if (!pkg.thumbnail || pkg.thumbnail.maxWords > 4) blockers.push("thumbnail identity missing or too verbose");
  if (!pkg.metadata || pkg.metadata.uploadChannel !== "behind-the-ordinary") blockers.push("wrong channel metadata");
  return { decision: blockers.length ? "BLOCK" : "PUBLISH", blockers, checked: ["identity", "central-question", "evidence", "hook", "visuals", "titles", "thumbnail", "sources", "metadata"] };
}

module.exports = { PILLARS, evaluateTopic, evaluatePackage };
