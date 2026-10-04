"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("../core/channel-context");
const Context = require("../core/growth/context");
const Growth = require("../core/growth");
const Experiment = require("../core/growth/publish-time-experiment");

function read(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function latestShort(channel) {
  const file = path.join(channel.paths.state, channel.config.pathMode === "legacy-adapter" ? "yayinlananlar.json" : "published.json");
  return (read(file, []) || []).filter((row) => (row.format || "short") === "short" && row.videoId)
    .sort((a, b) => String(b.publishAt || b.tarih).localeCompare(String(a.publishAt || a.tarih)))[0] || null;
}
function packageEvidence(channel, publication) {
  const directory = path.join(channel.paths.packages, publication.slug);
  const statePlan = read(path.join(channel.paths.state, "growth", "shorts", `${publication.slug}.json`), null);
  const packagePlan = read(path.join(directory, "growth-plan.json"), null);
  return {
    directory,
    growth: packagePlan || statePlan,
    quality: read(path.join(directory, "quality-gate.json"), null),
    render: read(path.join(directory, "render.json"), null),
    titles: read(path.join(directory, "titles.json"), null),
    attribution: read(path.join(directory, "visual-attribution.json"), null),
    provenance: read(path.join(directory, "provenance.json"), null),
  };
}
function chooseReplacement(channel, originalTopic, originalPlan) {
  if (originalPlan.viralPotentialGate.decision === "PRODUCE") return { topic: originalTopic, plan: originalPlan, case: "CASE_D", reuseTopic: true,
    reason: "Topic passes the separate viral-potential gate; rerun hook/title competition and the corrected render gates." };
  const selection = Growth.selectShortTopic(channel, { date: "2026-10-04" });
  if (!selection.selected) return { topic: null, plan: null, case: "BLOCKED", reuseTopic: false, reason: selection.reason };
  const topic = selection.selected.topic;
  const plan = Growth.planShort(channel, topic.id, { context: selection.ranked.context, skipDuplicate: true, selection: selection.decision });
  return { topic, plan, case: "CASE_B", reuseTopic: false,
    reason: `Original viral potential ${originalPlan.topicScore.ViralPotentialScore} is below ${originalPlan.viralPotentialGate.minimum}; selected the strongest unused qualified alternative.` };
}

const output = path.join(Channel.ROOT, "reports", "corrected-replacements");
const audits = [];
for (const slug of Object.keys(Channel.registry().channels)) {
  const channel = Channel.getChannel(slug);
  const publication = latestShort(channel);
  if (!publication) continue;
  const context = Context.build(channel);
  const originalTopic = context.inventory.find((topic) => topic.slug === publication.slug || topic.id === publication.slug);
  if (!originalTopic) throw new Error(`${slug}: latest topic not found: ${publication.slug}`);
  const originalPlan = Growth.planShort(channel, originalTopic.id, { context, skipDuplicate: true });
  const evidence = packageEvidence(channel, publication);
  const replacement = chooseReplacement(channel, originalTopic, originalPlan);
  const firstStill = evidence.attribution && evidence.attribution.stills && evidence.attribution.stills[0] || null;
  const oldGrowth = evidence.growth || {};
  const oldHook = oldGrowth.hooks && oldGrowth.hooks.selected && oldGrowth.hooks.selected.spoken || oldGrowth.growthMeta && oldGrowth.growthMeta.selectedHook || null;
  const oldScript = oldGrowth.script && (oldGrowth.script.spoken || oldGrowth.script.lines && oldGrowth.script.lines.join(" ")) || null;
  const oldVisualQuality = evidence.render && evidence.render.video && evidence.render.video.visualQuality || null;
  const defects = [];
  if (oldGrowth.readiness && oldGrowth.readiness.dimensions && oldGrowth.readiness.dimensions.visualQuality === 82) defects.push("final growth readiness fabricated visualQuality=82 instead of consuming render evidence");
  if (!oldVisualQuality || !oldVisualQuality.semanticEvidence) defects.push("opening semantic relevance was not measured in render.json");
  if (slug === "failure-reconstructed") defects.push("old hook/title component scores were 70/65; package deserved a stronger competition pass");
  if (slug === "critical-thread") defects.push("published script opened with malformed English: 'Why servers get only 5 to 15 minutes.'");
  if (slug === "behind-the-ordinary") defects.push("opening asset was an Oak Alley road photograph, not a road stud or its reflector mechanism", `original topic viral potential ${originalPlan.topicScore.ViralPotentialScore} is below the production minimum`);
  if (slug === "impossible-brief") defects.push("opening asset emphasized the old crater rather than the immediate present-day impact premise; semantic evidence was absent");
  const performanceRows = read(path.join(channel.paths.state, "growth", "performance.json"), []);
  const performance = (performanceRows || []).find((row) => row.videoId === publication.videoId) || null;
  audits.push({
    channel: channel.name, channelSlug: slug, originalVideoId: publication.videoId, originalTitle: publication.baslik || publication.title,
    originalTopicId: originalTopic.id, originalTopic: originalTopic.title, originalScript: oldScript,
    originalSelectedHook: oldHook, originalFirst3Seconds: oldGrowth.first3Seconds || null,
    originalOpeningAsset: firstStill, originalVisualPlan: originalTopic.visualScenes, originalVisualQuality: oldVisualQuality,
    originalSources: originalTopic.sources, originalProvenance: evidence.provenance, originalTitleCandidates: evidence.titles,
    originalTopicScore: originalPlan.topicScore.VideoPotentialScore, originalViralPotentialScore: originalPlan.topicScore.ViralPotentialScore,
    knownPerformance: performance, publishTimeCohort: Experiment.cohort(publication.publishAt),
    performanceDiagnosis: performance && performance.diagnoses || ["TOO_EARLY_TO_JUDGE", "DISTRIBUTION_LIMITED"], performanceConfidence: performance && performance.metrics ? "MEASURED" : "NO_ANALYTICS_CHECKPOINTS",
    defects, replacementCase: replacement.case, reuseTopic: replacement.reuseTopic, replacementReason: replacement.reason,
    replacementTopicId: replacement.topic && replacement.topic.id, replacementTopic: replacement.topic && replacement.topic.title,
    newHook: replacement.plan && replacement.plan.hooks.selected && replacement.plan.hooks.selected.spoken,
    newTitle: replacement.plan && replacement.plan.titles.selected && replacement.plan.titles.selected.title,
    newFirst3Seconds: replacement.plan && replacement.plan.first3Seconds,
    viralPotentialScore: replacement.plan && replacement.plan.topicScore.ViralPotentialScore,
    viralPotentialDecision: replacement.plan && replacement.plan.viralPotentialGate.decision,
    preRenderQualityDecision: replacement.plan && replacement.plan.readiness.decision,
    replacementForVideoId: publication.videoId, originalVideoId: publication.videoId, replacementVersion: 1,
  });
}

const report = { schema: "corrected-replacement-audit/1", generatedAt: new Date().toISOString(), analyticsNote: "No 01:00 video has a local analytics checkpoint yet; no metric or significance is fabricated.", audits };
write(path.join(output, "audit.json"), report);
const lines = ["# Corrected replacement audit", "", report.analyticsNote, "", "| Channel | Original | Case | Reuse topic | Replacement topic | Viral | Pre-render |", "|---|---|---|---:|---|---:|---|"];
for (const row of audits) lines.push(`| ${row.channel} | ${row.originalVideoId} — ${row.originalTitle} | ${row.replacementCase} | ${row.reuseTopic ? "YES" : "NO"} | ${row.replacementTopic} | ${row.viralPotentialScore} | ${row.preRenderQualityDecision} |`);
lines.push("", ...audits.flatMap((row) => [`## ${row.channel}`, "", `Old → new title: **${row.originalTitle}** → **${row.newTitle}**`, "", `Old → new hook: **${row.originalSelectedHook || "not preserved in package"}** → **${row.newHook}**`, "", ...row.defects.map((item) => `- ${item}`), ""]));
fs.writeFileSync(path.join(output, "audit.md"), lines.join("\n") + "\n");
console.log(path.join(output, "audit.json"));
