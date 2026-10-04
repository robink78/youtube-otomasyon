#!/usr/bin/env node
// Resolve free-text case names to exact Wikipedia article titles (opensearch),
// skipping names already in the library or in earlier candidate lists.
// Usage: node scripts/fr-library/resolve.js names.txt out.json
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const get = (url) => new Promise((resolve) => https.get(url, { headers: { "User-Agent": "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)" } }, (res) => {
  const p = []; res.on("data", (d) => p.push(d)); res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(p).toString())); } catch (e) { resolve(null); } });
}).on("error", () => resolve(null)));
(async () => {
  const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const dir = path.join(__dirname, "..", "..", "icerik");
  for (const f of fs.readdirSync(path.join(dir, "kutuphane-tohum")).filter((f) => /^candidates-.*\.json$|^batch-\d+\.json$/.test(f))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, "kutuphane-tohum", f), "utf8"))) if (row.wiki) seen.add(row.wiki.toLowerCase());
  }
  const out = [];
  for (const line of lines) {
    const [name, kisa, yil] = line.split("|").map((s) => s && s.trim());
    const r = await get("https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=" + encodeURIComponent(name));
    const url = r && r[3] && r[3][0];
    if (!url) { console.log("✗ not found: " + name); continue; }
    const wiki = decodeURIComponent(url.split("/wiki/")[1]);
    if (seen.has(wiki.toLowerCase())) { console.log("= already seen: " + wiki); continue; }
    seen.add(wiki.toLowerCase());
    out.push({ wiki, kisa: kisa || name, yil: +yil || 0 });
    console.log("✓ " + name + " → " + wiki);
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1) + "\n");
})();
