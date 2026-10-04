"use strict";

// Moving footage for ImpossibleBrief / CriticalThread Shorts from the Pexels
// video API (documented, https://www.pexels.com/api/documentation/, key in
// PEXELS_KEY; Pexels License: free, no attribution required — credits are
// still written to the description). Failure Reconstructed already uses the
// same source (stok-bul.js).
//
// Stock footage is context, never evidence: it is tagged STOCK FOOTAGE on
// screen. A clip is used only when its descriptive page slug names the topic
// (a topic term from core/rendering/nasa-images.js), it is not about people,
// it is portrait HD, at least 5 seconds long and not mostly dark.

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const https = require("https");
const Nasa = require("./nasa-images");

// Pexels needs an Authorization header and its file links redirect to a CDN.
function httpGet(url, options = {}, redirects = 5) {
  return new Promise((resolve) => {
    const request = https.request(url, { method: options.method || "GET", headers: { "User-Agent": "youtube-otomasyon/1.0", ...(options.headers || {}) }, timeout: 120000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume();
        // The key is for api.pexels.com only; never forward it to a CDN.
        return resolve(httpGet(new URL(response.headers.location, url).toString(), { ...options, headers: {} }, redirects - 1));
      }
      const parts = [];
      response.on("data", (chunk) => parts.push(chunk));
      response.on("end", () => { const buffer = Buffer.concat(parts); resolve({ status: response.statusCode, headers: response.headers, body: options.binary ? buffer : buffer.toString("utf8") }); });
    });
    request.end();
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () => resolve({ status: 0, body: options.binary ? Buffer.alloc(0) : "" }));
  });
}

const API = "https://api.pexels.com/videos/search";
const LICENCE = "Pexels License";
const MAX_CLIPS = 3;
// Low-information context words must never establish subject relevance on their
// own. They are useful search terms, but not evidence that a clip depicts the
// mechanism the Short is actually about.
const GENERIC_SUBJECT_TERMS = new Set([
  "road", "roads", "ocean", "oceans", "system", "systems", "eye", "eyes", "water", "power", "city", "cities",
  "building", "buildings", "machine", "machines", "vehicle", "vehicles", "technology", "infrastructure", "device", "devices",
  "server", "servers", "network", "networks", "view", "aerial", "street", "highway", "world", "earth",
]);

// A Short about a port should not cut to a smiling stranger.
// Uniformed crews read as a specific country's service (a Russian fire crew in
// a Short about a French–Italian tunnel).
const PEOPLE = /\b(?:woman|women|man|men|girl|girls|boy|boys|person|people|couple|family|portrait|selfie|lady|guy|kid|kids|child|children|businessman|businesswoman|worker|workers|model|dancing|smiling|face|firefighters?|fireman|firemen|rescuers?|soldiers?|army|military|police|policeman|officers?|doctors?|nurses?|pilots?|technicians?|engineers?|operators?|crew|team|tourists?|athletes?|students?|employees?)\b/i;

function slugWords(pageUrl) {
  const match = String(pageUrl || "").match(/\/video\/([^/]+?)(?:-\d+)?\/?$/);
  return match ? Nasa.contentWords(match[1].replace(/-/g, " ")) : [];
}

function queries(topic) {
  const scenes = (Array.isArray(topic.visualScenes) ? topic.visualScenes : (topic.visualPotential || {}).scenes || [])
    .map((scene) => typeof scene === "string" ? scene : scene && scene.text).filter(Boolean);
  const short = (text) => Nasa.contentWords(text).slice(0, 3).join(" ");
  return [...new Set([
    short(topic.canonicalTopic),
    ...Nasa.queries(topic).slice(0, 2).map(short),
    ...scenes.slice(0, 3).map(short),
    String(topic.category || "").toLowerCase(),
  ].filter((query) => query && query.split(/\s+/).length >= 1))].slice(0, 6);
}

// A road-tunnel Short should not cut to a metro station: a clip showing a
// transport mode the topic never mentions is about something else.
const MODES = [
  { clip: /\b(?:train|trains|subway|metro|railway|tram|locomotive)\b/, topic: /\b(?:train|trains|rail|railway|railways|subway|metro|tram|locomotive)\b/ },
  { clip: /\b(?:airplane|airplanes|plane|planes|aircraft|airport|jet)\b/, topic: /\b(?:aviation|aircraft|airport|airports|plane|planes|flight|flights|jet|airline)\b/ },
  { clip: /\b(?:ship|ships|boat|boats|vessel|vessels|ferry|yacht)\b/, topic: /\b(?:ship|ships|shipping|boat|vessel|vessels|ferry|port|ports|maritime|canal|cable|cables|strait|chokepoint|chokepoints)\b/ },
];

function modeConflict(words, topicText) {
  const clip = words.join(" ");
  return MODES.some((mode) => mode.clip.test(clip) && !mode.topic.test(topicText));
}
// A Short about another world must not cut to Earth scenery: "ocean" admitted
// dolphins leaping at sunset for a Short about Europa's ice-covered ocean.
const OFF_WORLD = /\b(?:europa|enceladus|titan|mars|martian|venus|jupiter|saturn|uranus|neptune|pluto|moon|moons|lunar|asteroids?|comets?|exoplanets?|galax(?:y|ies)|black holes?|neutron stars?|sun|solar|space|spacecraft|spaceship|orbit|cosmic|universe)\b/;
const EARTH_SCENE = /\b(?:ocean|oceans|sea|seas|beach|waves?|dolphins?|whales?|fish|coral|underwater|surf|surfing|sunset|sunrise|forest|trees?|city|street|traffic|mountains?|lake|river|desert|field|farm|island|boat|clouds?)\b/;
const SPACE_CLIP = /\b(?:space|stars?|galax(?:y|ies)|planets?|moon|nebula|universe|cosmos|astronaut|rocket|satellite|orbit|telescope|jupiter|saturn|mars|europa)\b/;
function offWorldConflict(words, topicText) {
  const clip = words.join(" ");
  return OFF_WORLD.test(String(topicText || "").toLowerCase()) && EARTH_SCENE.test(clip) && !SPACE_CLIP.test(clip);
}

// The subject of the topic (its canonical subject, or its title words), not a
// place name: "Mont Blanc" alone admitted a helicopter on a landing pad.
function subjectTerms(topic) {
  const text = [topic.canonicalTopic, topic.subject, topic.designDetail, topic.mechanism, topic.topic].filter(Boolean).join(" ")
    .replace(/cat['’]?s[- ]eye/gi, "road stud reflector");
  const words = Nasa.contentWords(text);
  if (/\b(?:road stud|cat['’]?s[- ]eye)\b/i.test(text)) words.push("stud", "reflector", "reflective", "catseye");
  if (/\b(?:uninterruptible power supply|\bups\b)\b/i.test(text)) words.push("ups", "uninterruptible", "battery", "backup");
  return new Set(words.filter((word) => !GENERIC_SUBJECT_TERMS.has(word)));
}

function relevanceEvidence(video, subject) {
  const words = slugWords(video && video.url);
  const strongSubject = new Set([...(subject || [])].filter((word) => !GENERIC_SUBJECT_TERMS.has(word)));
  const matchedStrongTerms = words.filter((word) => strongSubject.has(word));
  const genericTermsIgnored = words.filter((word) => GENERIC_SUBJECT_TERMS.has(word));
  return { words, matchedStrongTerms: [...new Set(matchedStrongTerms)], genericTermsIgnored: [...new Set(genericTermsIgnored)] };
}

function accept(video, terms, subject = terms.anchors, topicText = [...terms.anchors].join(" ")) {
  if (!video || !(video.duration >= 5)) return false;
  const evidence = relevanceEvidence(video, subject);
  const words = evidence.words;
  if (!words.length || PEOPLE.test(words.join(" ")) || modeConflict(words, topicText)) return false;
  if (offWorldConflict(words, topicText)) return false;
  // A generic setting ("road", "ocean", "system", etc.) is context, not
  // subject/mechanism evidence. At least one distinctive topic term must be in
  // the provider's descriptive slug.
  return evidence.matchedStrongTerms.length > 0;
}

function pickFile(video) {
  return (video.video_files || [])
    .filter((file) => file.height >= file.width && file.height >= 960 && /mp4/i.test(file.file_type || "mp4") && file.link)
    .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0] || null;
}

// Luma of the darkest half-second in the middle four seconds: a shot always
// uses the middle of its clip (core/rendering renderVideo), and a train
// entering a tunnel is bright first, then black.
function lumaStats(file, duration = 0) {
  const { ffmpeg } = require("../../ff-yol");
  const start = Math.max(0, duration / 2 - 2);
  const out = cp.spawnSync(ffmpeg, ["-hide_banner", "-ss", start.toFixed(2), "-t", "4", "-i", file, "-vf", "fps=2,scale=64:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { encoding: "utf8", timeout: 90000 });
  const values = [...String(out.stderr || "").matchAll(/YAVG=([\d.]+)/g)].map((match) => Number(match[1]));
  return values.length ? { min: Math.min(...values), mean: values.reduce((sum, value) => sum + value, 0) / values.length } : { min: 0, mean: 0 };
}

function brightness(file, duration = 0) {
  return lumaStats(file, duration).min;
}

async function search(topic, directory, key, options = {}) {
  const get = options.get || httpGet;
  const limit = options.limit || MAX_CLIPS;
  const terms = Nasa.topicTerms(topic);
  const subject = subjectTerms(topic);
  const topicText = [topic.topic, topic.canonicalTopic, topic.category, ...Nasa.queries(topic)].filter(Boolean).join(" ").toLowerCase();
  if (!key || !subject.size) return [];
  const seen = new Set(options.exclude || []);
  const candidates = [];
  for (const query of queries(topic)) {
    const response = await get(`${API}?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=15`, { json: true, headers: { Authorization: key } });
    if (!(response.status >= 200 && response.status < 300)) continue;
    let body;
    try { body = typeof response.body === "string" ? JSON.parse(response.body) : response.body; } catch (error) { continue; }
    for (const video of (body && body.videos) || []) {
      if (seen.has(video.id) || !accept(video, terms, subject, topicText)) continue;
      const file = pickFile(video);
      if (!file) continue;
      seen.add(video.id);
      const score = slugWords(video.url).filter((word) => subject.has(word)).length * 2 + slugWords(video.url).filter((word) => terms.anchors.has(word)).length;
      candidates.push({ video, file, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.video.id - b.video.id);
  const clips = [];
  for (const { video, file, score } of candidates) {
    if (clips.length >= limit) break;
    const cachedFile = `pexels-${video.id}.mp4`;
    const target = path.join(directory, cachedFile);
    const response = await get(file.link, { binary: true });
    if (!(response.status >= 200 && response.status < 300) || !Buffer.isBuffer(response.body) || !response.body.length) continue;
    fs.writeFileSync(target, response.body);
    if ((options.brightness || brightness)(target, video.duration) < 28) { fs.unlinkSync(target); continue; }
    clips.push({
      id: video.id,
      file: `Pexels video ${video.id}`,
      cachedFile,
      duration: video.duration,
      width: file.width,
      height: file.height,
      licence: LICENCE,
      author: (video.user && video.user.name) || "Pexels contributor",
      sourceUrl: video.url,
      origin: "pexels",
      score,
    });
  }
  return clips;
}

module.exports = { API, LICENCE, MAX_CLIPS, GENERIC_SUBJECT_TERMS, httpGet, lumaStats, slugWords, subjectTerms, relevanceEvidence, modeConflict, offWorldConflict, queries, accept, pickFile, brightness, search };
