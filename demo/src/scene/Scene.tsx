import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { clock } from "../clock";
import { labelElements } from "../labels";
import { smoothstep } from "../math";
import { BG } from "../palette";
import { cameraPos, cameraTarget, LABELS } from "../story";
import { Estate } from "./Estate";
import { Governance } from "./Governance";
import { Pipeline } from "./Pipeline";
import { Protagonist } from "./Protagonist";

/** Advances the timeline once per rendered frame. Mounted first, so it runs first. */
function ClockDriver() {
  useFrame((_, delta) => clock.advance(delta));
  return null;
}

function CameraRig() {
  useFrame(({ camera }) => {
    const t = clock.time;
    const p = cameraPos(t);
    const g = cameraTarget(t);
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(g[0], g[1], g[2]);
  });
  return null;
}

// Safe area as fractions of the stage (1920×1080: 77 px sides, 76 px top/bottom).
const SAFE_X = 0.04;
const SAFE_TOP = 0.14; // below the chapter tag and panel headings
const SAFE_BOTTOM = 0.84; // above captions

/**
 * Projects 3D anchors to the HTML overlay (crisp text, no font atlas).
 * Callouts and zone labels are clamped inside the safe area so they are never
 * clipped; gate labels fade out instead of sliding when near the frame edge.
 */
function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), []);
  const sizes = useMemo(() => new WeakMap<HTMLElement, { W: number; w: number; h: number }>(), []);
  useFrame(({ camera }) => {
    const t = clock.time;
    for (const def of LABELS) {
      const el = labelElements.get(def.id);
      if (!el) continue;
      let o = def.opacity(t);
      if (o < 0.01) {
        el.style.visibility = "hidden";
        continue;
      }
      const a = def.at(t);
      v.set(a[0], a[1], a[2]).project(camera);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      const parent = el.parentElement;
      const W = parent?.clientWidth ?? 1;
      const H = parent?.clientHeight ?? 1;
      let x = ((v.x + 1) / 2) * W;
      let y = ((1 - v.y) / 2) * H;
      el.style.visibility = "visible";
      if (def.active) el.style.setProperty("--active", def.active(t).toFixed(3));
      if (def.variant === "gate") {
        const fx = x / W;
        o *= smoothstep(SAFE_X + 0.03, SAFE_X + 0.09, fx) * (1 - smoothstep(0.91 - SAFE_X, 0.97 - SAFE_X, fx));
      } else {
        let sz = sizes.get(el);
        if (!sz || sz.W !== W) {
          sz = { W, w: el.offsetWidth, h: el.offsetHeight };
          sizes.set(el, sz);
        }
        const pointer = def.variant === "callout" ? 0.011 * W : 0;
        x = Math.min(Math.max(x, SAFE_X * W + sz.w / 2), W - SAFE_X * W - sz.w / 2);
        y = Math.min(Math.max(y, SAFE_TOP * H + sz.h + pointer), SAFE_BOTTOM * H);
      }
      el.style.opacity = o.toFixed(3);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  });
  return null;
}

export function Scene() {
  return (
    <>
      <ClockDriver />
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 19, 52]} />
      <CameraRig />
      <Estate />
      <Pipeline />
      <Governance />
      <Protagonist />
      <LabelProjector />
    </>
  );
}
