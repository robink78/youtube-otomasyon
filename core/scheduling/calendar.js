"use strict";

// Calendar-day Shorts scheduling in the channel's IANA time zone.
//
// Production time and public publish time are different things: each channel
// becomes eligible at its own morning production slot, and every Short is
// scheduled on YouTube to go public at the same local publish time that day.
// Eligibility is calendar-day idempotent (one Short per channel per local
// date), never "last publishAt + 24 h", which kept yesterday's 21:00 Short
// blocking this morning's production.
//
// Historical 01:00 Istanbul experiment records keep their original production
// day (the previous Istanbul date). Current production publishes at 21:00
// Europe/Istanbul. The explicit cohort conversion prevents a historical UTC
// instant from being reinterpreted as a second production day after a config
// change.
//
// All conversions go through Intl with an explicit time zone, so the runner's
// local TZ never matters and DST transitions are handled by the tz database.

const DEFAULT_TIME_ZONE = "Europe/Istanbul";
const DEFAULT_PRODUCTION_TIME = "09:00";
const DEFAULT_PUBLISH_TIME = "21:00";
const DEFAULT_MIN_LEAD_MINUTES = 60;
// YouTube only needs publishAt in the future; this is the floor for an upload
// that finishes after the production window closed.
const MIN_UPLOAD_LEAD_MINUTES = 10;

const formatters = new Map();
function parts(date, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  const out = {};
  for (const part of formatters.get(timeZone).formatToParts(date)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

const pad = (value) => String(value).padStart(2, "0");

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

// Local calendar date (YYYY-MM-DD) of an instant in the given time zone.
function dayKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = toDate(value);
  if (!date) return null;
  const p = parts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant at which the local wall clock in timeZone shows `time` on `key`.
// The second pass corrects the offset when the first guess crossed a DST edge.
function zonedTime(key, time, timeZone = DEFAULT_TIME_ZONE) {
  const [year, month, day] = key.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

function addDays(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(toKey + "T00:00:00Z") - Date.parse(fromKey + "T00:00:00Z")) / 86400000);
}

function validTime(value, fallback) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? value : fallback;
}

function shortSchedule(channel) {
  const config = channel.config || {};
  const shorts = (config.publishingCadence && config.publishingCadence.shorts) || {};
  return {
    timeZone: config.timezone || DEFAULT_TIME_ZONE,
    publishTimeZone: shorts.publishTimeZone || config.publishTimeZone || config.timezone || DEFAULT_TIME_ZONE,
    productionTime: validTime(shorts.productionTime, DEFAULT_PRODUCTION_TIME),
    publishTime: validTime(shorts.publishTime || config.publishTime, DEFAULT_PUBLISH_TIME),
    minLeadMinutes: Number.isFinite(shorts.minLeadMinutes) ? shorts.minLeadMinutes : DEFAULT_MIN_LEAD_MINUTES,
    everyDays: shorts.everyDays || 1,
  };
}

function shortRows(records) {
  return (Array.isArray(records) ? records : []).filter((row) => row && typeof row === "object" && (row.format || "short") === "short");
}

// A Short occupies the day of its publish slot (read in the publish zone) and
// the local day it was uploaded: a Short uploaded today but scheduled later
// still counts for today, so no run can follow it with a second upload.
function publicationDay(row, timeZone, publishTimeZone = timeZone) {
  if (!row || !row.publishAt) return null;
  const instant = toDate(row.publishAt);
  if (!instant) return null;
  const local = parts(instant, timeZone);
  const localDay = dayKey(row.publishAt, timeZone);
  // The preserved experiment cohort was scheduled as 18:00 New York and
  // appeared at 01:00 TR on D+1. Its production slot remains D.
  if ((row.publishTimeCohort === "01:00_TR" || (!row.publishTimeCohort && local.hour === 1)) && timeZone === DEFAULT_TIME_ZONE) return addDays(localDay, -1);
  return dayKey(row.publishAt, publishTimeZone);
}

function occupiedDays(row, timeZone, publishTimeZone = timeZone) {
  return [...new Set([publicationDay(row, timeZone, publishTimeZone), dayKey(row.tarih || row.generatedAt, timeZone)].filter(Boolean))];
}

function shortForDay(records, key, timeZone = DEFAULT_TIME_ZONE, publishTimeZone = timeZone) {
  return shortRows(records).filter((row) => occupiedDays(row, timeZone, publishTimeZone).includes(key))
    .sort((a, b) => String(a.tarih || "").localeCompare(String(b.tarih || ""))).pop() || null;
}

function lastShortDay(records, timeZone = DEFAULT_TIME_ZONE, publishTimeZone = timeZone) {
  return shortRows(records).flatMap((row) => occupiedDays(row, timeZone, publishTimeZone)).sort().pop() || null;
}

// The production day a publish instant belongs to, for this channel.
function publishDay(value, channel) {
  const schedule = shortSchedule(channel);
  return publicationDay({ publishAt: value }, schedule.timeZone, schedule.publishTimeZone);
}

// Daily eligibility. `everyDays` > 1 (a stretched cadence) requires that many
// calendar days since the last occupied day.
function shortDecision(channel, records, now = new Date(), options = {}) {
  const schedule = shortSchedule(channel);
  const timeZone = schedule.timeZone;
  const everyDays = options.everyDays || schedule.everyDays;
  const today = dayKey(now, timeZone);
  const productionAt = zonedTime(today, schedule.productionTime, timeZone);
  const publishAt = zonedTime(today, schedule.publishTime, schedule.publishTimeZone);
  const closesAt = new Date(publishAt.getTime() - schedule.minLeadMinutes * 60000);
  const existing = shortForDay(records, today, timeZone, schedule.publishTimeZone);
  const lastDay = lastShortDay(records, timeZone, schedule.publishTimeZone);
  const gap = lastDay ? daysBetween(lastDay, today) : null;
  let due = false;
  let reason;
  if (existing) reason = `today's Short already exists (${existing.slug || existing.videoId || "recorded"})`;
  else if (gap != null && gap < everyDays) reason = `cadence every ${everyDays} day(s); last Short ${lastDay}`;
  else if (now < productionAt) reason = `before production slot ${schedule.productionTime} ${timeZone}`;
  else if (now >= closesAt) reason = `production window closed at ${schedule.publishTime} ${schedule.publishTimeZone} minus ${schedule.minLeadMinutes} min`;
  else { due = true; reason = "due"; }
  return {
    due, reason, today, timeZone, publishTimeZone: schedule.publishTimeZone, everyDays, lastDay,
    productionAt: productionAt.toISOString(),
    publishAt: publishAt.toISOString(),
    closesAt: closesAt.toISOString(),
    existing: existing ? { slug: existing.slug || null, videoId: existing.videoId || null, publishAt: existing.publishAt || null } : null,
  };
}

// publishAt for a Short being uploaded now: today's publish time (in the
// publish zone, on today's production date) when that day is free and still in
// the future, otherwise the next free day.
function publishSlot(channel, records, now = new Date(), minLeadMinutes = MIN_UPLOAD_LEAD_MINUTES) {
  const schedule = shortSchedule(channel);
  const timeZone = schedule.timeZone;
  const taken = new Set(shortRows(records).map((row) => publicationDay(row, schedule.timeZone, schedule.publishTimeZone)).filter(Boolean));
  // Start one day back: after local midnight the previous production day's
  // release (e.g. 18:00 New York = 01:00 Istanbul) can still be ahead and free.
  let key = addDays(dayKey(now, timeZone), -1);
  for (let guard = 0; guard < 400; guard += 1, key = addDays(key, 1)) {
    const candidate = zonedTime(key, schedule.publishTime, schedule.publishTimeZone);
    if (!taken.has(key) && candidate.getTime() - now.getTime() >= minLeadMinutes * 60000) return candidate;
  }
  throw new Error("no free publish slot within 400 days");
}

module.exports = {
  DEFAULT_TIME_ZONE, MIN_UPLOAD_LEAD_MINUTES,
  dayKey, zonedTime, addDays, daysBetween, shortSchedule, publicationDay, occupiedDays, shortForDay, lastShortDay, publishDay, shortDecision, publishSlot,
};
