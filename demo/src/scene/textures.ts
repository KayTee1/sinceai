import * as THREE from "three";

// Procedural canvas textures (no image assets, fully deterministic).

let haloTex: THREE.Texture | null = null;

/** Soft radial falloff used for restrained glows. */
export function halo(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.42)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

const cardCache = new Map<string, THREE.Texture>();

/**
 * A card face: "request" shows text lines; "insight" shows a tiny bar chart.
 * Drawn in neutral greys so the material colour can tint it.
 */
export function cardFace(kind: "request" | "insight"): THREE.Texture {
  const hit = cardCache.get(kind);
  if (hit) return hit;
  const w = 512;
  const h = 312;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a2230";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillRect(32, 34, 150, 16);
  if (kind === "request") {
    g.fillStyle = "rgba(255,255,255,0.45)";
    const widths = [420, 380, 300, 340];
    widths.forEach((lw, i) => g.fillRect(32, 92 + i * 46, lw, 12));
  } else {
    const bars = [0.42, 0.58, 0.5, 0.74, 0.66, 0.88];
    bars.forEach((b, i) => {
      g.fillStyle = i === bars.length - 1 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)";
      const bh = b * 180;
      g.fillRect(40 + i * 72, h - 40 - bh, 44, bh);
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cardCache.set(kind, tex);
  return tex;
}
