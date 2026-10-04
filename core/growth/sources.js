"use strict";

// Source quality and claim classification (PHASE 23/24).
// Tiers are assigned from the source host and declared type. An unknown host
// is never promoted; a tertiary encyclopedia is usable for orientation but
// cannot be the only support for a central claim.

const TIERS = [
  { tier: "OFFICIAL_INVESTIGATION", score: 100, hosts: ["ntsb.gov", "bea.aero", "grenfelltowerinquiry.org.uk", "aaib.gov.uk", "maib.gov.uk", "raib.gov.uk", "tsb.gc.ca", "atsb.gov.au", "jtsb.mlit.go.jp", "onderzoeksraad.nl", "sust.admin.ch", "bfu-web.de", "nsia.no", "csb.gov", "nrc.gov", "osti.gov", "hq.nasa.gov/office/pao/History", "history.nasa.gov", "nssdc.gsfc.nasa.gov", "hse.gov.uk", "aaib.gov.uk", "bea.aero", "tsb.gc.ca", "marad.dot.gov", "uscg.mil", "iaea.org"] },
  { tier: "GOVERNMENT_AGENCY", score: 95, hosts: [".gov", ".mil", "nasa.gov", "esa.int", "noaa.gov", "usgs.gov", "nist.gov", "nih.gov", "energy.gov", "epa.gov", "faa.gov", "icao.int", "imo.org", "itu.int", "who.int", "fao.org", "iea.org", "unctad.org", "ipcc.ch", "europa.eu", "gov.uk", "bis.org", "itf-oecd.org", "oecd.org", "worldbank.org", "frbservices.org"] },
  { tier: "ACADEMIC", score: 92, hosts: ["ascelibrary.org", "icevirtuallibrary.com", "tandfonline.com", "semanticscholar.org", ".edu", "ac.uk", "doi.org", "arxiv.org", "nature.com", "science.org", "sciencedirect.com", "springer.com", "wiley.com", "ieee.org", "acs.org", "aip.org", "iop.org", "cern", "jstor.org", "pnas.org"] },
  { tier: "STANDARDS_BODY", score: 90, hosts: ["ice.org.uk", "istructe.org", "structuremag.org", "iso.org", "iec.ch", "ansi.org", "astm.org", "asme.org", "nerc.com", "etsi.org", "3gpp.org", "ietf.org", "w3.org", "gs1.org", "gs1us.org", "bluetooth.com", "unicode.org"] },
  { tier: "MANUFACTURER", score: 82, hosts: ["asml.com", "semi.org", "siemens", "abb.com", "ge.com", "boeing.com", "airbus.com", "intel.com", "tsmc.com", "maersk.com", "levistrauss.com", "levi.com", "otis.com", "qrcode.com", "denso-wave.com", "ykk.com"] },
  { tier: "INDUSTRY_ASSOCIATION", score: 80, hosts: ["damfailures.org", "damsafety.org", "skybrary.aero", "flightsafety.org", "semi.org", "iata.org", "worldshipping.org", "submarinecablemap.com", "telegeography.com", "gsma.com", "eia.gov"] },
  { tier: "MUSEUM_ARCHIVE", score: 80, hosts: ["trove.nla.gov.au", "chroniclingamerica.loc.gov", "tshaonline.org", "history.nasa.gov", "archive.org", "loc.gov", "si.edu", "nationalarchives", "britishmuseum", "commons.wikimedia.org", "okhistory.org", "nationalmotormuseum.org.uk", "mylearning.org", "sciencemuseum", "moma.org"] },
  { tier: "MAJOR_JOURNALISM", score: 72, hosts: ["abc.net.au", "cbc.ca", "smh.com.au", "latimes.com", "lemonde.fr", "spiegel.de", "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "nytimes.com", "washingtonpost.com", "theguardian.com", "ft.com", "economist.com", "wsj.com", "bloomberg.com"] },
  { tier: "ENCYCLOPEDIA", score: 55, hosts: ["wikipedia.org", "britannica.com", "thecanadianencyclopedia.ca"] },
];

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase() + new URL(url).pathname; } catch (error) { return ""; }
}

function tierFor(source) {
  const host = hostOf(source.url);
  const type = String(source.type || "").toLowerCase();
  if (!host) return { tier: "UNVERIFIABLE", score: 0 };
  for (const entry of TIERS) if (entry.hosts.some((pattern) => host.includes(pattern))) return { tier: entry.tier, score: entry.score };
  if (/government|agency|regulator/.test(type)) return { tier: "GOVERNMENT_AGENCY", score: 90 };
  if (/academic|journal|university/.test(type)) return { tier: "ACADEMIC", score: 88 };
  if (/standard/.test(type)) return { tier: "STANDARDS_BODY", score: 86 };
  if (/manufacturer/.test(type)) return { tier: "MANUFACTURER", score: 78 };
  if (/industry/.test(type)) return { tier: "INDUSTRY_ASSOCIATION", score: 76 };
  return { tier: "UNCLASSIFIED", score: 40 };
}

// SourceQualityScore: the strongest two sources carry most of the weight;
// coverage breadth adds a little; a source list made only of encyclopedias
// or unclassified hosts cannot score well.
function sourceQuality(sources) {
  const rated = (sources || []).map((source) => ({ ...source, ...tierFor(source) })).sort((a, b) => b.score - a.score);
  if (!rated.length) return { score: 0, tiers: [], primaryCount: 0, notes: ["no sources"] };
  const top = rated.slice(0, 2);
  const base = top.reduce((sum, item) => sum + item.score, 0) / top.length;
  const primaryCount = rated.filter((item) => item.score >= 80).length;
  const notes = [];
  let score = base * (rated.length >= 2 ? 1 : 0.75);
  if (primaryCount === 0) { score = Math.min(score, 58); notes.push("no primary/authoritative source"); }
  if (rated.length >= 3) score += 3;
  if (rated.every((item) => item.tier === "ENCYCLOPEDIA" || item.tier === "UNCLASSIFIED")) notes.push("only tertiary or unclassified sources");
  return { score: Math.round(Math.min(100, score)), tiers: rated.map((item) => ({ name: item.name, url: item.url, tier: item.tier, score: item.score })), primaryCount, notes };
}

// Map every channel's native confidence vocabulary onto the shared internal
// classes required by PHASE 23.
const CLAIM_CLASS = {
  "CONFIRMED FACT": "CONFIRMED_FACT", "VERIFIED FACT": "CONFIRMED_FACT", VERIFIED: "CONFIRMED_FACT", "KNOWN SCIENCE": "CONFIRMED_FACT",
  SUPPORTED: "ESTIMATE", ESTIMATE: "ESTIMATE", ESTIMATED: "ESTIMATE", "ESTIMATED CONSEQUENCE": "ESTIMATE", "INDUSTRY CLAIM": "INTERPRETATION",
  INTERPRETATION: "INTERPRETATION", MODEL: "MODEL", DISPUTED: "DISPUTED", HYPOTHESIS: "SPECULATION", SPECULATIVE: "SPECULATION",
  "SPECULATIVE SCENARIO": "SPECULATION", SPECULATION: "SPECULATION",
};

function classifyClaim(layerOrConfidence) {
  return CLAIM_CLASS[String(layerOrConfidence || "").toUpperCase()] || "UNCLASSIFIED";
}

// Numbers spoken in a script must exist somewhere in the topic's own evidence.
// This blocks invented death counts, dates, percentages and specs.
function numericSupport(text, topic) {
  const Model = require("./topic-model");
  const evidenceText = [
    topic.number, topic.trigger, topic.result, topic.consequence, topic.mechanism, topic.lesson, topic.misconception,
    topic.hookText, topic.openingLine, topic.secondBeat, topic.year, topic.title, ...(topic.editorialTitles || []),
    ...(topic.narration || []), ...(topic.chain || []), ...(topic.timeline || []).map((item) => `${item.t} ${item.event}`),
    ...(topic.evidence || []).map((item) => item.claim),
  ].join(" ").toLowerCase().replace(/,/g, "");
  const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000 };
  const digitsInEvidence = new Set((evidenceText.match(/\d+(?:\.\d+)?/g) || []));
  for (const [word, value] of Object.entries(WORD_NUMBERS)) if (new RegExp("\\b" + word + "\\b").test(evidenceText)) digitsInEvidence.add(String(value));
  const unsupported = [];
  for (const raw of Model.numbersIn(text)) {
    const digits = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (!digits) continue;
    if (!digitsInEvidence.has(digits[0])) unsupported.push(raw);
  }
  return { supported: unsupported.length === 0, unsupported };
}

const SUPERLATIVE = /\b(worst|deadliest|biggest|largest|first ever|only one|never before|most dangerous|every single|always|nobody|no one)\b/i;

function unsupportedSuperlatives(text, topic) {
  const evidence = [topic.title, topic.consequence, topic.result, topic.misconception, topic.hookText, ...(topic.narration || []), ...(topic.evidence || []).map((item) => item.claim), ...(topic.editorialTitles || [])].join(" ").toLowerCase();
  const found = String(text || "").match(new RegExp(SUPERLATIVE.source, "gi")) || [];
  return found.filter((word) => !evidence.includes(word.toLowerCase()));
}

module.exports = { TIERS, tierFor, sourceQuality, classifyClaim, numericSupport, unsupportedSuperlatives, CLAIM_CLASS };
