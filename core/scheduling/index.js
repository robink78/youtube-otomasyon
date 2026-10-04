"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("../channel-context");
const Calendar = require("./calendar");

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function lastPublished(channel, format) {
  if (channel.config.pathMode === "legacy-adapter") {
    const rows = read(path.join(channel.paths.state, "yayinlananlar.json"), []);
    return rows.filter((item) => (item.format || "short") === format).map((item) => item.publishAt || item.tarih).filter(Boolean).sort().pop() || null;
  }
  const state = read(path.join(channel.paths.state, "scheduler-state.json"), {});
  const scheduled = format === "short" ? state.lastShort || null : state.lastLong || null;
  const published = read(path.join(channel.paths.state, "published.json"), [])
    .filter((item) => (item.format || "short") === format)
    .map((item) => item.publishAt || item.tarih)
    .filter(Boolean).sort().pop() || null;
  return [scheduled, published].filter(Boolean).sort().pop() || null;
}

// Short records of the channel, plus the scheduler's own last Short marker.
function shortRecords(channel) {
  if (channel.config.pathMode === "legacy-adapter") return read(path.join(channel.paths.state, "yayinlananlar.json"), []);
  const state = read(path.join(channel.paths.state, "scheduler-state.json"), {});
  const published = read(path.join(channel.paths.state, "published.json"), []);
  return [...(Array.isArray(published) ? published : []), ...(state.lastShort ? [{ format: "short", publishAt: state.lastShort }] : [])];
}

// Rolling interval: used only for the weekly long-form lane. Daily Shorts use
// calendar-day idempotency (core/scheduling/calendar.js).
function isDue(last, everyDays, now) {
  return !last || now.getTime() - Date.parse(last) >= everyDays * 86400000;
}

function shortPlan(channel, last, everyDays, now) {
  const decision = Calendar.shortDecision(channel, shortRecords(channel), now);
  return { due: decision.due, last, everyDays, reason: decision.reason, today: decision.today, timeZone: decision.timeZone,
    productionAt: decision.productionAt, publishAt: decision.publishAt, closesAt: decision.closesAt, existing: decision.existing };
}

function channelPlan(channel, now = new Date()) {
  const cadence = channel.config.publishingCadence;
  const shortLast = lastPublished(channel, "short");
  const longLast = lastPublished(channel, "long");
  return {
    channel: channel.slug,
    channelName: channel.name,
    short: shortPlan(channel, shortLast, cadence.shorts.everyDays, now),
    long: { due: isDue(longLast, cadence.longForm.everyDays, now), last: longLast, everyDays: cadence.longForm.everyDays },
  };
}

function portfolioPlan(now = new Date()) {
  const registry = Channel.registry();
  const channels = Object.keys(registry.channels).filter((slug) => registry.channels[slug].enabled).map((slug) => channelPlan(Channel.getChannel(slug), now));
  const due = channels.flatMap((item) => [
    ...(item.short.due ? [{ channel: item.channel, format: "short", key: `${item.channel}:short` }] : []),
    ...(item.long.due ? [{ channel: item.channel, format: "long", key: `${item.channel}:long` }] : []),
  ]);
  const order = registry.global.queuePriority || [];
  due.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return {
    generatedAt: now.toISOString(),
    channels,
    resourceLimits: { maxConcurrentRenders: registry.global.maxConcurrentRenders, maxConcurrentUploads: registry.global.maxConcurrentUploads },
    queue: due.map((task, index) => ({ ...task, position: index + 1, renderLane: index % registry.global.maxConcurrentRenders, uploadLane: index % registry.global.maxConcurrentUploads })),
  };
}

// Close tasks from earlier days: "done" when that day has a Short (or the
// long-form lane recorded an episode), otherwise "missed". Without this every
// task stayed "queued" forever and queue depth / job age meant nothing.
function settle(state, channel, today, records = shortRecords(channel)) {
  const tz = channel.config.timezone;
  const publishTz = Calendar.shortSchedule(channel).publishTimeZone;
  for (const item of state.queue) {
    if (item.status !== "queued" || !item.date || item.date >= today) continue;
    const done = item.format === "short" ? !!Calendar.shortForDay(records, item.date, tz, publishTz) : false;
    item.status = done ? "done" : item.format === "short" ? "missed" : "expired";
    item.settledOn = today;
  }
  state.queue = state.queue.slice(-60);
  return state;
}

function enqueue(plan = portfolioPlan()) {
  for (const task of plan.queue) {
    const channel = Channel.getChannel(task.channel);
    const file = path.join(channel.paths.state, "scheduler-state.json");
    const state = read(file, { channel: task.channel, lastShort: null, lastLong: null, queue: [] });
    const today = Calendar.dayKey(plan.generatedAt, channel.config.timezone);
    const before = JSON.stringify(state.queue);
    settle(state, channel, today);
    const fresh = !state.queue.some((item) => item.key === task.key && item.date === today);
    if (fresh) state.queue.push({ ...task, date: today, status: "queued" });
    if (fresh || JSON.stringify(state.queue) !== before) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + `.tmp-${process.pid}`;
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n");
      fs.renameSync(temporary, file);
    }
  }
  return plan;
}

module.exports = { lastPublished, shortRecords, isDue, shortPlan, channelPlan, portfolioPlan, settle, enqueue };
