// Build status (T21): what actually happened to a request's build, read from
// app-owned storage. Read-only and deterministic: no clock tick, no lifecycle
// processing, no audit row, no proposal. Every lookup runs in one read-only
// SQLite transaction, so a write cannot happen here and the answer is one
// consistent snapshot.
//
// Approval and lifecycle are separate facts and are reported separately: a
// proposal can be approved while the insight it built is archived after its
// Temporary TTL expired. The approval is never rewritten by the lifecycle.
//
// State is as stored, i.e. as of the last processed clock tick. Events that
// fall due after it (a TTL ending on the running clock) are not applied here.
import type { Client } from "@libsql/client";
import type { AssetStatus, BuildEvidence, Db, ProposalStatus, Tier } from "../lifecycle";
import type { InsightResult } from "./build";

export type BuildStatusQuery = { by: "request" | "proposal" | "insight"; id: string };

export type BuildRecord = {
  proposal: {
    id: string;
    version: number;
    status: ProposalStatus;
    requestId: string;
    /** Sheet the request was loaded from (F5), from the stored evidence; null when missing. */
    requestSourceSheet: string | null;
    scope: { product: string; market: string };
    kpiIds: string[];
    requesterId: string;
    requesterSource: BuildEvidence["requesterSource"];
    requiredApprovers: string[];
    createdOn: string;
    dueOn: string | null;
  };
  /** The recorded human decision on this proposal version; null while pending. */
  decision: { action: string; actor: string; simDate: string; reason: string | null } | null;
  insight: {
    id: string;
    /** True only when the insights table holds the computed result. */
    built: boolean;
    name: string | null;
    scope: { product: string; market: string } | null;
    requestId: string | null;
    proposalId: string | null;
    ownerId: string | null;
    builtOn: string | null;
    builtBy: string | null;
    /** Which KPIs were computed and for how many markets; values stay in the insight (Dashboard). */
    kpis: { kpiId: string; kpiName: string | null; month: string; computedMarkets: number; totalMarkets: number }[];
  };
  lifecycle: {
    /** True when the insight has an asset_state row (registered as an asset). */
    registered: boolean;
    status: AssetStatus | null;
    tier: Tier | null;
    ttlEnd: string | null;
    leaseEnd: string | null;
    prevTier: Tier | null;
    /** Latest lifecycle audit entry for the insight (registration, expiry, restore, promotion, renewal, retirement). */
    lastEvent: { action: string; simDate: string; actor: string; rationale: string } | null;
  };
};

export type BuildStatus = {
  query: BuildStatusQuery;
  found: boolean;
  /** The request the matched proposals belong to, when found. */
  requestId: string | null;
  /** Every matching build proposal, oldest first. */
  builds: BuildRecord[];
  summary: {
    proposals: number;
    pending: number;
    approved: number;
    rejected: number;
    built: number;
    active: number;
    archived: number;
  };
  /** Stored simulated date of the lifecycle clock (no tick is run to advance it). */
  clockDate: string | null;
  notes: string[];
};

const LIFECYCLE_ACTIONS = ["temporary_registered", "ttl_expired", "retired", "restored", "promoted", "renewed"];

type ProposalRow = {
  id: string;
  version: number;
  type: string;
  asset_ids: string;
  evidence: string;
  required_approvers: string;
  status: ProposalStatus;
  created_on: string;
  due_on: string | null;
};

const canon = (id: string) => id.trim().toUpperCase();

async function tableExists(db: Db, name: string): Promise<boolean> {
  const r = await db.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [name] });
  return r.rows.length > 0;
}

/** Full status of one stored build proposal: decision, insight and lifecycle state. Read-only. */
export async function buildRecord(db: Db, proposalId: string): Promise<BuildRecord | null> {
  const r = await db.execute({ sql: `SELECT * FROM proposals WHERE id = ? AND type = 'build_temporary'`, args: [proposalId] });
  return r.rows[0] ? toRecord(db, r.rows[0] as unknown as ProposalRow) : null;
}

async function toRecord(db: Db, p: ProposalRow): Promise<BuildRecord> {
  const ev = JSON.parse(p.evidence) as BuildEvidence;
  const insightId = (JSON.parse(p.asset_ids) as string[])[0];

  const d = await db.execute({
    sql: `SELECT action, actor, reason, sim_date FROM decisions WHERE proposal_id = ? AND version = ? ORDER BY rowid DESC LIMIT 1`,
    args: [p.id, p.version],
  });
  const dec = d.rows[0];

  const i = await db.execute({ sql: `SELECT * FROM insights WHERE id = ?`, args: [insightId] });
  const ins = i.rows[0];
  const results = ins ? (JSON.parse(ins.results as string) as InsightResult[]) : [];

  const s = await db.execute({ sql: `SELECT * FROM asset_state WHERE asset_id = ?`, args: [insightId] });
  const st = s.rows[0];
  const a = await db.execute({
    sql: `SELECT action, sim_date, actor, rationale FROM audit_log
          WHERE asset_id = ? AND action IN (${LIFECYCLE_ACTIONS.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 1`,
    args: [insightId, ...LIFECYCLE_ACTIONS],
  });
  const last = a.rows[0];

  return {
    proposal: {
      id: p.id,
      version: Number(p.version),
      status: p.status,
      requestId: ev.requestId,
      requestSourceSheet: ev.source?.find((x) => x.ids?.includes(ev.requestId))?.sheet ?? null,
      scope: ev.scope,
      kpiIds: ev.kpis.map((k) => k.kpiId),
      requesterId: ev.requesterId,
      requesterSource: ev.requesterSource,
      requiredApprovers: JSON.parse(p.required_approvers),
      createdOn: p.created_on,
      dueOn: p.due_on,
    },
    decision: dec
      ? { action: dec.action as string, actor: dec.actor as string, simDate: dec.sim_date as string, reason: (dec.reason as string | null) ?? null }
      : null,
    insight: {
      id: insightId,
      built: !!ins,
      name: (ins?.name as string | undefined) ?? null,
      scope: ins ? JSON.parse(ins.scope as string) : null,
      requestId: (ins?.request_id as string | undefined) ?? null,
      proposalId: (ins?.proposal_id as string | undefined) ?? null,
      ownerId: (ins?.owner_id as string | undefined) ?? null,
      builtOn: (ins?.built_on as string | undefined) ?? null,
      builtBy: (ins?.built_by as string | undefined) ?? null,
      kpis: results.map((k) => ({
        kpiId: k.kpiId,
        kpiName: k.kpiName,
        month: k.month,
        computedMarkets: k.byMarket.filter((m) => m.status === "computed").length,
        totalMarkets: k.byMarket.length,
      })),
    },
    lifecycle: {
      registered: !!st,
      status: (st?.status as AssetStatus | undefined) ?? null,
      tier: (st?.tier as Tier | undefined) ?? null,
      ttlEnd: (st?.ttl_end as string | null | undefined) ?? null,
      leaseEnd: (st?.lease_end as string | null | undefined) ?? null,
      prevTier: (st?.prev_tier as Tier | null | undefined) ?? null,
      lastEvent: last
        ? { action: last.action as string, simDate: last.sim_date as string, actor: last.actor as string, rationale: last.rationale as string }
        : null,
    },
  };
}

function summarize(builds: BuildRecord[]): BuildStatus["summary"] {
  const count = (f: (b: BuildRecord) => boolean) => builds.filter(f).length;
  return {
    proposals: builds.length,
    pending: count((b) => b.proposal.status === "open" || b.proposal.status === "escalated"),
    approved: count((b) => b.proposal.status === "approved"),
    rejected: count((b) => b.proposal.status === "rejected"),
    built: count((b) => b.insight.built),
    active: count((b) => b.lifecycle.status !== null && b.lifecycle.status !== "archived"),
    archived: count((b) => b.lifecycle.status === "archived"),
  };
}

async function lookup(db: Db, q: BuildStatusQuery): Promise<BuildStatus> {
  const query = { by: q.by, id: canon(q.id) };
  const empty = (notes: string[], clockDate: string | null = null): BuildStatus => ({
    query,
    found: false,
    requestId: null,
    builds: [],
    summary: summarize([]),
    clockDate,
    notes,
  });
  if (!query.id) return empty(["No identifier was given."]);
  for (const t of ["proposals", "decisions", "insights", "asset_state", "audit_log", "app_clock"]) {
    if (!(await tableExists(db, t))) return empty(["The lifecycle store is not initialised, so no proposal or insight exists yet."]);
  }
  const clock = await db.execute(`SELECT sim_date FROM app_clock WHERE id = 1`);
  const clockDate = (clock.rows[0]?.sim_date as string | undefined) ?? null;

  const where = {
    request: `json_extract(evidence, '$.requestId') = ?`,
    proposal: `id = ?`,
    insight: `json_extract(asset_ids, '$[0]') = ?`,
  }[query.by];
  const r = await db.execute({
    sql: `SELECT * FROM proposals WHERE type = 'build_temporary' AND ${where} ORDER BY created_on, rowid`,
    args: [query.id],
  });
  const rows = r.rows as unknown as ProposalRow[];

  if (rows.length === 0) {
    const notes: string[] = [];
    if (query.by === "request") notes.push(`No build proposal has been stored for ${query.id}.`);
    if (query.by === "proposal") {
      const other = await db.execute({ sql: `SELECT type FROM proposals WHERE id = ?`, args: [query.id] });
      notes.push(
        other.rows[0]
          ? `${query.id} is a ${other.rows[0].type as string} proposal, not a build proposal.`
          : `No proposal with ID ${query.id} exists.`,
      );
    }
    if (query.by === "insight") {
      const s = await db.execute({ sql: `SELECT origin FROM asset_state WHERE asset_id = ?`, args: [query.id] });
      notes.push(
        s.rows[0]
          ? `${query.id} is a ${s.rows[0].origin === "pack" ? "catalog" : "lifecycle"} asset, not an insight built from a build proposal.`
          : `No build proposal names insight ${query.id}.`,
      );
    }
    return empty(notes, clockDate);
  }

  const builds: BuildRecord[] = [];
  for (const row of rows) builds.push(await toRecord(db, row));
  const requestIds = [...new Set(builds.map((b) => b.proposal.requestId))];
  const notes: string[] = [];
  if (builds.length > 1) {
    notes.push(`${builds.length} build proposals match ${query.id}; each is listed separately with its own decision and lifecycle state.`);
  }
  for (const b of builds) {
    if (b.proposal.status === "approved" && !b.insight.built) {
      notes.push(`${b.proposal.id} is approved but no built insight ${b.insight.id} is stored.`);
    }
    if (b.insight.built && !b.lifecycle.registered) notes.push(`${b.insight.id} is built but has no lifecycle state.`);
  }
  return {
    query,
    found: true,
    requestId: requestIds.length === 1 ? requestIds[0] : null,
    builds,
    summary: summarize(builds),
    clockDate,
    notes,
  };
}

/**
 * Status of every build proposal for a request, or of one proposal or insight:
 * proposal state, the recorded decision, whether the insight was built, and its
 * current lifecycle state. Read-only.
 */
export async function getBuildStatus(db: Client, q: BuildStatusQuery): Promise<BuildStatus> {
  const tx = await db.transaction("read");
  try {
    return await lookup(tx, q);
  } finally {
    tx.close();
  }
}
