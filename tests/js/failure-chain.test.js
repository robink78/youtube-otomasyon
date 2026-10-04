"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../../engineering-visuals");

test("the failure chain fits every normal Short: after the hook, before the closing question", () => {
  for (const vodur of [18, 21.2, 25, 31, 38]) {
    const p = E.kisaZincirPenceresi({ adimSayisi: 5, vodur });
    assert.ok(p, `${vodur}s`);
    assert.ok(p.a >= Math.min(2.7, vodur * 0.4) + 0.3 - 0.001, `${vodur}s starts after the hook`);
    assert.ok(p.b <= vodur - 2.9 + 0.001, `${vodur}s ends before the question`);
    assert.ok(p.b - p.a >= 2.4);
  }
  assert.equal(E.kisaZincirPenceresi({ adimSayisi: 5, vodur: 7 }), null, "too short: no chain rather than a cramped one");
  assert.equal(E.kisaZincirPenceresi({ adimSayisi: 2, vodur: 30 }), null, "a chain needs three steps");
});

test("steps reveal one after another and the full chain holds at the end", () => {
  const p = E.kisaZincirPenceresi({ adimSayisi: 5, vodur: 21.2, teknikBas: 8 });
  assert.equal(p.a, 8, "starts on the technical scene when there is one");
  assert.equal(p.asamalar.length, 5);
  p.asamalar.forEach((stage, index) => {
    assert.ok(stage.b > stage.a);
    if (index) assert.equal(stage.a, p.asamalar[index - 1].b, "contiguous stages");
  });
  assert.equal(p.asamalar[4].b, p.b);
  assert.ok(p.asamalar[4].b - p.asamalar[4].a >= 1, "the complete chain stays readable");
  assert.ok(p.asamalar[0].b - p.asamalar[0].a >= 0.35, "each step stays on screen long enough to read");
});

test("Failure Reconstructed renders the staged chain overlay", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../shorts-yap.js"), "utf8");
  assert.match(source, /kisaZincirPenceresi\(\{ adimSayisi:/);
  assert.match(source, /kisaZincirAsamalari\(konu, TMP\)/);
  assert.match(source, /ustKatman\.pngs\.flatMap\(\(png\) => \["-loop", "1"/);
  assert.match(source, /overlay=0:0:enable='between\(t,/);
  assert.doesNotMatch(source, /zamanlar\[i\]\.bas \+ 3 <= VODUR - 3/, "the old rule that found no window in short videos is gone");
});
