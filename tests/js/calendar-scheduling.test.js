"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Channel = require("../../core/channel-context");
const Calendar = require("../../core/scheduling/calendar");
const Scheduler = require("../../core/scheduling");
const Sla = require("../../production-sla-check");

const FR = Channel.getChannel("failure-reconstructed");
const IB = Channel.getChannel("impossible-brief");
const CT = Channel.getChannel("critical-thread");
const BTO = Channel.getChannel("behind-the-ordinary");
const SLOTS = [[FR, "09:00", "06:00"], [IB, "09:30", "06:30"], [CT, "10:00", "07:00"], [BTO, "10:30", "07:30"]];
const DAY = "2026-10-02";
const at = (utc) => new Date(`${DAY}T${utc}:00Z`);
const yesterdays = [{ format: "short", slug: "yesterday", videoId: "AAAAAAAAAAA", tarih: "2026-10-01T06:20:00Z", publishAt: "2026-10-01T18:00:00.000Z" }];

test("each channel is not due before its Istanbul production slot and due at/after it", () => {
  for (const [channel, local, utc] of SLOTS) {
    const [h, m] = utc.split(":").map(Number);
    const before = new Date(Date.UTC(2026, 9, 2, h, m) - 60000);
    const decisionBefore = Calendar.shortDecision(channel, yesterdays, before);
    assert.equal(decisionBefore.due, false, `${channel.slug} one minute before ${local}`);
    assert.match(decisionBefore.reason, new RegExp(`before production slot ${local}`));
    assert.equal(Calendar.shortDecision(channel, yesterdays, at(utc)).due, true, `${channel.slug} at ${local}`);
    assert.equal(Calendar.shortDecision(channel, yesterdays, at("12:00")).due, true, `${channel.slug} after ${local}`);
    assert.equal(Calendar.shortDecision(channel, yesterdays, at(utc)).productionAt, `${DAY}T${utc}:00.000Z`);
  }
});

test("all four channels schedule the public release for 21:00 Europe/Istanbul without double conversion", () => {
  for (const [channel, , utc] of SLOTS) {
    assert.equal(Calendar.shortSchedule(channel).publishTimeZone, "Europe/Istanbul");
    assert.equal(Calendar.shortSchedule(channel).publishTime, "21:00");
    const decision = Calendar.shortDecision(channel, yesterdays, at(utc));
    assert.equal(decision.publishAt, `${DAY}T18:00:00.000Z`);
    // The uploader runs a few minutes after production starts.
    const uploadedAt = new Date(at(utc).getTime() + 12 * 60000);
    assert.equal(Calendar.publishSlot(channel, yesterdays, uploadedAt).toISOString(), `${DAY}T18:00:00.000Z`);
  }
});

test("a Short public at 01:00 Istanbul belongs to the previous production day and never blocks the next one", () => {
  // Without a separate publish zone this Short would occupy Istanbul's 3 Oct and
  // the 3 Oct morning production would be skipped: one video every other day.
  const today = [...yesterdays, { format: "short", slug: "today", videoId: "GGGGGGGGGGG", tarih: `${DAY}T06:14:00Z`, publishAt: `${DAY}T22:00:00.000Z` }];
  for (const [channel, , utc] of SLOTS) {
    const nextMorning = new Date(`2026-10-03T${utc}:00Z`);
    const decision = Calendar.shortDecision(channel, today, nextMorning);
    assert.equal(decision.due, true, channel.slug);
    assert.equal(decision.lastDay, DAY);
    assert.equal(decision.publishAt, "2026-10-03T18:00:00.000Z");
    assert.equal(Calendar.publishSlot(channel, today, nextMorning).toISOString(), "2026-10-03T18:00:00.000Z");
    assert.equal(Calendar.publishDay(`${DAY}T22:00:00.000Z`, channel), DAY);
  }
});

test("the 21:00 Istanbul release remains 18:00 UTC across US DST changes", () => {
  assert.equal(Calendar.shortDecision(FR, [], new Date("2026-10-31T06:00:00Z")).publishAt, "2026-10-31T18:00:00.000Z");
  assert.equal(Calendar.shortDecision(FR, [], new Date("2026-11-02T06:00:00Z")).publishAt, "2026-11-02T18:00:00.000Z");
  assert.equal(Calendar.shortDecision(IB, [], new Date("2027-03-12T07:00:00Z")).publishAt, "2027-03-12T18:00:00.000Z");
  assert.equal(Calendar.shortDecision(IB, [], new Date("2027-03-15T07:00:00Z")).publishAt, "2027-03-15T18:00:00.000Z");
});

test("the switch from the 01:00 experiment back to 21:00 Istanbul neither skips nor doubles a production day", () => {
  const old = [{ format: "short", slug: "old", videoId: "HHHHHHHHHHH", tarih: `${DAY}T06:14:00Z`, publishAt: `${DAY}T22:00:00.000Z`, publishTimeCohort: "01:00_TR" }];
  assert.equal(Calendar.shortDecision(FR, old, at("16:00")).due, false, "2 Oct is still filled");
  const next = Calendar.shortDecision(FR, old, new Date("2026-10-03T06:00:00Z"));
  assert.equal(next.due, true, "3 Oct is produced");
  assert.equal(next.publishAt, "2026-10-03T18:00:00.000Z");
});

test("yesterday's 21:00 Short does not block this morning's production", () => {
  // The old rolling rule (last publishAt + 24 h) kept this "not due" until 21:00.
  for (const [channel, , utc] of SLOTS) {
    const decision = Calendar.shortDecision(channel, yesterdays, at(utc));
    assert.equal(decision.due, true, channel.slug);
    assert.equal(decision.lastDay, "2026-10-01");
  }
  const YP = require("../../yayin-plani");
  assert.equal(YP.durum("short", at("06:00"), yesterdays, []).uygun, true, "Failure Reconstructed legacy plan");
});

test("a Short already uploaded or scheduled for today prevents a second production", () => {
  const scheduledToday = [...yesterdays, { format: "short", slug: "today", videoId: "BBBBBBBBBBB", tarih: `${DAY}T06:14:00Z`, publishAt: `${DAY}T18:00:00.000Z` }];
  const lateUpload = [...yesterdays, { format: "short", slug: "late", videoId: "CCCCCCCCCCC", tarih: `${DAY}T17:40:00Z`, publishAt: "2026-10-03T18:00:00.000Z" }];
  const unscheduled = [...yesterdays, { format: "short", slug: "private", videoId: "DDDDDDDDDDD", tarih: `${DAY}T06:14:00Z` }];
  for (const [channel] of SLOTS) {
    for (const records of [scheduledToday, lateUpload, unscheduled]) {
      for (const time of ["07:30", "10:23", "16:23"]) {
        const decision = Calendar.shortDecision(channel, records, at(time));
        assert.equal(decision.due, false, `${channel.slug} ${records[1].slug} ${time}`);
        assert.match(decision.reason, /today's Short already exists/);
      }
    }
  }
  // A Short uploaded late yesterday for today also fills today.
  const carried = [{ format: "short", slug: "carried", tarih: "2026-10-01T17:30:00Z", publishAt: `${DAY}T18:00:00.000Z` }];
  assert.equal(Calendar.shortDecision(IB, carried, at("08:00")).due, false);
  // Long-form records never occupy the Short day.
  assert.equal(Calendar.shortDecision(CT, [{ format: "long", tarih: `${DAY}T05:00:00Z`, publishAt: `${DAY}T18:00:00.000Z` }], at("08:00")).due, true);
});

test("the production window closes one hour before 21:00 Istanbul; late uploads use the next free slot", () => {
  assert.equal(Calendar.shortDecision(FR, yesterdays, at("16:59")).due, true);
  const nextDay = Calendar.shortDecision(FR, yesterdays, at("17:00"));
  assert.equal(nextDay.due, false);
  assert.equal(nextDay.today, DAY);
  assert.match(nextDay.reason, /production window closed/);
  assert.equal(Calendar.publishSlot(FR, yesterdays, at("17:30")).toISOString(), `${DAY}T18:00:00.000Z`);
  // Too late for that day's release -> the next free day.
  assert.equal(Calendar.publishSlot(FR, yesterdays, at("17:55")).toISOString(), "2026-10-03T18:00:00.000Z");
  // Today's slot already taken -> next free day.
  const taken = [...yesterdays, { format: "short", publishAt: `${DAY}T18:00:00.000Z` }];
  assert.equal(Calendar.publishSlot(FR, taken, at("08:00")).toISOString(), "2026-10-03T18:00:00.000Z");
});

test("Europe/Istanbul handling is DST- and runner-timezone-safe", () => {
  // Istanbul is UTC+3 all year since 2016; it observed DST before that.
  assert.equal(Calendar.zonedTime("2026-01-15", "21:00").toISOString(), "2026-01-15T18:00:00.000Z");
  assert.equal(Calendar.zonedTime("2026-07-15", "21:00").toISOString(), "2026-07-15T18:00:00.000Z");
  assert.equal(Calendar.zonedTime("2015-01-15", "21:00").toISOString(), "2015-01-15T19:00:00.000Z");
  assert.equal(Calendar.zonedTime("2015-07-15", "21:00").toISOString(), "2015-07-15T18:00:00.000Z");
  // A zone with DST today: the spring-forward day itself.
  assert.equal(Calendar.zonedTime("2026-03-29", "09:00", "Europe/London").toISOString(), "2026-03-29T08:00:00.000Z");
  assert.equal(Calendar.zonedTime("2026-03-28", "09:00", "Europe/London").toISOString(), "2026-03-28T09:00:00.000Z");
  // Local midnight: 21:30 UTC on the 1st is already the 2nd in Istanbul.
  assert.equal(Calendar.dayKey("2026-10-01T21:30:00Z"), "2026-10-02");
  assert.equal(Calendar.dayKey("2026-10-01T20:59:59Z"), "2026-10-01");
  // The runner's own TZ must not matter.
  const script = `const C=require(${JSON.stringify(path.resolve(__dirname, "../../core/scheduling/calendar"))});` +
    `const ch=require(${JSON.stringify(path.resolve(__dirname, "../../core/channel-context"))}).getChannel("critical-thread");` +
    `const d=C.shortDecision(ch,[],new Date("2026-10-01T21:30:00Z"));` +
    `process.stdout.write(JSON.stringify([d.today,d.productionAt,d.publishAt,C.zonedTime("2026-10-02","09:00").toISOString()]));`;
  for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"]) {
    const out = cp.execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: tz } }).toString();
    assert.deepEqual(JSON.parse(out), ["2026-10-02", "2026-10-02T07:00:00.000Z", "2026-10-02T18:00:00.000Z", "2026-10-02T06:00:00.000Z"], tz);
  }
});

test("calendar scheduling stays channel-isolated", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-isolation-"));
  try {
    const states = {};
    for (const channel of [IB, CT]) {
      states[channel.slug] = path.join(temp, channel.slug);
      fs.mkdirSync(states[channel.slug], { recursive: true });
    }
    // Only ImpossibleBrief has today's Short.
    fs.writeFileSync(path.join(states["impossible-brief"], "published.json"), JSON.stringify([
      { channel: "impossible-brief", format: "short", slug: "ib-today", videoId: "EEEEEEEEEEE", tarih: `${DAY}T06:40:00Z`, publishAt: `${DAY}T18:00:00.000Z` },
    ]));
    fs.writeFileSync(path.join(states["critical-thread"], "published.json"), JSON.stringify(yesterdays));
    const ib = { ...IB, paths: { ...IB.paths, state: states["impossible-brief"] } };
    const ct = { ...CT, paths: { ...CT.paths, state: states["critical-thread"] } };
    const ibPlan = Scheduler.channelPlan(ib, at("07:30"));
    const ctPlan = Scheduler.channelPlan(ct, at("07:30"));
    assert.equal(ibPlan.short.due, false);
    assert.equal(ibPlan.short.existing.slug, "ib-today");
    assert.equal(ctPlan.short.due, true);
    assert.equal(ctPlan.short.existing, null);
    // Each channel keeps its own production slot.
    assert.equal(ibPlan.short.productionAt, `${DAY}T06:30:00.000Z`);
    assert.equal(ctPlan.short.productionAt, `${DAY}T07:00:00.000Z`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  assert.notEqual(Calendar.shortSchedule(FR).productionTime, Calendar.shortSchedule(IB).productionTime);
  assert.notEqual(Calendar.shortSchedule(IB).productionTime, Calendar.shortSchedule(CT).productionTime);
  assert.notEqual(Calendar.shortSchedule(CT).productionTime, Calendar.shortSchedule(BTO).productionTime);
});

test("watchdog checks today's Istanbul calendar day, not a rolling interval", () => {
  const records = [
    ...yesterdays,
    // Uploaded 22:30 UTC on the 1st = 01:30 TR on the 2nd.
    { format: "short", slug: "after-midnight", videoId: "FFFFFFFFFFF", tarih: "2026-10-01T22:30:00Z", publishAt: `${DAY}T18:00:00.000Z` },
  ];
  assert.equal(Sla.recordForDate(records, DAY).slug, "after-midnight");
  assert.equal(Sla.recordForDate(records, "2026-10-01").slug, "yesterday");
  assert.equal(Sla.recordForDate(yesterdays, DAY), null, "yesterday's Short never satisfies today's SLA");
  const video = (id, publishAt) => ({ id, contentDetails: { duration: "PT40S" }, status: { publishAt } });
  assert.equal(Sla.youtubeVideoForDate([video("a", "2026-10-01T18:00:00Z"), video("b", `${DAY}T18:00:00Z`)], DAY).id, "b");
  const snapshot = Sla.evaluateSnapshot({ date: DAY, channel: "critical-thread", published: yesterdays, generated: [], notifications: {}, youtubeVerified: true });
  assert.equal(snapshot.productionReady, false);
  assert.equal(snapshot.safeToRecover, true, "today is empty, so recovery may produce today's Short");
});

test("watchdog reads a 01:00 Istanbul release as today's Short, so it never recovers into a duplicate", () => {
  const NY = "America/New_York";
  const tonight = `${DAY}T22:00:00.000Z`;
  const video = { id: "tonight", contentDetails: { duration: "PT40S" }, status: { publishAt: tonight } };
  // Read in Istanbul this instant is 3 Oct, which would leave 2 Oct looking empty.
  assert.equal(Sla.youtubeVideoForDate([video], DAY), null);
  assert.equal(Sla.youtubeVideoForDate([video], DAY, "Europe/Istanbul", NY).id, "tonight");
  const records = [...yesterdays, { format: "short", slug: "tonight", videoId: "IIIIIIIIIII", tarih: `${DAY}T06:14:00Z`, publishAt: tonight }];
  assert.equal(Sla.recordForDate(records, DAY, "Europe/Istanbul", NY).slug, "tonight");
  const snapshot = Sla.evaluateSnapshot({ date: DAY, timeZone: "Europe/Istanbul", publishTimeZone: NY, channel: "critical-thread",
    published: records, generated: ["tonight"], notifications: {}, youtubeVerified: true, remoteVideoExists: true, remoteTodayVideo: video });
  assert.equal(snapshot.scheduled, true);
  assert.equal(snapshot.safeToRecover, false);
});

test("the empty-day alarm waits for the Istanbul day's deadline, not the UTC date's", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../bildirim.js"), "utf8");
  assert.match(source, /Date\.parse\(`\$\{g\}T\$\{sonSaat\}:00Z`\)/);
  assert.match(source, /shortForDay\(K\.yayinlananlar\(\), g, tz, Calendar\.shortSchedule\(CHANNEL\)\.publishTimeZone\)/);
});

test("state-writing workflows check out the latest branch tip, not the trigger commit", () => {
  // A run queued behind the concurrency lock would otherwise read state from
  // before the previous run's upload: the calendar check could see today as
  // empty (duplicate Short) and the state commit would conflict on rebase.
  for (const name of ["portfolio-production", "uretim-is", "production-watchdog", "yayin-kontrol", "yorum-yanitla"]) {
    const text = fs.readFileSync(path.join(__dirname, "../../.github/workflows", name + ".yml"), "utf8");
    const checkouts = text.split(/- uses: actions\/checkout@v4/).slice(1);
    assert.ok(checkouts.length, name);
    for (const block of checkouts) assert.match(block.split(/\n\s*- (?:uses|name|id):/)[0], /ref: \$\{\{ github\.ref_name \}\}/, name);
  }
});
