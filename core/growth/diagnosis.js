"use strict";

// FAILURE DIAGNOSIS (PHASE 19). Configurable thresholds, separate Shorts and
// long-form rules, confidence reflects sample size, and no causal claim is
// made without the metric that would support it. Missing data → the code is
// not emitted (INSUFFICIENT_DATA instead), never guessed.

function diagnose(row, baselines, config, options = {}) {
  const long = row.contentType === "long";
  const t = long ? config.diagnosis.longform : config.diagnosis.shorts;
  const m = row.metrics || {};
  const base = (long ? baselines.long : baselines.short) || {};
  const out = [];
  const add = (code, confidence, evidence, recommendation) => out.push({ code, confidence, evidence, recommendation });
  const views = m.views;
  if (!Number.isFinite(views) || views < t.minViews) {
    add("INSUFFICIENT_DATA", "high", `${views ?? "unknown"} views < ${t.minViews}`, "No intervention; wait for the next checkpoint.");
    return finalize(out, row, options);
  }
  const sampleConfidence = (base.n || 0) >= 10 ? "medium" : "low";
  const retentionEarly = long ? retentionAt(row, 30) : retentionAt(row, 3);
  if (retentionEarly != null && retentionEarly < (long ? t.hookFailureRetentionAt30s : t.hookFailureRetentionAt3s)) {
    add("HOOK_FAILURE", sampleConfidence, `retention ${Math.round(retentionEarly * 100)}% at ${long ? "30 s" : "3 s"}`, "Next videos in this cluster: stronger first frame and a result-first opening.");
  }
  if (Number.isFinite(m.averagePercentageViewed) && m.averagePercentageViewed < t.retentionFailureAvp) {
    add("RETENTION_FAILURE", sampleConfidence, `average viewed ${m.averagePercentageViewed}% < ${t.retentionFailureAvp}%`, long ? "Tighten the middle; add a new reveal every 20–60 s." : "Cut setup sentences; move the mechanism earlier.");
  }
  if (long) {
    const half = retentionAt(row, null, 0.5);
    if (half != null && half < t.depthFailureRetentionAtHalf) add("LONGFORM_DEPTH_FAILURE", sampleConfidence, `retention ${Math.round(half * 100)}% at 50%`, "Middle sections repeat or lack new evidence; restructure around the failure chain.");
    if (Number.isFinite(m.ctr) && m.ctr < t.lowCtr) add("THUMBNAIL_PACKAGING_FAILURE", "low", `CTR ${m.ctr}% < ${t.lowCtr}% (manual Studio value)`, "Test one new thumbnail concept (logged experiment).");
  }
  if (Number.isFinite(m.engagementPer1000Views) && m.engagementPer1000Views < t.lowEngagementRatePer1000) add("LOW_ENGAGEMENT", "low", `${m.engagementPer1000Views} engagements / 1,000 views`, "Contextual comment prompt after the payoff.");
  if (Number.isFinite(m.subscribersPer1000Views) && views >= 1000 && m.subscribersPer1000Views < t.lowSubsPer1000) add("LOW_SUBSCRIBER_CONVERSION", sampleConfidence, `${m.subscribersPer1000Views} subs / 1,000 views`, long ? "Stronger series promise and end-screen pathway." : "Series-shaped payoff; link a related long-form episode.");
  const goodRetention = Number.isFinite(m.averagePercentageViewed) && m.averagePercentageViewed >= t.goodAvp;
  if (goodRetention && Number.isFinite(base.views) && views < base.views * t.lowDistributionViewsVsMedian) add("GOOD_CONTENT_LOW_DISTRIBUTION", "low", `good retention (${m.averagePercentageViewed}%) but views ${views} < ${t.lowDistributionViewsVsMedian}× median ${base.views}`, "Do not change the video; strengthen packaging/cluster links.");
  if (!long && Number.isFinite(m.shortsFeedShare) && m.shortsFeedShare < t.shortsFeedShareMinimum && !goodRetention) add("TOPIC_FAILURE", "low", `Shorts feed share ${Math.round(m.shortsFeedShare * 100)}% and weak retention`, "Lower this cluster's topic weight until more evidence.");
  if (!long && Number.isFinite(m.averagePercentageViewed) && goodRetention && Number.isFinite(m.first30sRetention) && m.first30sRetention < 0.5) add("VISUAL_FAILURE", "low", "viewers stay on average but drop at the start of visuals", "Review first-frame evidence and visual variety.");
  if (options.titleScore != null && options.titleScore < 60 && Number.isFinite(base.views) && views < base.views * 0.5) add("TITLE_PACKAGING_FAILURE", "low", `title score ${options.titleScore} and views below half the median`, "Test one alternative title (logged).");
  // Spec diagnoses, always relative to this channel's own format baseline and
  // only with a large enough baseline sample (no universal thresholds).
  const baselineReady = (base.n || 0) >= (t.minBaselineSample || 5);
  if (Number.isFinite(m.searchShare) && m.searchShare >= (t.searchDependentShare || 0.5)) add("SEARCH_DEPENDENT", "medium", `${Math.round(m.searchShare * 100)}% of views from YouTube search`, "Evergreen search demand: keep the searchable subject in the title; consider a long-form companion.");
  if (baselineReady && Number.isFinite(m.subscribersPer1000Views) && Number.isFinite(base.subscribersPer1000Views) && base.subscribersPer1000Views > 0
    && m.subscribersPer1000Views >= base.subscribersPer1000Views * (t.strongConversionVsMedian || 1.5)) add("STRONG_TOPIC_AUDIENCE_FIT", sampleConfidence, `${m.subscribersPer1000Views} subs / 1,000 views vs channel median ${base.subscribersPer1000Views}`, "Nominate adjacent topics in this cluster; candidate for a series.");
  if (baselineReady && Number.isFinite(base.views) && views >= base.views * (t.strongDiscoveryVsMedian || 2) && (long || !Number.isFinite(m.shortsFeedShare) || m.shortsFeedShare >= (t.shortsFeedShareMinimum || 0.5)))
    add("STRONG_DISCOVERY", sampleConfidence, `${views} views vs channel ${long ? "long-form" : "Shorts"} median ${base.views}`, "Study the opening and topic; replicate one variable at a time.");
  if (Number.isFinite(m.ctr) && m.ctr >= (t.goodCtr || 6) && retentionEarly != null && retentionEarly < (long ? t.hookFailureRetentionAt30s : t.hookFailureRetentionAt3s))
    add("PROMISE_CONTENT_MISMATCH", "low", `CTR ${m.ctr}% (manual Studio value) but retention ${Math.round(retentionEarly * 100)}% early`, "The title/thumbnail promises something the opening does not deliver; align the first seconds with the promise.");
  if (long && options.linkedShorts && options.linkedShorts > 0 && Number.isFinite(options.shortsTrafficShare) && options.shortsTrafficShare < 0.02) add("SHORT_TO_LONG_FUNNEL_FAILURE", "low", `${options.linkedShorts} linked Shorts but ${Math.round(options.shortsTrafficShare * 100)}% of views from Shorts (inferred)`, "Check Related Video manual actions are done; test an on-screen long-form CTA.");
  return finalize(out, row, options);
}

function retentionAt(row, seconds, ratio) {
  const curve = row.retention || (row.checkpoints && row.latestCheckpoint && row.checkpoints[row.latestCheckpoint] && row.checkpoints[row.latestCheckpoint].retention) || null;
  if (!Array.isArray(curve) || !curve.length) return null;
  const target = ratio != null ? ratio : row.durationSeconds ? Math.min(1, seconds / row.durationSeconds) : null;
  if (target == null) return null;
  const point = curve.reduce((best, item) => Math.abs(item.oran - target) < Math.abs(best.oran - target) ? item : best, curve[0]);
  return point.izleme;
}

// Spec names for the original codes (kept, so stored history stays readable).
const SPEC_CODES = Object.freeze({
  HOOK_FAILURE: "HOOK_WEAK", RETENTION_FAILURE: "RETENTION_WEAK", LONGFORM_DEPTH_FAILURE: "RETENTION_WEAK",
  THUMBNAIL_PACKAGING_FAILURE: "PACKAGING_WEAK", TITLE_PACKAGING_FAILURE: "PACKAGING_WEAK",
  LOW_SUBSCRIBER_CONVERSION: "SUBSCRIBER_CONVERSION_WEAK", GOOD_CONTENT_LOW_DISTRIBUTION: "TOPIC_REACH_LIMITED",
  TOPIC_FAILURE: "TOPIC_REACH_LIMITED", BREAKOUT: "POTENTIAL_BREAKOUT", EARLY_DISTRIBUTION_PLATEAU: "EARLY_DISTRIBUTION_PLATEAU",
});
const specCode = (code) => SPEC_CODES[code] || code;

// Portfolio-level cadence check from the warehouse: more uploads per window
// while watch time per upload falls → CADENCE_QUALITY_RISK. uploads: ISO dates.
function cadenceRisk(channelDaily, uploads, config = {}, now = new Date()) {
  const c = { windowDays: 28, uploadIncreaseRatio: 1.25, watchPerUploadDropRatio: 0.8, minimumUploads: 4, ...config };
  const day = 86400000;
  const end = now.getTime();
  const inWindow = (time, k) => time > end - (k + 1) * c.windowDays * day && time <= end - k * c.windowDays * day;
  const count = (k) => (uploads || []).filter((at) => inWindow(Date.parse(at), k)).length;
  const minutes = (k) => (channelDaily || []).filter((row) => inWindow(Date.parse(row.day + "T12:00:00Z"), k)).reduce((sum, row) => sum + (row.estimatedMinutesWatched || 0), 0);
  const recent = count(0), previous = count(1);
  if (recent < c.minimumUploads || previous < c.minimumUploads) return { code: null, reason: "insufficient uploads", recent, previous };
  const perUploadRecent = minutes(0) / recent, perUploadPrevious = minutes(1) / previous;
  const risk = recent >= previous * c.uploadIncreaseRatio && perUploadPrevious > 0 && perUploadRecent <= perUploadPrevious * c.watchPerUploadDropRatio;
  return { code: risk ? "CADENCE_QUALITY_RISK" : null, recentUploads: recent, previousUploads: previous,
    watchMinutesPerUpload: { recent: Math.round(perUploadRecent), previous: Math.round(perUploadPrevious) } };
}

function finalize(list, row, options) {
  if (!list.length) list.push({ code: "HEALTHY", confidence: "low", evidence: "no problem pattern in available metrics", recommendation: "Keep; revisit at next checkpoint." });
  for (const item of list) item.specCode = specCode(item.code);
  return { videoId: row.videoId, channel: row.channel, contentType: row.contentType, checkpoint: options.checkpoint || row.latestCheckpoint || null, diagnoses: list };
}

module.exports = { SPEC_CODES, specCode, cadenceRisk, diagnose, retentionAt };
