"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Kadraj = require("../../lib/dikey-kadraj");

test("photos fill the whole 9:16 frame: no blurred letterbox bands", () => {
  for (const [w, h] of [[1600, 1200], [3000, 1000], [800, 1400], [1080, 1080]]) {
    const filter = Kadraj.fotoFiltre({ w, h, j: 0, n: 60 });
    assert.doesNotMatch(filter, /boxblur|overlay/, `${w}x${h}`);
    assert.match(filter, /^\[0:v\]/);
    assert.match(filter, /\[v\]$/);
    assert.equal(Kadraj.kaplama({ w, h, foto: true }), 1);
  }
});

test("landscape photos pan across the image and alternate direction shot by shot", () => {
  const first = Kadraj.fotoFiltre({ w: 1600, h: 1200, j: 0, n: 61 });
  const second = Kadraj.fotoFiltre({ w: 1600, h: 1200, j: 1, n: 61 });
  assert.match(first, /crop=2160:3840:x='\(iw-ow\)\*\(0\.290\+0\.420\*n\/60\)'/);
  assert.match(second, /crop=2160:3840:x='\(iw-ow\)\*\(0\.710-0\.420\*n\/60\)'/);
  assert.match(first, /scale=1080:1920/);
  assert.doesNotMatch(first + second, /\d\.\d{6,}/, "no floating-point noise in filter expressions");
});

test("near-portrait photos get a slow push; square photos still pan", () => {
  assert.match(Kadraj.fotoFiltre({ w: 1000, h: 1000, j: 0, n: 45 }), /crop=2160:3840:x=/);
  const filter = Kadraj.fotoFiltre({ w: 800, h: 1200, j: 0, n: 45 });
  assert.match(filter, /force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='1\+0\.10\*on\/44'/);
});

test("archival tone adds contrast and sharpening to stills", () => {
  assert.match(Kadraj.fotoFiltre({ w: 1600, h: 1200 }), /eq=contrast=1\.12.*unsharp=/);
});

test("landscape video fills ~60% of the frame height; portrait video fills it all", () => {
  const landscape = Kadraj.videoTaban({ w: 1920, h: 1080 });
  assert.match(landscape, /scale=-2:1150,crop='min\(iw,1080\)':1150/);
  assert.ok(Kadraj.kaplama({ w: 1920, h: 1080 }) >= 0.59);
  const portrait = Kadraj.videoTaban({ w: 1080, h: 1920 });
  assert.doesNotMatch(portrait, /boxblur/);
  assert.equal(Kadraj.kaplama({ w: 1080, h: 1920 }), 1);
  // Open label contract: the caller appends either "[v]" or a camera move.
  assert.doesNotMatch(landscape, /\[v\]$/);
});

test("Failure Reconstructed render uses the full-bleed framing and shows the hook from the first frame", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../shorts-yap.js"), "utf8");
  assert.match(source, /Kadraj\.fotoFiltre\(/);
  assert.match(source, /Kadraj\.videoTaban\(/);
  assert.doesNotMatch(source, /\[0:v\]scale=1080:-2\[fg\]/, "old letterbox foreground is gone");
  assert.match(source, /Dialogue: 0,\$\{assTime\(0\)\},\$\{assTime\(hookSon\)\}/);
  assert.match(source, /\\\\fad\(0,220\)/);
});
