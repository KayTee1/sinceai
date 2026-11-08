#!/usr/bin/env node
// Write narration/voiceover.srt from the cue manifest, using the same timing
// rules as the on-screen subtitles (src/subtitles.ts): start - lead, end + tail,
// never closer than minGap to the next cue.
//
//   node narration/srt.mjs

import { readFileSync, writeFileSync } from "node:fs";

const m = JSON.parse(readFileSync(new URL("../src/narration/cues.json", import.meta.url), "utf8"));
const { lead, tail, minGap } = m.subtitles;
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = m.cues
  .map((c, i) => {
    const next = m.cues[i + 1]?.start ?? m.film.duration;
    const start = Math.max(0, c.start - lead);
    const end = Math.min(c.end + tail, next - lead - minGap);
    return `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${c.text}\n`;
  })
  .join("\n");
const out = new URL("./voiceover.srt", import.meta.url);
writeFileSync(out, srt);
console.log(`wrote ${out.pathname} (${m.cues.length} cues)`);
