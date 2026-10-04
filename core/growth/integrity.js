"use strict";

// VISUAL SOURCE INTEGRITY (PHASE 10) and FACTUAL ACCURACY (PHASE 23).
// Hard failures here override any numeric score.

const Sources = require("./sources");

const CERTAINTY = /\b(definitely|certainly|proves?|guaranteed|will always|without doubt|undeniabl\w*)\b/i;
const FORBIDDEN_CT_VISUAL = /\b(futuristic|sci-?fi|hologram|glowing circuit|generic factory|cyberpunk)\b/i;

function classifyScene(topic, scene, index, context = {}) {
  if (topic.channel === "failure-reconstructed") {
    if (scene.synthetic) return context.diagram && context.diagram.test(scene.text || "") ? "DIAGRAM" : "RECONSTRUCTION";
    if (topic.stock) return "LICENSED_STOCK";
    if (/\.(ogv|webm|mp4|mpg|mov)$/i.test(String(scene.source || "")) || topic.archivalFilm) return "REAL_ARCHIVAL";
    if (topic.archival) return "REAL_ARCHIVAL";
    return "LICENSED_STOCK";
  }
  if (topic.channel === "critical-thread") return /\b(map|diagram|chart|cross-section|timeline|graph)\b/i.test(scene.text || "") ? "PROCESS_DIAGRAM" : "TECHNICAL_ILLUSTRATION";
  if (topic.channel === "behind-the-ordinary") return /\b(diagram|cutaway|cross-section|comparison)\b/i.test(scene.text || "") ? "TECHNICAL_ILLUSTRATION" : /\barchive|source document\b/i.test(scene.text || "") ? "MUSEUM_ARCHIVE" : /\bmacro|detail\b/i.test(scene.text || "") ? "MACRO_DETAIL" : "REAL_OBJECT";
  return /diagram|comparison|map/i.test(scene.text || "") ? "DIAGRAM" : "ILLUSTRATION";
}

function visual(topic, config, options = {}) {
  const policy = config.visualIntegrity || {};
  const disclosureEnabled = options.disclosureEnabled !== false;
  const labelled = options.labelled != null ? options.labelled : topic.channel !== "failure-reconstructed";
  const hardFails = [];
  const notes = [];
  const scenes = (topic.visualScenes || []).map((scene, index) => {
    const sourceClass = classifyScene(topic, scene, index, options);
    const needsLabel = (policy.requireLabel || []).includes(sourceClass);
    const hasLabel = sourceClass === "RECONSTRUCTION" || sourceClass === "AI_GENERATED" ? disclosureEnabled : labelled || !needsLabel;
    if (needsLabel && !hasLabel) hardFails.push(`misleading ${sourceClass.toLowerCase()}: scene ${index + 1} has no on-screen label`);
    if (topic.channel === "critical-thread" && FORBIDDEN_CT_VISUAL.test(scene.text || "")) hardFails.push(`forbidden generic visual in scene ${index + 1}: ${scene.text}`);
    return { scene: index + 1, text: scene.text, sourceClass, label: needsLabel ? (hasLabel ? "labelled" : "MISSING") : "n/a" };
  });
  if (topic.channel === "failure-reconstructed" && topic.stock) notes.push("licensed stock: colour-graded, never presented as archival film");
  const classes = [...new Set(scenes.map((scene) => scene.sourceClass))];
  if (!scenes.length) notes.push("no scene plan yet");
  const repeatSources = {};
  for (const scene of topic.visualScenes || []) if (scene.source) repeatSources[scene.source] = (repeatSources[scene.source] || 0) + 1;
  const evidenceFrames = scenes.filter((scene) => /REAL_ARCHIVAL|REAL_INFRASTRUCTURE|REAL_MAP|DIAGRAM|PROCESS_DIAGRAM|OFFICIAL/.test(scene.sourceClass)).length;
  const score = Math.max(0, Math.min(100, 60 + Math.round(evidenceFrames / Math.max(1, scenes.length) * 30) + (classes.length >= 2 ? 10 : 0) - hardFails.length * 50));
  return { score, scenes, classes, hardFails, notes };
}

function factual(topic, lines) {
  const text = lines.join(" ");
  const numeric = Sources.numericSupport(text, topic);
  const superlatives = Sources.unsupportedSuperlatives(text, topic);
  const hardFails = [];
  const notes = [];
  if (!numeric.supported) hardFails.push("unsupported number(s) in narration: " + numeric.unsupported.join(", "));
  if (superlatives.length) notes.push("unsupported superlative(s): " + superlatives.join(", "));
  if (topic.channel === "impossible-brief" && CERTAINTY.test(text)) hardFails.push("speculative scenario narrated with false certainty");
  const classes = (topic.evidence || []).map((item) => Sources.classifyClaim(item.layer || item.confidence));
  const distribution = {};
  for (const value of classes) distribution[value] = (distribution[value] || 0) + 1;
  const unclassified = distribution.UNCLASSIFIED || 0;
  if (unclassified) notes.push(`${unclassified} evidence item(s) without a recognised confidence class`);
  const score = Math.max(0, 100 - hardFails.length * 60 - superlatives.length * 10 - Math.min(20, unclassified * 5));
  return { score, hardFails, notes, claimClasses: distribution, unsupportedNumbers: numeric.unsupported };
}

module.exports = { visual, factual, classifyScene, CERTAINTY };
