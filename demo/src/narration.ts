import { useSyncExternalStore } from "react";
import { clock, type Transport } from "./clock";
import manifest from "./narration/cues.json";

// Optional voiceover. If `public/audio/voiceover.mp3` exists, it plays in sync
// with the timeline: the audio drives the clock during real-time playback, and
// play, pause, seek, restart and chapter jumps move the audio with the film.
// If the file is missing, or narration is disabled (`?narration=0`) or the
// clock is in fixed-step capture mode (`?fixed=60`), the film plays silently
// exactly as before. No network service is involved; the file is static.

export type NarrationStatus =
  | "off" // disabled by URL or fixed-step mode
  | "checking" // looking for the file
  | "missing" // no narration file: silent playback
  | "ready" // file loaded, in sync with the clock
  | "blocked" // browser refused to start audio without a user gesture
  | "unseekable" // server ignores Range requests: kept silent so seeking stays exact
  | "error"; // file present but could not be decoded

export interface NarrationSnapshot {
  status: NarrationStatus;
  muted: boolean;
  duration: number | null;
}

export interface Cue {
  id: string;
  chapter: string;
  start: number;
  end: number;
  text: string;
}

export const CUES: Cue[] = manifest.cues;
export const cueAt = (t: number) => CUES.find((c) => t >= c.start && t < c.end) ?? null;

/** Timeline second at which audio time 0 plays. */
const OFFSET = manifest.audio.offset;
const SRC = `${import.meta.env.BASE_URL}${manifest.audio.src}`;

class Narration {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  private snap: NarrationSnapshot = { status: "off", muted: false, duration: null };
  /** Audio time the last seek asked for, checked when the seek completes. */
  private expected: number | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<NarrationSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Look for the file; stays silent if it is not there. */
  async init(enabled: boolean) {
    if (!enabled) return;
    this.set({ status: "checking" });
    let found = false;
    try {
      // HEAD first, so a missing file (or a dev-server HTML fallback) never
      // reaches the media element.
      const res = await fetch(SRC, { method: "HEAD", cache: "no-store" });
      const type = res.headers.get("content-type") ?? "";
      found = res.ok && !type.includes("text/html");
    } catch {
      found = false;
    }
    if (!found) {
      this.set({ status: "missing" });
      return;
    }
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("loadedmetadata", () => {
      const s = audio.seekable;
      if (s.length === 0 || s.end(s.length - 1) < audio.duration - 0.1) {
        // Without byte-range support the browser cannot seek the audio, and a
        // seek would drag the film back to 0. Stay silent instead.
        audio.removeAttribute("src");
        this.set({ status: "unseekable", duration: audio.duration });
        return;
      }
      audio.addEventListener("seeked", () => {
        // A seek that silently lands elsewhere means the server cannot serve
        // byte ranges yet: detach rather than let the audio pull the film.
        if (this.expected !== null && Math.abs(audio.currentTime - this.expected) > 0.25) this.detach();
        this.expected = null;
      });
      this.audio = audio;
      this.set({ status: "ready", duration: audio.duration });
      clock.follow = () => this.masterTime();
      clock.onTransport = (e) => this.onTransport(e);
      // The film may already be playing (autoplay): join it at the current time.
      this.onTransport(clock.playing ? "play" : "seek");
    });
    audio.addEventListener("error", () => {
      if (this.audio === null) this.set({ status: "error" });
    });
    audio.src = SRC;
  }

  /** Timeline time implied by the audio, or null when the audio is not the master. */
  private masterTime(): number | null {
    const a = this.audio;
    if (!a || this.snap.status !== "ready" || a.seeking) return null;
    if (a.paused) {
      // With a positive offset the film reaches the narration while playing.
      if (!a.ended && clock.playing && this.inRange(clock.time)) {
        this.place(clock.time);
        this.start(clock.time);
      }
      return null;
    }
    return a.ended ? null : a.currentTime + OFFSET;
  }

  private inRange(t: number) {
    const a = t - OFFSET;
    return this.audio !== null && a >= 0 && a < this.audio.duration;
  }

  private place(t: number) {
    const a = this.audio!;
    const target = Math.min(Math.max(t - OFFSET, 0), a.duration);
    if (Math.abs(a.currentTime - target) > 0.02) {
      this.expected = target;
      a.currentTime = target;
    }
  }

  private detach() {
    const a = this.audio;
    if (!a) return;
    a.pause();
    a.removeAttribute("src");
    this.audio = null;
    clock.follow = null;
    clock.onTransport = null;
    this.set({ status: "unseekable" });
  }

  private onTransport(e: Transport) {
    const a = this.audio;
    if (!a) return;
    const t = clock.time;
    if (e === "pause" || !clock.playing) {
      a.pause();
      this.place(t);
      return;
    }
    // play, or seek while playing
    if (!this.inRange(t)) {
      // Outside the narration (before the offset or after it ended): the clock
      // keeps time on its own until the audio range is reached.
      a.pause();
      return;
    }
    this.place(t);
    if (a.paused) this.start(t);
  }

  private start(t: number) {
    const a = this.audio!;
    a.play().then(
      () => {
        if (this.snap.status === "blocked") this.set({ status: "ready" });
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          // Autoplay with sound refused: hold the film where it was so voice and
          // picture start together on the viewer's next play.
          this.set({ status: "blocked" });
          clock.pause();
          clock.seek(t);
        }
        // AbortError: a pause or seek interrupted play(); nothing to do.
      },
    );
  }

  toggleMuted() {
    if (!this.audio) return;
    this.audio.muted = !this.audio.muted;
    this.set({ muted: this.audio.muted });
  }
}

export const narration = new Narration();

export function useNarration(): NarrationSnapshot {
  return useSyncExternalStore(narration.subscribe, narration.getSnapshot);
}
