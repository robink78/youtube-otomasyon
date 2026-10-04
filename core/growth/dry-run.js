"use strict";

// DRY RUNS (PHASE 36). One full Short plan and one long-form package per
// channel, written as Markdown to reports/dry-runs/. Never renders, never
// uploads, never writes production state: every write goes to a sandbox
// (GROWTH_STATE_ROOT), created here when the caller did not set one.

const fs = require("fs");
const os = require("os");
const path = require("path");

function sandbox() {
  if (!process.env.GROWTH_STATE_ROOT) process.env.GROWTH_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "growth-dryrun-"));
  return process.env.GROWTH_STATE_ROOT;
}

const cut = (text, n = 160) => { const value = String(text == null ? "" : text).replace(/\s+/g, " ").trim(); return value.length > n ? value.slice(0, n - 1) + "…" : value; };
const cell = (text) => cut(text, 140).replace(/\|/g, "\\|");

function factorLine(factors) {
  return Object.entries(factors || {}).map(([key, value]) => `${key.replace(/Score$/, "")} ${value && value.value != null ? value.value : value}`).join(" · ");
}

function shortReport(channel, options = {}) {
  const Growth = require("./index");
  const Pacing = require("./pacing");
  const Config = require("./config");
  const config = Config.forChannel(channel);
  const date = options.date || new Date().toISOString().slice(0, 10);
  const selection = Growth.selectShortTopic(channel, { date });
  const ranked = selection.ranked.rows;
  // A channel with no qualified topic still gets a full dry run on its best
  // ranked candidate, so the gate's BLOCK is visible rather than silent.
  const target = selection.selected || ranked[0] || null;
  const out = [`# Dry run — ${channel.name} — Short`, "", `Date: ${date} · sandbox state · nothing rendered or uploaded`, ""];
  out.push("## Candidate topics", "", "| # | Topic | Bucket | VideoPotential | Hook | Why |", "|---|---|---|---|---|---|");
  ranked.slice(0, 8).forEach((row, index) => out.push(`| ${index + 1} | ${cell(row.topic.slug)} | ${row.score.bucket} | ${row.score.VideoPotentialScore} | ${row.hooks && row.hooks.selectedScore != null ? row.hooks.selectedScore : "—"} | ${cell(row.score.reasons.join("; "))} |`));
  out.push("", `Inventory (unused): A ${selection.inventory.A} · B ${selection.inventory.B} · C ${selection.inventory.C} · D ${selection.inventory.D}`, "");
  out.push("## Selected topic", "", selection.selected ? `**${target.topic.slug}** — ${selection.reason}` : `**None qualified** — ${selection.reason}. Planning the best-ranked candidate (${target ? target.topic.slug : "none"}) to show the gate decision.`, "");
  if (!target) return { markdown: out.join("\n") + "\n", plan: null, selection };
  const plan = Growth.planShort(channel, target.topic.slug, { now: options.now });
  out.push("## Topic score", "", `VideoPotentialScore **${plan.topicScore.VideoPotentialScore}** · bucket **${plan.topicScore.bucket}**`, "", factorLine(plan.topicScore.factors), "");
  out.push("## Hook candidates (top 10)", "", "| # | Family | Spoken | On-screen | Score | Blocked |", "|---|---|---|---|---|---|");
  plan.hooks.candidates.slice(0, 10).forEach((hook, index) => out.push(`| ${index + 1} | ${hook.family} | ${cell(hook.spoken)} | ${cell(hook.onScreen)} | ${hook.adjustedTotal} | ${hook.blocked ? cell(hook.blockers.join("; ")) : "—"} |`));
  out.push("", `Selected hook: **${plan.hooks.selected ? plan.hooks.selected.spoken : "none"}** (${plan.hooks.selected ? plan.hooks.selected.family + ", " + plan.hooks.selected.adjustedTotal : "—"}) · ${plan.hooks.candidateCount} candidates / ${plan.hooks.familyCount} families`, "");
  const f = plan.first3Seconds.First3SecondPlan;
  out.push("## First 3 seconds", "", f ? [
    `- Narration: ${f.narration}`, `- First frame: ${f.firstFrame.description} (${f.firstFrame.sourceClass}, ${f.firstFrame.source || "no file"})`,
    `- On-screen text: ${f.onScreenText}`, `- Motion: ${f.motion}`, `- Cut timing (s): ${(f.cutTiming || []).join(", ")}`, `- Sound cue: ${f.soundCue}`, `- First3SecondScore: **${plan.first3Seconds.score}**`,
  ].join("\n") : "no plan (no hook)", "");
  out.push("## Script", "", `Generator: ${plan.script.generator} · ~${plan.script.estimatedSeconds}s`, "");
  (plan.script.lines || []).forEach((line, index) => out.push(`${index + 1}. ${line}${plan.script.structure && plan.script.structure[index] ? `  _[${plan.script.structure[index]}]_` : ""}`));
  out.push("", `Retention lint: score ${plan.script.retention.score}${plan.script.retention.blockers && plan.script.retention.blockers.length ? " · " + plan.script.retention.blockers.join("; ") : ""}`, "");
  out.push("## Scene plan", "", "| # | Narration | Visual source class | Label |", "|---|---|---|---|");
  plan.integrity.scenes.forEach((scene) => out.push(`| ${scene.scene} | ${cell(scene.text)} | ${scene.sourceClass} | ${scene.label} |`));
  out.push("", `Pacing: ${plan.pacing.segments} segments, ${plan.pacing.cutsInFirst3Seconds} cuts in first 3 s, average ${plan.pacing.averageSeconds}s, longest ${plan.pacing.longestSeconds}s${plan.pacing.mechanical ? " — MECHANICAL" : ""}`, "");
  const lines = plan.script.claims ? plan.script.claims.map((claim) => claim.text) : plan.script.lines;
  const seconds = plan.script.estimatedSeconds || 30;
  const words = lines.map((line) => line.split(/\s+/).length);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const claims = lines.map((text, i) => { const start = t; t += seconds * words[i] / total; return { start, end: t, text }; });
  out.push("## Captions", "", "```", Pacing.srt(claims, config.captions).split("\n\n").slice(0, 8).join("\n\n"), "```", "", `Audit: ${plan.captions.events} events · max ${plan.captions.maxWords} words · ${plan.captions.maxLines} lines · too fast ${plan.captions.tooFast} · ${plan.captions.passes ? "PASS" : "FAIL"}`, "");
  out.push("## Metadata", "", `- Title: **${plan.titles.selected ? plan.titles.selected.title : "—"}** (${plan.titles.selectedScore}; ${plan.titles.count} candidates)`,
    `- Other titles: ${plan.titles.candidates.slice(1, 5).map((row) => row.title).join(" · ")}`,
    `- CTA: ${plan.cta.type}${plan.cta.text ? ` — "${plan.cta.text}"` : ""} (${plan.cta.delivery || "—"})`,
    `- Loop: LoopPotentialScore ${plan.loop.LoopPotentialScore} · ${plan.loop.apply ? "applied" : "not applied"}`,
    `- Related long video: ${plan.relatedLong ? plan.relatedLong.title : "none published yet (Shorts Related Video is set manually — no API field)"}`,
    `- Factual check: ${plan.factual.score} · unsupported numbers ${plan.factual.unsupportedNumbers.length}`, "");
  out.push("## ProductionReadinessScore", "", `**${plan.readiness.ProductionReadinessScore} → ${plan.readiness.decision}** (stage ${plan.readiness.stage}; publish ≥ ${plan.readiness.thresholds.publish}, review ≥ ${plan.readiness.thresholds.review})`, "",
    `Dimensions: ${Object.entries(plan.readiness.dimensions).map(([k, v]) => `${k} ${v == null ? "n/m" : v}`).join(" · ")}`, "",
    plan.readiness.hardFails.length ? `Hard fails: ${plan.readiness.hardFails.join("; ")}` : "Hard fails: none", "",
    `Unmeasured before render (measured by the final-stage gate): ${plan.readiness.unmeasured.join(", ")}`, "");
  const decisionText = !selection.selected
    ? `NOT SCHEDULED — topic bucket ${plan.topicScore.bucket} is outside the primary buckets and C fallback is disabled for this channel; the plan scores ${plan.readiness.ProductionReadinessScore} (${plan.readiness.decision}) but the scheduler skips the slot rather than publish an unqualified topic.`
    : plan.readiness.decision === "PUBLISH" ? "PUBLISH-eligible at the pre-render stage; the final-stage gate re-checks the rendered file (visual, audio, captions, duration)."
      : `NOT published: ${plan.readiness.decision}.`;
  out.push("## Publish / block decision", "", decisionText, "");
  return { markdown: out.join("\n") + "\n", plan, selection };
}

async function longReport(channel, options = {}) {
  const Context = require("./context");
  const Lane = require("./lane");
  const Longform = require("./longform");
  const ctx = Context.build(channel);
  const candidates = Lane.candidates(channel, ctx);
  const out = [`# Dry run — ${channel.name} — Long-form`, "", `Sandbox state · LLM writer ${options.llm ? "ON" : "OFF (no configured LONGFORM_LLM_PROVIDER / provider key)"} · nothing rendered or uploaded`, ""];
  out.push("## Candidate long-form topics", "", "| # | Topic | LongFormPotential | Bucket | Mode |", "|---|---|---|---|---|");
  candidates.slice(0, 6).forEach((row, index) => out.push(`| ${index + 1} | ${cell(row.topic.slug)} | ${row.potential.LongFormPotentialScore} | ${row.potential.bucket} | ${row.mode} |`));
  if (!candidates.length) { out.push("", "No candidate above bucket D.", ""); return { markdown: out.join("\n") + "\n", pkg: null }; }
  const chosen = candidates[0];
  const pkg = await Longform.buildPackage(channel, chosen.topic, { context: ctx, potential: chosen.potential, llm: options.llm, offline: options.offline, now: options.now });
  out.push("", "## Selected topic", "", `**${pkg.topic.slug}** — ${pkg.topic.title} · LongFormPotentialScore **${pkg.LongFormPotential.LongFormPotentialScore}** (${pkg.LongFormPotential.bucket})`, "", factorLine(pkg.LongFormPotential.factors), "");
  out.push("## Research sources", "", ...pkg.researchPackage.sources.map((source) => `- ${source.name} — ${source.tier} (${source.score}) ${source.url || ""}`), "");
  const deep = pkg.researchPackage.deepResearch;
  out.push("## ResearchPackage", "", `- Claims: ${pkg.researchPackage.claims} · deep research: ${deep ? `${deep.status}, ${deep.claims} claims from "${deep.article || "—"}" (${deep.licence || ""})` : "none"}`,
    `- Gaps: ${pkg.researchPackage.gaps.length ? pkg.researchPackage.gaps.join("; ") : "none"}`, `- Reusable for: long-form, derived Shorts, metadata, fact-check, visual sourcing, follow-ups`, "");
  out.push("## Outline", "", "| # | Section | Question | Claims | Evidence |", "|---|---|---|---|---|");
  pkg.outline.sections.forEach((row) => out.push(`| ${row.order} | ${row.section} | ${cell(row.question)} | ${row.claimIds.length} | ${row.evidence} |`));
  out.push("", `Coverage ${pkg.outline.coverage}%${pkg.outline.missingSections.length ? ` · missing: ${pkg.outline.missingSections.join(", ")}` : ""}`, "");
  out.push("## Cold-open candidates", "", ...pkg.coldOpens.candidates.map((row) => `- (${row.type}, ${row.score}, ~${row.estimatedSeconds}s) ${row.text}`), "", `Selected cold open: **${pkg.coldOpens.selected ? pkg.coldOpens.selected.text : "—"}**`, "");
  out.push("## Long-form script", "", `Generator: ${pkg.script.generator} · ${pkg.script.words} words · ~${pkg.script.estimatedMinutes} min (target ${pkg.targetMinutes.join("–")} min) · new beat every ~${pkg.script.secondsPerNewBeat}s${pkg.script.llmError ? ` · LLM error: ${pkg.script.llmError}` : ""}`, "");
  for (const section of pkg.script.sections) for (const paragraph of section.paragraphs || []) out.push(`**${section.section}** — ${paragraph.text}`, "");
  out.push("## Scene plan", "", "| # | Section | Visual type | Subject | Seconds | Disclosure |", "|---|---|---|---|---|---|");
  pkg.scenePlan.slice(0, 20).forEach((scene) => out.push(`| ${scene.scene} | ${scene.section} | ${scene.visualType} | ${cell(scene.subject)} | ${scene.durationEstimateSeconds} | ${scene.disclosure || "—"} |`));
  out.push("", "## Asset plan", "", `By type: ${Object.entries(pkg.assetPlan.byType).map(([k, v]) => `${k} ${v}`).join(" · ")} · distinct subjects ${pkg.assetPlan.distinctSubjects} · overused ${pkg.assetPlan.overused.length} · ${pkg.assetPlan.licensing}`, "");
  out.push("## Thumbnail concepts", "", "| Concept | Text | Emotion | Score | Truthfulness |", "|---|---|---|---|---|");
  pkg.thumbnails.concepts.forEach((row) => out.push(`| ${row.id} | ${cell(row.text)} | ${row.emotion} | ${row.total} | ${row.truthfulness} |`));
  out.push("", `Selected: **${pkg.thumbnails.selected ? pkg.thumbnails.selected.id : "—"}**`, "");
  out.push("## Title candidates", "", ...pkg.titles.candidates.slice(0, 10).map((row) => `- ${row.title} (${row.adjustedTotal}, ${row.pattern})`), "", `Selected title: **${pkg.titles.selected ? pkg.titles.selected.title : "—"}** (${pkg.titles.selectedScore})`, "");
  out.push("## Short derivatives", "", ...(pkg.derivedShorts.shorts || []).map((row) => `- ${row.angle}: "${row.hook}" (${row.hookFamily}, ${row.hookScore})`), "");
  out.push("## Related-video mapping", "", pkg.relatedShorts.length ? pkg.relatedShorts.map((row) => `- Short ${row.short_slug} (${row.short_video_id || "unpublished"}) → this long-form: ${row.relationship_type} (${row.score})`).join("\n") : "- no published same-channel Short relates yet", "",
    "Shorts Related Video cannot be set through the public API; each mapping becomes a RELATED_VIDEO_MANUAL_ACTION_REQUIRED task after the long-form uploads.", "");
  const end = pkg.endScreenPlan;
  out.push("## End-screen plan", "", `- Primary next: ${end.primary_next_video ? `${end.primary_next_video.title} (${end.primary_next_video.reason})` : "none — playlist + subscribe"}`,
    `- Secondary next: ${end.secondary_next_video ? end.secondary_next_video.title : "—"}`, `- Playlist: ${end.playlist} · subscribe element: ${end.subscribe_element}`,
    `- Timing: last ${end.timing.durationSeconds}s from ${end.timing.startSeconds}s — ${end.timing.note}`, `- Transition line: ${end.final_narration_transition}`, "- End screens are set in YouTube Studio (no API write).", "");
  out.push("## LongFormProductionReadinessScore", "", `**${pkg.readiness.LongFormProductionReadinessScore} → ${pkg.readiness.decision}** (publish ≥ ${pkg.readiness.thresholds.publish})`, "",
    `Dimensions: ${Object.entries(pkg.readiness.dimensions).map(([k, v]) => `${k} ${v == null ? "n/m" : v}`).join(" · ")}`, "",
    pkg.readiness.hardFails.length ? `Hard fails: ${pkg.readiness.hardFails.join("; ")}` : "Hard fails: none", "", ...(pkg.readiness.notes || []).map((note) => `- Note: ${note}`), "",
    `Cost estimate: $${pkg.cost.estimated_production_cost} (${Object.entries(pkg.cost.breakdown).map(([k, v]) => `${k} ${v}`).join(", ")})`, "");
  out.push("## Publish / Review / Block decision", "", pkg.readiness.decision === "PUBLISH" ? "PUBLISH-eligible (render still requires longform.render.enabled + <PREFIX>_LONGFORM_PUBLISH=1)." : `${pkg.readiness.decision}: the weekly lane records QUALITY_BLOCKED/REVIEW_REQUIRED for this cycle. Quality over cadence — this is expected behaviour, not a production failure.`, "");
  return { markdown: out.join("\n") + "\n", pkg };
}

async function run(options = {}) {
  sandbox();
  const Channel = require("../channel-context");
  const dir = options.outDir || path.join(Channel.ROOT, "reports", "dry-runs");
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const slug of options.channels || Object.keys(Channel.registry().channels)) {
    const channel = Channel.getChannel(slug);
    const short = shortReport(channel, options);
    const long = await longReport(channel, options);
    fs.writeFileSync(path.join(dir, `${slug}-short.md`), short.markdown);
    fs.writeFileSync(path.join(dir, `${slug}-long.md`), long.markdown);
    results.push({
      channel: slug,
      short: short.plan ? { topic: short.plan.topic.slug, qualified: !!short.selection.selected, score: short.plan.readiness.ProductionReadinessScore, decision: short.plan.readiness.decision, hook: short.plan.hooks.selected && short.plan.hooks.selected.spoken } : null,
      long: long.pkg ? { topic: long.pkg.topic.slug, potential: long.pkg.LongFormPotential.LongFormPotentialScore, score: long.pkg.readiness.LongFormProductionReadinessScore, decision: long.pkg.readiness.decision, hardFails: long.pkg.readiness.hardFails, minutes: long.pkg.script.estimatedMinutes, deepClaims: long.pkg.researchPackage.deepResearch ? long.pkg.researchPackage.deepResearch.claims : 0 } : null,
    });
  }
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sandbox: "GROWTH_STATE_ROOT (temporary)", results }, null, 2) + "\n");
  return results;
}

module.exports = { run, shortReport, longReport, sandbox };
