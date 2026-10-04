#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

async function main() {
  const [input, output, voice = "en-US-AndrewMultilingualNeural", rate = "+10%"] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: synthesize-voice.js <text-file> <output.mp3> [voice] [rate]");
  const text = fs.readFileSync(input, "utf8").trim();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: false, sentenceBoundaryEnabled: false });
  const { audioStream } = tts.toStream(text, { rate });
  const chunks = [];
  await new Promise((resolve, reject) => {
    audioStream.on("data", (chunk) => chunks.push(chunk));
    audioStream.on("end", resolve);
    audioStream.on("error", reject);
  });
  if (!chunks.length) throw new Error("Edge TTS returned no audio");
  fs.writeFileSync(output, Buffer.concat(chunks));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
