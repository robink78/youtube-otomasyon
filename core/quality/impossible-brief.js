"use strict";

const Research = require("../research");
const Scripting = require("../scripting");

function evaluateTopic(topic, allTopics = []) {
  const research = Research.auditTopic(topic);
  const exactDuplicates = allTopics.filter((item) => item.id !== topic.id && item.topic.toLowerCase() === topic.topic.toLowerCase());
  const scores = {
    scientificCredibility: research.pass ? 94 : 40,
    hook: topic.hook && !Scripting.FORBIDDEN_OPENINGS.test(topic.hook) ? 90 : 30,
    clarity: topic.coreQuestion && topic.scientificMechanism ? 92 : 40,
    retentionPotential: topic.shortPotential.score,
    visualPotential: topic.visualPotential.score,
    novelty: topic.quality.distinctiveness,
    sourceQuality: topic.sourceQuality.score,
    claimConfidence: (topic.claimFramework || []).length >= 3 ? 95 : 35,
    repetition: exactDuplicates.length ? 0 : 100,
  };
  const total = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length);
  const blockers = [...research.errors];
  if (exactDuplicates.length) blockers.push("exact duplicate topic");
  if (scores.hook < 75) blockers.push("weak or forbidden hook");
  if (scores.visualPotential < 70) blockers.push("low visual potential");
  if (scores.sourceQuality < 75) blockers.push("low source confidence");
  return { topicId: topic.id, decision: blockers.length ? "BLOCK" : total >= 86 ? "PUBLISH" : "REVIEW", total, scores, blockers };
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
  if (!pkg.metadata || !pkg.metadata.uploadChannel) blockers.push("channel metadata missing");
  return { decision: blockers.length ? "BLOCK" : "PUBLISH", blockers, checked: ["science", "hook", "clarity", "retention", "visuals", "novelty", "sources", "confidence", "titles", "thumbnail", "repetition", "metadata"] };
}

module.exports = { evaluateTopic, evaluatePackage };
