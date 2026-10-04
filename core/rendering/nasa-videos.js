"use strict";

// NASA visualizations and animations (NASA Image and Video Library, public
// documented API, no key) as moving footage for "what if" topics: ocean
// circulation, the Blue Marble, El Niño in 3D, ice shelves, solar storms.
// ImpossibleBrief cannot film its scenarios; NASA's data visualizations are
// the closest real, public-domain moving pictures.
//
// The library also holds launch broadcasts, interviews, news features and
// briefings. A video is used only when its title, keywords or description
// read as a visualization/animation, nothing marks it as a broadcast or
// people story, the rights/relevance rules of nasa-images.js pass, the chosen
// rendition is at most MAX_BYTES, it runs at least MIN_SECONDS and its middle
// four seconds are not black. Landscape footage is shown full width over its
// own blur and tagged NASA VISUALIZATION.

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const Nasa = require("./nasa-images");
const Stock = require("./stock-footage");

const MAX_CLIPS = 2;
const MAX_BYTES = 60 * 1024 * 1024;
const MIN_SECONDS = 8;
const VISUALIZATION = /visuali[sz]|animation|animated|simulat|3d look|time-?lapse|composite|data (?:set|map)|global (?:map|view)|model run|from space|imagery|satellite (?:data|images?|view)|\bsdo\b|\bsoho\b|\bsees\b|snapshots?|flyover|fly-?through|zoom (?:in|out)|\bloop\b|movie|observ(?:es|ed|ations?) of/i;
const NOT_FOOTAGE = /\blive\b|coverage|launch|broadcast|briefing|conference|interview|talks?\b|webinar|podcast|panel|news|recap|trailer|teaser|update|behind the scenes|tour\b|award|ceremony|reel\b|explains?|scientists?\b|engineers?\b|astronauts?\b|crew\b|people\b|students?\b|town hall|q&a|social media|b-roll|expert|promo|ask ?nasa|we asked|history of|education|campaign|kids|lesson|speaks|speaker|lecture|hangout|chat\b/i;

function looksLikeVisualization(data) {
  const head = `${data.title || ""} ${(data.keywords || []).join(" ")}`;
  const text = `${head} ${data.description || ""}`;
  return VISUALIZATION.test(text) && !NOT_FOOTAGE.test(head) && !NOT_FOOTAGE.test(String(data.description || "").slice(0, 300));
}

function acceptVideo(data, terms) {
  if (!data || data.media_type !== "video") return false;
  if (!looksLikeVisualization(data)) return false;
  // Reuse the image rules (rights, relevance, other bodies, programme graphics).
  return Nasa.accept({ ...data, media_type: "image" }, terms);
}

function pickRenditions(urls) {
  const list = (Array.isArray(urls) ? urls : []).filter((url) => /\.mp4$/i.test(url)).map((url) => url.replace(/^http:/, "https:"));
  return ["~medium.mp4", "~small.mp4"].map((suffix) => list.find((url) => url.endsWith(suffix))).filter(Boolean);
}

function probeVideo(file) {
  const { ffprobe } = require("../../ff-yol");
  try {
    const out = JSON.parse(cp.execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8", timeout: 30000 }));
    const stream = (out.streams || [])[0] || {};
    return { duration: Number((out.format || {}).duration) || 0, width: stream.width || 0, height: stream.height || 0 };
  } catch (error) { return { duration: 0, width: 0, height: 0 }; }
}

async function search(topic, directory, options = {}) {
  const get = options.get || Stock.httpGet;
  const limit = options.limit || MAX_CLIPS;
  const terms = Nasa.topicTerms(topic);
  if (terms.anchors.size < 2 || limit <= 0) return [];
  const candidates = new Map();
  for (const query of Nasa.queries(topic)) {
    const response = await get(`${Nasa.API}/search?media_type=video&page_size=25&q=${encodeURIComponent(query)}`, { json: true });
    if (!(response.status >= 200 && response.status < 300)) continue;
    let body;
    try { body = typeof response.body === "string" ? JSON.parse(response.body) : response.body; } catch (error) { continue; }
    for (const item of (body && body.collection && body.collection.items) || []) {
      const data = item.data && item.data[0];
      if (!data || candidates.has(data.nasa_id) || !acceptVideo(data, terms)) continue;
      candidates.set(data.nasa_id, { data, href: item.href, score: Nasa.relevance(data, terms).score });
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || String(a.data.nasa_id).localeCompare(String(b.data.nasa_id)));
  const clips = [];
  for (const { data, href, score } of ranked) {
    if (clips.length >= limit) break;
    const assets = await get(href, { json: true });
    if (!(assets.status >= 200 && assets.status < 300)) continue;
    let urls;
    try { urls = typeof assets.body === "string" ? JSON.parse(assets.body) : assets.body; } catch (error) { continue; }
    let chosen = null;
    for (const url of pickRenditions(urls)) {
      const head = await get(url, { method: "HEAD" });
      const bytes = Number(head.headers && head.headers["content-length"]) || 0;
      if (head.status >= 200 && head.status < 300 && bytes > 0 && bytes <= MAX_BYTES) { chosen = url; break; }
    }
    if (!chosen) continue;
    const cachedFile = `nasa-video-${String(data.nasa_id).replace(/[^a-z0-9-]/gi, "-").slice(0, 60)}.mp4`;
    const target = path.join(directory, cachedFile);
    const response = await get(chosen, { binary: true });
    if (!(response.status >= 200 && response.status < 300) || !Buffer.isBuffer(response.body) || !response.body.length) continue;
    fs.writeFileSync(target, response.body);
    const info = (options.probe || probeVideo)(target);
    // Space and Earth visualizations sit on black: judge the mean luma, not the darkest frame.
    const luma = info.duration >= MIN_SECONDS ? (options.luma || Stock.lumaStats)(target, info.duration) : { mean: 0 };
    if (info.duration < MIN_SECONDS || luma.mean < 18) { fs.unlinkSync(target); continue; }
    const title = String(data.title || data.nasa_id).replace(/\s+/g, " ").trim();
    clips.push({
      id: `nasa-${data.nasa_id}`,
      file: `NASA ${data.nasa_id} - ${title}`,
      cachedFile,
      duration: info.duration,
      width: info.width,
      height: info.height,
      landscape: info.width > info.height,
      licence: Nasa.LICENCE,
      author: [data.secondary_creator, data.photographer].filter(Boolean).join(" / ") || `NASA ${data.center || ""}`.trim(),
      sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
      origin: "nasa-video",
      score,
    });
  }
  return clips;
}

module.exports = { MAX_CLIPS, MAX_BYTES, MIN_SECONDS, looksLikeVisualization, acceptVideo, pickRenditions, search };
