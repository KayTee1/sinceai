import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clock } from "../clock";
import { estate, TILE_H, TILE_W } from "../estate";
import { lerp, smoothstep, win } from "../math";
import { C } from "../palette";
import { APPROVE_T, protagonist, T } from "../story";
import { cardFace, halo } from "./textures";

// The request's journey: card -> token through the pipeline -> build proposal
// waiting at the boundary -> (human approval) -> Temporary insight with a
// 30-tick TTL ring -> a tile in the governed estate.

const TTL_DAYS = 30;
const RING_R = 0.98;

export function Protagonist() {
  const group = useRef<THREE.Group>(null);
  const reqCard = useRef<THREE.Mesh>(null);
  const insCard = useRef<THREE.Mesh>(null);
  const token = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const ticks = useRef<THREE.LineSegments>(null);
  const approval = useRef<THREE.Mesh>(null);

  const tickGeo = useMemo(() => {
    const pts: number[] = [];
    for (let d = 0; d < TTL_DAYS; d++) {
      const a = Math.PI / 2 - (d / TTL_DAYS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push(c * RING_R, s * RING_R, 0, c * (RING_R + 0.09), s * (RING_R + 0.09), 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const tint = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const t = clock.time;
    const p = protagonist(t);
    const g = group.current;
    if (!g) return;
    g.visible = p.mode !== "hidden";
    g.position.set(p.pos[0], p.pos[1], p.pos[2]);
    g.rotation.y = lerp(0, estate.insightRotY, p.settle);

    const arrive = smoothstep(T.requestIn, T.requestIn + 0.7, t);
    // card size: request 1.5 x 0.92, proposal/insight 1.3 x 0.8, settles to tile size
    const bigW = p.mode === "request" ? 1.5 : 1.3;
    const bigH = p.mode === "request" ? 0.92 : 0.8;
    const w = lerp(bigW, TILE_W, p.settle) * p.card;
    const h = lerp(bigH, TILE_H, p.settle) * p.card;
    const insightK = smoothstep(T.insightForm[0], T.insightForm[1], t);

    if (reqCard.current) {
      reqCard.current.scale.set(Math.max(w, 1e-4), Math.max(h, 1e-4), 1);
      const m = reqCard.current.material as THREE.MeshBasicMaterial;
      m.opacity = arrive * (1 - insightK);
      // request: cool white; proposal (a recommendation, pending): warm
      const proposalK = smoothstep(T.toBoundary[0], T.toBoundary[1] - 0.4, t);
      m.color.copy(C.request).lerp(C.warn, 0.7 * proposalK);
    }
    if (insCard.current) {
      insCard.current.scale.set(Math.max(w, 1e-4), Math.max(h, 1e-4), 1);
      const m = insCard.current.material as THREE.MeshBasicMaterial;
      m.opacity = insightK;
      m.color.copy(C.accent).lerp(C.white, 0.15);
    }
    if (token.current) {
      const s = (1 - p.card) * (p.mode === "token" || p.mode === "request" ? 1 : 0);
      token.current.scale.setScalar(Math.max(s, 1e-4));
    }
    if (glow.current) {
      const m = glow.current.material as THREE.SpriteMaterial;
      const waiting = win(t, T.toBoundary[1], APPROVE_T, 0.4);
      const pulse = 0.5 + 0.5 * Math.sin((t - T.toBoundary[1]) * 2.0);
      tint.copy(C.request);
      if (t > T.toBoundary[0]) tint.lerp(C.warn, smoothstep(T.toBoundary[0], T.toBoundary[1] - 0.4, t));
      tint.lerp(C.human, win(t, APPROVE_T, T.through[1], 0.3));
      tint.lerp(C.accent, insightK);
      m.color.copy(tint);
      m.opacity = arrive * (0.3 + 0.18 * waiting * pulse) * (1 - 0.75 * p.settle);
      const gs = lerp(p.card > 0.5 ? 3.4 : 1.3, 0.9, p.settle);
      glow.current.scale.set(gs, gs, 1);
    }
    if (ticks.current) {
      const n = Math.round(p.ttl * TTL_DAYS);
      ticks.current.geometry.setDrawRange(0, n * 2);
      const m = ticks.current.material as THREE.LineBasicMaterial;
      m.opacity = 0.85 * (1 - smoothstep(T.settle[0] + 0.2, T.settle[0] + 1.2, t));
    }
    if (approval.current) {
      const k = smoothstep(APPROVE_T, APPROVE_T + 1.1, t);
      const on = t >= APPROVE_T && t < APPROVE_T + 1.2 ? 1 : 0;
      approval.current.scale.setScalar(lerp(0.75, 1.6, k));
      (approval.current.material as THREE.MeshBasicMaterial).opacity = on * (1 - k) * 0.95;
    }
  });

  return (
    <group ref={group} visible={false}>
      <sprite ref={glow} position={[0, 0, -0.05]}>
        <spriteMaterial
          map={halo()}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={reqCard}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={cardFace("request")} transparent side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={insCard} position={[0, 0, 0.002]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={cardFace("insight")} transparent opacity={0} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={token}>
        <icosahedronGeometry args={[0.13, 3]} />
        <meshBasicMaterial color={C.request} toneMapped={false} />
      </mesh>
      <lineSegments ref={ticks} geometry={tickGeo}>
        <lineBasicMaterial color={C.accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <mesh ref={approval}>
        <ringGeometry args={[0.92, 0.95, 96]} />
        <meshBasicMaterial color={C.human} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
