"use strict";

const ALLOWED_CONFIDENCE = new Set(["VERIFIED", "SUPPORTED", "ESTIMATED", "SPECULATIVE", "VERIFIED FACT", "ESTIMATE", "INDUSTRY CLAIM", "MODEL", "HYPOTHESIS"]);
const PRIMARY_HOSTS = [
  "nasa.gov", "jpl.nasa.gov", "esa.int", "noaa.gov", "usgs.gov", "cern", "nist.gov", "nih.gov", "osti.gov", "ipcc.ch",
  "energy.gov", "nerc.com", "itu.int", "fcc.gov", "transportation.gov", "itf-oecd.org", "imo.org", "unctad.org", "faa.gov", "icao.int",
  "epa.gov", "who.int", "usda.gov", "fao.org", "iea.org", "bis.org", "frbservices.org", "asml.com", "semi.org", "iso.org", "ieee.org",
];

function auditTopic(topic) {
  const errors = [];
  if (!topic.scientificMechanism && !topic.mechanism) errors.push("missing mechanism");
  if (!Array.isArray(topic.sources) || topic.sources.length < 2) errors.push("fewer than two sources");
  for (const source of topic.sources || []) {
    let host = "";
    try { host = new URL(source.url).hostname; } catch (error) { errors.push("invalid source URL"); }
    if (host && !PRIMARY_HOSTS.some((allowed) => host.includes(allowed))) errors.push("non-primary source: " + host);
  }
  const layers = new Set((topic.claimFramework || []).map((claim) => claim.layer));
  if (topic.channel === "critical-thread") {
    for (const layer of ["VERIFIED FACT", "ESTIMATE", "INDUSTRY CLAIM", "MODEL", "HYPOTHESIS"]) if (!layers.has(layer)) errors.push("missing claim layer: " + layer);
  } else if (!layers.has("KNOWN SCIENCE") || !layers.has("ESTIMATED CONSEQUENCE") || !layers.has("SPECULATIVE SCENARIO")) errors.push("claim layers are incomplete");
  if ((topic.claimFramework || []).some((claim) => !ALLOWED_CONFIDENCE.has(claim.confidence))) errors.push("invalid confidence label");
  return { pass: errors.length === 0, errors, sourceCount: (topic.sources || []).length, sourceQuality: topic.sourceQuality && topic.sourceQuality.score };
}

module.exports = { ALLOWED_CONFIDENCE, PRIMARY_HOSTS, auditTopic };
