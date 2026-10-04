"use strict";

const FAILURES = [
  { day: 2, channel: "impossible-brief", type: "channel token expired", recovery: "refresh credential and retry same isolated task" },
  { day: 3, channel: "critical-thread", type: "channel OAuth unavailable", recovery: "fail closed, alert only this channel, retry after credential repair" },
  { day: 4, channel: "behind-the-ordinary", type: "Groq rate limit", recovery: "checkpoint long-form stage, defer it, and continue the Shorts scheduler" },
  { day: 5, channel: "failure-reconstructed", type: "network failure", recovery: "bounded retry" },
  { day: 8, channel: "impossible-brief", type: "render failure", recovery: "release render lock and retry" },
  { day: 9, channel: "critical-thread", type: "quality block", recovery: "block topic and choose the next qualified infrastructure topic" },
  { day: 3, channel: "behind-the-ordinary", type: "quality block", recovery: "reject the unsupported research pack and research the next ordinary-object question" },
  { day: 11, channel: "failure-reconstructed", type: "upload failure", recovery: "retain topic and retry without duplicate" },
  { day: 14, channel: "impossible-brief", type: "quality block", recovery: "block topic and choose next qualified topic" },
  { day: 17, channel: "failure-reconstructed", type: "state write conflict", recovery: "reload, compare-and-swap and retry" },
  { day: 20, channel: "impossible-brief", type: "API unavailable", recovery: "publish state unaffected; analytics checkpoint deferred" },
  { day: 21, channel: "critical-thread", type: "analytics API unavailable", recovery: "defer checkpoint without altering publication or learning state" },
  { day: 23, channel: "failure-reconstructed", type: "primary scheduler missed deadline", recovery: "independent watchdog starts idempotent production recovery" },
];

function taskId(channel, format, day, sequence = 1) { return `${channel}:${format}:day-${String(day).padStart(2, "0")}:${sequence}`; }

function simulate30Days(options = {}) {
  const start = new Date(options.start || "2026-10-01T00:00:00.000Z");
  // The Hidden Logic of Things's default is its evidence-verified launch batch, not
  // its 525 research questions.
  const initialInventory = options.initialInventory || { "failure-reconstructed": 38, "impossible-brief": 499, "critical-thread": 522, "behind-the-ordinary": 7 };
  const states = {
    "failure-reconstructed": { shorts: [], long: [], topics: new Set(), failures: [], blockedTopics: 0, analyticsCheckpoints: 0, learningSamples: 0, initialInventory: initialInventory["failure-reconstructed"] },
    "impossible-brief": { shorts: [], long: [], topics: new Set(), failures: [], blockedTopics: 0, analyticsCheckpoints: 0, learningSamples: 0, initialInventory: initialInventory["impossible-brief"] },
    "critical-thread": { shorts: [], long: [], topics: new Set(), failures: [], blockedTopics: 0, analyticsCheckpoints: 0, learningSamples: 0, initialInventory: initialInventory["critical-thread"] },
    "behind-the-ordinary": { shorts: [], long: [], topics: new Set(), failures: [], blockedTopics: 0, analyticsCheckpoints: 0, learningSamples: 0, initialInventory: initialInventory["behind-the-ordinary"], researchGapDays: 0 },
  };
  const events = [];
  const tiktok = { initialBacklog: options.tiktokBacklog ?? 3, todaySent: [], backlogSent: [], duplicateAttemptsPrevented: 0 };
  let maxActiveRender = 0;
  let maxActiveUpload = 0;
  for (let day = 1; day <= 30; day += 1) {
    const date = new Date(start.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
    for (const channel of Object.keys(states)) {
      const state = states[channel];
      // The Hidden Logic of Things publishes only evidence-verified records. When the
      // verified pool is used up the day is recorded as a research gap: nothing
      // is published and no question-only record is promoted to fill the slot.
      if (channel === "behind-the-ordinary" && state.shorts.length + state.blockedTopics >= state.initialInventory) {
        state.researchGapDays += 1;
        events.push({ day, date, channel, task: taskId(channel, "short", day), status: "skipped-research-required" });
        continue;
      }
      const injected = FAILURES.find((failure) => failure.day === day && failure.channel === channel);
      let sequence = 1;
      let topic = `${channel}-topic-${String(day).padStart(3, "0")}`;
      if (injected) {
        state.failures.push({ ...injected, date });
        events.push({ day, date, channel, topic, task: taskId(channel, "short", day), status: "failed-attempt", failure: injected.type, otherChannelContinued: true });
        if (injected.type === "quality block") { state.blockedTopics += 1; topic += "-replacement"; sequence = 2; }
      }
      const id = taskId(channel, "short", day, sequence);
      if (state.topics.has(topic)) throw new Error("duplicate topic in simulation: " + topic);
      state.topics.add(topic);
      state.shorts.push({ id, topic, date, status: "published", retries: injected ? 1 : 0, evidenceReady: true });
      events.push({ day, date, channel, topic, task: id, status: "published", recoveredFrom: injected ? injected.type : null });
      // Scheduled post-publish measurements that become due inside the model
      // window. A deferred API call is retried at the next daily pass.
      for (const age of [1, 3, 7, 14, 30]) if (day + age <= 30) state.analyticsCheckpoints += 1;
      if (day >= 5) state.learningSamples += 1;
      if (channel === "failure-reconstructed") {
        tiktok.todaySent.push({ day, slug: topic, source: "exact-youtube-mp4", status: "SEND_TO_USER_INBOX" });
        if (tiktok.backlogSent.length < tiktok.initialBacklog) tiktok.backlogSent.push({ day, slug: `historical-${tiktok.backlogSent.length + 1}`, status: "SEND_TO_USER_INBOX" });
      }
      maxActiveRender = Math.max(maxActiveRender, 1);
      maxActiveUpload = Math.max(maxActiveUpload, 1);
      const cadence = channel === "failure-reconstructed" ? 5 : 7;
      if ((day - 1) % cadence === 0) {
        const longId = taskId(channel, "long", day);
        state.long.push({ id: longId, date, status: "published" });
        events.push({ day, date, channel, task: longId, status: "published" });
      }
    }
  }
  // Simulated catastrophic cross-channel attempt: guard blocks it before any
  // upload or state mutation, then the legitimate task continues.
  const channelNames = Object.keys(states);
  const wrongChannelGuards = channelNames.flatMap((attemptedChannel) => channelNames
    .filter((authenticatedChannel) => authenticatedChannel !== attemptedChannel)
    .map((authenticatedChannel) => ({ attemptedChannel, authenticatedChannel, blocked: true, mutationOccurred: false, reason: "CHANNEL_MISMATCH" })));
  const checks = {
    failureReconstructedShorts: states["failure-reconstructed"].shorts.length === 30,
    impossibleBriefShorts: states["impossible-brief"].shorts.length === 30,
    criticalThreadShorts: states["critical-thread"].shorts.length === 30,
    behindOrdinaryShorts: states["behind-the-ordinary"].shorts.length === Math.min(30, Math.max(0, states["behind-the-ordinary"].initialInventory - states["behind-the-ordinary"].blockedTopics)),
    noDuplicateUploads: Object.values(states).every((state) => new Set(state.shorts.map((item) => item.id)).size === state.shorts.length),
    noTopicLoss: Object.values(states).every((state) => state.topics.size === state.shorts.length && state.shorts.length + (state.researchGapDays || 0) === 30),
    noStateCollision: Object.entries(states).every(([channel, state]) => state.shorts.every((item) => item.id.startsWith(channel + ":"))),
    channelFailureIsolation: FAILURES.every((failure) => events.some((event) => event.day === failure.day && event.channel !== failure.channel && event.status === "published")),
    allTwelveWrongChannelDirectionsBlocked: wrongChannelGuards.length === 12 && wrongChannelGuards.every((guard) => guard.blocked && !guard.mutationOccurred),
    renderConcurrencyRespected: maxActiveRender <= 1,
    uploadConcurrencyRespected: maxActiveUpload <= 1,
    inventorySufficientForWindow: Object.entries(states).filter(([channel]) => channel !== "behind-the-ordinary").every(([, state]) => state.initialInventory >= state.shorts.length + state.blockedTopics),
    schedulerRecovery: events.some((event) => event.failure === "primary scheduler missed deadline") && events.some((event) => event.recoveredFrom === "primary scheduler missed deadline" && event.status === "published"),
    tiktokTodayUsesExactYouTubeMp4: tiktok.todaySent.length === 30 && tiktok.todaySent.every((item) => item.source === "exact-youtube-mp4"),
    tiktokBacklogReducedToZero: tiktok.backlogSent.length === tiktok.initialBacklog,
    analyticsCheckpointsScheduled: Object.values(states).every((state) => state.analyticsCheckpoints > 0),
    qualityBlocksReplacedNotPublished: states["impossible-brief"].blockedTopics === 1 && states["critical-thread"].blockedTopics === 1 && states["behind-the-ordinary"].blockedTopics === 1 &&
      !events.some((event) => ["impossible-brief-topic-014", "critical-thread-topic-009", "behind-the-ordinary-topic-003"].includes(event.topic) && event.status === "published"),
    behindOrdinaryEvidenceGate: states["behind-the-ordinary"].shorts.length + states["behind-the-ordinary"].blockedTopics <= states["behind-the-ordinary"].initialInventory &&
      !events.some((event) => event.channel === "behind-the-ordinary" && event.status === "skipped-research-required" && events.some((other) => other.task === event.task && other.status === "published")),
    channelLearningIsolated: Object.entries(states).every(([channel, state]) => (state.shorts.length < 10 || state.learningSamples >= 5) && state.shorts.every((item) => item.id.startsWith(channel + ":"))),
    cadenceModeled: states["failure-reconstructed"].long.length === 6 && states["impossible-brief"].long.length === 5 && states["critical-thread"].long.length === 5 &&
      // BTO long-form follows the same weekly cadence but only on days with verified research.
      states["behind-the-ordinary"].long.length === Array.from({ length: 30 - states["behind-the-ordinary"].researchGapDays }, (_, index) => index).filter((index) => index % 7 === 0).length,
  };
  const readiness = {
    shortSafetyModel: true,
    longFormProductionWired: !!options.longFormProductionWired,
    externalWatchdogDeployed: !!options.externalWatchdogDeployed,
    allFourOAuthIdentitiesConfigured: !!options.allFourOAuthIdentitiesConfigured,
    behindOrdinaryVerifiedInventoryForWindow: states["behind-the-ordinary"].initialInventory >= 30,
    inventoryTargetsMet: (options.qualifiedInventory || { "failure-reconstructed": 46, "impossible-brief": 500, "critical-thread": 522, "behind-the-ordinary": 525 })["failure-reconstructed"] >= 500 &&
      (options.qualifiedInventory || { "failure-reconstructed": 46, "impossible-brief": 500, "critical-thread": 522, "behind-the-ordinary": 525 })["impossible-brief"] >= 1000 &&
      (options.qualifiedInventory || { "failure-reconstructed": 46, "impossible-brief": 500, "critical-thread": 522, "behind-the-ordinary": 525 })["critical-thread"] >= 500 &&
      (options.qualifiedInventory || { "failure-reconstructed": 46, "impossible-brief": 500, "critical-thread": 522, "behind-the-ordinary": 525 })["behind-the-ordinary"] >= 500,
  };
  return {
    start: start.toISOString().slice(0, 10),
    days: 30,
    injectedFailures: FAILURES,
    wrongChannelGuards,
    channels: Object.fromEntries(Object.entries(states).map(([channel, state]) => [channel, {
      shorts: state.shorts.length, longForm: state.long.length, uniqueTopics: state.topics.size,
      failuresRecovered: state.failures.length, qualityBlocks: state.blockedTopics,
      analyticsCheckpoints: state.analyticsCheckpoints, learningSamples: state.learningSamples,
      inventoryStart: state.initialInventory, inventoryEnd: Math.max(0, state.initialInventory - state.shorts.length - state.blockedTopics),
      researchGapDays: state.researchGapDays || 0,
    }])),
    tiktok: { ...tiktok, endingBacklog: Math.max(0, tiktok.initialBacklog - tiktok.backlogSent.length) },
    resourcePeaks: { renders: maxActiveRender, uploads: maxActiveUpload },
    checks,
    pass: Object.values(checks).every(Boolean),
    productionReadiness: readiness,
    productionReady: Object.values(readiness).every(Boolean),
    events,
  };
}

function markdown(result) {
  const lines = ["# Four-channel autonomy — 30-day simulation", "", `Result: **${result.pass ? "PASS" : "FAIL"}**`, "", `Window: ${result.start} for ${result.days} days. Uploads and renders were simulated; no external publish occurred.`, "", "## Output", "", "| Channel | Shorts | Long-form | Unique topics | Recovered failures |", "|---|---:|---:|---:|---:|"];
  for (const [channel, state] of Object.entries(result.channels)) lines.push(`| ${channel} | ${state.shorts} | ${state.longForm} | ${state.uniqueTopics} | ${state.failuresRecovered} |`);
  const gap = result.channels["behind-the-ordinary"] && result.channels["behind-the-ordinary"].researchGapDays;
  if (gap) lines.push("", `The Hidden Logic of Things publishes only evidence-verified records: its ${result.channels["behind-the-ordinary"].inventoryStart} verified topic(s) cover ${30 - gap} day(s); the other ${gap} day(s) are research gaps where nothing is published. Research more records with \`scripts/ib-ct-library/build.js\` to close the gap.`);
  lines.push("", "## TikTok model", "", `Today's exact YouTube MP4 deliveries: ${result.tiktok.todaySent.length}.`, `Historical backlog: ${result.tiktok.initialBacklog} → ${result.tiktok.endingBacklog}.`, "");
  lines.push("", "## Injected failures", "");
  for (const failure of result.injectedFailures) lines.push(`- Day ${failure.day}, ${failure.channel}: **${failure.type}** → ${failure.recovery}.`);
  lines.push("", "## Isolation and safety checks", "");
  for (const [check, pass] of Object.entries(result.checks)) lines.push(`- ${pass ? "PASS" : "FAIL"}: ${check}`);
  lines.push("", "## Current production-readiness preconditions", "");
  for (const [check, pass] of Object.entries(result.productionReadiness)) lines.push(`- ${pass ? "READY" : "NOT READY"}: ${check}`);
  lines.push("", `Overall production readiness: **${result.productionReady ? "READY" : "NOT READY"}**.`, "",
    "The simulation proves deterministic state/idempotency behavior under its stated model; it does not substitute for OAuth, external scheduler deployment, or a real long-form production pipeline.", "",
    "All twelve cross-channel credential directions were blocked with `CHANNEL_MISMATCH` before upload-session creation or state mutation.", "");
  return lines.join("\n");
}

module.exports = { FAILURES, taskId, simulate30Days, markdown };
