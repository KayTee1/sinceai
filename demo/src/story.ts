import { estate, ORIGINALS } from "./estate";
import { eased, lerp, lerp3, smootherstep, smoothstep, win, type Key, type Vec3 } from "./math";

// The film script. Every timing, camera key, note and 3D label lives here
// as a function of timeline time t (seconds); scene components read `T`
// instead of hard-coding numbers. Wording is checked against README,
// ARCHITECTURE, MASTRA, GOVERNANCE and DEMO at 3cdfb60. Anything shown is
// either documented behavior or labelled as illustration.
//
// Pacing rule: every beat has an approach, an action, and a readable hold.

export const DURATION = 55;

// ---------------------------------------------------------------- pipeline layout

/** request-pipeline workflow steps, in source order (MASTRA.md). */
export const GATES = [
  { name: "Intent", detail: "Request → KPIs, product, market" },
  { name: "Discovery", detail: "Catalog searched for candidate assets" },
  { name: "Conflict", detail: "KPI definition conflicts surfaced" },
  { name: "Duplicate", detail: "Existing and pending builds checked" },
  { name: "Recommend", detail: "Reuse candidates · flag the gap" },
];
export const GATE_Y = 1.5;
export const GATE_Z = 4;
export const gateX = (i: number) => -6 + i * 3;
export const GATE_START = 15;
export const GATE_STEP = 4;
/** Within each 4 s gate: 0–0.9 approach, 0.9–2.8 action, 2.8–4 hold. */
export const GATE_APPROACH = 0.9;
export const gateWindow = (i: number): [number, number] => [
  GATE_START + i * GATE_STEP,
  GATE_START + (i + 1) * GATE_STEP,
];
const gA = (i: number) => gateWindow(i)[0];

export const GAP_POS: Vec3 = [gateX(4), 3.2, 4.4];
export const BOUNDARY_X = 9.6;

// ---------------------------------------------------------------- timing table

export const T = {
  // 01 sprawl
  tilesAppearSpan: 2.6,
  linesIn: [1.2, 3.5] as const,
  dupLabel: [2.4, 7.4] as const,
  conflictLabel: [3.4, 7.6] as const,
  sprawlWarnOut: [13, 15.5] as const,
  // 02 request
  requestIn: 8,
  requestArrive: 11.6,
  requestLabel: [9.4, 14.5] as const,
  cardToToken: [14.3, 15.0] as const,
  // 03 pipeline (gate windows from gateWindow)
  pipelineVis: [14.6, 35.6] as const,
  dimPipeline: [14.4, 15.6, 34.8, 35.8] as const,
  intentResult: [gA(0) + 1.0, gA(0) + 3.9] as const,
  scan: [gA(1) + 0.9, gA(1) + 3.0] as const,
  candidatesOn: gA(1) + 1.9,
  candidatesLabel: [gA(1) + 2.1, gA(1) + 4.05] as const,
  kpiStep: [gA(2) + 0.9, gA(2) + 3.95] as const,
  dupStep: [gA(3) + 0.9, gA(3) + 3.9] as const,
  reuse: [gA(4) + 0.9, gA(4) + 3.85] as const,
  gap: [gA(4) + 1.3, gA(4) + 3.95] as const,
  // 04 governance
  boundaryVis: [35.1, 47.6] as const,
  dimGov: [35.0, 36.4, 46.6, 48.0] as const,
  toBoundary: [35.0, 36.6] as const,
  zones: [36.0, 46.8] as const,
  proposalLabel: [36.6, 41.5] as const,
  inbox: [38.4, 43.6] as const,
  inboxHover: 40.2,
  inboxPress: 40.9,
  approve: 41.4, // the decision lands after the Lead presses Approve
  through: [41.9, 43.1] as const,
  insightForm: [42.1, 43.0] as const,
  ttl: [43.2, 45.0] as const,
  insightLabel: [43.3, 46.9] as const,
  // 05 resolution
  organize: [46.9, 49.0] as const, // + per-tile stagger up to 0.5 s
  settle: [47.1, 49.3] as const,
  archiveLabel: [49.3, 51.0] as const,
  brand: [50.9, 51.6, 54.45, DURATION - 0.05] as const, // in, full, out start, gone
  veil: [50.7, 51.5, 54.45, DURATION - 0.05] as const,
};

export const APPROVE_T = T.approve;
export const brandOpacity = (t: number) =>
  smoothstep(T.brand[0], T.brand[1], t) * (1 - smoothstep(T.brand[2], T.brand[3], t));

export const pipelineVis = (t: number) => win(t, T.pipelineVis[0], T.pipelineVis[1], 0.7);
export const boundaryVis = (t: number) => win(t, T.boundaryVis[0], T.boundaryVis[1], 0.8);
export const gateActive = (i: number, t: number) => {
  const [a, b] = gateWindow(i);
  return win(t, a + GATE_APPROACH * 0.6, b + 0.1, 0.35);
};
export const activeGate = (t: number) =>
  t < GATE_START || t >= GATE_START + GATES.length * GATE_STEP
    ? -1
    : Math.floor((t - GATE_START) / GATE_STEP);

// ---------------------------------------------------------------- chapters & notes

export interface Chapter {
  id: string;
  index: string;
  title: string;
  start: number;
  end: number;
}

export const CHAPTERS: Chapter[] = [
  { id: "sprawl", index: "01", title: "Analytics sprawl", start: 0, end: 8 },
  { id: "request", index: "02", title: "A business request", start: 8, end: 15 },
  { id: "pipeline", index: "03", title: "Mastra investigation", start: 15, end: 35 },
  { id: "approval", index: "04", title: "Human governance and approval", start: 35, end: 47 },
  { id: "governed", index: "05", title: "Resolution", start: 47, end: DURATION },
];

export function chapterAt(t: number): number {
  for (let i = CHAPTERS.length - 1; i >= 0; i--) if (t >= CHAPTERS[i].start) return i;
  return 0;
}

// Spoken subtitles come from the narration cue manifest (src/subtitles.ts).
// These are small informational notes shown under the subtitle line; they are
// not narration and are not spoken.
export interface Note {
  start: number;
  end: number;
  text: string;
}

export const NOTES: Note[] = [
  { start: 41.0, end: 46.7, text: "No automatic approvals · every decision is audited" },
  { start: 47.4, end: 51.0, text: "Illustrative outcome, not the result of one request" },
];

// ---------------------------------------------------------------- camera

// Pipeline shots: settle on each gate for its action and hold, drift slightly,
// then move during the next approach. Recommend pulls back to show the reuse
// candidates and the gap together.
const gateShot = (i: number): { pos: Vec3; target: Vec3 } =>
  i === 4
    ? { pos: [3.4, 3.3, 18.6], target: [3.0, 1.5, 2.4] }
    : {
        pos: [gateX(i) + 0.9, 2.95, 15.8],
        target: [gateX(i) + 0.3, 1.45, 2.8],
      };

const pipelinePos: Key[] = [];
const pipelineTarget: Key[] = [];
for (let i = 0; i < GATES.length; i++) {
  const [a, b] = gateWindow(i);
  const s = gateShot(i);
  pipelinePos.push({ t: a + 0.95, v: s.pos }, { t: b - 0.25, v: [s.pos[0] + 0.3, s.pos[1], s.pos[2] - 0.2] });
  pipelineTarget.push({ t: a + 0.95, v: s.target }, { t: b - 0.25, v: [s.target[0] + 0.2, s.target[1], s.target[2]] });
}

const CAM_POS: Key[] = [
  { t: 0, v: [0, 3.2, 33] },
  { t: 7.6, v: [3.6, 2.6, 25.5] },
  { t: 10.4, v: [-6.4, 2.6, 18.6] },
  { t: 12.0, v: [-6.6, 2.35, 15.9] },
  { t: 14.4, v: [-6.8, 2.3, 15.4] },
  ...pipelinePos,
  { t: 36.6, v: [8.3, 2.4, 15.6] },
  { t: 46.6, v: [8.7, 2.3, 14.9] },
  { t: 49.4, v: [0, 2.9, 22.5] },
  { t: DURATION, v: [0, 2.5, 20.4] },
];

const CAM_TARGET: Key[] = [
  { t: 0, v: [0, 0.4, -2.5] },
  { t: 7.6, v: [0, 0.6, -2] },
  { t: 10.4, v: [-9.6, 2.2, 7.2] },
  { t: 12.0, v: [-8.2, 1.7, 4.3] },
  { t: 14.4, v: [-8.2, 1.6, 4.2] },
  ...pipelineTarget,
  { t: 36.6, v: [9.9, 1.6, 4] },
  { t: 46.6, v: [10.2, 1.55, 4] },
  { t: 49.4, v: [0, -0.15, -2] },
  { t: DURATION, v: [0, -0.15, -2] },
];

export const cameraPos = (t: number) => eased(CAM_POS, t);
export const cameraTarget = (t: number) => eased(CAM_TARGET, t);

// ---------------------------------------------------------------- estate

export function organizeK(i: number, t: number): number {
  const d = (estate.nodes[i].phase / (Math.PI * 2)) * 0.5;
  return smootherstep(T.organize[0] + d, T.organize[1] + d, t);
}

export function nodePosition(i: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const n = estate.nodes[i];
  const k = organizeK(i, t);
  const p = n.phase;
  const drift = 1 - k;
  out[0] = lerp(n.chaos[0] + Math.sin(t * 0.3 + p) * 0.2 * drift, n.order[0], k);
  out[1] = lerp(n.chaos[1] + Math.cos(t * 0.26 + p * 1.3) * 0.15 * drift, n.order[1], k);
  out[2] = lerp(n.chaos[2] + Math.sin(t * 0.21 + p * 0.7) * 0.16 * drift, n.order[2], k);
  return out;
}

// ---------------------------------------------------------------- protagonist

const REQUEST_FROM: Vec3 = [-12.5, 3.0, 11];
const REQUEST_AT: Vec3 = [-8.2, GATE_Y, GATE_Z];
const PROPOSAL_AT: Vec3 = [BOUNDARY_X - 0.95, GATE_Y, GATE_Z];
const INSIGHT_AT: Vec3 = [BOUNDARY_X + 1.9, GATE_Y, GATE_Z];

export type Mode = "hidden" | "request" | "token" | "proposal" | "insight";

export interface Protagonist {
  mode: Mode;
  pos: Vec3;
  /** 0..1 card presence (card vs token morph) */
  card: number;
  approved: number; // 0 -> 1 after the human decision
  ttl: number; // fraction of 30 TTL ticks drawn
  settle: number; // 0 -> 1 while it joins the governed grid
}

export function protagonist(t: number): Protagonist {
  if (t < T.requestIn)
    return { mode: "hidden", pos: REQUEST_FROM, card: 0, approved: 0, ttl: 0, settle: 0 };
  if (t < T.cardToToken[0]) {
    const k = smootherstep(T.requestIn, T.requestArrive, t);
    const p = lerp3(REQUEST_FROM, REQUEST_AT, k);
    p[1] += Math.sin(k * Math.PI) * 0.8;
    return { mode: "request", pos: p, card: 1, approved: 0, ttl: 0, settle: 0 };
  }
  if (t < T.toBoundary[0]) {
    const card = 1 - smoothstep(T.cardToToken[0], T.cardToToken[1], t);
    let pos: Vec3 = REQUEST_AT;
    for (let i = 0; i < GATES.length; i++) {
      const [a] = gateWindow(i);
      if (t >= a) {
        const from: Vec3 = i === 0 ? REQUEST_AT : [gateX(i - 1), GATE_Y, GATE_Z];
        const to: Vec3 = [gateX(i), GATE_Y, GATE_Z];
        pos = lerp3(from, to, smootherstep(a, a + GATE_APPROACH, t));
      }
    }
    return { mode: card > 0.02 ? "request" : "token", pos, card, approved: 0, ttl: 0, settle: 0 };
  }
  const approved = smoothstep(T.approve, T.approve + 0.6, t);
  const ttl = smoothstep(T.ttl[0], T.ttl[1], t);
  if (t < T.settle[0]) {
    const toBoundary = smootherstep(T.toBoundary[0], T.toBoundary[1], t);
    const through = smootherstep(T.through[0], T.through[1], t);
    const pos = lerp3(lerp3([gateX(4), GATE_Y, GATE_Z], PROPOSAL_AT, toBoundary), INSIGHT_AT, through);
    return {
      mode: through > 0.5 ? "insight" : "proposal",
      pos,
      card: toBoundary,
      approved,
      ttl,
      settle: 0,
    };
  }
  const settle = smootherstep(T.settle[0], T.settle[1], t);
  const pos = lerp3(INSIGHT_AT, estate.insightSlot, settle);
  return { mode: "insight", pos, card: 1, approved: 1, ttl: 1, settle };
}

// ---------------------------------------------------------------- 3D labels

export type LabelVariant = "callout" | "gate" | "zone";

export interface LabelDef {
  id: string;
  variant: LabelVariant;
  title: string;
  body?: string;
  tone?: "neutral" | "accent" | "warn" | "human";
  at: (t: number) => Vec3;
  opacity: (t: number) => number;
  /** 0..1, highlights the active pipeline gate */
  active?: (t: number) => number;
}

const tmp: Vec3 = [0, 0, 0];
const nodeAt = (i: number, dy = 0.28) => (t: number): Vec3 => {
  const p = nodePosition(i, t, tmp);
  return [p[0], p[1] + dy, p[2]];
};

function centroid(ids: number[], t: number): Vec3 {
  const c: Vec3 = [0, 0, 0];
  const p: Vec3 = [0, 0, 0];
  for (const i of ids) {
    nodePosition(i, t, p);
    c[0] += p[0] / ids.length;
    c[1] += p[1] / ids.length;
    c[2] += p[2] / ids.length;
  }
  return c;
}

const conflictEdge = estate.edges[estate.conflictShowcase];
const archiveIds = Array.from({ length: estate.nodes.length - ORIGINALS }, (_, k) => ORIGINALS + k);
const w = (r: readonly [number, number], fade = 0.45) => (t: number) => win(t, r[0], r[1], fade);

export const LABELS: LabelDef[] = [
  {
    id: "dup",
    variant: "callout",
    tone: "warn",
    title: "Duplicate dashboards",
    at: nodeAt(estate.dupShowcase, 0.42),
    opacity: w(T.dupLabel),
  },
  {
    id: "conflict",
    variant: "callout",
    tone: "warn",
    title: "Conflicting KPI definitions",
    at: (t) => {
      const a = nodePosition(conflictEdge.a, t);
      const b = nodePosition(conflictEdge.b, t);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.2, (a[2] + b[2]) / 2];
    },
    opacity: w(T.conflictLabel),
  },
  {
    id: "request",
    variant: "callout",
    tone: "human",
    title: "Business request · TEAM-REQ-01",
    body: "Net sales and forecast variance · Xarelto · North America, by country",
    at: (t) => {
      const p = protagonist(t).pos;
      return [p[0], p[1] + 0.75, p[2]];
    },
    opacity: w(T.requestLabel),
  },
  ...GATES.map<LabelDef>((g, i) => ({
    id: `gate-${i}`,
    variant: "gate",
    title: g.name,
    body: g.detail,
    at: () => [gateX(i), GATE_Y - 0.78, GATE_Z],
    opacity: (t) => win(t, GATE_START - 0.1 + i * 0.15, T.pipelineVis[1] - 0.3, 0.5),
    active: (t) => gateActive(i, t),
  })),
  {
    id: "intent",
    variant: "callout",
    tone: "accent",
    title: "Mapped KPIs: Net Sales · Forecast Variance",
    body: "Product Xarelto · market North America · by country",
    at: () => [gateX(0), GATE_Y + 0.85, GATE_Z],
    opacity: w(T.intentResult, 0.4),
  },
  {
    id: "candidates",
    variant: "callout",
    tone: "accent",
    title: "Catalog candidates for Net Sales",
    body: "Ranked by KPI and scope fit · candidates, not answers",
    at: (t) => {
      const c = centroid(estate.candidates, t);
      return [c[0], c[1] + 0.55, c[2]];
    },
    opacity: w(T.candidatesLabel, 0.4),
  },
  {
    id: "kpi-approved",
    variant: "callout",
    tone: "accent",
    title: "Approved definition",
    at: nodeAt(estate.kpiApproved, 0.34),
    opacity: w(T.kpiStep, 0.4),
  },
  {
    id: "kpi-variant",
    variant: "callout",
    tone: "warn",
    title: "Variant definition · flagged",
    at: nodeAt(estate.kpiVariant, 0.34),
    opacity: (t) => win(t, T.kpiStep[0] + 0.3, T.kpiStep[1], 0.4),
  },
  {
    id: "duplicates",
    variant: "callout",
    tone: "warn",
    title: "Existing copies and pending builds checked",
    at: () => [gateX(3), GATE_Y + 0.85, GATE_Z],
    opacity: (t) => win(t, T.dupStep[0] + 0.3, T.dupStep[1], 0.4),
  },
  {
    id: "reuse",
    variant: "callout",
    tone: "accent",
    title: "Reuse candidates for Net Sales",
    body: "Candidates, not guaranteed answers · the requester confirms reuse",
    at: (t) => {
      const c = centroid(estate.candidates, t);
      return [c[0], c[1] + 0.55, c[2]];
    },
    opacity: w(T.reuse, 0.4),
  },
  {
    id: "gap",
    variant: "callout",
    tone: "warn",
    title: "Gap: Forecast Variance, North America",
    body: "No candidate found · computability probed · a build can be proposed",
    at: () => [GAP_POS[0], GAP_POS[1] + 0.45, GAP_POS[2]],
    opacity: w(T.gap, 0.4),
  },
  {
    id: "zone-ai",
    variant: "zone",
    tone: "accent",
    title: "AI proposes",
    at: () => [BOUNDARY_X - 2.3, 3.05, GATE_Z],
    opacity: w(T.zones, 0.6),
  },
  {
    id: "zone-human",
    variant: "zone",
    tone: "human",
    title: "People decide",
    at: () => [BOUNDARY_X + 2.4, 3.05, GATE_Z],
    opacity: (t) => win(t, T.zones[0] + 0.3, T.zones[1], 0.6),
  },
  {
    id: "proposal",
    variant: "callout",
    tone: "warn",
    title: "Build proposal · nothing built yet",
    body: "Waiting for a Lead in the requester's region",
    at: (t) => {
      const p = protagonist(t).pos;
      return [p[0], p[1] - 0.85, p[2]];
    },
    opacity: w(T.proposalLabel, 0.4),
  },
  {
    id: "insight",
    variant: "callout",
    tone: "accent",
    title: "Approved Temporary insight · 30-day TTL",
    body: "Supported KPIs computed in code from source rows · provenance stored",
    at: (t) => {
      const p = protagonist(t).pos;
      return [p[0], p[1] - 1.0, p[2]];
    },
    opacity: w(T.insightLabel, 0.4),
  },
  {
    id: "archive",
    variant: "callout",
    tone: "neutral",
    title: "Archived per owner decision, never in bulk · restorable",
    at: (t) => {
      const c = centroid(archiveIds, t);
      return [c[0], c[1] - 0.45, c[2]];
    },
    opacity: w(T.archiveLabel, 0.4),
  },
];
