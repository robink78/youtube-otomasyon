"use strict";

// FIRST 3 SECONDS AS A SEPARATE PRODUCT (PHASE 6).
// The plan is built from the selected hook plus the channel's real visual
// material: Failure Reconstructed opens on the archival film's striking moment
// (existing retention rule: never the reel's leader), ImpossibleBrief and
// CriticalThread open on a labelled consequence/dependency frame.

const GENERIC_FRAME = /\b(logo|intro|title card|skyline|establishing|aerial view of city|stock b-roll|channel name|countdown card)\b/i;

function clamp(value) { return Math.max(0, Math.min(100, Math.round(value))); }

function firstFrame(topic, hook) {
  const scene = (topic.visualScenes || [])[0] || {};
  if (topic.channel === "failure-reconstructed") {
    const film = topic.archivalFilm;
    return {
      description: scene.text ? `Evidence frame for: "${scene.text}"` : `Evidence frame of ${topic.subject}`,
      source: scene.source || (topic.footageSources || [])[0] || null,
      startAtSeconds: scene.start != null ? scene.start : null,
      sourceClass: film ? "REAL_ARCHIVAL" : topic.stock ? "LICENSED_STOCK" : topic.archival ? "REAL_ARCHIVAL" : "RECONSTRUCTION",
      communicates: /collapse|explod|tore|sank|burn|fell|fire|crash/i.test(hook.spoken + " " + (scene.text || "")) ? "consequence" : "tension",
      rule: film && scene.start == null ? "VIOLATION: archival opening must name the striking moment (baslangic)" : "opens on the most striking evidence moment, never the reel's leader",
    };
  }
  const subject = (topic.visualScenes || [])[0] ? topic.visualScenes[0].text : topic.subject;
  return {
    description: topic.channel === "critical-thread"
      ? `${topic.subject} isolated, dependency lines to what fails without it`
      : topic.channel === "behind-the-ordinary"
        ? `${topic.subject} fills the frame; one marker isolates ${topic.designDetail || "the unusual detail"}`
      : `${subject} at the moment the impossible change begins`,
    source: "procedural render",
    startAtSeconds: 0,
    sourceClass: topic.channel === "critical-thread" ? "TECHNICAL_ILLUSTRATION" : topic.channel === "behind-the-ordinary" ? "REAL_OBJECT" : "ILLUSTRATION",
    communicates: topic.channel === "critical-thread" ? "dependency" : "mystery",
    rule: "labelled illustration; no logo, no establishing shot",
  };
}

function plan(topic, hookBundle, config, options = {}) {
  const hook = hookBundle.selected;
  if (!hook) return { score: 0, passes: false, blockers: ["no selectable hook"] };
  const frame = firstFrame(topic, hook);
  const onScreenWords = String(hook.onScreen || "").split(/\s+/).filter(Boolean).length;
  const narrationSeconds = hook.estimatedSeconds;
  const openingMax = options.openingMaxSeconds || 2.2;
  const firstCut = Math.min(config.firstSeconds.firstCutWithinSeconds, Math.max(0.8, narrationSeconds / 2));
  const soundCue = config.firstSeconds.soundCue ? (typeof config.firstSeconds.soundCue === "string" ? config.firstSeconds.soundCue : "single low hit on the first cut") : null;
  const motion = topic.channel === "failure-reconstructed"
    ? (topic.archivalFilm ? "no zoom on moving film; punch-in crop 100→108% at the first cut" : "slow push-in 100→112% on the still, hard cut at the first beat")
    : topic.channel === "critical-thread" ? "dependency lines draw outward in 0.6 s, then hard cut"
      : topic.channel === "behind-the-ordinary" ? "macro push toward the highlighted detail in 0.7 s, then cut to source evidence"
        : "scale shift: object shrinks/grows in 0.8 s, then hard cut";
  const blockers = [];
  const notes = [];
  if (GENERIC_FRAME.test(frame.description)) blockers.push("generic establishing/logo first frame");
  if (/^VIOLATION/.test(frame.rule)) blockers.push(frame.rule);
  if (onScreenWords > config.firstSeconds.maxOnScreenWords) notes.push(`on-screen text ${onScreenWords} words > ${config.firstSeconds.maxOnScreenWords}`);
  if (narrationSeconds > openingMax * 1.6) notes.push(`hook narration ~${narrationSeconds}s; opening window ${openingMax}s`);
  const frameScore = frame.sourceClass === "REAL_ARCHIVAL" ? 95 : frame.sourceClass === "REAL_OBJECT" ? 92 : frame.sourceClass === "LICENSED_STOCK" ? 65 : 78;
  const score = clamp(
    hook.scores.SwipeStoppingPower * 0.4 +
    frameScore * 0.25 +
    (onScreenWords > 0 && onScreenWords <= config.firstSeconds.maxOnScreenWords ? 100 : 55) * 0.15 +
    (firstCut <= config.firstSeconds.firstCutWithinSeconds ? 100 : 50) * 0.1 +
    (narrationSeconds <= openingMax * 1.6 ? 100 : 60) * 0.1
  ) - (blockers.length ? 40 : 0);
  return {
    First3SecondPlan: {
      narration: hook.spoken,
      firstFrame: frame,
      visual: frame.description,
      onScreenText: hook.onScreen,
      motion,
      cutTiming: [0, Math.round(firstCut * 10) / 10, Math.round(Math.min(3, firstCut * 2) * 10) / 10],
      soundCue,
      communicates: frame.communicates,
    },
    score: clamp(score),
    passes: blockers.length === 0 && clamp(score) >= config.firstSeconds.minimumScore,
    blockers,
    notes,
  };
}

module.exports = { plan, firstFrame, GENERIC_FRAME };
