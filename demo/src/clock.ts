import { useSyncExternalStore } from "react";
import { DURATION } from "./story";

// One timeline clock for the whole film. The 3D scene reads `clock.time` every
// frame; React UI subscribes through `useClock`. Time only moves forward while
// playing, by real frame delta (clamped) or by a fixed step for frame-exact
// capture (`?fixed=60`).

type Listener = () => void;

export interface ClockSnapshot {
  time: number;
  playing: boolean;
}

class Clock {
  time = 0;
  playing = false;
  fixedStep: number | null = null;
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
    this.time = Math.min(DURATION, this.time + step);
    if (this.time >= DURATION) this.playing = false;
    this.emit();
  }

  seek(t: number) {
    this.time = Math.min(DURATION, Math.max(0, t));
    this.emit();
  }

  play() {
    if (this.time >= DURATION) this.time = 0;
    this.playing = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(autoplay = true) {
    this.time = 0;
    this.playing = autoplay;
    this.emit();
  }
}

export const clock = new Clock();

export function useClock(): ClockSnapshot {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
