"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const Scripting = require("../scripting");
const Visuals = require("../visuals");
const Quality = require("../quality");
const TopicVisuals = require("./topic-visuals");
const Hashtags = require("../hashtags");
const Series = require("../series");
const { ROOT } = require("../channel-context");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
}

function srtTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const ms = String(milliseconds % 1000).padStart(3, "0");
  const totalSeconds = Math.floor(milliseconds / 1000);
  const sec = String(totalSeconds % 60).padStart(2, "0");
  const min = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
  const hour = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  return `${hour}:${min}:${sec},${ms}`;
}

function captions(script) {
  const rows = [];
  for (const claim of script.claims) {
    const words = claim.text.split(/\s+/);
    const chunks = [];
    for (let index = 0; index < words.length; index += 4) chunks.push(words.slice(index, index + 4).join(" "));
    const duration = (claim.end - claim.start) / chunks.length;
    chunks.forEach((text, index) => rows.push({ start: claim.start + duration * index, end: claim.start + duration * (index + 1), text }));
  }
  return rows.map((row, index) => `${index + 1}\n${srtTime(row.start)} --> ${srtTime(row.end)}\n${row.text}\n`).join("\n");
}

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const cs = String(centiseconds % 100).padStart(2, "0");
  const total = Math.floor(centiseconds / 100);
  const sec = String(total % 60).padStart(2, "0");
  const min = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const hour = Math.floor(total / 3600);
  return `${hour}:${min}:${sec}.${cs}`;
}

function assCaptions(script) {
  const srtRows = captions(script).trim().split(/\n\n+/).map((block) => {
    const lines = block.split("\n");
    const [start, end] = lines[1].split(" --> ").map((value) => {
      const match = value.match(/(\d+):(\d+):(\d+),(\d+)/);
      return +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
    });
    return { start, end, text: lines.slice(2).join(" ").replace(/[{}]/g, "") };
  });
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,58,&H00FFFFFF,&H000000FF,&H00101824,&H90000000,-1,0,0,0,100,100,0,0,1,5,0,2,100,100,230,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + srtRows.map((row) => `Dialogue: 0,${assTime(row.start)},${assTime(row.end)},Caption,,0,0,0,,${row.text}`).join("\n") + "\n";
}

function commandExists(name) {
  return cp.spawnSync("sh", ["-lc", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

function probe(file) {
  const ffprobe = require("../../ff-yol").ffprobe;
  const output = cp.execFileSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const data = JSON.parse(output);
  const video = (data.streams || []).find((stream) => stream.codec_type === "video") || {};
  return { durationSeconds: +(data.format || {}).duration, width: video.width || null, height: video.height || null, hasAudio: (data.streams || []).some((stream) => stream.codec_type === "audio") };
}

// Natural documentary pace (~150-160 words per minute with Edge neural voices).
const DEFAULT_VOICE_RATE = "-6%";
// Breath between narration lines; part of each line's measured duration, so
// captions and cuts stay aligned. Kept short: on Shorts a gap reads as an
// exit point (8 lines x 0.28 s was over two seconds of silence).
const LINE_PAUSE_SECONDS = 0.18;
// Retiming is a last resort for a script slightly over the channel maximum;
// beyond this the voice audibly rushes, and the duration check decides instead.
const MAX_TEMPO = 1.08;

function synthesizeVoice(text, outputDirectory, basename = "narration", options = {}) {
  const ffmpeg = require("../../ff-yol").ffmpeg;
  const output = path.join(outputDirectory, basename + ".m4a");
  if (process.platform === "darwin" && process.env.TTS_PROVIDER !== "edge" && commandExists("say")) {
    const aiff = path.join(outputDirectory, basename + ".aiff");
    cp.execFileSync("say", ["-r", "170", "-o", aiff, text], { stdio: "ignore" });
    cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", aiff, "-c:a", "aac", "-b:a", "128k", output], { stdio: "ignore" });
    fs.unlinkSync(aiff);
    return { file: output, provider: "macOS say dry-run voice", syntheticVoice: true };
  }
  try {
    require.resolve("msedge-tts");
    const input = path.join(outputDirectory, basename + "-input.txt");
    const mp3 = path.join(outputDirectory, basename + ".mp3");
    fs.writeFileSync(input, text + "\n");
    cp.execFileSync(process.execPath, [path.join(__dirname, "..", "..", "scripts", "synthesize-voice.js"), input, mp3, options.voice || "en-US-AndrewMultilingualNeural", options.rate || DEFAULT_VOICE_RATE], { stdio: "ignore", timeout: 90000 });
    fs.unlinkSync(input);
    return { file: mp3, provider: "Microsoft Edge neural TTS", syntheticVoice: true };
  } catch (error) {}
  const estimatedDuration = Math.max(1, text.trim().split(/\s+/).length / 2.8);
  cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=180:sample_rate=44100:duration=${estimatedDuration}`, "-c:a", "aac", "-b:a", "96k", output], { stdio: "ignore" });
  return { file: output, provider: "non-speech CI fallback; production voice remains configured Edge TTS", syntheticVoice: false };
}

function atempoFilter(rate) {
  const factors = [];
  let remaining = rate;
  while (remaining > 2) { factors.push(2); remaining /= 2; }
  while (remaining < 0.5) { factors.push(0.5); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.001) factors.push(remaining);
  return (factors.length ? factors : [1]).map((factor) => `atempo=${factor.toFixed(6)}`).join(",");
}

function retimeAudio(file, currentDuration, targetDuration) {
  if (!(currentDuration > 0) || !(targetDuration > 0) || currentDuration <= targetDuration) return currentDuration;
  const ffmpeg = require("../../ff-yol").ffmpeg;
  const extension = path.extname(file);
  const temporary = file.slice(0, -extension.length) + ".retimed" + extension;
  const rate = currentDuration / targetDuration;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-filter:a", atempoFilter(rate), "-vn"];
  if (extension === ".m4a") args.push("-c:a", "aac", "-b:a", "128k");
  args.push(temporary);
  cp.execFileSync(ffmpeg, args, { stdio: "ignore", timeout: 120000 });
  fs.renameSync(temporary, file);
  return probe(file).durationSeconds;
}

function synthesizeNarration(script, outputDirectory, channel) {
  const ffmpeg = require("../../ff-yol").ffmpeg;
  const voiceConfig = channel.config.voice || {};
  // Every line, hook included, is read at the same unhurried rate. The hook's
  // brevity comes from the script, never from speeding the voice up.
  const takes = script.claims.map((claim, index) => {
    const voice = synthesizeVoice(claim.text, outputDirectory, `narration-claim-${index + 1}`, { voice: voiceConfig.voice, rate: voiceConfig.rate || DEFAULT_VOICE_RATE });
    const pause = index < script.claims.length - 1 ? LINE_PAUSE_SECONDS : 0;
    return { ...voice, pause, durationSeconds: probe(voice.file).durationSeconds + pause };
  });
  const output = path.join(outputDirectory, "narration.m4a");
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const take of takes) args.push("-i", take.file);
  const padded = takes.map((take, index) => `[${index}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${take.pause.toFixed(2)}[p${index}]`).join(";");
  const inputs = takes.map((_, index) => `[p${index}]`).join("");
  // Consistent loudness for mobile playback (YouTube normalises to about -14 LUFS).
  args.push("-filter_complex", `${padded};${inputs}concat=n=${takes.length}:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[a]`, "-map", "[a]", "-ar", "44100", "-c:a", "aac", "-b:a", "160k", output);
  try { cp.execFileSync(ffmpeg, args, { stdio: "ignore", timeout: 120000 }); }
  finally { for (const take of takes) try { fs.unlinkSync(take.file); } catch (error) {} }
  let claimDurations = takes.map((take) => take.durationSeconds);
  const durationRange = channel.config.publishingCadence.shorts.targetDurationSeconds || [18, 40];
  const beforeFinalRetime = probe(output).durationSeconds;
  const maximumDuration = Number(durationRange[1]) - 0.2;
  const target = Math.max(maximumDuration, beforeFinalRetime / MAX_TEMPO);
  const finalDuration = beforeFinalRetime > target ? retimeAudio(output, beforeFinalRetime, target) : beforeFinalRetime;
  const scale = finalDuration / (claimDurations.reduce((sum, value) => sum + value, 0) || finalDuration);
  claimDurations = claimDurations.map((duration) => duration * scale);
  return {
    file: output,
    provider: takes.every((take) => take.provider === takes[0].provider) ? takes[0].provider + " (claim-timed)" : "mixed claim-timed narration",
    syntheticVoice: takes.every((take) => take.syntheticVoice),
    rate: voiceConfig.rate || DEFAULT_VOICE_RATE,
    claimDurations,
  };
}

// Atmosphere bed: the same procedural, licence-free generator and ducking
// chain as Failure Reconstructed (lib/muzik.js, shorts-yap.js), with a mood
// chosen from the topic's category so every video does not play one bed.
const MUSIC_MOODS = {
  "impossible-brief": { SPACE: "spaceflight-disasters", "FUTURE TECHNOLOGY": "spaceflight-disasters", EARTH: "natural-hazards", OTHER: "natural-hazards",
    PHYSICS: "aviation-failures", HUMAN: "materials-failures", "EXTREME SCIENCE": "nuclear-accidents", default: "natural-hazards" },
  "critical-thread": { ENERGY: "industrial-disasters", "ELECTRICAL GRID": "industrial-disasters", "INDUSTRIAL CHEMICALS": "industrial-disasters",
    MANUFACTURING: "industrial-disasters", "CRITICAL MINERALS": "industrial-disasters", SHIPPING: "maritime-disasters", PORTS: "maritime-disasters",
    "SUBMARINE CABLES": "maritime-disasters", "GLOBAL CHOKEPOINTS": "maritime-disasters", AVIATION: "aviation-failures", SATELLITES: "aviation-failures",
    "GPS AND TIMING": "aviation-failures", default: "infrastructure-failures" },
  "behind-the-ordinary": { "EVERYDAY MYSTERIES": "everyday-curious", "HIDDEN ENGINEERING": "everyday-curious", "STRANGE ORIGINS": "everyday-warm",
    "DESIGN DECISIONS": "everyday-warm", "ORDINARY SYSTEMS": "everyday-curious", default: "everyday-curious" },
};

function musicMood(topic) {
  const moods = MUSIC_MOODS[topic.channel] || {};
  return moods[String(topic.category || "").toUpperCase()] || moods.default || "structural-failures";
}

function mixMusicBed(voiceFile, duration, topic, outputDirectory) {
  const ffmpeg = require("../../ff-yol").ffmpeg;
  const mood = musicMood(topic);
  const profile = require("../../lib/muzik").profil(topic.slug || topic.id, mood);
  const total = duration.toFixed(2);
  const bed = path.join(outputDirectory, ".music-bed.wav");
  const output = path.join(outputDirectory, "narration-music.m4a");
  try {
    cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `sine=frequency=${profile.kok}:duration=${total}`,
      "-f", "lavfi", "-i", `sine=frequency=${(profile.kok * profile.oran).toFixed(2)}:duration=${total}`,
      "-f", "lavfi", "-i", `anoisesrc=d=${total}:c=${profile.renk}:a=0.04`,
      "-filter_complex",
      `[0]volume=0.55,tremolo=f=${profile.trem}:d=0.5[a];[1]volume=0.26[b];[2]highpass=f=180,lowpass=f=1100,volume=0.6[c];`
      + `[a][b][c]amix=inputs=3:normalize=0,lowpass=f=${profile.alcak},aecho=0.8:0.9:${profile.yanki[0]}|${profile.yanki[1]}:0.28|0.2,`
      + `afade=t=in:st=0:d=1.6,afade=t=out:st=${Math.max(0, duration - 1.6).toFixed(2)}:d=1.6[m]`,
      "-map", "[m]", "-t", total, bed], { stdio: "ignore", timeout: 120000 });
    // Narration ducks the bed (sidechain); the final mix is brought to -14 LUFS.
    cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", voiceFile, "-i", bed, "-filter_complex",
      "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,asplit=2[vo1][vo2];[1:a]aresample=48000,volume=1.0[mus];"
      + "[mus][vo1]sidechaincompress=threshold=0.035:ratio=6:attack=6:release=340[duck];"
      + "[duck][vo2]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]",
      "-map", "[a]", "-t", duration.toFixed(3), "-ar", "48000", "-c:a", "aac", "-b:a", "160k", output], { stdio: "ignore", timeout: 120000 });
  } finally { try { fs.unlinkSync(bed); } catch (error) {} }
  const mixed = probe(output).durationSeconds;
  if (Math.abs(mixed - duration) > 0.3) throw new Error(`music mix length ${mixed.toFixed(2)} s != narration ${duration.toFixed(2)} s`);
  return { file: output, mood, profile };
}

function applyMeasuredTiming(script, claimDurations, totalDuration) {
  const measuredTotal = claimDurations.reduce((sum, value) => sum + value, 0) || totalDuration;
  let cursor = 0;
  script.claims = script.claims.map((claim, index) => {
    const start = cursor;
    cursor += claimDurations[index] * totalDuration / measuredTotal;
    return { ...claim, start, end: cursor };
  });
  script.targetSeconds = totalDuration;
  script.timing = "measured from per-claim narration takes";
  return script;
}

function scientificFrames(topic, directory, count = 8, startFrame = 0) {
  const width = 1080, height = 1920;
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const palette = { background: rgb("#030712"), grid: rgb("#07334a"), cyan: rgb("#25d9ff"), ice: rgb("#b9eaff"), blue: rgb("#176b9d"), warm: rgb("#ffb347"), red: rgb("#ff5d73"), gray: rgb("#b7c0cc"), green: rgb("#218c74") };
  const files = [];
  let seed = [...topic.id].reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381);
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  for (let sequence = 0; sequence < count; sequence += 1) {
    const frame = startFrame + sequence;
    const data = Buffer.alloc(width * height * 3);
    for (let offset = 0; offset < data.length; offset += 3) {
      data[offset] = palette.background[0]; data[offset + 1] = palette.background[1]; data[offset + 2] = palette.background[2];
    }
    const pixel = (x, y, color) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const offset = (y * width + x) * 3;
      data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2];
    };
    const block = (x, y, w, h, color) => {
      for (let py = Math.max(0, y); py < Math.min(height, y + h); py += 1) {
        for (let px = Math.max(0, x); px < Math.min(width, x + w); px += 1) pixel(px, py, color);
      }
    };
    const circle = (cx, cy, radius, color, outline = false, thickness = 5) => {
      const inner = Math.max(0, radius - thickness);
      for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
        const dy = y - cy;
        const dx = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
        const innerDx = Math.floor(Math.sqrt(Math.max(0, inner * inner - dy * dy)));
        if (!outline || Math.abs(dy) > inner) block(cx - dx, y, dx * 2 + 1, 1, color);
        else {
          block(cx - dx, y, Math.max(0, dx - innerDx), 1, color);
          block(cx + innerDx, y, Math.max(0, dx - innerDx + 1), 1, color);
        }
      }
    };
    const line = (x1, y1, x2, y2, color, thickness = 5) => {
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
      for (let step = 0; step <= steps; step += 1) {
        const x = Math.round(x1 + (x2 - x1) * step / steps);
        const y = Math.round(y1 + (y2 - y1) * step / steps);
        block(x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
      }
    };
    for (let x = 0; x < width; x += 120) block(x, 0, 2, height, palette.grid);
    for (let y = 0; y < height; y += 120) block(0, y, width, 2, palette.grid);
    for (let star = 0; star < 180; star += 1) circle(Math.floor(random() * width), 170 + Math.floor(random() * 1160), 1 + Math.floor(random() * 3), palette.ice);

    if (topic.channel === "critical-thread") {
      circle(540, 930, 330, palette.blue);
      circle(540, 930, 330, palette.cyan, true, 10);
      for (let node = 0; node < 10; node += 1) {
        const angle = (Math.PI * 2 * node / 10) + frame * 0.05;
        const x = 540 + Math.cos(angle) * 380;
        const y = 930 + Math.sin(angle) * 380;
        circle(x, y, 22, node % 3 === 0 ? palette.warm : palette.ice);
        line(540, 930, x, y, node % 3 === 0 ? palette.warm : palette.cyan, 4);
      }
      block(385, 705, 310, 450, palette.background);
      block(405, 735, 270, 390, palette.gray);
      block(435, 775, 210, 170, palette.background);
      for (let slot = 0; slot < 4; slot += 1) block(445 + slot * 48, 985, 30, 95, palette.gold || palette.warm);
      circle(540, 860, 74 + (frame % 12) * 2, palette.warm, true, 8);
    } else if (/moon/i.test(topic.topic)) {
      circle(540, 900, 315, palette.blue);
      circle(540, 900, 315, palette.cyan, true, 9);
      circle(430, 820, 92, palette.green);
      circle(655, 970, 68, palette.green);
      circle(540, 900, 365 + (frame % 12) * 5, palette.ice, true, 4);
      const moonFrame = frame % 8;
      const moonRadius = moonFrame < 3 ? 92 : Math.max(0, 92 - (moonFrame - 2) * 20);
      if (moonRadius > 4) {
        circle(810, 525, moonRadius, palette.gray);
        circle(810, 525, moonRadius, palette.ice, true, 6);
      }
      line(735, 610, 655, 710, frame >= 3 ? palette.red : palette.cyan, 7);
      line(655, 710, 676, 688, frame >= 3 ? palette.red : palette.cyan, 7);
      line(655, 710, 660, 680, frame >= 3 ? palette.red : palette.cyan, 7);
    } else if (/stopped spinning/i.test(topic.topic)) {
      circle(540, 900, 350, palette.blue);
      circle(540, 900, 350, palette.cyan, true, 10);
      circle(450, 805, 105, palette.green);
      circle(660, 1010, 82, palette.green);
      for (let band = -2; band <= 2; band += 1) line(205, 900 + band * 90, 875, 900 + band * 90, palette.ice, 3);
      const drift = (frame % 20) * 28;
      for (let particle = 0; particle < 11; particle += 1) {
        const x = 170 + ((particle * 95 + drift) % 760);
        circle(x, 510 + (particle % 3) * 55, 8, palette.warm);
      }
      line(220, 520, 860, 520, palette.warm, 10);
      line(860, 520, 825, 495, palette.warm, 10);
      line(860, 520, 825, 545, palette.warm, 10);
      line(540, 635, 540, 1165, frame >= 3 ? palette.red : palette.cyan, 8);
    } else if (/gravity doubled/i.test(topic.topic)) {
      block(0, 1190, width, 730, palette.blue);
      block(0, 1190, width, 9, palette.cyan);
      const fall = Math.min(620, (frame % 10) * 92);
      circle(300, 430 + fall, 64, palette.warm);
      circle(780, 320 + fall, 42, palette.ice);
      for (const x of [300, 540, 780]) {
        line(x, 420, x, 1040, palette.red, 12);
        line(x, 1040, x - 28, 995, palette.red, 12);
        line(x, 1040, x + 28, 995, palette.red, 12);
      }
      circle(540, 730, 55, palette.ice);
      line(540, 785, 540, 1000, palette.ice, 18);
      line(540, 840, 445, 935, palette.ice, 15);
      line(540, 840, 635, 935, palette.ice, 15);
      line(540, 1000, 475, 1130, palette.ice, 17);
      line(540, 1000, 605, 1130, palette.ice, 17);
    } else {
      circle(540, 850, 310, palette.blue);
      circle(540, 850, 310, palette.cyan, true, 10);
      circle(540, 850, 355 + (frame % 12) * 8, palette.ice, true, 5);
    }
    // The fallback remains procedural, but its composition is selected from
    // the current claim's scene description. This prevents unrelated claims
    // from receiving one repeated circle or hub-and-spoke drawing.
    const sceneList = Array.isArray(topic.visualScenes) ? topic.visualScenes : (topic.visualPotential || {}).scenes || [];
    const sceneValue = sceneList[frame % Math.max(1, sceneList.length)];
    const sceneText = typeof sceneValue === "string" ? sceneValue : sceneValue && sceneValue.text || `${topic.category} ${frame}`;
    const motifSeed = [...sceneText].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
    const motif = motifSeed % 4;
    if (motif === 0) {
      for (let bar = 0; bar < 5; bar += 1) {
        const barHeight = 100 + ((motifSeed >>> (bar * 3)) % 390);
        block(190 + bar * 150, 1320 - barHeight, 90, barHeight, bar % 2 ? palette.warm : palette.cyan);
      }
    } else if (motif === 1) {
      for (let arrow = 0; arrow < 4; arrow += 1) {
        const y = 520 + arrow * 230;
        line(180, y, 880, y + ((motifSeed >>> arrow) % 3 - 1) * 85, arrow % 2 ? palette.ice : palette.warm, 12);
        line(880, y + ((motifSeed >>> arrow) % 3 - 1) * 85, 830, y - 35, arrow % 2 ? palette.ice : palette.warm, 12);
      }
    } else if (motif === 2) {
      const nodes = 5 + motifSeed % 4;
      for (let node = 0; node < nodes; node += 1) {
        const angle = Math.PI * 2 * node / nodes + frame * 0.19;
        const x = 540 + Math.cos(angle) * (220 + (motifSeed % 130));
        const y = 870 + Math.sin(angle) * (350 + (motifSeed % 90));
        line(540, 870, x, y, palette.cyan, 5);
        circle(x, y, 20 + node % 3 * 7, node % 2 ? palette.warm : palette.ice);
      }
    } else {
      let previous = null;
      for (let point = 0; point <= 18; point += 1) {
        const x = 100 + point * 49;
        const y = 900 + Math.sin(point * 0.72 + motifSeed % 11) * (120 + motifSeed % 160);
        if (previous) line(previous.x, previous.y, x, y, palette.warm, 10);
        previous = { x, y };
      }
    }
    const file = path.join(directory, `.science-frame-${startFrame}-${sequence}.ppm`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), data]));
    files.push(file);
  }
  return files;
}

// drawtext text inside a single-quoted filter value: an apostrophe would end
// the quote and a backslash starts an escape, so both are replaced; colons,
// commas and "%" are literal once quoted and expansion is off.
function drawtextSafe(text) {
  return String(text).replace(/'/g, "’").replace(/\\/g, "");
}

function numberCardFontSize(text) {
  // DejaVu Sans is proportional, so character count alone lets wide labels
  // such as "30 MINUTES" escape the 870 px card even when a longer label made
  // only of narrow glyphs fits. Estimate glyph widths in em units and reserve
  // generous horizontal padding for the drawtext border.
  const widthEm = [...String(text)].reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.32;
    if (/[MW@%]/.test(character)) return total + 0.92;
    if (/[I1l|.,:;]/.test(character)) return total + 0.35;
    if (/[A-Z0-9]/.test(character)) return total + 0.67;
    return total + 0.58;
  }, 0);
  return Math.max(28, Math.min(146, Math.floor(750 / Math.max(1, widthEm))));
}

function channelAccent(topic) {
  return topic && topic.channel === "critical-thread" ? "0xffb347" : topic && topic.channel === "behind-the-ordinary" ? "0x45adf2" : "0x25d9ff";
}

// A sourced number over a blurred, darkened photograph from the same topic (or
// a dark grid when the topic has no photograph), with its meaning underneath.
// No box and no internal labels: the value and its context are the visual.
function cardHeadline(shot) {
  const headline = drawtextSafe(shot.numbers.slice(0, 2).join("  vs  ").toUpperCase());
  return { headline, fontSize: Math.min(190, Math.floor(numberCardFontSize(headline) * 1.25)), y: 600 };
}

// Count-up: a single whole number with an optional unit ("39", "14,800 TONNES",
// "45%") climbs from 0 to its value in under a second, then the card shows the
// exact sourced text. Years, ranges, comparisons, decimals and values under 10
// stay static: counting those up would read oddly or misstate the value.
const COUNT_UP_SECONDS = 0.9;
function countUp(shot) {
  if (!shot || !Array.isArray(shot.numbers) || shot.numbers.length !== 1 || (shot.comparison && shot.comparison.length)) return null;
  const match = String(shot.numbers[0]).match(/^(\d{1,3}(?:,\d{3})+|\d+)(\s*%|\s+[A-Za-z][A-Za-z\s-]*)?$/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  const suffix = (match[2] || "").toUpperCase();
  if (!Number.isFinite(value) || value < 10 || value > 10000000) return null;
  if (!suffix && value >= 1000 && value <= 2100) return null;
  const seconds = Math.min(COUNT_UP_SECONDS, Math.max(0.5, (shot.duration || 1.5) * 0.6));
  return { value, suffix: drawtextSafe(suffix), seconds };
}

function renderNumberCard(output, shot, topic, options = {}) {
  const ffmpeg = require("../../ff-yol").ffmpeg;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const accent = channelAccent(topic);
  const { headline, fontSize } = cardHeadline(shot);
  const caption = drawtextSafe(String(shot.caption || "").toUpperCase());
  const barY = 600 + fontSize + 46;
  const backdrop = shot.backdrop && shot.backdrop.path && fs.existsSync(shot.backdrop.path) ? shot.backdrop.path : null;
  const filters = backdrop
    ? ["scale=1080:1920:force_original_aspect_ratio=increase", "crop=1080:1920", "gblur=sigma=28", "eq=brightness=-0.30:saturation=0.70"]
    : ["drawgrid=width=120:height=120:thickness=2:color=0x0d2a3d@0.55"];
  // An animated card draws its number in the shot itself (countUp), not here.
  if (!options.omitHeadline) filters.push(`drawtext=expansion=none:text='${headline}':fontcolor=white:fontsize=${fontSize}:borderw=6:bordercolor=0x000000@0.55:x=(w-text_w)/2:y=600`);
  filters.push(`drawbox=x=420:y=${barY}:w=240:h=10:color=${accent}@0.95:t=fill`);
  if (caption) filters.push(`drawtext=expansion=none:text='${caption}':fontcolor=${accent}:fontsize=${Math.max(40, Math.min(66, Math.floor(1650 / Math.max(1, caption.length))))}:borderw=4:bordercolor=0x000000@0.55:x=(w-text_w)/2:y=${barY + 52}`);
  if (shot.comparison && shot.comparison.length >= 2) {
    const values = shot.comparison.map((value) => Number((value.replace(/,/g, "").match(/\d+(?:\.\d+)?/) || [1])[0]));
    const maximum = Math.max(...values, 1);
    const widths = values.map((value) => Math.max(80, Math.round(620 * value / maximum)));
    filters.push(`drawbox=x=230:y=${barY + 70}:w=${widths[0]}:h=34:color=0xffb347@0.95:t=fill`);
    filters.push(`drawbox=x=230:y=${barY + 130}:w=${widths[1]}:h=34:color=0x25d9ff@0.95:t=fill`);
  }
  const input = backdrop ? ["-i", backdrop] : ["-f", "lavfi", "-i", "color=c=0x060b16:s=1080x1920:d=0.1"];
  cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...input, "-vf", filters.join(","), "-frames:v", "1", "-update", "1", "-q:v", "2", output], { stdio: "ignore", timeout: 30000 });
  return output;
}

const FPS = 30;

// On-screen words above the caption band: the hook's thumbnail words from the
// very first frame for 2 s, unless the first shot is already a number card
// (which is the hook). There is no end card: a dimmed "comment below" screen
// stopped the loop, so the last shot returns to the opening picture instead
// (TopicVisuals.buildVisualPlan) and the question lives in the pinned comment.
const HOOK_SECONDS = 2;
// Font size that keeps capitals inside a 960 px line (DejaVu Sans capitals are
// up to ~0.72 em wide).
function fitFontSize(text, maximum) {
  return Math.max(36, Math.min(maximum, Math.floor(960 / (Math.max(1, String(text).length) * 0.72))));
}

function overlayText(topic, duration, opening, firstShotType = null, seriesLabel = null) {
  const parts = [];
  const on = `enable='lt(t,${HOOK_SECONDS})'`;
  // Series tag ("CRITICAL THREAD #3") sits above the hook in the channel accent:
  // a numbered, recurring format is a reason to subscribe.
  if (seriesLabel) parts.push(`drawtext=expansion=none:text='${drawtextSafe(seriesLabel)}':fontcolor=${channelAccent(topic)}:fontsize=44:borderw=4:bordercolor=0x000000@0.75:x=(w-text_w)/2:y=262:${on}`);
  const showHook = opening === "motion" || (firstShotType && firstShotType !== "number-card");
  const hook = showHook ? drawtextSafe(String(topic.thumbnailText || "").toUpperCase()) : "";
  if (hook) parts.push(`drawtext=expansion=none:text='${hook}':fontcolor=white:fontsize=${fitFontSize(hook, 112)}:borderw=8:bordercolor=0x000000@0.75:x=(w-text_w)/2:y=330:${on}`);
  return parts.length ? "," + parts.join(",") : "";
}

// One consistent look per channel on photographs (figures and cards keep their
// exact colours so values stay readable). A topic "colorGrade": ""
// switches it off.
const COLOUR_GRADES = {
  "impossible-brief": "eq=contrast=1.06:saturation=1.10:gamma=0.98,colorbalance=bs=0.05:bm=0.02:rh=0.03,vignette=angle=PI/5,noise=alls=3:allf=t",
  "critical-thread": "eq=contrast=1.08:saturation=0.90:gamma=0.97,colorbalance=rs=-0.02:bs=0.04:rh=0.05:gh=0.02,vignette=angle=PI/5,noise=alls=3:allf=t",
  "behind-the-ordinary": "eq=contrast=1.06:saturation=0.96:gamma=1.02,colorbalance=rs=0.035:gs=0.015:bh=-0.025,vignette=angle=PI/5,noise=alls=2:allf=t",
};
function colourGrade(topic) {
  const grade = topic.colorGrade != null ? topic.colorGrade : COLOUR_GRADES[topic.channel] || "";
  return grade ? "," + grade : "";
}

// A figure shown again is a closer look at one part of it (paper figures are
// usually panels side by side or stacked), not the same whole figure.
function diagramCrop(shot) {
  const variant = shot.motion || 0;
  if (!variant) return "";
  const wide = !(shot.still && shot.still.height > (shot.still.width || 0));
  const crops = wide
    ? ["crop=iw/2:ih:0:0", "crop=iw/2:ih:iw/2:0", "crop=iw*0.6:ih*0.6:iw*0.2:ih*0.2"]
    : ["crop=iw:ih/2:0:0", "crop=iw:ih/2:0:ih/2", "crop=iw*0.6:ih*0.6:iw*0.2:ih*0.2"];
  return crops[(variant - 1) % crops.length] + ",";
}

// Distinct slow camera moves, so a photograph shown twice is a different shot.
function cameraMove(variant, frames) {
  const t = `on/${Math.max(1, frames)}`;
  const center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  const moves = [
    `z='1+0.10*${t}':${center}`,
    `z='1.16':x='(iw-iw/zoom)*${t}':y='ih/2-(ih/zoom/2)'`,
    `z='1.12-0.10*${t}':${center}`,
    `z='1.16':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*${t}'`,
    `z='1.16':x='(iw-iw/zoom)*(1-${t})':y='ih/2-(ih/zoom/2)'`,
  ];
  return moves[variant % moves.length];
}

// The climbing number (t is the shot's own clock after zoompan), then the
// exact sourced headline. floor(V*t/T) never exceeds V while t < T.
function countUpFilter(shot) {
  const { headline, fontSize, y } = cardHeadline(shot);
  const { value, suffix, seconds } = shot.countUp;
  const style = `fontcolor=white:fontsize=${fontSize}:borderw=6:bordercolor=0x000000@0.55:x=(w-text_w)/2:y=${y}`;
  return `,drawtext=expansion=normal:text='%{eif\\:floor(${value}*t/${seconds})\\:d}${suffix}':${style}:enable='lt(t,${seconds})'`
    + `,drawtext=expansion=none:text='${headline}':${style}:enable='gte(t,${seconds})'`;
}

function renderVideo(audioFile, duration, output, captionsFile, topic, options = {}) {
  const ff = require("../../ff-yol");
  const ffmpeg = ff.ffmpeg;
  const opening = TopicVisuals.openingVariant(topic);
  const plan = TopicVisuals.buildVisualPlan(topic, options.script, options.assets && options.assets.stills || [], options.segments || [], duration, options.assets && options.assets.clips || [], { opening });
  const generated = [];
  const cardDirectory = path.join(path.dirname(output), "visual-cache");
  const inputs = [];
  for (const shot of plan) {
    if (shot.type === "stock-video") {
      // The middle of the clip, just long enough for the shot.
      const offset = Math.max(0, ((shot.clip.duration || shot.duration) - shot.duration) / 2);
      inputs.push({ pre: ["-ss", offset.toFixed(2), "-t", (shot.duration + 0.3).toFixed(2)], file: shot.clip.path });
    } else if (shot.type === "licensed-still") inputs.push(shot.still.path);
    else if (shot.type === "number-card") {
      shot.countUp = countUp(shot);
      const file = path.join(cardDirectory, (shot.sourceId + (shot.backdrop ? "-" + shot.backdrop.cachedFile : "") + (shot.countUp ? "-count" : "")).replace(/[^a-z0-9-]/gi, "-") + ".jpg");
      if (!fs.existsSync(file)) renderNumberCard(file, shot, topic, { omitHeadline: !!shot.countUp });
      inputs.push(file);
    } else {
      const file = scientificFrames({ ...topic, visualScenes: [shot.scene] }, path.dirname(output), 1, shot.proceduralFrame)[0];
      generated.push(file);
      inputs.push(file);
    }
  }
  if (!inputs.length) throw new Error("No visual shots could be built");
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  // Each input is one decoded still. zoompan creates the exact segment frame
  // count; looping here would multiply those frames again and make a 30-second
  // Short take minutes to render.
  inputs.forEach((input) => typeof input === "string" ? args.push("-i", input) : args.push(...input.pre, "-i", input.file));
  args.push("-i", audioFile);
  const filters = [];
  for (let index = 0; index < plan.length; index += 1) {
    const shot = plan[index];
    const frames = Math.max(1, Math.ceil(shot.duration * FPS));
    let chain;
    if (shot.type === "stock-video" && shot.clip.landscape) {
      // Landscape NASA visualization: full width above the caption band, over
      // its own blur, with its scientific colours untouched.
      chain = `[${index}:v]fps=${FPS},split=2[vbg${index}][vfg${index}];`
        + `[vbg${index}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30,eq=brightness=-0.25:saturation=0.8[vbgb${index}];`
        + `[vfg${index}]scale=1080:-2[vfgs${index}];`
        + `[vbgb${index}][vfgs${index}]overlay=0:(H-h)/2-170`;
    } else if (shot.type === "stock-video") {
      chain = `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS}${colourGrade(topic)}`;
    } else if (shot.type === "licensed-still" && shot.kind === "diagram") {
      // Whole figure, readable, above the caption band, over its own blur.
      chain = `[${index}:v]split=2[bg${index}][fg${index}];`
        + `[bg${index}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30,eq=brightness=-0.30:saturation=0.65[bgb${index}];`
        + `[fg${index}]${diagramCrop(shot)}scale=1000:1000:force_original_aspect_ratio=decrease[fgs${index}];`
        + `[bgb${index}][fgs${index}]overlay=(W-w)/2:210+(1000-h)/2,zoompan=z='1+0.0004*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${FPS}`;
    } else if (shot.type === "licensed-still") {
      chain = `[${index}:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=${cameraMove(shot.motion || 0, frames)}:d=${frames}:s=1080x1920:fps=${FPS}${colourGrade(topic)}`;
    } else if (shot.type === "number-card") {
      chain = `[${index}:v]scale=1080:1920,zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${FPS}`;
      if (shot.countUp) chain += countUpFilter(shot);
    } else {
      chain = `[${index}:v]scale=1080:1920,zoompan=z='min(zoom+0.0004,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${FPS}`;
    }
    // Disclosure stays, as a small corner tag: stills are context for the
    // topic, not footage of the scenario; procedural frames are illustrations.
    const tag = shot.type === "licensed-still" ? "CONTEXT IMAGE" : shot.type === "stock-video" ? (shot.clip.origin === "nasa-video" ? "NASA VISUALIZATION" : "STOCK FOOTAGE") : shot.type === "procedural" ? "ILLUSTRATION" : null;
    if (tag) chain += `,drawtext=expansion=none:text='${tag}':fontcolor=white@0.78:fontsize=26:box=1:boxcolor=0x000000@0.45:boxborderw=10:x=48:y=84`;
    filters.push(`${chain},setsar=1,trim=duration=${shot.duration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
  }
  const concatInputs = plan.map((_, index) => `[v${index}]`).join("");
  const escapedCaptions = captionsFile.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  filters.push(`${concatInputs}concat=n=${plan.length}:v=1:a=0,ass=filename='${escapedCaptions}'${overlayText(topic, duration, opening, plan[0] && plan[0].type, options.seriesLabel || null)}[v]`);
  const filterFile = path.join(path.dirname(output), ".visual-filter.txt");
  fs.writeFileSync(filterFile, filters.join(";\n") + "\n");
  args.push(ff.filtreBayragi, filterFile, "-map", "[v]", "-map", `${plan.length}:a`, "-t", String(duration), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output);
  try { cp.execFileSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 600000 }); }
  catch (error) {
    const detail = String(error.stderr || "").trim().slice(-4000);
    throw new Error(`ffmpeg topic-visual render failed${detail ? `:\n${detail}` : ""}`);
  }
  finally {
    for (const frame of generated) try { fs.unlinkSync(frame); } catch (error) {}
    try { fs.unlinkSync(filterFile); } catch (error) {}
  }
  const metrics = TopicVisuals.visualMetrics(plan, topic);
  return { ...metrics, opening, visualQuality: TopicVisuals.evaluateVisualQuality(metrics), segmentSeconds: plan.map((shot) => shot.duration), sources: plan.map(({ shot, claimIndex, type, sourceId, numbers }) => ({ shot, claimIndex, type, sourceId, numbers })) };
}

function renderThumbnail(output, topic, assets = { stills: [] }, script = null) {
  const ffmpeg = require("../../ff-yol").ffmpeg;
  const text = topic.thumbnailText || (/moon/i.test(topic.topic) ? "NO MOON" : /stopped spinning/i.test(topic.topic) ? "EARTH STOPS" : /gravity doubled/i.test(topic.topic) ? "2x GRAVITY" : topic.category);
  let source;
  let sourceType;
  let sourceId;
  let generated = null;
  if (assets.stills && assets.stills.length) {
    // A photograph reads at thumbnail size; a paper figure does not.
    const still = assets.stills.find((item) => TopicVisuals.stillKind(item) === "photo") || assets.stills[0];
    source = still.path;
    sourceType = "licensed-still";
    sourceId = `still:${still.file}`;
  } else {
    const claim = script && script.claims && script.claims.find((item) => TopicVisuals.numberTokens(item.text).length);
    if (claim) {
      const shot = { numbers: TopicVisuals.numberTokens(claim.text), comparison: TopicVisuals.numberTokens(claim.text).slice(0, 2) };
      source = path.join(path.dirname(output), "visual-cache", "thumbnail-number-card.jpg");
      renderNumberCard(source, shot, topic);
      sourceType = "number-card";
      sourceId = `thumbnail-card:${shot.numbers.join("|")}`;
    } else {
      generated = scientificFrames(topic, path.dirname(output), 1, 0)[0];
      source = generated;
      sourceType = "procedural";
      sourceId = `procedural-thumbnail:${topic.id}`;
    }
  }
  const filter = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=contrast=1.10:saturation=1.08,drawbox=x=0:y=500:w=1280:h=220:color=0x030712@0.72:t=fill,drawtext=expansion=none:text='${drawtextSafe(text)}':fontcolor=white:fontsize=108:borderw=7:bordercolor=0x030712:x=(w-text_w)/2:y=535`;
  try { cp.execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-vf", filter, "-frames:v", "1", "-update", "1", output], { stdio: "ignore" }); }
  finally { if (generated) try { fs.unlinkSync(generated); } catch (error) {} }
  return { sourceType, sourceId, textWords: text.split(/\s+/).length, usesLicensedStill: sourceType === "licensed-still" };
}

function buildPackage(topic, channel, outputDirectory, options = {}) {
  // options.growthPlan (core/growth planShort) replaces the templated script,
  // titles, captions and pacing. Without it the legacy package is unchanged.
  const growth = options.growthPlan || null;
  const growthConfig = growth ? require("../growth/config").forChannel(channel) : null;
  const Pacing = growth ? require("../growth/pacing") : null;
  const growthLines = growth && (growth.script.claims || (growth.script.lines || []).map((text, index, lines) => {
    const target = Number(growth.script.estimatedSeconds || 30);
    return { text, start: index * target / lines.length, end: (index + 1) * target / lines.length, role: growth.script.structure && growth.script.structure[index] || `BEAT_${index + 1}` };
  }));
  const script = growth ? JSON.parse(JSON.stringify({ format: "short", targetSeconds: growth.script.targetSeconds || growth.script.estimatedSeconds,
    spoken: growth.script.spoken || (growth.script.lines || []).join(" "), claims: growthLines.map(({ role, ...claim }) => ({ ...claim, role })),
    forbiddenOpening: growth.script.forbiddenOpening || false, sourceIds: growth.script.sourceIds || (topic.sources || []).map((source) => source.name) })) : Scripting.shortScript(topic);
  const titles = growth ? growth.titles.candidates.filter((item) => !item.misleading).map((item) => item.title) : Scripting.titleCandidates(topic);
  const captionSrt = (value) => growth ? Pacing.srt(value.claims, growthConfig.captions) : captions(value);
  const captionAss = (value) => growth ? Pacing.ass(value.claims, growthConfig.captions) : assCaptions(value);
  let visuals = Visuals.plan(topic, script);
  const thumbnail = Visuals.thumbnail(topic);
  const isCriticalThread = channel.slug === "critical-thread";
  const isBehindOrdinary = channel.slug === "behind-the-ordinary";
  // Hashtags stay on the description's last line; visual credits added after
  // render are inserted above them (see describe()).
  const hashtags = Hashtags.forTopic(channel.slug, topic, { format: "short" });
  const subject = Hashtags.subjectPhrase(topic);
  const disclosure = isCriticalThread
    ? "Technical illustrations and dependency models are labelled. Estimates and industry claims are attributed; modeled consequences are not presented as observed fact."
    : isBehindOrdinary
      ? "Historical and engineering claims are mapped to the sources above. Illustrations and reconstructions are labelled."
      : "Illustrative visuals are labelled. Speculative outcomes are not presented as measured fact.";
  const descriptionBody = `${topic.coreQuestion}\n\nSources:\n${topic.sources.map((source) => `- ${source.name}: ${source.url}`).join("\n")}\n\n${disclosure}`;
  const seriesLine = Series.descriptionLine(channel, topic.slug);
  const describe = (credits = []) => [descriptionBody, seriesLine, credits.length ? `Visual credits:\n${credits.join("\n")}` : null, hashtags.join(" ")]
    .filter(Boolean).join("\n\n");
  const baseTags = isCriticalThread ? ["infrastructure", "engineering", "supply chain", topic.category.toLowerCase(), "CriticalThread"]
    : isBehindOrdinary ? ["design", "how things work", "everyday objects", topic.category.toLowerCase(), "The Hidden Logic of Things"]
      : ["science", "what if", topic.category.toLowerCase(), "ImpossibleBrief"];
  const metadata = {
    uploadChannel: channel.slug,
    expectedYouTubeChannelId: channel.expectedChannelId() || "MANUAL_CONFIGURATION_REQUIRED",
    uploadEnabled: false,
    privacy: "private",
    categoryId: isCriticalThread || isBehindOrdinary ? "27" : "28",
    title: titles[0],
    description: describe(),
    hashtags,
    tags: subject ? [subject, ...baseTags.filter((tag) => tag.toLowerCase() !== subject.toLowerCase())] : baseTags,
  };
  const pkg = { channel: channel.slug, topic, script, titles, visuals, thumbnail, sources: topic.sources, metadata };
  pkg.qualityGate = Quality.evaluatePackage(pkg);
  write(path.join(outputDirectory, "topic.json"), topic);
  write(path.join(outputDirectory, "script.json"), script);
  write(path.join(outputDirectory, "script.txt"), script.spoken + "\n");
  const titleScores = growth ? growth.titles.candidates.map((item) => ({ title: item.title, pattern: item.pattern, total: item.adjustedTotal, scores: item.scores, misleading: item.misleading })) : titles.map((title, index) => ({ title, scores: {
    clarity: Math.max(75, 96 - index % 11), curiosity: 80 + index % 16, specificity: /system|bottleneck|replace|depends/i.test(title) ? 94 : 84,
    truthfulness: 96, searchIntent: 76 + index % 15, ctrPotential: 78 + index % 17, channelIdentity: isCriticalThread ? 92 : 88,
  } }));
  write(path.join(outputDirectory, "titles.json"), { count: titles.length, selected: titles[0], candidates: titles, scoredCandidates: titleScores });
  write(path.join(outputDirectory, "visuals.json"), visuals);
  write(path.join(outputDirectory, "thumbnail.json"), thumbnail);
  write(path.join(outputDirectory, "sources.json"), topic.sources);
  write(path.join(outputDirectory, "captions.srt"), captionSrt(script));
  write(path.join(outputDirectory, "captions.ass"), captionAss(script));
  write(path.join(outputDirectory, "description.txt"), metadata.description + "\n");
  if (growth) {
    write(path.join(outputDirectory, "growth-plan.json"), growth);
    write(path.join(outputDirectory, "hooks.json"), growth.hooks);
    write(path.join(outputDirectory, "first-3-seconds.json"), growth.first3Seconds);
  }
  write(path.join(outputDirectory, "metadata.json"), metadata);
  write(path.join(outputDirectory, "quality-gate.json"), pkg.qualityGate);
  if (isCriticalThread || isBehindOrdinary) {
    write(path.join(outputDirectory, "long-form-outline.json"), Scripting.longFormOutline(topic));
    write(path.join(outputDirectory, "short-factory.json"), Scripting.longToShortFactory(topic));
  }
  const render = { requested: !!options.render, completed: false, audio: null, video: null, thumbnail: null };
  if (options.render) {
    const assets = TopicVisuals.prepareAssetsSync(path.join(outputDirectory, "topic.json"), outputDirectory);
    const attribution = TopicVisuals.attributionLines(assets.stills, assets.clips);
    if (attribution.length) {
      metadata.description = describe(attribution);
      write(path.join(outputDirectory, "metadata.json"), metadata);
      write(path.join(outputDirectory, "description.txt"), metadata.description + "\n");
    }
    write(path.join(outputDirectory, "visual-attribution.json"), { count: assets.stills.length, stills: assets.stills.map(({ path: localPath, ...still }) => still), clips: (assets.clips || []).map(({ path: localPath, ...clip }) => clip), error: assets.error || null });
    const voice = synthesizeNarration(script, outputDirectory, channel);
    const audioProbe = probe(voice.file);
    const duration = audioProbe.durationSeconds;
    applyMeasuredTiming(script, voice.claimDurations, duration);
    visuals = Visuals.plan(topic, script);
    pkg.visuals = visuals;
    write(path.join(outputDirectory, "script.json"), script);
    write(path.join(outputDirectory, "visuals.json"), visuals);
    write(path.join(outputDirectory, "captions.srt"), captionSrt(script));
    write(path.join(outputDirectory, "captions.ass"), captionAss(script));
    const video = path.join(outputDirectory, topic.slug + ".mp4");
    const minimumSegments = Math.ceil(duration / 3.5);
    const image = path.join(outputDirectory, "thumbnail.jpg");
    // ImpossibleBrief records do not carry their channel; the look, the music
    // mood and the card accent are chosen per channel.
    const renderTopic = topic.channel ? topic : { ...topic, channel: channel.slug };
    const music = channel.config.music && channel.config.music.enabled === false || process.env.MUSIC === "0" ? null : mixMusicBed(voice.file, duration, renderTopic, outputDirectory);
    const visualRender = renderVideo(music ? music.file : voice.file, duration, video, path.join(outputDirectory, "captions.ass"), renderTopic,
      { script, assets, segments: growth ? Pacing.segments(duration, growthConfig, { minimumSegments }) : [], seriesLabel: Series.label(channel, topic.slug) });
    const thumbnailRender = renderThumbnail(image, renderTopic, assets, script);
    render.completed = true;
    render.audio = { ...voice, ...audioProbe, music: music ? { mood: music.mood, profile: music.profile } : null };
    render.video = { file: video, captionsBurned: true, ...visualRender, ...probe(video) };
    render.thumbnail = { file: image, bytes: fs.statSync(image).size, ...thumbnailRender };
    // Provenance manifest (every external + generated asset, licence, duty to
    // attribute) and the thumbnail variant ledger.
    require("../../lib/provenance").write(outputDirectory, require("../../lib/provenance").build({
      channel: channel.slug, slug: topic.slug, stills: assets.stills || [], clips: assets.clips || [], voiceProvider: voice.provider, music: !!music,
    }));
    try {
      require("../growth/thumbnails").recordVariants(channel, topic.slug, [{ file: path.relative(ROOT, image), sha256: require("../growth/thumbnails").sha256(image),
        concept: thumbnailRender.sourceType || "lead-still-with-hook-text", layoutType: "full-bleed-still-text", text: topic.thumbnailText || null, templateVersion: "ib-ct-thumbnail-v1", human: false, selected: true }]);
    } catch (error) {}
    pkg.renderVisuals = visualRender;
    pkg.qualityGate = Quality.evaluatePackage(pkg);
    write(path.join(outputDirectory, "quality-gate.json"), pkg.qualityGate);
  }
  const portableRender = JSON.parse(JSON.stringify(render));
  for (const key of ["audio", "video", "thumbnail"]) {
    if (portableRender[key] && portableRender[key].file) portableRender[key].file = path.relative(ROOT, portableRender[key].file);
  }
  write(path.join(outputDirectory, "render.json"), portableRender);
  const retention = channel.config.retentionRules || {};
  const openingMax = Number(retention.openingMaxSeconds || 2.2);
  const secondBeatMax = Number(retention.secondBeatMaxSeconds || 6.2);
  const durationRange = channel.config.publishingCadence.shorts.targetDurationSeconds || [18, 35.2];
  const visualQuality = options.render ? render.video.visualQuality : { decision: "PUBLISH", reasons: [] };
  const evidenceRows = topic.claimFramework || topic.facts || topic.researchEvidence || [];
  const validations = {
    script: !!script.spoken,
    science: evidenceRows.length >= 3,
    sources: topic.sources.length >= 2,
    hook: !script.forbiddenOpening,
    // Natural-pace narration: the hook line must still land quickly, but it is
    // never sped up to hit the visual opening window.
    timing: !options.render || (script.claims[0].end <= Number(retention.hookVoiceMaxSeconds || openingMax) && script.claims[1].end <= Number(retention.secondBeatVoiceMaxSeconds || secondBeatMax)),
    audio: !options.render || (render.completed && render.video.hasAudio && render.audio.claimDurations.length === script.claims.length),
    captions: fs.existsSync(path.join(outputDirectory, "captions.srt")) && fs.existsSync(path.join(outputDirectory, "captions.ass")) && (!options.render || render.video.captionsBurned),
    visuals: visuals.length >= 5 && (!options.render || visualQuality.decision === "PUBLISH"),
    video: !options.render || (render.video.width === 1080 && render.video.height === 1920 && render.video.durationSeconds >= durationRange[0] && render.video.durationSeconds <= durationRange[1] + 0.2),
    titles: titles.length >= 20,
    thumbnail: !options.render || (render.thumbnail.bytes > 0 && ["licensed-still", "number-card"].includes(render.thumbnail.sourceType) && render.thumbnail.textWords <= (isBehindOrdinary ? 4 : 3)),
    description: metadata.description.includes("Sources:"),
    qualityGate: pkg.qualityGate.decision === "PUBLISH",
    metadata: metadata.uploadChannel === channel.slug && metadata.uploadEnabled === false,
    ...(growth ? { growthReadiness: growth.readiness.decision !== "BLOCK" } : {}),
  };
  const validationReasons = {};
  if (!validations.visuals) validationReasons.visuals = visualQuality.reasons || ["visual plan contains fewer than five scenes"];
  if (!validations.thumbnail && options.render) validationReasons.thumbnail = [`thumbnail source ${render.thumbnail.sourceType} is neither a licensed still nor a sourced number card`];
  if (!validations.qualityGate) validationReasons.qualityGate = pkg.qualityGate.blockers || [];
  return { topicId: topic.id, slug: topic.slug, category: topic.category, outputDirectory, qualityGate: pkg.qualityGate, render, validations, validationReasons };
}

module.exports = { countUp, countUpFilter, overlayText, musicMood, colourGrade, srtTime, captions, assTime, assCaptions, probe, drawtextSafe, numberCardFontSize, scientificFrames, renderVideo, renderThumbnail, buildPackage };
