"use strict";

// SERIES IDENTITY — every Short is a numbered episode of its channel's series
// ("FAILURE FILE #13"). A recurring, numbered format tells a viewer there is
// more coming, which is what a subscription is for; one-off videos give no
// reason to subscribe.
//
// The episode number is the channel's count of published Shorts before this
// one, plus one. A topic that is re-rendered keeps its number; a render that is
// never uploaded leaves the number for the next Short.

const fs = require("fs");
const path = require("path");

const SERIES = Object.freeze({
  "failure-reconstructed": { name: "FAILURE FILE", tagline: "A new engineering failure, reconstructed every day." },
  "impossible-brief": { name: "IMPOSSIBLE BRIEF", tagline: "One impossible scenario, worked through with real science, every day." },
  "critical-thread": { name: "CRITICAL THREAD", tagline: "One hidden system the modern world depends on, every day." },
  "behind-the-ordinary": { name: "HIDDEN LOGIC", tagline: "One familiar object, one documented reason hidden in plain sight." },
});

function publishedShorts(channel) {
  const legacy = channel.config && channel.config.pathMode === "legacy-adapter";
  const file = path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json");
  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(rows) ? rows : []).filter((row) => row && (row.format || "short") === "short" && row.videoId);
  } catch (error) { return []; }
}

function episodeNumber(channel, slug, rows = publishedShorts(channel)) {
  const index = rows.findIndex((row) => row.slug === slug);
  return index >= 0 ? index + 1 : rows.length + 1;
}

function forChannel(channelOrSlug) {
  const slug = typeof channelOrSlug === "string" ? channelOrSlug : channelOrSlug && channelOrSlug.slug;
  return SERIES[slug] || null;
}

// "FAILURE FILE #13", or null for a channel without a series.
function label(channel, slug, rows) {
  const series = forChannel(channel);
  return series ? `${series.name} #${episodeNumber(channel, slug, rows)}` : null;
}

// One description line: "Failure File · Episode 13 · A new engineering failure, reconstructed every day."
// No "#" here: YouTube would read "#13" as a hashtag and count it against the
// five real ones on the last line.
function descriptionLine(channel, slug, rows) {
  const series = forChannel(channel);
  if (!series) return null;
  const name = series.name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${name} · Episode ${episodeNumber(channel, slug, rows)} · ${series.tagline}`;
}

module.exports = { SERIES, publishedShorts, episodeNumber, forChannel, label, descriptionLine };
