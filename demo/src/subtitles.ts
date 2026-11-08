import { win } from "./math";
import manifest from "./narration/cues.json";

// Spoken subtitles. Text and timing come only from the narration cue manifest
// (src/narration/cues.json): each cue's text is the exact spoken wording and its
// start/end are the measured voiced times in public/audio/voiceover.mp3.
// narration/srt.mjs builds the .srt file from the same manifest and rules.

export interface Subtitle {
  id: string;
  start: number;
  end: number;
  text: string;
}

const { lead, tail, minGap } = manifest.subtitles;
const FADE = 0.15;

export const SUBTITLES: Subtitle[] = manifest.cues.map((c, i, all) => {
  const next = all[i + 1]?.start ?? manifest.film.duration;
  return {
    id: c.id,
    start: Math.max(0, c.start - lead),
    end: Math.min(c.end + tail, next - lead - minGap),
    text: c.text,
  };
});

export const subtitleAt = (t: number) => SUBTITLES.find((s) => t >= s.start && t < s.end) ?? null;

export const subtitleOpacity = (s: Subtitle, t: number) => win(t, s.start, s.end, FADE);
