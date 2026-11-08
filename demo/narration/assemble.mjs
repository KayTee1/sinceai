#!/usr/bin/env node
// Optional helper: place one ElevenLabs clip per cue at its exact start time
// and print the ffmpeg command that mixes them into public/audio/voiceover.mp3.
// The film is never stretched; clips are positioned on the fixed timeline.
//
//   node narration/assemble.mjs <clips-dir>        # expects <clips-dir>/c01.mp3 … c15.mp3
//
// It only prints a command (and, if ffprobe is installed, checks that each clip
// ends before the next cue starts). Nothing is downloaded, generated or uploaded.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node narration/assemble.mjs <clips-dir>");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(new URL("../src/narration/cues.json", import.meta.url), "utf8"));
const { cues, film } = manifest;

const clips = cues.map((c) => ({ ...c, file: join(dir, `${c.id}.mp3`) }));
const missing = clips.filter((c) => !existsSync(c.file));
if (missing.length) {
  console.error(`missing clips: ${missing.map((c) => c.file).join(", ")}`);
  process.exit(1);
}

let probe = true;
let problems = 0;
clips.forEach((c, i) => {
  if (!probe) return;
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", c.file]);
    const d = Number(String(out).trim());
    const limit = (clips[i + 1]?.start ?? film.narrationEndsBy ?? film.duration) - c.start;
    const flag = d > limit ? "  <-- overruns the next cue (or the brand fade)" : d > c.end - c.start + 0.3 ? "  (longer than planned window)" : "";
    if (d > limit) problems++;
    console.error(`${c.id} ${d.toFixed(2)} s, window ${(c.end - c.start).toFixed(2)} s, room ${limit.toFixed(2)} s${flag}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      probe = false;
      console.error("ffprobe not found: clip lengths not checked.");
    } else {
      problems++;
      console.error(`${c.id} could not be read by ffprobe (${c.file})`);
    }
  }
});
if (problems) console.error(`${problems} clip(s) overrun; regenerate them shorter or adjust the cue starts in cues.json.`);

const inputs = clips.flatMap((c) => ["-i", JSON.stringify(c.file)]);
const delayed = clips.map((c, i) => `[${i}:a]adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`);
const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${film.duration}[out]`;
console.log(
  [
    "ffmpeg -y",
    ...inputs,
    `-filter_complex "${[...delayed, mix].join(";")}"`,
    `-map "[out]" -t ${film.duration} -ar 44100 -c:a libmp3lame -q:a 2 public/audio/voiceover.mp3`,
  ].join(" "),
);
