"use strict";

const Research = require("../research");
const Scripting = require("../scripting");

function evaluateTopic(topic, allTopics = []) {
  const research = Research.auditTopic(topic);
  const exact = allTopics.filter((item) => item.id !== topic.id && item.canonicalTopic.toLowerCase() === topic.canonicalTopic.toLowerCase());
  const scores = {
    technicalCredibility: research.pass ? 95 : 35,
    hook: topic.hookPotential.score,
    specificity: topic.canonicalTopic && topic.dependency && topic.bottleneck ? 94 : 40,
    visualPotential: topic.visualPotential.score,
    novelty: topic.novelty.score,
    sourceQuality: topic.sourceAvailability.score,
    criticality: topic.criticality.score,
    evergreen: topic.evergreenScore,
    channelFit: topic.quality.channelFit,
    repetition: exact.length ? 0 : 100,
  };
  const total = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length);
  const blockers = [...research.errors];
  if (exact.length) blockers.push("exact duplicate topic");
  if (topic.hookPotential.score < 76 || Scripting.FORBIDDEN_OPENINGS.test(topic.openingLine)) blockers.push("weak or forbidden hook");
  if (topic.visualPotential.score < 72) blockers.push("low visual potential");
  if (topic.sourceAvailability.score < 78) blockers.push("low source confidence");
  return { topicId: topic.id, decision: blockers.length ? "BLOCK" : total >= 85 ? "PUBLISH" : "REVIEW", total, scores, blockers };
}

function evaluatePackage(pkg) {
  const blockers = [];
  if (!pkg.script || pkg.script.forbiddenOpening) blockers.push("forbidden or missing opening");
  if (!pkg.titles || pkg.titles.length < 20) blockers.push("fewer than 20 title candidates");
  if (!pkg.visuals || pkg.visuals.some((scene) => scene.changeRequiredWithinSeconds > 3.5)) blockers.push("visual pacing too slow");
  if (pkg.renderVisuals && pkg.renderVisuals.visualQuality && pkg.renderVisuals.visualQuality.decision === "BLOCK") {
    blockers.push(...pkg.renderVisuals.visualQuality.reasons.map((reason) => "rendered visuals: " + reason));
  }
  if (!pkg.sources || pkg.sources.length < 2) blockers.push("insufficient sources");
  if (!pkg.thumbnail || !Array.isArray(pkg.thumbnail.concepts) || pkg.thumbnail.concepts.length < 5) blockers.push("fewer than five thumbnail concepts");
  if (!pkg.metadata || pkg.metadata.uploadChannel !== "critical-thread") blockers.push("wrong channel metadata");
  return { decision: blockers.length ? "BLOCK" : "PUBLISH", blockers, checked: ["technical-credibility", "hook", "mechanism", "bottleneck", "visuals", "sources", "claims", "titles", "thumbnail-concepts", "metadata"] };
}

module.exports = { evaluateTopic, evaluatePackage };
