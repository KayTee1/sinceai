import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clock } from "../clock";
import { smoothstep } from "../math";
import { C } from "../palette";
import { APPROVE_T, BOUNDARY_X, boundaryVis, GATE_Y, GATE_Z } from "../story";

// The approval boundary: a quiet translucent plane between "AI proposes" and
// "People decide". The proposal stops here. Only the human decision at
// APPROVE_T lets it through; there is no timer or automatic path.

const H = 3.1;
const W = 5.2;

export function Governance() {
  const plane = useRef<THREE.Mesh>(null);
  const frame = useRef<THREE.LineSegments>(null);

  const frameGeo = useMemo(() => {
    const y0 = GATE_Y - H / 2 + 0.2;
    const y1 = y0 + H;
    const z0 = GATE_Z - W / 2;
    const z1 = GATE_Z + W / 2;
    const x = BOUNDARY_X;
    const pts = [
      x, y0, z0, x, y1, z0,
      x, y0, z1, x, y1, z1,
      x, y1, z0, x, y1, z1,
      x, y0, z0, x, y0, z1,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  useFrame(() => {
    const t = clock.time;
    const vis = boundaryVis(t);
    const flash = smoothstep(APPROVE_T, APPROVE_T + 0.25, t) * (1 - smoothstep(APPROVE_T + 0.4, APPROVE_T + 1.6, t));
    if (plane.current) {
      const m = plane.current.material as THREE.MeshBasicMaterial;
      m.opacity = vis * (0.06 + 0.05 * flash);
      m.color.copy(C.accent).lerp(C.human, flash);
    }
    if (frame.current) {
      const m = frame.current.material as THREE.LineBasicMaterial;
      m.opacity = vis * (0.42 + 0.5 * flash);
      m.color.copy(C.accent).lerp(C.human, flash);
    }
  });

  return (
    <group>
      <mesh ref={plane} position={[BOUNDARY_X, GATE_Y + 0.2, GATE_Z]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <lineSegments ref={frame} geometry={frameGeo}>
        <lineBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </lineSegments>
    </group>
  );
}
