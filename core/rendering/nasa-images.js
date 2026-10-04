"use strict";

// NASA Image and Video Library (https://images.nasa.gov, public documented API
// at https://images-api.nasa.gov, no key) as a second picture source for topics
// whose Wikipedia article has few or no photographs: ocean currents, planets,
// storms, ice sheets.
//
// NASA media are generally not copyrighted, but the library also holds
// partner and third-party material. An item is used only when nothing in its
// credits names a non-NASA rights holder, and only when its own title or
// keywords carry at least two of the topic's own terms.

const API = "https://images-api.nasa.gov";
const LICENCE = "Public domain (NASA media usage guidelines)";

const STOPWORDS = new Set(("what if the a an of to in on at for by with and or but from into over under than then that this these those it its is are was were be been " +
  "would could should will can may might do does did not no all any every each one two three first new about why how when where which who whose there their " +
  "they them we our you your he she his her up down out off more most less very just only also tomorrow tonight right now became become stop stopped shut " +
  "inside system built around behind machine depends entire").split(/\s+/));
// Too common in the library to say anything about relevance on their own.
const GENERIC = new Set(["earth", "space", "nasa", "image", "images", "view", "photo", "world", "planet", "water", "light", "science", "data", "day", "year", "years", "time", "center"]);

// Rights notices anywhere; partner organisations in the credit fields (a
// description may mention a university or ESA in its story without the image
// being theirs).
const RIGHTS_NOTICE = /©|copyright|all rights reserved|getty|reuters|associated press|\bap photo\b/i;
const PARTNER_CREDIT = /\besa\b|european space|\bcnes\b|\bjaxa\b|\bcsa\b|canadian space|roscosmos|\bdlr\b|\bisro\b|copernicus|universit|institut|\binc\b|\bltd\b|\bcorp|\bllc\b|spacex|boeing|lockheed|northrop|courtesy/i;
const NOT_A_SCENE = /portrait|headshot|logo|insignia|\bpatch\b|crew photo|press conference|ceremony|award|meeting|briefing|signing|visit|speaks|poses|tour\b|audience|infrastructure|operations|architecture|update|campaign|program|strategy|roadmap|poster|infographic|\[video\]/i;
// "Moon" also matches Phobos ("Mars' Moon Phobos"): a picture naming another
// body than the topic's is about something else.
const BODIES = new Set(["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "phobos", "deimos", "europa", "ganymede", "callisto", "titan", "enceladus", "ceres", "vesta", "charon", "triton", "bennu", "ryugu"]);

function contentWords(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

function articleTitles(topic) {
  const titles = [];
  for (const fact of Array.isArray(topic.facts) ? topic.facts : []) {
    try {
      const url = new URL(fact.url || "");
      if (url.hostname === "en.wikipedia.org" && url.pathname.startsWith("/wiki/")) titles.push(decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " "));
    } catch (error) {}
  }
  return [...new Set(titles)];
}

// Anchor terms name the topic itself (title, article, canonical subject); a
// match on scene wording alone is not enough. The article title is the
// strongest anchor, and its disambiguation ("Galileo (satellite navigation)")
// separates a topic from a namesake (the Galileo Jupiter probe).
function topicTerms(topic) {
  const articles = articleTitles(topic);
  const anchors = new Set([topic.topic, topic.canonicalTopic, topic.subject, ...articles].flatMap(contentWords).filter((word) => !GENERIC.has(word)));
  const subjects = articles.map((title) => contentWords(title.replace(/\([^)]*\)/g, " ")).filter((word) => !GENERIC.has(word))).filter((words) => words.length);
  const article = new Set(subjects.flat());
  const qualifiers = new Set(articles.flatMap((title) => (title.match(/\(([^)]*)\)/g) || []).flatMap(contentWords)).filter((word) => !GENERIC.has(word)));
  // Only the topic's primary article may match on its own: a secondary
  // article such as "Tide" would also accept "Red Tide" algae.
  return { anchors, article, subjects: subjects.slice(0, 1), qualifiers };
}

function queries(topic) {
  const scenes = (Array.isArray(topic.visualScenes) ? topic.visualScenes : (topic.visualPotential || {}).scenes || [])
    .map((scene) => typeof scene === "string" ? scene : scene && scene.text).filter(Boolean);
  const articles = articleTitles(topic).map((title) => title.replace(/\s*\(([^)]*)\)/, " $1").trim());
  const out = [
    topic.canonicalTopic,
    contentWords(topic.topic).filter((word) => !GENERIC.has(word)).slice(0, 4).join(" "),
    ...scenes.slice(0, 3).map((scene) => contentWords(scene).slice(0, 4).join(" ")),
  ].map((query) => String(query || "").trim()).filter((query) => query.split(/\s+/).length >= 2);
  // Article titles are searched even when they are one word ("Phytoplankton").
  return [...new Set([...articles, ...out])].slice(0, 6);
}

function rightsClear(data) {
  const credits = [data.secondary_creator, data.photographer].filter(Boolean).join(" ");
  const everything = [credits, data.title, data.description_508, data.description].filter(Boolean).join(" ");
  return !RIGHTS_NOTICE.test(everything) && !PARTNER_CREDIT.test(credits);
}

function relevance(data, terms) {
  const head = new Set(contentWords(`${data.title || ""} ${(data.keywords || []).join(" ")}`));
  const matched = [...terms.anchors].filter((word) => head.has(word));
  return { matched, score: matched.length };
}

function accept(data, terms) {
  if (!data || data.media_type !== "image") return false;
  if (NOT_A_SCENE.test(`${data.title || ""} ${(data.keywords || []).join(" ")}`)) return false;
  if (!rightsClear(data)) return false;
  const { matched, score } = relevance(data, terms);
  const head = contentWords(`${data.title || ""} ${(data.keywords || []).join(" ")}`);
  if (head.some((word) => BODIES.has(word) && !terms.anchors.has(word))) return false;
  const article = terms.article || new Set();
  // The whole primary-article subject ("Phytoplankton", "Sun") is enough;
  // otherwise two topic terms, at least one of them from an article.
  const wholeArticle = (terms.subjects || []).some((words) => words.every((word) => matched.includes(word)));
  if (!wholeArticle && (score < 2 || (article.size && !matched.some((word) => article.has(word))))) return false;
  if (terms.qualifiers && terms.qualifiers.size) {
    const all = new Set(contentWords(`${data.title || ""} ${(data.keywords || []).join(" ")} ${data.description || ""}`));
    if (![...terms.qualifiers].every((word) => all.has(word))) return false;
  }
  return true;
}

function toStill(data, imageUrl, score) {
  const title = String(data.title || data.nasa_id).replace(/\s+/g, " ").trim();
  const credit = [data.secondary_creator, data.photographer].filter(Boolean).join(" / ") || (data.center ? `NASA ${data.center}` : "NASA");
  return {
    file: `NASA ${data.nasa_id} - ${title}.jpg`.replace(/[\\/:*?"<>|]/g, " "),
    imageUrl,
    width: null,
    height: null,
    licence: LICENCE,
    author: credit,
    sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
    description: String(data.description || title).replace(/\s+/g, " ").slice(0, 300),
    origin: "nasa-images",
    score,
  };
}

function pickRendition(urls) {
  const list = (Array.isArray(urls) ? urls : []).filter((url) => /\.jpe?g$/i.test(url));
  return list.find((url) => /~large\.jpe?g$/i.test(url)) || list.find((url) => /~medium\.jpe?g$/i.test(url)) || list.find((url) => /~orig\.jpe?g$/i.test(url)) || null;
}

async function search(topic, limit, get, exclude = new Set()) {
  const terms = topicTerms(topic);
  if (terms.anchors.size < 2 || limit <= 0) return [];
  const candidates = new Map();
  for (const query of queries(topic)) {
    const response = await get(`${API}/search?media_type=image&page_size=25&q=${encodeURIComponent(query)}`, { json: true });
    if (!(response.status >= 200 && response.status < 300)) continue;
    let body;
    try { body = typeof response.body === "string" ? JSON.parse(response.body) : response.body; } catch (error) { continue; }
    for (const item of (body && body.collection && body.collection.items) || []) {
      const data = item.data && item.data[0];
      if (!data || candidates.has(data.nasa_id) || !accept(data, terms)) continue;
      candidates.set(data.nasa_id, { data, href: item.href, score: relevance(data, terms).score });
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || String(a.data.nasa_id).localeCompare(String(b.data.nasa_id)));
  const out = [];
  for (const candidate of ranked) {
    if (out.length >= limit) break;
    const still = toStill(candidate.data, null, candidate.score);
    if (exclude.has(still.file)) continue;
    const assets = await get(candidate.href, { json: true });
    if (!(assets.status >= 200 && assets.status < 300)) continue;
    let urls;
    try { urls = typeof assets.body === "string" ? JSON.parse(assets.body) : assets.body; } catch (error) { continue; }
    const imageUrl = pickRendition(urls);
    if (!imageUrl) continue;
    out.push({ ...still, imageUrl: imageUrl.replace(/^http:/, "https:") });
  }
  return out;
}

module.exports = { API, LICENCE, contentWords, topicTerms, queries, rightsClear, relevance, accept, pickRendition, toStill, search };
