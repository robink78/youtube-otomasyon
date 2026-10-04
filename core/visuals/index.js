"use strict";

function plan(topic, script) {
  if (topic.channel === "critical-thread") {
    const priority = ["government-technical-media", "manufacturer-technical-material", "standards-diagram", "procedural-system-map", "labelled-technical-illustration", "licensed-industrial-footage"];
    return script.claims.map((claim, index) => ({
      scene: index + 1, start: claim.start, end: claim.end,
      sourcePriority: priority[Math.min(index, priority.length - 1)],
      subject: topic.visualPotential.scenes[index % topic.visualPotential.scenes.length],
      evidenceLabel: claim.layer === "MODEL" || claim.layer === "HYPOTHESIS" ? "MODEL / ILLUSTRATION" : claim.layer,
      changeRequiredWithinSeconds: 3.5,
    }));
  }
  if (topic.channel === "behind-the-ordinary") {
    const priority = ["licensed-object-photography", "macro-detail-photography", "manufacturer-archive", "standards-diagram", "labelled-technical-illustration", "object-in-use"];
    return script.claims.map((claim, index) => ({
      scene: index + 1, start: claim.start, end: claim.end,
      sourcePriority: priority[Math.min(index, priority.length - 1)],
      subject: topic.visualPotential.scenes[index % topic.visualPotential.scenes.length],
      evidenceLabel: /ILLUSTRATION|MODEL/.test(claim.layer) ? "ILLUSTRATION" : claim.layer,
      changeRequiredWithinSeconds: 3.5,
    }));
  }
  const priority = ["official-scientific-media", "scientific-diagram", "public-domain-astronomy", "procedural-simulation", "labelled-ai-illustration", "relevant-stock"];
  return script.claims.map((claim, index) => ({
    scene: index + 1,
    start: claim.start,
    end: claim.end,
    sourcePriority: priority[Math.min(index, priority.length - 1)],
    subject: topic.visualPotential.scenes[index % topic.visualPotential.scenes.length],
    evidenceLabel: claim.layer === "SPECULATIVE SCENARIO" ? "ILLUSTRATION" : claim.layer,
    changeRequiredWithinSeconds: 3.5,
  }));
}

function thumbnail(topic) {
  if (topic.channel === "critical-thread") return {
    subject: topic.canonicalTopic,
    text: [topic.thumbnailText],
    maxWords: 3,
    palette: ["#07090d", "#c8ced8", "#d6ae5f", "#5aa9e6"],
    clutter: false,
    concepts: [
      { id: "critical-object", composition: `${topic.canonicalTopic} isolated against a dark technical field`, consequence: "faint global network" },
      { id: "system-map", composition: `${topic.canonicalTopic} centered inside a minimal dependency map`, consequence: "downstream nodes dimmed" },
      { id: "scale", composition: `extreme close view of ${topic.canonicalTopic}`, consequence: "small Earth silhouette" },
      { id: "failure", composition: `${topic.canonicalTopic} with one precise break or warning marker`, consequence: "restrained dark infrastructure" },
      { id: "replacement", composition: `${topic.canonicalTopic} beside an empty replacement outline`, consequence: "lead-time clock" },
    ],
  };
  if (topic.channel === "behind-the-ordinary") return {
    subject: topic.canonicalTopic || topic.object,
    text: [topic.thumbnailText].filter(Boolean),
    maxWords: 4,
    palette: ["#15130f", "#f3ead8", "#f2ad45", "#4eb3a5"],
    clutter: false,
    concepts: [
      { id: "single-object-detail", composition: `one ${topic.canonicalTopic} filling the frame`, consequence: `one amber marker on ${topic.designDetail}` },
      { id: "macro-purpose", composition: `macro crop of ${topic.designDetail}`, consequence: "rest of object softly out of focus" },
      { id: "then-now", composition: `clean two-panel historical and modern ${topic.canonicalTopic}`, consequence: `${topic.designDetail} aligned across both` },
      { id: "cutaway", composition: `labelled cutaway of ${topic.designDetail}`, consequence: "one teal motion or force arrow" },
      { id: "misconception", composition: `${topic.canonicalTopic} isolated on warm charcoal`, consequence: `wrong use dimmed, documented purpose highlighted` },
    ],
  };
  return { subject: topic.visualPotential.scenes[0], impossibleVisual: topic.scenarioChange, text: [], maxWords: 3, palette: ["#030712", "#25d9ff", "#b9eaff", "#ffffff"], clutter: false };
}

module.exports = { plan, thumbnail };
