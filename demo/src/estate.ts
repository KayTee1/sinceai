import { dist3, gauss, mulberry32, type Vec3 } from "./math";

// Illustrative estate: 360 dashboard tiles (the size of the Bayer pack's
// synthetic asset catalog), generated from a fixed seed. Nothing here is read
// from the workbook; positions and relationships are narrative only.

export const NODE_COUNT = 360;
export const ORIGINALS = 270; // indices >= ORIGINALS are duplicate copies
export const DOMAINS = 6;
export const PER_DOMAIN = ORIGINALS / DOMAINS; // 45 -> 9 x 5 grid
export const GRID_COLS = 9;
export const CELL_W = 0.56;
export const CELL_H = 0.4;
export const TILE_W = 0.46;
export const TILE_H = 0.3;

export interface EstateNode {
  domain: number;
  dup: boolean;
  original: number; // self for originals
  chaos: Vec3;
  chaosRot: Vec3; // euler xyz
  order: Vec3;
  orderRotY: number;
  shade: number;
  phase: number;
}

export interface EstateEdge {
  a: number;
  b: number;
  kind: "kpi" | "conflict" | "copy";
}

export interface Estate {
  nodes: EstateNode[];
  edges: EstateEdge[];
  candidates: number[]; // existing assets covering Net Sales (reuse)
  kpiApproved: number;
  kpiVariant: number;
  dupShowcase: number; // an original with visible copies, for the opening label
  conflictShowcase: number; // edge index of a visible conflict
  insightSlot: Vec3; // where the new Temporary insight settles
  insightRotY: number;
}

const CLOUD_CENTER: Vec3 = [0, 0.6, -3.5];

/** Governed layout: six domain clusters in a gentle arc, archive row below. */
function clusterCenter(domain: number): { c: Vec3; rotY: number } {
  const col = domain % 3;
  const row = Math.floor(domain / 3);
  const x = (col - 1) * 6.1;
  const y = row === 0 ? 2.15 : -0.55;
  const z = -2.2 + Math.abs(x) * 0.17;
  return { c: [x, y, z], rotY: -Math.sign(x) * 0.2 };
}

function gridSlot(domain: number, j: number): { p: Vec3; rotY: number } {
  const { c, rotY } = clusterCenter(domain);
  const col = j % GRID_COLS;
  const row = Math.floor(j / GRID_COLS);
  const lx = (col - (GRID_COLS - 1) / 2) * CELL_W;
  const ly = (2 - row) * CELL_H;
  // rotate local x offset around the cluster's y axis
  return {
    p: [c[0] + lx * Math.cos(rotY), c[1] + ly, c[2] - lx * Math.sin(rotY)],
    rotY,
  };
}

export function buildEstate(seed = 20261108): Estate {
  const rng = mulberry32(seed);
  const centers: Vec3[] = [];
  for (let d = 0; d < DOMAINS; d++) {
    centers.push([
      CLOUD_CENTER[0] + (rng() * 2 - 1) * 8.5,
      CLOUD_CENTER[1] + (rng() * 2 - 1) * 3,
      CLOUD_CENTER[2] + (rng() * 2 - 1) * 4,
    ]);
  }

  const nodes: EstateNode[] = [];
  for (let i = 0; i < ORIGINALS; i++) {
    const domain = i % DOMAINS;
    const j = Math.floor(i / DOMAINS);
    const c = centers[domain];
    const chaos: Vec3 = [
      c[0] + gauss(rng) * 3.4,
      c[1] + gauss(rng) * 1.9,
      Math.min(0.4, c[2] + gauss(rng) * 2.8),
    ];
    const slot = gridSlot(domain, j);
    nodes.push({
      domain,
      dup: false,
      original: i,
      chaos,
      chaosRot: [(rng() * 2 - 1) * 0.9, (rng() * 2 - 1) * 1.1, (rng() * 2 - 1) * 0.5],
      order: slot.p,
      orderRotY: slot.rotY,
      shade: 0.82 + rng() * 0.36,
      phase: rng() * Math.PI * 2,
    });
  }

  // Duplicates sit right next to their original: near-identical copies.
  const archiveCols = 45;
  for (let k = 0; k < NODE_COUNT - ORIGINALS; k++) {
    const original = Math.floor(rng() * ORIGINALS);
    const o = nodes[original];
    const col = k % archiveCols;
    const row = Math.floor(k / archiveCols);
    nodes.push({
      domain: o.domain,
      dup: true,
      original,
      chaos: [
        o.chaos[0] + 0.18 + rng() * 0.35,
        o.chaos[1] - 0.1 + rng() * 0.3,
        o.chaos[2] + 0.12 + rng() * 0.3,
      ],
      chaosRot: [o.chaosRot[0] + 0.12, o.chaosRot[1] - 0.1, o.chaosRot[2] + 0.05],
      order: [(col - (archiveCols - 1) / 2) * 0.42, -3.35 - row * 0.3, -1.4],
      orderRotY: 0,
      shade: o.shade * 0.95,
      phase: rng() * Math.PI * 2,
    });
  }

  const edges: EstateEdge[] = [];
  for (let i = 0; i < ORIGINALS; i++) {
    if (rng() < 0.62) {
      const j = Math.floor(rng() * PER_DOMAIN) * DOMAINS + nodes[i].domain;
      if (j !== i) edges.push({ a: i, b: j, kind: "kpi" });
    }
  }
  for (let k = 0; k < 44; k++) {
    const a = Math.floor(rng() * ORIGINALS);
    let b = Math.floor(rng() * ORIGINALS);
    if (nodes[a].domain === nodes[b].domain) b = (b + 1) % ORIGINALS;
    edges.push({ a, b, kind: "conflict" });
  }
  for (let i = ORIGINALS; i < NODE_COUNT; i++) {
    edges.push({ a: nodes[i].original, b: i, kind: "copy" });
  }

  // Pick showcase nodes by proximity to framed points so labels land on screen.
  const nearest = (p: Vec3, filter: (i: number) => boolean, exclude: number[] = []) => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < NODE_COUNT; i++) {
      if (!filter(i) || exclude.includes(i)) continue;
      const d = dist3(nodes[i].chaos, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  const candidates: number[] = [];
  for (let k = 0; k < 5; k++) {
    candidates.push(
      nearest([-1.2, 0.2, -0.2], (i) => !nodes[i].dup && nodes[i].domain === 2, candidates),
    );
  }
  const kpiApproved = nearest([-3.6, 2.3, 0.2], (i) => !nodes[i].dup);
  const kpiVariant = nearest([-0.2, 2.5, 0.0], (i) => !nodes[i].dup && i !== kpiApproved);
  const dupHolder = nearest([3.5, 1.5, 0.5], (i) => nodes[i].dup);
  const dupShowcase = nodes[dupHolder].original;

  let conflictShowcase = edges.findIndex((e) => e.kind === "conflict");
  let bestC = Infinity;
  edges.forEach((e, idx) => {
    if (e.kind !== "conflict") return;
    const a = nodes[e.a].chaos;
    const b = nodes[e.b].chaos;
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const d = dist3(mid, [-4.5, -1.2, 0]) + Math.abs(dist3(a, b) - 5) * 0.4;
    if (d < bestC) {
      bestC = d;
      conflictShowcase = idx;
    }
  });

  const slot = gridSlot(2, PER_DOMAIN); // first cell of a sixth row
  return {
    nodes,
    edges,
    candidates,
    kpiApproved,
    kpiVariant,
    dupShowcase,
    conflictShowcase,
    insightSlot: slot.p,
    insightRotY: slot.rotY,
  };
}

export const estate = buildEstate();
