"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const Channel = require("../channel-context");
const Discovery = require("../discovery");
const Rendering = require("../rendering");
const Scripting = require("../scripting");
const Growth = require("../growth");
const GrowthRuntime = require("../growth/runtime");

function writeCompatibilityFiles(result, topic, channel) {
  const directory = result.outputDirectory;
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));
  fs.writeFileSync(path.join(directory, "konu.json"), JSON.stringify({
    slug: topic.slug,
    channel: channel.slug,
    format: "short",
    baslik: metadata.title,
    aciklama: metadata.description,
    etiketler: metadata.tags,
    bilim: topic.claimFramework,
    sahneler: result.validations.visuals ? JSON.parse(fs.readFileSync(path.join(directory, "visuals.json"), "utf8")).map((scene) => ({ metin: scene.subject, sentetik: scene.evidenceLabel === "ILLUSTRATION" })) : [],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(directory, "YUKLEME.json"), JSON.stringify({ baslik: metadata.title, aciklama: metadata.description, etiketler: metadata.tags }, null, 2) + "\n");
  if (result.render.completed) {
    const videoDirectory = path.join(directory, "Videos");
    fs.mkdirSync(videoDirectory, { recursive: true });
    const target = path.join(videoDirectory, topic.slug + ".mp4");
    fs.copyFileSync(result.render.video.file, target);
  }
  const packageDirectory = path.join(channel.paths.packages, topic.slug);
  fs.mkdirSync(packageDirectory, { recursive: true });
  for (const file of ["quality-gate.json", "render.json", "titles.json", "metadata.json", "sources.json", "thumbnail.json", "visual-attribution.json", "provenance.json", "validations.json", "long-form-outline.json", "short-factory.json"]) {
    const source = path.join(directory, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(packageDirectory, file));
  }
  const thumbnail = path.join(directory, "thumbnail.jpg");
  if (fs.existsSync(thumbnail)) fs.copyFileSync(thumbnail, path.join(packageDirectory, "onizleme.jpg"));
}

function writeValidationEvidence(result, topic, channel, output) {
  const failed = Object.entries(result.validations).filter(([, passed]) => !passed).map(([name]) => name);
  const evidence = {
    channel: channel.slug,
    topicId: topic.id,
    slug: topic.slug,
    passed: failed.length === 0,
    failed,
    checks: result.validations,
    reasons: Object.fromEntries(failed.map((name) => [name, result.validationReasons && result.validationReasons[name] || [`${name} validation failed`]])),
  };
  fs.writeFileSync(path.join(output, "validations.json"), JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}

function recordBlocked(channel, topic, reason) {
  const file = path.join(channel.paths.state, "blocked.json");
  let blocked = {};
  try { blocked = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {}
  if (Array.isArray(blocked)) blocked = Object.fromEntries(blocked.map((id) => [id, { reason: "legacy" }]));
  blocked[topic.id] = { slug: topic.slug, reason, date: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(blocked, null, 2) + "\n");
}

// A render rejected only by the visual gate (too few licensed stills or
// sourced number cards, or no usable thumbnail source) is a property of the
// topic, not of this run. Returns the reason, or null when anything else
// failed or the Commons fetch itself errored (a transient fault must not block
// the topic forever).
function visualRejection(result, output) {
  const failed = Object.entries(result.validations).filter(([, passed]) => !passed).map(([name]) => name);
  if (!failed.length || !failed.some((name) => name === "visuals" || name === "thumbnail")) return null;
  if (!failed.every((name) => ["visuals", "thumbnail", "qualityGate"].includes(name))) return null;
  const reasons = result.validationReasons || {};
  if (failed.includes("qualityGate") && !(reasons.qualityGate || []).every((reason) => /^rendered visuals: /.test(reason))) return null;
  try {
    if (JSON.parse(fs.readFileSync(path.join(output, "visual-attribution.json"), "utf8")).error) return null;
  } catch (error) { return null; }
  return failed.map((name) => `${name}: ${(reasons[name] || []).join("; ") || "failed"}`).join(" | ");
}

const MAX_RENDER_ATTEMPTS = 3;

// Visual pre-check: download the topic's licensed pictures and clips (cached
// in the output folder, so the render reuses them) BEFORE spending ~5 minutes
// on a render the visual gate would reject. A topic with too few real
// pictures is recorded as blocked and the next one is checked; these quick
// rejections do not use up the three render attempts. Before this, three
// picture-poor topics in a row (1 image, 0 images, 4 visuals) left the slot
// empty.
const MIN_PRECHECK_VISUALS = 4;
const MAX_VISUAL_PRECHECKS = 8;

function visualShortfall(topic, output, prepare = (topicFile, directory) => require("../rendering/topic-visuals").prepareAssetsSync(topicFile, directory)) {
  fs.mkdirSync(output, { recursive: true });
  const topicFile = path.join(output, "topic.json");
  fs.writeFileSync(topicFile, JSON.stringify(topic, null, 2) + "\n");
  const assets = prepare(topicFile, output) || {};
  // A source outage is not evidence that the topic lacks pictures; the
  // render-time gate stays the judge then.
  if (assets.error) return null;
  const count = (assets.stills || []).length + (assets.clips || []).length;
  return count < MIN_PRECHECK_VISUALS ? `${count} licensed pictures/clips < ${MIN_PRECHECK_VISUALS}` : null;
}

// Growth-engine topic choice: A/B first, C deliberately, D never; a topic
// whose pre-render readiness is BLOCK is recorded and the next one is tried.
function chooseTopic(channel, explicit, universe) {
  if (explicit) {
    const topic = universe.find((item) => item.slug === explicit || item.id === explicit);
    if (!topic) throw new Error(`${channel.name} topic not found: ${explicit}`);
    return { topic, plan: Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true, assignExperiment: true, write: true }), reason: "explicit topic" };
  }
  const exclude = [...Discovery.usedIds(channel)];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selection = Growth.selectShortTopic(channel, { exclude, write: true });
    if (!selection.selected) return { topic: null, plan: null, reason: selection.reason, inventory: selection.inventory };
    const topic = universe.find((item) => item.id === selection.selected.topic.id);
    const plan = Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), write: true, assignExperiment: true, selection: selection.decision });
    if (plan.readiness.decision !== "BLOCK") return { topic, plan, reason: selection.reason, inventory: selection.inventory };
    console.log(`[${channel.name}] pre-render readiness BLOCK for ${topic.slug}: ${plan.readiness.hardFails.join("; ") || plan.readiness.ProductionReadinessScore}`);
    recordBlocked(channel, topic, `growth pre-gate ${plan.readiness.ProductionReadinessScore}: ${plan.readiness.hardFails.join("; ") || "below threshold"}`);
    exclude.push(topic.id);
  }
  return { topic: null, plan: null, reason: "three consecutive pre-gate blocks" };
}

function runChannel(slug, argv = []) {
  const channel = Channel.getChannel(slug);
  if (channel.config.pathMode === "legacy-adapter") throw new Error(`Isolated documentary pipeline cannot run legacy channel: ${slug}`);
  const explicit = argv.find((arg) => !arg.startsWith("--"));
  if (process.env.PUBLISH === "1" && !process.env.SAGLIK_ATLA) {
    const health = cp.spawnSync(process.execPath, [path.join(Channel.ROOT, "saglik.js"), "--channel", channel.slug, "--sessiz"], {
      cwd: Channel.ROOT, stdio: "inherit", env: process.env,
    });
    if (health.status === 5) {
      console.error(`[${channel.name}] OAuth pre-flight failed; this channel was skipped before render/upload and other channels may continue.`);
      return 0;
    }
    if (health.status !== 0) throw new Error(`${channel.name} health pre-flight could not complete safely`);
  }
  if (!explicit && process.env.PUBLISH === "1") {
    const due = require("../scheduling").channelPlan(channel).short;
    if (!due.due) { console.log(`[${channel.name}] Takvim: henuz degil — ${due.reason}`); return 0; }
  }
  const universe = Discovery.universe(channel).topics;
  const noRender = argv.includes("--no-render");
  let choice, topic, output, result, finalPlan;
  let prechecks = 0;
  for (let attempt = 1; ; attempt += 1) {
    choice = chooseTopic(channel, explicit, universe);
    if (!choice.topic) {
      // Quality over cadence: no weak topic is produced to fill the slot. The
      // skip is an actionable alert, not a pipeline failure.
      GrowthRuntime.alert(channel, "NO_QUALIFIED_TOPIC", choice.reason, { inventory: choice.inventory || null });
      console.log(`::warning::[${channel.name}] ${choice.reason}`);
      return 0;
    }
    topic = choice.topic;
    output = path.join(channel.paths.production, topic.slug);
    const shortfall = !noRender && !explicit ? visualShortfall(topic, output) : null;
    if (shortfall) {
      recordBlocked(channel, topic, `visual pre-check: ${shortfall}`);
      GrowthRuntime.alert(channel, "VISUAL_PRECHECK_BLOCK", topic.slug, { reason: shortfall });
      console.log(`::notice::[${channel.name}] visual pre-check skipped ${topic.slug}: ${shortfall}`);
      prechecks += 1;
      if (prechecks >= MAX_VISUAL_PRECHECKS) {
        GrowthRuntime.alert(channel, "NO_QUALIFIED_TOPIC", `${MAX_VISUAL_PRECHECKS} topics without enough licensed pictures`, {});
        console.log(`::warning::[${channel.name}] ${MAX_VISUAL_PRECHECKS} topics without enough licensed pictures; slot skipped (quality over cadence)`);
        return 0;
      }
      attempt -= 1;
      continue;
    }
    result = Rendering.buildPackage(topic, channel, output, { render: !noRender, growthPlan: choice.plan });
    finalPlan = !noRender && result.render.completed
      ? Growth.planShort(channel, topic.id, {
        legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true, stage: "final",
        assignExperiment: true, write: true, selection: choice.plan.topicDecision,
        render: { completed: true, syntheticVoice: result.render.audio.syntheticVoice, hasAudio: result.render.video.hasAudio, captionsBurned: result.render.video.captionsBurned,
          width: result.render.video.width, height: result.render.video.height, durationSeconds: result.render.video.durationSeconds,
          visualQuality: result.render.video.visualQuality },
      })
      : choice.plan;
    fs.writeFileSync(path.join(output, "readiness.json"), JSON.stringify(finalPlan.readiness, null, 2) + "\n");
    const validationEvidence = writeValidationEvidence(result, topic, channel, output);
    if (validationEvidence.passed) break;
    // Without this the same top-ranked topic would be re-selected and fail on
    // every scheduled run, stalling the channel.
    const visualReason = !noRender && !explicit ? visualRejection(result, output) : null;
    if (!visualReason) throw new Error(`${channel.name} package failed quality validation: ${validationEvidence.failed.join(", ")}`);
    recordBlocked(channel, topic, `render visual gate: ${visualReason}`);
    GrowthRuntime.alert(channel, "VISUAL_GATE_BLOCK", topic.slug, { reason: visualReason, attempt });
    console.log(`::warning::[${channel.name}] visual gate BLOCK for ${topic.slug}: ${visualReason}`);
    if (attempt >= MAX_RENDER_ATTEMPTS) {
      GrowthRuntime.alert(channel, "NO_QUALIFIED_TOPIC", `${MAX_RENDER_ATTEMPTS} consecutive visual gate blocks`, {});
      console.log(`::warning::[${channel.name}] ${MAX_RENDER_ATTEMPTS} consecutive visual gate blocks; slot skipped (quality over cadence)`);
      return 0;
    }
  }
  writeCompatibilityFiles(result, topic, channel);
  let uploadStatus = process.env.PUBLISH === "1" ? "pending" : "skipped (PUBLISH!=1)";
  if (process.env.PUBLISH === "1") {
    if (!result.render.completed || !result.render.audio.syntheticVoice) throw new Error("Publishing blocked: a real synthetic narration render is required");
    if (finalPlan.readiness.decision !== "PUBLISH") {
      recordBlocked(channel, topic, `growth final readiness ${finalPlan.readiness.decision} ${finalPlan.readiness.ProductionReadinessScore}: ${finalPlan.readiness.hardFails.join("; ")}`);
      GrowthRuntime.alert(channel, "PRODUCTION_READINESS_" + finalPlan.readiness.decision, topic.slug, { score: finalPlan.readiness.ProductionReadinessScore, hardFails: finalPlan.readiness.hardFails });
      console.log(GrowthRuntime.shortSummary(finalPlan, { "Upload Status": "not uploaded — readiness " + finalPlan.readiness.decision, "Video ID": "—" }));
      return 0;
    }
    const upload = cp.spawnSync(process.execPath, [path.join(Channel.ROOT, "youtube-yukle.js"), "--channel", channel.slug, topic.slug], { cwd: Channel.ROOT, stdio: "inherit", env: process.env });
    if (upload.status !== 0) throw new Error(`${channel.name} upload failed; generated state was not advanced`);
    uploadStatus = "uploaded";
  }
  const generatedFile = path.join(channel.paths.state, "generated.json");
  const generated = (() => { try { return JSON.parse(fs.readFileSync(generatedFile, "utf8")); } catch (error) { return []; } })();
  if (!generated.some((item) => item.topicId === topic.id)) generated.push({ topicId: topic.id, slug: topic.slug, generatedAt: new Date().toISOString(), uploaded: process.env.PUBLISH === "1" });
  fs.writeFileSync(generatedFile, JSON.stringify(generated, null, 2) + "\n");
  const videoId = uploadStatus === "uploaded" ? GrowthRuntime.afterUpload(channel, topic.slug, finalPlan) : null;
  console.log(`[${channel.name}] ${topic.topic} — ${noRender ? "package only" : "rendered"}${process.env.PUBLISH === "1" ? " and uploaded" : "; upload skipped"}`);
  console.log(GrowthRuntime.shortSummary(finalPlan, { "Upload Status": uploadStatus, "Video ID": videoId || "—" }));
  return 0;
}

function main(argv = []) { return runChannel("impossible-brief", argv); }

module.exports = { MIN_PRECHECK_VISUALS, MAX_VISUAL_PRECHECKS, visualShortfall, writeCompatibilityFiles, writeValidationEvidence, visualRejection, runChannel, main };
