#!/usr/bin/env node
// Pre-check candidate cases BEFORE writing a full seed: is the Wikipedia
// article there, are there ≥ 3 licence-clean on-topic stills, and is an
// authoritative source cited? Only candidates that pass are worth writing.
//
// Usage: node scripts/fr-library/probe.js candidates.json
//   candidates.json: [{ "wiki": "Tay_Bridge_disaster", "kisa": "Tay Bridge", "yil": 1879 }, ...]
"use strict";
const fs = require("fs");
const B = require("./build");

(async () => {
  const list = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const out = [];
  for (const c of list) {
    const stills = await B.commonsStills([c.commons || c.kisa, c.kisa, c.wiki.replace(/_/g, " ").replace(/\(.*\)/, "")].flat(), 7, c.wiki,
      { keywords: [c.commons || c.kisa, c.kisa].flat(), year: c.yil, phrases: [c.kisa, c.wiki.replace(/_/g, " ").replace(/\s*\(.*\)/, "")] });
    const cited = await B.citedOfficialLinks(c.wiki);
    const row = { ...c, stills: stills.length, sources: cited.length, bestSource: cited[0] ? cited[0].body : null, ok: stills.length >= 3 && cited.length > 0 };
    out.push(row);
    console.log(`${row.ok ? "✓" : "✗"} ${c.wiki.padEnd(55)} stills ${stills.length}  sources ${cited.length}${row.bestSource ? " (" + row.bestSource + ")" : ""}`);
  }
  fs.writeFileSync(process.argv[2].replace(/\.json$/, ".probe.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n${out.filter((r) => r.ok).length}/${out.length} worth writing`);
})();
