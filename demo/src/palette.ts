import * as THREE from "three";

// One restrained palette for 3D and overlay. Overlay CSS mirrors these values
// as custom properties in styles.css.

export const BG = "#05070b";

export const C = {
  tile: new THREE.Color("#3a5272"),
  tileOrdered: new THREE.Color("#5b7aa3"),
  link: new THREE.Color("#4a6588"),
  accent: new THREE.Color("#6fd6c8"), // Analytics Steward / reuse / governed
  warn: new THREE.Color("#e0a957"), // duplicates, conflicts, pending
  human: new THREE.Color("#f4ede1"), // human decisions
  request: new THREE.Color("#dbe6f4"),
  white: new THREE.Color("#ffffff"),
};

/** Subtle per-domain tint for the governed layout. */
export const DOMAIN_TINT = ["#5c7ba6", "#6680a8", "#5a84a0", "#6a7aa6", "#5f86a8", "#687fa0"].map(
  (h) => new THREE.Color(h),
);
