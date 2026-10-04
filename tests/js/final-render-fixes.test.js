"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../../core/rendering/topic-visuals");

test("raw ImpossibleBrief scenario/mechanism fields can establish semantic opening relevance", () => {
  const topic = {
    topic: "What If the Dinosaur-Killing Asteroid Hit Today?",
    scenarioChange: "a Chicxulub-size asteroid strikes Earth today",
    scientificMechanism: "impact converts kinetic energy into heat, shock and ejecta",
    openingLine: "One 10-kilometre asteroid ended the age of dinosaurs."
  };
  const evidence = V.semanticVisualEvidence(topic, {
    type: "licensed-still",
    still: { file: "Yucatan chix crater.jpg", description: "Chicxulub impact crater and asteroid scale illustration" },
    claimText: topic.openingLine,
  });
  assert.equal(evidence.relevant, true);
  assert.ok(evidence.strongTerms.some((term) => ["chicxulub", "asteroid", "impact"].includes(term)));
});

test("a sparse two-still pool gains scene-specific procedural variety instead of endless reuse", () => {
  const topic = { slug: "bluetooth", topic: "Bluetooth logo", canonicalTopic: "the Bluetooth symbol", visualScenes: ["Bluetooth logo", "two runes", "runes merge", "runestone", "phone pairing"] };
  const claims = Array.from({ length: 5 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: `Bluetooth scene ${i + 1}.` }));
  const stills = [
    { file: "Bluetooth logo.jpg", description: "Bluetooth logo", width: 1000, height: 1000 },
    { file: "Bluetooth dongle.jpg", description: "Bluetooth dongle", width: 1000, height: 1000 },
  ];
  const plan = V.buildVisualPlan(topic, { claims, targetSeconds: 10 }, stills, [2, 2, 2, 2, 2], 10, [], { opening: "motion" });
  const distinct = new Set(plan.map((shot) => shot.visualKey || shot.sourceId));
  assert.ok(distinct.size >= 5, `distinct=${distinct.size}`);
  assert.ok(plan.some((shot) => shot.type === "procedural"));
});

test("loopBack never creates a consecutive same-source hold at the end", () => {
  const first = { type: "licensed-still", kind: "photo", visualKey: "A", sourceId: "A", still: { file: "A.jpg" }, motion: 0 };
  const plan = [
    first,
    { type: "procedural", visualKey: "B", sourceId: "B" },
    { type: "procedural", visualKey: "C", sourceId: "C" },
    { type: "procedural", visualKey: "D", sourceId: "D" },
    { type: "procedural", visualKey: "E", sourceId: "E" },
    { type: "licensed-still", kind: "photo", visualKey: "A", sourceId: "A2", still: { file: "A.jpg" }, motion: 1 },
    { type: "licensed-still", kind: "photo", visualKey: "Z", sourceId: "Z", still: { file: "Z.jpg" }, motion: 0 },
  ];
  const out = V.loopBack(plan);
  assert.equal(out[out.length - 1].visualKey, "Z");
  assert.equal(out[out.length - 1].loopBack, undefined);
});
