"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const TopicVisuals = require("../../core/rendering/topic-visuals");
const Rendering = require("../../core/rendering");
const PackageQuality = require("../../core/quality/impossible-brief");
const BtoQuality = require("../../core/quality/behind-the-ordinary");

function shot(sourceId, type, start, end, claimIndex = 0, claimText = "80,800 km", numbers = ["80,800 km"]) {
  return { sourceId, type, start, end, duration: end - start, claimIndex, claimText, numbers };
}

function packageWith(renderQuality) {
  return {
    script: { forbiddenOpening: false },
    titles: Array.from({ length: 20 }, (_, index) => `Title ${index}`),
    visuals: Array.from({ length: 5 }, () => ({ changeRequiredWithinSeconds: 3 })),
    sources: [{}, {}],
    metadata: { uploadChannel: "impossible-brief" },
    renderVisuals: { visualQuality: renderQuality },
  };
}

test("rendered-visual gate blocks the old repeated generic composition", () => {
  const plan = Array.from({ length: 6 }, (_, index) => shot("procedural:generic", "procedural", index * 3, index * 3 + 3, index, "No measured value", []));
  const metrics = TopicVisuals.visualMetrics(plan);
  const gate = TopicVisuals.evaluateVisualQuality(metrics);
  assert.equal(metrics.distinctVisuals, 1);
  assert.equal(metrics.maxStaticSeconds, 18);
  assert.equal(gate.decision, "BLOCK");
  assert.ok(gate.reasons.some((reason) => reason.includes("distinct visuals")));
  assert.ok(gate.reasons.some((reason) => reason.includes("licensed real images")));
  assert.equal(PackageQuality.evaluatePackage(packageWith(gate)).decision, "BLOCK");
});

test("rendered-visual gate passes varied licensed stills and sourced cards", () => {
  const plan = [
    shot("card:0:distance", "number-card", 0, 2.5),
    shot("still:earth.jpg", "licensed-still", 2.5, 5, 1, "Gravity changes", []),
    shot("card:2:speed", "number-card", 5, 7.5, 2, "At 20–25 RPM", ["20–25 RPM"]),
    shot("still:moon.jpg", "licensed-still", 7.5, 10, 3, "The Moon remains visible", []),
    shot("card:4:time", "number-card", 10, 13, 4, "It takes 38 minutes", ["38 minutes"]),
  ];
  const metrics = TopicVisuals.visualMetrics(plan);
  assert.deepEqual({ distinct: metrics.distinctVisuals, images: metrics.realImageCount, cards: metrics.numberCardCount }, { distinct: 5, images: 2, cards: 3 });
  const gate = TopicVisuals.evaluateVisualQuality(metrics);
  assert.equal(gate.decision, "PUBLISH");
  assert.equal(PackageQuality.evaluatePackage(packageWith(gate)).decision, "PUBLISH");
});

test("opening semantic gate rejects generic roads/Oak Alley and accepts a real road-stud mechanism", () => {
  const topic = { canonicalTopic: "road cat's eyes", subject: "road stud", designDetail: "self-cleaning reflector mechanism" };
  const oak = TopicVisuals.semanticVisualEvidence(topic, { type: "licensed-still", still: { file: "Oak Alley road photograph.jpg", description: "A road under oak trees" } });
  assert.equal(oak.relevant, false);
  assert.match(oak.reason, /Oak Alley/);
  const genuine = TopicVisuals.semanticVisualEvidence(topic, { type: "licensed-still", still: { file: "Road stud reflector close-up.jpg", description: "Catseye road reflector mechanism" } });
  assert.equal(genuine.relevant, true);
  assert.ok(genuine.matchedTerms.some((term) => ["stud", "reflector"].includes(term)));
  const generic = TopicVisuals.semanticVisualEvidence({ canonicalTopic: "ocean current sensor system" }, { type: "licensed-still", still: { file: "Ocean.jpg", description: "generic ocean view" } });
  assert.equal(generic.relevant, false, "generic ocean/system words alone are not evidence");
});

test("Behind the Ordinary package gate has rendered-visual BLOCK parity", () => {
  const pkg = packageWith({ decision: "BLOCK", score: 40, reasons: ["opening asset is unrelated"] });
  pkg.channel = "behind-the-ordinary";
  pkg.topic = { productionReady: true, researchStatus: "VERIFIED" };
  pkg.thumbnail = { maxWords: 3 };
  pkg.metadata.uploadChannel = "behind-the-ordinary";
  assert.equal(BtoQuality.evaluatePackage(pkg).decision, "BLOCK");
});

test("number cards use only number-and-unit tokens present in their narration line", () => {
  const line = "The rim spans 80,800 km and turns at 20–25 RPM.";
  assert.deepEqual(TopicVisuals.numberTokens(line), ["80,800 km", "20–25 RPM"]);
  assert.deepEqual(TopicVisuals.numberTokens("In 2011, it stopped."), ["2011"]);
  assert.deepEqual(TopicVisuals.numberTokens("Drilling Kola SG-3 began in 1970."), ["SG-3", "1970"]);
  const script = { targetSeconds: 6, claims: [{ text: line, start: 0, end: 6 }] };
  const topic = { id: "IB-TEST", category: "SPACE", visualPotential: { scenes: ["rotating orbital habitat"] } };
  const plan = TopicVisuals.buildVisualPlan(topic, script, [], [3, 3], 6);
  const cards = plan.filter((item) => item.type === "number-card");
  // One card per narration line, and km vs RPM is not a comparison.
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].numbers, ["80,800 km"]);
  assert.deepEqual(cards[0].comparison, []);
  assert.ok(cards.every((item) => item.numbers.every((token) => item.claimText.includes(token))));
  assert.equal(TopicVisuals.visualMetrics(plan).cardNumbersValid, true);
  const sameUnit = TopicVisuals.buildVisualPlan(topic, { targetSeconds: 3, claims: [{ text: "Winters fall from 15 °C to 5 °C.", start: 0, end: 3 }] }, [], [3], 3);
  assert.deepEqual(sameUnit[0].comparison, ["15 °C", "5 °C"]);
});

test("cards only for values with a unit; bare numbers and identifiers stay off screen", () => {
  assert.deepEqual(TopicVisuals.cardTokens(["8", "4", "10", "1970", "SG-3"]), []);
  assert.deepEqual(TopicVisuals.cardTokens(["25%", "10 °C", "80,800 km", "7 million"]), ["25%", "10 °C", "80,800 km", "7 million"]);
});

test("visual plan leads with photographs, caps cards, and reuses stills with a new camera move", () => {
  const stills = [
    { file: "AMOC chart.png", description: "model graph" },
    { file: "Gulf Stream from orbit.jpg", description: "satellite photograph" },
    { file: "Iceberg.jpg", description: "iceberg near Greenland" },
  ];
  assert.deepEqual(stills.map(TopicVisuals.stillKind), ["diagram", "photo", "photo"]);
  const claims = Array.from({ length: 6 }, (_, index) => ({ text: `Line ${index} moves ${index + 2}0% of the heat.`, start: index * 5, end: index * 5 + 5 }));
  const plan = TopicVisuals.buildVisualPlan({ id: "IB-PLAN" }, { targetSeconds: 30, claims }, stills, Array(12).fill(2.5), 30);
  const cards = plan.filter((shot) => shot.type === "number-card");
  assert.ok(cards.length <= 3, `cards ${cards.length}`);
  assert.ok(plan.every((shot, index) => !index || !(shot.type === "number-card" && plan[index - 1].type === "number-card")), "no back-to-back cards");
  assert.ok(cards.every((card) => card.backdrop), "cards sit on a picture from the topic");
  const firstStill = plan.find((shot) => shot.type === "licensed-still");
  assert.equal(firstStill.kind, "photo", "photographs before diagrams");
  assert.ok(plan.every((shot, index) => !index || shot.type !== "licensed-still" || plan[index - 1].still !== shot.still), "never the same picture twice in a row");
  const reused = plan.filter((shot) => shot.type === "licensed-still" && shot.motion > 0);
  assert.ok(reused.length > 0 && reused.every((shot) => /#\d+$/.test(shot.sourceId)));
  const metrics = TopicVisuals.visualMetrics(plan);
  assert.equal(metrics.realImageCount, 3, "a re-used still counts once");
  assert.equal(TopicVisuals.evaluateVisualQuality(metrics).decision, "PUBLISH");
});

test("number-card type scales down wide sourced values to stay inside the card", () => {
  assert.ok(Rendering.numberCardFontSize("30 MINUTES") <= 122);
  assert.ok(Rendering.numberCardFontSize("80,800 KM  VS  20–25 RPM") < Rendering.numberCardFontSize("7 MILLION"));
});

test("pipeline skips a topic rejected only by the rendered-visual gate", () => {
  const os = require("os");
  const { visualRejection } = require("../../core/pipeline/impossible-brief");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "visual-rejection-"));
  const attribution = (error) => fs.writeFileSync(path.join(directory, "visual-attribution.json"), JSON.stringify({ count: 1, stills: [], error }));
  const result = (validations, validationReasons) => ({ validations: { script: true, audio: true, ...validations }, validationReasons });
  const visualBlock = result({ visuals: false, qualityGate: false }, {
    visuals: ["requires 2 licensed real images or 5 number cards (got 1 images, 1 cards)"],
    qualityGate: ["rendered visuals: requires 2 licensed real images or 5 number cards (got 1 images, 1 cards)"],
  });

  attribution(null);
  assert.match(visualRejection(visualBlock, directory), /requires 2 licensed real images/);
  // A Commons fetch failure is transient: the topic must not be blocked forever.
  attribution("visual cache preparation failed");
  assert.equal(visualRejection(visualBlock, directory), null);
  attribution(null);
  // Any non-visual failure keeps the old hard failure.
  assert.equal(visualRejection(result({ visuals: false, audio: false }, {}), directory), null);
  assert.equal(visualRejection(result({ visuals: false, qualityGate: false }, { qualityGate: ["unsupported claim"] }), directory), null);
  assert.equal(visualRejection(result({ qualityGate: false }, { qualityGate: ["rendered visuals: x"] }), directory), null);
  assert.equal(visualRejection(result({}, {}), directory), null);
});

test("music bed mood follows the topic category; colour grade is per channel", () => {
  const Muzik = require("../../lib/muzik");
  assert.equal(Rendering.musicMood({ channel: "impossible-brief", category: "SPACE" }), "spaceflight-disasters");
  assert.equal(Rendering.musicMood({ channel: "impossible-brief", category: "EARTH" }), "natural-hazards");
  assert.equal(Rendering.musicMood({ channel: "critical-thread", category: "PORTS" }), "maritime-disasters");
  assert.equal(Rendering.musicMood({ channel: "critical-thread", category: "RAIL" }), "infrastructure-failures");
  for (const mood of ["spaceflight-disasters", "natural-hazards", "aviation-failures", "materials-failures", "nuclear-accidents", "industrial-disasters", "maritime-disasters", "infrastructure-failures"]) {
    assert.ok(Muzik.RUH[mood], `mood ${mood} exists in lib/muzik.js`);
  }
  assert.notEqual(Rendering.colourGrade({ channel: "impossible-brief" }), Rendering.colourGrade({ channel: "critical-thread" }));
  assert.equal(Rendering.colourGrade({ channel: "critical-thread", colorGrade: "" }), "");
});

test("ImpossibleBrief records render with their channel's look and music", () => {
  const Channel = require("../../core/channel-context");
  const Discovery = require("../../core/discovery");
  const topic = Discovery.universe(Channel.getChannel("impossible-brief")).topics[0];
  assert.equal(topic.channel, undefined, "IB research records carry no channel field");
  const source = fs.readFileSync(path.join(__dirname, "../../core/rendering/index.js"), "utf8");
  assert.match(source, /const renderTopic = topic\.channel \? topic : \{ \.\.\.topic, channel: channel\.slug \}/);
  assert.notEqual(Rendering.musicMood({ ...topic, channel: "impossible-brief" }), "structural-failures");
});

test("a still comes back only when the previous shot cannot hold longer", () => {
  const stills = [{ file: "Tunnel entrance.jpg" }, { file: "Portal.jpg" }];
  const claims = Array.from({ length: 4 }, (_, index) => ({ text: `Line ${index} without values.`, start: index * 4, end: index * 4 + 4 }));
  const plan = TopicVisuals.buildVisualPlan({ id: "CT-HOLD" }, { targetSeconds: 16, claims }, stills, Array(16).fill(1), 16);
  for (const [index, shot] of plan.entries()) {
    if (shot.type !== "licensed-still" || !(shot.motion > 0)) continue;
    const previous = plan[index - 1];
    assert.ok(!previous || !["licensed-still", "stock-video"].includes(previous.type) || previous.duration + shot.duration > 3.75,
      `shot ${shot.shot} reuses a still although shot ${previous.shot} could have held`);
  }
  assert.ok(plan.every((shot) => shot.duration <= 4.001), "static-hold limit kept");
  assert.equal(plan[0].start, 0);
  assert.ok(Math.abs(plan[plan.length - 1].end - 16) < 0.001, "timeline still covers the whole narration");
  assert.ok(plan.every((shot, index) => !index || Math.abs(shot.start - plan[index - 1].end) < 0.001), "no gaps after holding longer");
  const old = plan.filter((shot) => shot.type === "licensed-still").length;
  assert.ok(old < 16, `fewer cuts than pacing segments when pictures run out (${old})`);
});

test("artist's illustrations and cutaways never count as photographs", () => {
  assert.equal(TopicVisuals.stillKind({ file: "Plate Tectonics on Europa.jpg", description: "Artist's illustration of subduction" }), "diagram");
  assert.equal(TopicVisuals.stillKind({ file: "Europa-moon.jpg", description: "Europa imaged by Galileo" }), "photo");
});

test("ImpossibleBrief and CriticalThread narrate at Failure Reconstructed's brisker Shorts pace", () => {
  const Channel = require("../../core/channel-context");
  for (const slug of ["impossible-brief", "critical-thread"]) {
    const rate = Number(String(Channel.getChannel(slug).config.voice.rate).replace("%", ""));
    assert.ok(rate >= 0 && rate <= 10, `${slug} voice rate ${rate}%`);
  }
  const source = fs.readFileSync(path.join(__dirname, "../../core/rendering/index.js"), "utf8");
  assert.match(source, /const LINE_PAUSE_SECONDS = 0\.18;/);
});

test("multi-panel comparisons and composites are shown whole, never cropped as a photo", () => {
  for (const file of ["Europa, Earth & Moon size comparison.jpg", "Photo composite of suspected water plumes on Europa.jpg", "Galileo mosaic of Europa.jpg"]) {
    assert.equal(TopicVisuals.stillKind({ file }), "diagram", file);
  }
  assert.equal(TopicVisuals.stillKind({ file: "Tunel mont blanc.jpg" }), "photo");
});

test("stills: the story's own article leads, and within it pictures naming the subject", () => {
  const items = [
    { file: "Gotthard Road Tunnel - Ventilation Center Bäzberg (15607257755).jpg", articleRank: 0, score: 9 },
    { file: "Ventilation System (9627691007).jpg", articleRank: 0, score: 8 },
    { file: "Tunel mont blanc.jpg", articleRank: 0, score: 1 },
    { file: "Entrance of Mont-Blanc tunnel from le Brevent.jpg", articleRank: 0, score: 2 },
    { file: "Jet fan in a road tunnel.jpg", articleRank: 1, score: 10 },
    { file: "NASA tunnel photo.jpg", articleRank: 0.5, score: 5 },
  ];
  const ordered = TopicVisuals.orderStills(items, ["Mont Blanc Tunnel", "Tunnel ventilation"], ["ventilation", "road", "tunnel"]);
  assert.deepEqual(ordered.slice(0, 2).map((item) => item.file), ["Entrance of Mont-Blanc tunnel from le Brevent.jpg", "Tunel mont blanc.jpg"]);
  assert.equal(ordered[ordered.length - 1].file, "Jet fan in a road tunnel.jpg", "background article last");
  assert.ok(ordered.findIndex((item) => item.file.startsWith("NASA")) > ordered.findIndex((item) => item.file.startsWith("Ventilation System")), "NASA after the story's own article");
});

test("visual pre-check skips picture-poor topics before a render, but never on a source outage", () => {
  const os = require("os");
  const Pipeline = require("../../core/pipeline/impossible-brief");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precheck-"));
  try {
    const topic = { id: "CT-X", slug: "ct-x" };
    const fake = (stills, clips = 0, error) => () => ({ stills: Array(stills).fill({}), clips: Array(clips).fill({}), error });
    assert.match(Pipeline.visualShortfall(topic, dir, fake(1)), /1 licensed pictures\/clips < 4/);
    assert.match(Pipeline.visualShortfall(topic, dir, fake(2, 1)), /3 licensed/);
    assert.equal(Pipeline.visualShortfall(topic, dir, fake(3, 1)), null);
    assert.equal(Pipeline.visualShortfall(topic, dir, fake(0, 0, "Commons timeout")), null, "outage: let the render gate decide");
    assert.ok(fs.existsSync(path.join(dir, "topic.json")), "the render reuses the same topic file and picture cache");
    const source = fs.readFileSync(path.join(__dirname, "../../core/pipeline/impossible-brief.js"), "utf8");
    assert.match(source, /const shortfall = !noRender && !explicit \? visualShortfall\(topic, output\) : null;/);
    assert.match(source, /attempt -= 1;\n      continue;/, "pre-check skips do not use up render attempts");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("multi-panel figures are detected from titles listing several features", () => {
  assert.equal(TopicVisuals.stillKind({ file: "Europa PIA2387x - Chaos Transition, Crisscrossing Bands & Chaos Near Agenor Linea.jpg" }), "diagram");
  assert.equal(TopicVisuals.stillKind({ file: "Jupiter's moon Europa, as seen by Juno.jpg" }), "photo", "one comma is a caption, not panels");
  assert.equal(TopicVisuals.stillKind({ file: "Gotthard Road Tunnel - Ventilation Center Bäzberg (15607257755).jpg" }), "photo");
  assert.equal(TopicVisuals.stillKind({ file: "Dam.jpg", description: "Two panels side by side" }), "diagram");
});

test("number cards count up only for whole sourced values, then show the exact text", () => {
  const card = (numbers, extra = {}) => ({ numbers, duration: 2, ...extra });
  assert.deepEqual(Rendering.countUp(card(["39"])), { value: 39, suffix: "", seconds: 0.9 });
  assert.deepEqual(Rendering.countUp(card(["14,800 tonnes"])), { value: 14800, suffix: " TONNES", seconds: 0.9 });
  assert.equal(Rendering.countUp(card(["45%"])).suffix, "%");
  for (const numbers of [["1999"], ["11.611 kilometres"], ["2–3"], ["8"], ["200", "400"]]) assert.equal(Rendering.countUp(card(numbers)), null, numbers.join("|"));
  assert.equal(Rendering.countUp(card(["300 metres"], { comparison: ["300", "400"] })), null);
  assert.equal(Rendering.countUp(card(["39"], { duration: 0.6 })).seconds, 0.5, "short shots count faster");
  const shot = card(["39"]);
  shot.countUp = Rendering.countUp(shot);
  const filter = Rendering.countUpFilter(shot);
  assert.match(filter, /text='%\{eif\\:floor\(39\*t\/0\.9\)\\:d\}'.*enable='lt\(t,0\.9\)'/);
  assert.match(filter, /text='39'.*enable='gte\(t,0\.9\)'/, "the exact sourced value after the count");
  assert.doesNotMatch(filter, /min\(/, "no comma inside the expression");
});
