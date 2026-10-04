// Yayin oncesi gorsel denetim — gercek ffmpeg ile (ffmpeg yoksa atlanir; CI'da atlanir).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ffVar = (() => {
  const yol = process.env.FFMPEG_YOL || "ffmpeg";
  try { cp.execFileSync(yol, ["-version"], { stdio: "ignore", timeout: 45000 }); return true; } catch (e) { return false; }
})();

const ass = (fs_, metin) => `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\n` +
  `Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
  `Style: Pop,DejaVu Sans,90,&H00FFFFFF,&H00000000,&H64000000,1,1,7,3,2,60,60,470,1\n\n[Events]\n` +
  `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
  `Dialogue: 0,0:00:00.00,0:00:01.00,Pop,,0,0,0,,{\\an5\\pos(540,960)\\fs${fs_}}${metin}\n`;

test("metin tasmasi: tasan yaziyi yakalar, sigan yaziyi gecirir", { skip: !ffVar && "ffmpeg yok" }, () => {
  const D = require("../../lib/gorsel-denetim");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "den-"));
  const tasan = path.join(dir, "a.ass"), sigan = path.join(dir, "b.ass");
  fs.writeFileSync(tasan, ass(130, "WAS AEROELASTIC FLUTTER"));
  fs.writeFileSync(sigan, ass(D.sigdir("WAS AEROELASTIC FLUTTER", 90, 1080, 0.76), "WAS AEROELASTIC FLUTTER"));
  assert.ok(D.metinTasmasi(tasan, 1, 1080, 1920).length > 0, "tasma yakalanmali");
  assert.equal(D.metinTasmasi(sigan, 1, 1080, 1920).length, 0, "sigdirilmis yazi tasmamali");
  fs.rmSync(dir, { recursive: true, force: true });
});
