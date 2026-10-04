#!/usr/bin/env node
"use strict";

// VOICE SAMPLES — reads the same line in each free Microsoft Edge neural voice
// so a person can listen and choose a narrator per channel (the automation
// cannot judge how natural a voice sounds).
//
//   node scripts/voice-samples.js <output-dir>

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const LINE = "In 1971, an earthquake shook the Van Norman Dam. Its earth fill turned to liquid, and part of the crest slid into the reservoir. Eighty thousand people lived below it.";
const VOICES = [
  "en-US-GuyNeural", "en-US-ChristopherNeural", "en-US-EricNeural", "en-US-RogerNeural", "en-US-SteffanNeural",
  "en-US-AndrewNeural", "en-US-AndrewMultilingualNeural", "en-US-BrianNeural", "en-US-BrianMultilingualNeural",
  "en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-GB-RyanNeural", "en-GB-ThomasNeural", "en-AU-WilliamNeural",
];

const out = path.resolve(process.argv[2] || "voice-samples");
fs.mkdirSync(out, { recursive: true });
const text = path.join(out, "line.txt");
fs.writeFileSync(text, LINE + "\n");
const results = [];
for (const voice of VOICES) {
  const file = path.join(out, `${voice}.mp3`);
  const run = cp.spawnSync(process.execPath, [path.join(__dirname, "synthesize-voice.js"), text, file, voice, "+6%"], { encoding: "utf8", timeout: 90000 });
  const ok = run.status === 0 && fs.existsSync(file) && fs.statSync(file).size > 1000;
  results.push({ voice, ok });
  console.log(`${ok ? "✓" : "✗"} ${voice}`);
}
fs.writeFileSync(path.join(out, "voices.json"), JSON.stringify({ line: LINE, rate: "+6%", results }, null, 2) + "\n");
