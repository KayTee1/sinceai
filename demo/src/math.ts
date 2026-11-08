// Small deterministic helpers. Everything on screen is a pure function of the
// timeline time `t` plus data generated from a fixed seed, so any frame can be
// reproduced exactly by seeking to the same time.

export type Vec3 = [number, number, number];

/** mulberry32: tiny seeded PRNG. Same seed, same sequence, every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate standard normal from a uniform PRNG (sum of uniforms). */
export function gauss(rng: () => number): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.2247;
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function smoothstep(e0: number, e1: number, x: number): number {
  const k = clamp((x - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
}

export function smootherstep(e0: number, e1: number, x: number): number {
  const k = clamp((x - e0) / (e1 - e0));
  return k * k * k * (k * (k * 6 - 15) + 10);
}

/** Trapezoid visibility window: fades in over `fade` after a, out before b. */
export function win(t: number, a: number, b: number, fade = 0.45): number {
  return smoothstep(a, a + fade, t) * (1 - smoothstep(b - fade, b, t));
}

export function lerp3(a: Vec3, b: Vec3, k: number): Vec3 {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface Key {
  t: number;
  v: Vec3;
}

/**
 * Eased keys: each segment eases in and out (zero velocity at every key).
 * Two equal keys make a hold; this gives deliberate move-then-settle camera
 * beats instead of constant motion.
 */
export function eased(keys: Key[], t: number): Vec3 {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  return lerp3(keys[i].v, keys[i + 1].v, smootherstep(keys[i].t, keys[i + 1].t, t));
}
