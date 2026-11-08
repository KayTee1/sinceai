import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { clock } from "../clock";
import { estate, NODE_COUNT, TILE_H, TILE_W } from "../estate";
import { clamp, lerp, smoothstep, win, type Vec3 } from "../math";
import { C, DOMAIN_TINT } from "../palette";
import { gateX, GATE_Y, GATE_Z, nodePosition, organizeK, protagonist, T } from "../story";

// The analytics estate: 360 instanced tiles plus their relationships drawn as
// one additive LineSegments buffer. Everything is recomputed from `t` per frame.

const LIGHT = new THREE.Vector3(0.35, 0.55, 0.76).normalize();
const SCAN_ORIGIN: Vec3 = [gateX(1), GATE_Y, GATE_Z];

const candidateSet = new Set(estate.candidates);
const pos = new Float32Array(NODE_COUNT * 3);

export function Estate() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const threads = useRef<THREE.LineSegments>(null);

  const data = useMemo(() => {
    const qChaos = estate.nodes.map((n) =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...n.chaosRot)),
    );
    const qOrder = estate.nodes.map((n) =>
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), n.orderRotY),
    );
    const edgeCount = estate.edges.length;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgeCount * 6), 3));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(edgeCount * 6), 3));
    // reuse threads (5) + KPI threads (2), from the token to nodes
    const threadCount = estate.candidates.length + 2;
    const threadGeo = new THREE.BufferGeometry();
    threadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(threadCount * 6), 3));
    threadGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(threadCount * 6), 3));
    return { qChaos, qOrder, lineGeo, threadGeo };
  }, []);

  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(),
      p: new THREE.Vector3(),
      n: new THREE.Vector3(),
      col: new THREE.Color(),
      tmp: new THREE.Color(),
      v: [0, 0, 0] as Vec3,
    }),
    [],
  );

  useFrame(() => {
    const t = clock.time;
    const im = mesh.current;
    if (!im) return;
    const { m, q, s, p, n, col, tmp, v } = scratch;

    // global emphasis per act: dim the estate when the story is in front of it
    // Background recedes hard during the pipeline and approval so only the
    // active gate and its evidence (candidates, KPI pair, copies) stand out.
    const dp = T.dimPipeline;
    const dg = T.dimGov;
    const dimPipeline = smoothstep(dp[0], dp[1], t) * (1 - smoothstep(dp[2], dp[3], t));
    const dimGov = smoothstep(dg[0], dg[1], t) * (1 - smoothstep(dg[2], dg[3], t));
    const globalB = 1 - 0.8 * dimPipeline - 0.8 * dimGov;

    const scanR = smoothstep(T.scan[0], T.scan[1] - 0.3, t) * 24;
    const scanOn = win(t, T.scan[0], T.scan[1], 0.3);
    const dupStep = win(t, T.dupStep[0], T.dupStep[1], 0.4);
    const kpiStep = win(t, T.kpiStep[0], T.kpiStep[1], 0.4);
    const candOn = smoothstep(T.candidatesOn, T.candidatesOn + 0.7, t) * (1 - smoothstep(dg[2], dg[3], t));
    const candStrong = 0.5 + 0.5 * win(t, T.reuse[0], T.reuse[1], 0.4);
    const sprawlWarn = 1 - smoothstep(T.sprawlWarnOut[0], T.sprawlWarnOut[1], t);

    for (let i = 0; i < NODE_COUNT; i++) {
      const node = estate.nodes[i];
      nodePosition(i, t, v);
      pos[i * 3] = v[0];
      pos[i * 3 + 1] = v[1];
      pos[i * 3 + 2] = v[2];
      const k = organizeK(i, t);

      q.copy(data.qChaos[i]).slerp(data.qOrder[i], k);
      const a0 = (node.phase / (Math.PI * 2)) * T.tilesAppearSpan;
      const appear = smoothstep(a0, a0 + 0.7, t);
      const sc = appear * (node.dup ? lerp(1, 0.72, k) : 1);
      s.set(sc, sc, sc);
      p.set(v[0], v[1], v[2]);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);

      // faked directional shading from the tile normal
      n.set(0, 0, 1).applyQuaternion(q);
      const lit = 0.5 + 0.62 * Math.max(0, n.dot(LIGHT));

      col.copy(C.tile).lerp(DOMAIN_TINT[node.domain], k);
      let b = lit * node.shade * globalB * lerp(1, 1.18, k);

      if (node.dup) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.1 + node.phase);
        col.lerp(C.warn, 0.32 * sprawlWarn * (0.55 + 0.45 * pulse) + 0.7 * dupStep);
        b *= lerp(1, 0.38, k);
      }
      if (scanOn > 0) {
        const d = Math.hypot(v[0] - SCAN_ORIGIN[0], v[1] - SCAN_ORIGIN[1], v[2] - SCAN_ORIGIN[2]);
        const band = Math.exp(-(((d - scanR) / 1.3) ** 2)) * scanOn;
        col.lerp(tmp.copy(C.request), 0.6 * band);
        b += 0.55 * band;
      }
      if (candidateSet.has(i) && candOn > 0) {
        col.lerp(C.accent, 0.85 * candOn);
        b = lerp(b, 1.45 * candStrong + 0.2, candOn);
      }
      if (kpiStep > 0 && (i === estate.kpiApproved || i === estate.kpiVariant)) {
        col.lerp(i === estate.kpiApproved ? C.accent : C.warn, 0.9 * kpiStep);
        b = lerp(b, 1.5, kpiStep);
      }
      col.multiplyScalar(clamp(b, 0, 2));
      im.setColorAt(i, col);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    // relationships
    const lp = data.lineGeo.attributes.position as THREE.BufferAttribute;
    const lc = data.lineGeo.attributes.color as THREE.BufferAttribute;
    const lpA = lp.array as Float32Array;
    const lcA = lc.array as Float32Array;
    const linesIn = smoothstep(T.linesIn[0], T.linesIn[1], t);
    const govern = smoothstep(T.organize[0] + 0.2, T.organize[1] + 0.2, t);
    estate.edges.forEach((e, idx) => {
      const o = idx * 6;
      for (let a = 0; a < 3; a++) {
        lpA[o + a] = pos[e.a * 3 + a];
        lpA[o + 3 + a] = pos[e.b * 3 + a];
      }
      let c = C.link;
      let inten: number;
      if (e.kind === "kpi") {
        inten = lerp(0.42, 0.16, govern) * (1 - 0.88 * dimPipeline) * (1 - 0.8 * dimGov);
      } else if (e.kind === "conflict") {
        c = C.warn;
        const flick = 0.75 + 0.25 * Math.sin(t * 3.1 + idx);
        const show = idx === estate.conflictShowcase ? win(t, T.conflictLabel[0] - 0.2, T.conflictLabel[1], 0.4) * 0.6 : 0;
        inten = (0.36 * flick + show) * (1 - 0.92 * dimPipeline) * (1 - 0.85 * dimGov) * (1 - govern);
        inten += 0.06 * kpiStep * (1 - govern);
      } else {
        c = C.warn;
        inten = (0.22 * (1 - 0.92 * dimPipeline) + 0.5 * dupStep) * (1 - 0.85 * dimGov) * (1 - govern);
      }
      inten *= linesIn;
      lcA[o] = lcA[o + 3] = c.r * inten;
      lcA[o + 1] = lcA[o + 4] = c.g * inten;
      lcA[o + 2] = lcA[o + 5] = c.b * inten;
    });
    lp.needsUpdate = true;
    lc.needsUpdate = true;
    data.lineGeo.computeBoundingSphere();

    // threads from the request token to the KPI definitions and reuse candidates
    const tp = data.threadGeo.attributes.position as THREE.BufferAttribute;
    const tc = data.threadGeo.attributes.color as THREE.BufferAttribute;
    const tpA = tp.array as Float32Array;
    const tcA = tc.array as Float32Array;
    const tok = protagonist(t).pos;
    const targets = [...estate.candidates, estate.kpiApproved, estate.kpiVariant];
    targets.forEach((ni, j) => {
      const o = j * 6;
      tpA[o] = tok[0];
      tpA[o + 1] = tok[1];
      tpA[o + 2] = tok[2];
      tpA[o + 3] = pos[ni * 3];
      tpA[o + 4] = pos[ni * 3 + 1];
      tpA[o + 5] = pos[ni * 3 + 2];
      const isCand = j < estate.candidates.length;
      const c = isCand || ni === estate.kpiApproved ? C.accent : C.warn;
      const inten = isCand ? 0.8 * win(t, T.reuse[0], T.reuse[1], 0.5) : 0.8 * kpiStep;
      tcA[o] = tcA[o + 3] = c.r * inten;
      tcA[o + 1] = tcA[o + 4] = c.g * inten;
      tcA[o + 2] = tcA[o + 5] = c.b * inten;
    });
    tp.needsUpdate = true;
    tc.needsUpdate = true;
    data.threadGeo.computeBoundingSphere();
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, NODE_COUNT]} frustumCulled={false}>
        <boxGeometry args={[TILE_W, TILE_H, 0.022]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={lines} geometry={data.lineGeo} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments ref={threads} geometry={data.threadGeo} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
