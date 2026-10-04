"use strict";

// HASHTAGS — at most five per video, all relevant. YouTube shows the first
// three above the title and ignores every hashtag once there are more than 15;
// unrelated trending tags (#viral, #fyp) count as spam, so none are used.
//
//   Short: #shorts · #<broad> · #<Subject> · #<category> · #<second broad>
//   Long:          #<broad> · #<Subject> · #<category> · #<second broad>
//
// The visible three are therefore #shorts, a high-volume channel hashtag and
// the video's own subject.
//
// The subject hashtag names the video's own case/object (#VanNormanDam,
// #Europa, #MontBlancTunnel). It comes from the topic's short case name or its
// first English Wikipedia reference, so it is deterministic and never invented.

const MAX_HASHTAGS = 5;
const MAX_SUBJECT_LENGTH = 30;

const CATEGORY = Object.freeze({
  "impossible-brief": {
    SPACE: "#space", EARTH: "#earthscience", PHYSICS: "#physics", HUMAN: "#humanbody",
    "FUTURE TECHNOLOGY": "#futuretech", "EXTREME SCIENCE": "#science", OTHER: "#science",
  },
  "critical-thread": {
    SEMICONDUCTORS: "#semiconductors", "ELECTRICAL GRID": "#powergrid", ENERGY: "#energy",
    TELECOMMUNICATIONS: "#telecom", "SUBMARINE CABLES": "#submarinecables", SATELLITES: "#satellites",
    "GPS AND TIMING": "#gps", AVIATION: "#aviation", SHIPPING: "#shipping", PORTS: "#ports", RAIL: "#railways",
    "ROADS AND BRIDGES": "#infrastructure", WATER: "#water", WASTEWATER: "#wastewater", FOOD: "#foodsystems",
    "COLD CHAIN": "#coldchain", AGRICULTURE: "#agriculture", "INDUSTRIAL CHEMICALS": "#chemicals",
    "CRITICAL MINERALS": "#criticalminerals", MANUFACTURING: "#manufacturing", LOGISTICS: "#logistics",
    "SUPPLY CHAINS": "#supplychain", "GLOBAL CHOKEPOINTS": "#chokepoints", "PRECISION MACHINERY": "#machinery",
    STANDARDS: "#standards", "FINANCIAL INFRASTRUCTURE": "#fintech", "DATA CENTERS": "#datacenters",
    "HEALTH INFRASTRUCTURE": "#healthcare", "WASTE AND RECYCLING": "#recycling",
  },
  "behind-the-ordinary": {
    "EVERYDAY MYSTERIES": "#everydayobjects", "HIDDEN ENGINEERING": "#engineering",
    "STRANGE ORIGINS": "#designhistory", "DESIGN DECISIONS": "#design", "ORDINARY SYSTEMS": "#howitworks",
  },
});

// High-volume hashtags that describe each channel's whole catalogue.
const BROAD = Object.freeze({
  "failure-reconstructed": ["#engineering", "#history"],
  "impossible-brief": ["#science", "#whatif"],
  "critical-thread": ["#engineering", "#howitworks"],
  "behind-the-ordinary": ["#design", "#howitworks"],
});

// "Lower Van Norman Dam" -> "#LowerVanNormanDam"; "Europa (moon)" -> "#Europa".
function toHashtag(name) {
  const cleaned = String(name || "")
    .replace(/^the\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ");
  const words = cleaned.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  const tag = words.map((word) => /^[A-Z0-9]+$/.test(word) && word.length <= 4 ? word : word[0].toUpperCase() + word.slice(1)).join("");
  if (/^\d+$/.test(tag) || tag.length < 3 || tag.length > MAX_SUBJECT_LENGTH) return null;
  return "#" + tag;
}

function wikipediaTitles(references = []) {
  const titles = [];
  for (const item of references) {
    if (!item) continue;
    const url = String(item.url || "").match(/en\.wikipedia\.org\/wiki\/([^#?\s]+)/);
    if (url) {
      try { titles.push(decodeURIComponent(url[1]).replace(/_/g, " ")); } catch (error) { titles.push(url[1].replace(/_/g, " ")); }
    }
    const label = String(item.source || item.name || item.ad || "").match(/^Wikipedia\s+—\s+(.+)$/);
    if (label) titles.push(label[1]);
  }
  return titles;
}

// names: preferred plain subject names (e.g. FR's short case name), tried first.
// A tag that starts with a digit (#787Battery) reads poorly, so a later
// candidate that starts with a letter (#Boeing787Batteries) is preferred.
function subjectHashtag({ names = [], references = [] } = {}) {
  const tags = [...names, ...wikipediaTitles(references)].map(toHashtag).filter(Boolean);
  return tags.find((tag) => /^#[A-Za-z]/.test(tag)) || tags[0] || null;
}

function compose({ format = "short", subject = null, category = null, broad = [] } = {}) {
  const [primary = null, secondary = null] = broad;
  const ordered = [format === "short" ? "#shorts" : null, primary, subject, category, secondary];
  const seen = new Set();
  const out = [];
  for (const tag of ordered) {
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

// IB/CT documentary topics (topic-universe.json entries).
function forTopic(channelSlug, topic = {}, options = {}) {
  const subject = subjectHashtag({ names: channelSlug === "behind-the-ordinary" ? [topic.canonicalTopic || topic.object || ""] : [], references: [...(topic.facts || []), ...(topic.researchEvidence || []), ...(topic.sources || [])] });
  const category = (CATEGORY[channelSlug] || {})[String(topic.category || "").toUpperCase()] || null;
  return compose({ format: options.format || "short", subject, category, broad: BROAD[channelSlug] || [] });
}

// Plain subject phrase for the YouTube tags field ("Mont Blanc Tunnel").
function subjectPhrase(topic = {}) {
  const title = wikipediaTitles([...(topic.facts || []), ...(topic.researchEvidence || []), ...(topic.sources || [])])
    .map((value) => value.replace(/\s*\(.*?\)\s*/g, " ").replace(/[,<>"]/g, " ").replace(/\s+/g, " ").trim())
    .find((value) => value.length >= 3 && value.length <= 60);
  return title || topic.canonicalTopic || topic.object || null;
}

module.exports = { MAX_HASHTAGS, CATEGORY, BROAD, toHashtag, wikipediaTitles, subjectHashtag, compose, forTopic, subjectPhrase };
