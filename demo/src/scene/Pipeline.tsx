import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clock } from "../clock";
import { TILE_H, TILE_W } from "../estate";
import { smoothstep, win } from "../math";
import { BG, C } from "../palette";
import { GAP_POS, GATE_Y, GATE_Z, GATES, gateActive, gateWindow, gateX, pipelineVis, T } from "../story";
import { halo } from "./textures";

// Five rings = the five request-pipeline workflow steps run by the Mastra
// orchestrator. Thin connectors drop to a rail labelled as the deterministic
// Steward services that compute supported KPI values (not the model).

const RAIL_Y = -0.2;

export function Pipeline() {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const glows = useRef<(THREE.Sprite | null)[]>([]);
  const rail = useRef<THREE.LineSegments>(null);
  const gap = useRef<THREE.LineSegments>(null);
  const gapFill = useRef<THREE.Mesh>(null);

  const railGeo = useMemo(() => {
    const pts: number[] = [gateX(0) - 1.6, RAIL_Y, GATE_Z, gateX(4) + 1.6, RAIL_Y, GATE_Z];
    for (let i = 0; i < GATES.length; i++) {
      pts.push(gateX(i), RAIL_Y + 0.22, GATE_Z, gateX(i), RAIL_Y, GATE_Z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const gapGeo = useMemo(() => {
    const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(TILE_W * 2.2, TILE_H * 2.2));
    return g;
  }, []);

  useFrame(() => {
    const t = clock.time;
    const vis = pipelineVis(t);
    GATES.forEach((_, i) => {
      const [, b] = gateWindow(i);
      const active = gateActive(i, t);
      const done = smoothstep(b, b + 0.4, t);
      const ring = rings.current[i];
      if (ring) {
        const mat = ring.material as THREE.MeshBasicMaterial;
        // pending gates stay faint, done gates medium, the active gate dominant
        mat.opacity = vis * (0.14 + 0.22 * done * (1 - active) + 0.86 * active);
        mat.color.copy(C.accent).lerp(C.white, 0.35 * active);
        const s = 1 + 0.12 * active;
        ring.scale.set(s, s, s);
        ring.rotation.z = t * 0.15 + i;
      }
      const glow = glows.current[i];
      if (glow) (glow.material as THREE.SpriteMaterial).opacity = vis * 0.42 * active;
    });
    if (rail.current) (rail.current.material as THREE.LineBasicMaterial).opacity = 0.4 * vis;
    if (gap.current) {
      const g = win(t, T.gap[0], T.gap[1], 0.4);
      const mat = gap.current.material as THREE.LineDashedMaterial;
      mat.opacity = g * (0.75 + 0.25 * Math.sin(t * 3));
      if (gapFill.current) (gapFill.current.material as THREE.MeshBasicMaterial).opacity = 0.94 * g;
    }
  });

  return (
    <group>
      {GATES.map((_, i) => (
        <group key={i} position={[gateX(i), GATE_Y, GATE_Z]}>
          <mesh ref={(el) => void (rings.current[i] = el)}>
            <torusGeometry args={[0.56, 0.011, 8, 120]} />
            <meshBasicMaterial transparent depthWrite={false} toneMapped={false} opacity={0} />
          </mesh>
          <sprite ref={(el) => void (glows.current[i] = el)} scale={[2.4, 2.4, 1]}>
            <spriteMaterial
              map={halo()}
              color={C.accent}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}
      <lineSegments ref={rail} geometry={railGeo}>
        <lineBasicMaterial color={C.accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </lineSegments>
      {/* opaque backing so background tiles never show through the gap marker */}
      <mesh ref={gapFill} position={[GAP_POS[0], GAP_POS[1], GAP_POS[2] - 0.01]} renderOrder={1}>
        <planeGeometry args={[TILE_W * 2.5, TILE_H * 2.6]} />
        <meshBasicMaterial color={BG} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments
        renderOrder={2}
        ref={gap}
        geometry={gapGeo}
        position={GAP_POS}
        onUpdate={(self) => self.computeLineDistances()}
      >
        <lineDashedMaterial
          color={C.warn}
          dashSize={0.08}
          gapSize={0.06}
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
