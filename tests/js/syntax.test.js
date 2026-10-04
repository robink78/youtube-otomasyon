// Sozdizimi kontrolu (lint yerine): depodaki tum JS dosyalari `node --check` ile derlenir,
// tum JSON konfigurasyon/konu dosyalari parse edilir.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const KOK = path.resolve(__dirname, "..", "..");
const ATLA = new Set(["node_modules", "uretim", ".git", "video-indirici", "__pycache__"]);

function dosyalar(dir, uzanti, out = []) {
  for (const f of fs.readdirSync(dir)) {
    if (ATLA.has(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) dosyalar(p, uzanti, out);
    else if (uzanti.test(f)) out.push(p);
  }
  return out;
}

test("tum .js/.cjs dosyalari derlenir", () => {
  for (const f of dosyalar(KOK, /\.(c?js)$/)) {
    const r = cp.spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    assert.equal(r.status, 0, path.relative(KOK, f) + "\n" + r.stderr);
  }
});

test("config ve konu JSON dosyalari gecerli", () => {
  for (const d of ["config", "icerik/konular", "channels"]) {
    for (const f of dosyalar(path.join(KOK, d), /\.json$/)) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, "utf8")), f);
  }
  for (const f of dosyalar(path.join(KOK, "icerik/konular"), /\.json$/)) {
    const k = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.ok(k.vaka && k.vaka.kume && k.vaka.mekanizma, "vaka dosyasi eksik: " + path.basename(f));
    assert.ok(Array.isArray(k.vaka.kaynakca) && k.vaka.kaynakca.length, "kaynakca eksik: " + path.basename(f));
  }
});
