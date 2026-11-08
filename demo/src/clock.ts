import { useSyncExternalStore } from "react";
import { DURATION } from "./story";

// One timeline clock for the whole film. The 3D scene reads `clock.time` every
// frame; React UI subscribes through `useClock`. Time only moves forward while
// playing, by real frame delta (clamped) or by a fixed step for frame-exact
// capture (`?fixed=60`).
//
// Optional narration: `follow` returns the timeline time implied by the playing
// audio (or null). In real-time playback the clock is steered onto it, so the
// visuals cannot drift from the voice. `onTransport` tells the narration about
// play, pause and seek so it can mirror them. Neither is used in fixed-step mode.

type Listener = () => void;
export type Transport = "play" | "pause" | "seek";

export interface ClockSnapshot {
  time: number;
  playing: boolean;
}

class Clock {
  time = 0;
  playing = false;
  fixedStep: number | null = null;
  follow: (() => number | null) | null = null;
  onTransport: ((e: Transport) => void) | null = null;
  private listeners = new Set<Listener>();
  private snap: ClockSnapshot = { time: 0, playing: false };

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.snap;

  private emit() {
    if (this.snap.time !== this.time || this.snap.playing !== this.playing) {
      this.snap = { time: this.time, playing: this.playing };
      this.listeners.forEach((l) => l());
    }
  }

  advance(delta: number) {
    if (!this.playing) return;
    const step = this.fixedStep ?? Math.min(delta, 1 / 30);
    let next = this.time + step;
    const audio = this.fixedStep === null && this.follow ? this.follow() : null;
    if (audio !== null) {
      // Small errors are eased out; a large one (tab was hidden, a hitch) snaps.
      const err = audio - next;
      next = Math.abs(err) > 0.1 ? audio : next + err * 0.2;
    }
    this.time = Math.min(DURATION, Math.max(0, next));
    if (this.time >= DURATION) {
      this.playing = false;
      this.onTransport?.("pause");
    }
    this.emit();
  }

  seek(t: number) {
    this.time = Math.min(DURATION, Math.max(0, t));
    this.emit();
    this.onTransport?.("seek");
  }

  play() {
    if (this.time >= DURATION) this.time = 0;
    this.playing = true;
    this.emit();
    this.onTransport?.("play");
  }

  pause() {
    this.playing = false;
    this.emit();
    this.onTransport?.("pause");
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(autoplay = true) {
    this.time = 0;
    this.playing = autoplay;
    this.emit();
    this.onTransport?.("seek");
    this.onTransport?.(autoplay ? "play" : "pause");
  }
}

export const clock = new Clock();

export function useClock(): ClockSnapshot {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
