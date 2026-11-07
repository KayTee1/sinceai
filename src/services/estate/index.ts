// Estate reads for the orchestrator (T22): one view over imported catalog
// assets and app-built insights, with their lifecycle state. Discovery
// (steward/discovery.ts) reads only the imported catalog; these reads add
// what it misses: archived assets, app-built Temporary insights and build
// proposals already waiting. Read-only; deterministic SQL over the pack and
// the app tables.
import type { Client } from "@libsql/client";
import {
  getAssetAudit,
  getPortfolioCounts,
  listPendingProposals,
  nextDueEvent,
  regionSteward,
  type AuditEntry,
  type BuildEvidence,
  type PortfolioChanges,
  type PortfolioCounts,
} from "../lifecycle";
import { scopeFit } from "../steward/discovery";
import type { Scope } from "../steward/types";

export type EstateStatus = "active" | "lease_due" | "archived";

export type EstateAsset = {
  assetId: string;
  name: string;
  origin: "catalog" | "app";
  product: string;
  market: string;
  tier: string;
  status: EstateStatus;
  ownerId: string | null;
  ownerName: string | null;
  ownerActive: boolean;
  kpiIds: string[];
  leaseEnd: string | null;
  ttlEnd: string | null;
};

type Row = Record<string, unknown>;

export async function loadEstate(db: Client): Promise<EstateAsset[]> {
  const [catalog, maps, app] = await Promise.all([
    db.execute(`
      SELECT a.asset_id, a.asset_name, a.product_scope, a.market_scope, a.owner_id, a.endorsement,
             s.tier, s.status, s.lease_end, s.ttl_end, o.owner_name, o.status AS owner_status
      FROM Analytics_Assets a
      LEFT JOIN asset_state s ON s.asset_id = a.asset_id
      LEFT JOIN Owners o ON o.owner_id = a.owner_id
      ORDER BY a._source_row`),
    db.execute(`SELECT asset_id, kpi_id FROM Asset_KPI_Map ORDER BY _source_row`),
    db.execute(`
      SELECT i.id, i.name, i.scope, i.results, i.owner_id, s.tier, s.status, s.lease_end, s.ttl_end,
             o.owner_name, o.status AS owner_status
      FROM insights i
      JOIN asset_state s ON s.asset_id = i.id
      LEFT JOIN Owners o ON o.owner_id = i.owner_id
      ORDER BY i.built_on, i.id`),
  ]);
  const kpisByAsset = new Map<string, string[]>();
  for (const m of maps.rows) {
    const id = m.asset_id as string;
    kpisByAsset.set(id, [...new Set([...(kpisByAsset.get(id) ?? []), m.kpi_id as string])]);
  }
  const owner = (r: Row) => ({
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    ownerActive: r.owner_status === "active",
  });
  const fromCatalog: EstateAsset[] = catalog.rows.map((r) => ({
    assetId: r.asset_id as string,
    name: r.asset_name as string,
    origin: "catalog",
    product: r.product_scope as string,
    market: r.market_scope as string,
    tier: (r.tier as string | null) ?? "unknown",
    status: ((r.status as string | null) ?? "active") as EstateStatus,
    ...owner(r),
    kpiIds: kpisByAsset.get(r.asset_id as string) ?? [],
    leaseEnd: (r.lease_end as string | null) ?? null,
    ttlEnd: (r.ttl_end as string | null) ?? null,
  }));
  const fromApp: EstateAsset[] = app.rows.map((r) => {
    const scope = JSON.parse(r.scope as string) as Scope;
    const results = JSON.parse(r.results as string) as { kpiId: string }[];
    return {
      assetId: r.id as string,
      name: r.name as string,
      origin: "app",
      product: scope.product,
      market: scope.market,
      tier: r.tier as string,
      status: r.status as EstateStatus,
      ...owner(r),
      kpiIds: [...new Set(results.map((x) => x.kpiId))],
      leaseEnd: (r.lease_end as string | null) ?? null,
      ttlEnd: (r.ttl_end as string | null) ?? null,
    };
  });
  return [...fromCatalog, ...fromApp];
}

const fits = (a: EstateAsset, scope: Partial<Scope>) =>
  (!scope.product || scopeFit("product", scope.product, a.product) !== null) &&
  (!scope.market || scopeFit("market", scope.market, a.market) !== null);

export type EstateQuery = {
  product?: string;
  market?: string;
  kpiIds?: string[];
  /** Case-insensitive words that must all appear in the asset name. */
  text?: string;
  status?: "active" | "archived" | "any";
  limit?: number;
};

export type EstateHit = EstateAsset & { kpiMatches: string[]; coversAllKpis: boolean };

export type EstateSearchResult = { total: number; assets: EstateHit[] };

/** Assets whose scope covers the asked scope (exact or broader), ranked by KPI overlap, active first. */
export async function searchEstate(db: Client, q: EstateQuery): Promise<EstateSearchResult> {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kpiIds = q.kpiIds ?? [];
  const status = q.status ?? "any";
  const hits = (await loadEstate(db))
    .filter((a) => fits(a, q))
    .filter((a) => words.every((w) => a.name.toLowerCase().includes(w)))
    .filter((a) => status === "any" || (status === "archived" ? a.status === "archived" : a.status !== "archived"))
    .map((a) => {
      const kpiMatches = kpiIds.filter((k) => a.kpiIds.includes(k));
      return { ...a, kpiMatches, coversAllKpis: kpiIds.length > 0 && kpiMatches.length === kpiIds.length };
    })
    .filter((a) => kpiIds.length === 0 || a.kpiMatches.length > 0)
    .sort(
      (a, b) =>
        b.kpiMatches.length - a.kpiMatches.length ||
        Number(a.status === "archived") - Number(b.status === "archived") ||
        Number(b.origin === "app") - Number(a.origin === "app"),
    );
  return { total: hits.length, assets: hits.slice(0, q.limit ?? 10) };
}

export type DuplicateVerdict = "reuse" | "pending" | "restore" | "partial" | "none";

export type PendingBuild = { proposalId: string; requestId: string; scope: Scope; kpiIds: string[]; status: string };

export type DuplicateCheck = {
  scope: Scope;
  kpiIds: string[];
  /** reuse: an active asset covers every KPI; pending: the same build already waits for approval;
   *  restore: only an archived asset covers every KPI; partial: active assets cover some; none: nothing. */
  verdict: DuplicateVerdict;
  active: EstateHit[];
  archived: EstateHit[];
  partial: EstateHit[];
  pending: PendingBuild[];
  rationale: string;
};

/**
 * The gate before anything new is built: does an active or archived asset, an
 * app-built insight, or a waiting build proposal already cover this scope and
 * every KPI?
 */
export async function checkDuplicate(db: Client, input: { scope: Scope; kpiIds: string[] }): Promise<DuplicateCheck> {
  const { scope } = input;
  const kpiIds = [...new Set(input.kpiIds)];
  const { assets } = await searchEstate(db, { ...scope, kpiIds, status: "any", limit: 1000 });
  const full = assets.filter((a) => a.coversAllKpis);
  const active = full.filter((a) => a.status !== "archived");
  const archived = full.filter((a) => a.status === "archived");
  const partial = assets.filter((a) => !a.coversAllKpis && a.status !== "archived");

  const pending: PendingBuild[] = (await listPendingProposals(db))
    .filter((p) => p.type === "build_temporary")
    .map((p) => ({ p, ev: p.evidence as BuildEvidence }))
    .filter(
      ({ ev }) =>
        ev.scope.product === scope.product &&
        ev.scope.market === scope.market &&
        kpiIds.every((k) => ev.kpis.some((x) => x.kpiId === k)),
    )
    .map(({ p, ev }) => ({ proposalId: p.id, requestId: ev.requestId, scope: ev.scope, kpiIds: ev.kpis.map((k) => k.kpiId), status: p.status }));

  const verdict: DuplicateVerdict = active.length
    ? "reuse"
    : pending.length
      ? "pending"
      : archived.length
        ? "restore"
        : partial.length
          ? "partial"
          : "none";
  const label = `${scope.product} · ${scope.market} with ${kpiIds.join(", ") || "no KPIs"}`;
  const rationale = {
    reuse: `${active.map((a) => a.assetId).join(", ")} already cover ${label}; reuse instead of building.`,
    pending: `A build for ${label} already waits for approval (${pending.map((p) => p.proposalId).join(", ")}).`,
    restore: `Only archived assets cover ${label} (${archived.map((a) => a.assetId).join(", ")}); restore one instead of building.`,
    partial: `No asset covers all of ${label}; ${partial.length} active asset(s) cover part of it.`,
    none: `Nothing in the estate covers ${label}.`,
  }[verdict];
  return { scope, kpiIds, verdict, active, archived, partial, pending, rationale };
}

export type ArchivedAsset = EstateAsset & { archivedOn: string | null; archivedBecause: string | null; restoredTier: string };

/** Archived assets, newest first, with when and why they were archived (from the audit log). */
export async function listArchived(db: Client, q: Omit<EstateQuery, "status" | "kpiIds"> = {}): Promise<{ total: number; assets: ArchivedAsset[] }> {
  const { total, assets } = await searchEstate(db, { ...q, status: "archived", limit: 1000 });
  const prev = await db.execute(`SELECT asset_id, prev_tier, tier FROM asset_state WHERE status = 'archived'`);
  const prevTier = new Map(prev.rows.map((r) => [r.asset_id as string, ((r.prev_tier ?? r.tier) as string) ?? "unknown"]));
  const out: ArchivedAsset[] = [];
  for (const a of assets) {
    const last = (await getAssetAudit(db, a.assetId))
      .filter((e) => ["retired", "ttl_expired", "merged", "archived"].includes(e.action))
      .at(-1);
    out.push({
      ...a,
      archivedOn: last?.simDate ?? null,
      archivedBecause: last?.rationale ?? null,
      restoredTier: prevTier.get(a.assetId) ?? a.tier,
    });
  }
  out.sort((x, y) => (y.archivedOn ?? "").localeCompare(x.archivedOn ?? ""));
  return { total, assets: out.slice(0, q.limit ?? 10) };
}

export type AssetDetail = {
  asset: EstateAsset;
  usage: { appOpens: number; appViewers: number; lastOpened: string | null; packAvgMonthlyUsers: number | null };
  openProposals: { id: string; type: string; status: string; dueOn: string | null }[];
  timeline: Pick<AuditEntry, "simDate" | "actor" | "action" | "rationale">[];
};

export async function getAsset(db: Client, assetId: string): Promise<AssetDetail | null> {
  const id = assetId.trim().toUpperCase();
  const asset = (await loadEstate(db)).find((a) => a.assetId.toUpperCase() === id);
  if (!asset) return null;
  const [opens, pack, pending, audit] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS v, MAX(sim_date) AS last FROM usage_events WHERE asset_id = ? AND origin = 'app'`,
      args: [asset.assetId],
    }),
    db.execute({ sql: `SELECT AVG(unique_users) AS u FROM Asset_Usage WHERE asset_id = ?`, args: [asset.assetId] }),
    listPendingProposals(db),
    getAssetAudit(db, asset.assetId),
  ]);
  const u = pack.rows[0]?.u;
  return {
    asset,
    usage: {
      appOpens: Number(opens.rows[0]?.n ?? 0),
      appViewers: Number(opens.rows[0]?.v ?? 0),
      lastOpened: (opens.rows[0]?.last as string | null) ?? null,
      packAvgMonthlyUsers: u === null || u === undefined ? null : Math.round(Number(u)),
    },
    openProposals: pending
      .filter((p) => p.assetIds.includes(asset.assetId))
      .map((p) => ({ id: p.id, type: p.type, status: p.status, dueOn: p.dueOn })),
    timeline: audit.slice(-8).map((e) => ({ simDate: e.simDate, actor: e.actor, action: e.action, rationale: e.rationale })),
  };
}

export type Approver = { id: string; name: string; role: string; region: string; active: boolean };

export type Approvers = {
  /** For a build in this scope: active Leads in the scope's region; the region's steward if none. */
  build: Approver[] | null;
  /** For a lease review or retire of this asset: its owner, then the region's steward on escalation. */
  review: { owner: Approver | null; steward: Approver | null } | null;
  rationale: string;
};

async function person(db: Client, id: string | null): Promise<Approver | null> {
  if (!id) return null;
  const r = await db.execute({ sql: `SELECT owner_id, owner_name, role, scope, status FROM Owners WHERE owner_id = ?`, args: [id] });
  const x = r.rows[0];
  return x
    ? { id: x.owner_id as string, name: x.owner_name as string, role: x.role as string, region: x.scope as string, active: x.status === "active" }
    : null;
}

async function regionOf(db: Client, market: string): Promise<string> {
  if (market === "Global") return "Global";
  const r = await db.execute({ sql: `SELECT region FROM Markets WHERE market_id = ?`, args: [market] });
  return (r.rows[0]?.region as string | undefined) ?? market;
}

/** Who would decide: Leads for a build in a market's region; owner then steward for an asset's review. */
export async function whoApproves(db: Client, input: { market?: string; assetId?: string }): Promise<Approvers> {
  let build: Approver[] | null = null;
  let review: Approvers["review"] = null;
  const notes: string[] = [];
  if (input.market) {
    const region = await regionOf(db, input.market);
    const leads = await db.execute({
      sql: `SELECT owner_id FROM Owners WHERE status = 'active' AND scope = ? AND role LIKE '%Lead%' ORDER BY owner_id`,
      args: [region],
    });
    build = (await Promise.all(leads.rows.map((r) => person(db, r.owner_id as string)))).filter((x): x is Approver => !!x);
    if (build.length === 0) {
      const s = await db.execute({
        sql: `SELECT owner_id FROM Owners WHERE role = 'Data Steward' AND status = 'active' AND scope IN (?, 'Global') ORDER BY scope = 'Global', owner_id LIMIT 1`,
        args: [region],
      });
      const steward = await person(db, (s.rows[0]?.owner_id as string | undefined) ?? null);
      build = steward ? [steward] : [];
    }
    notes.push(`A build in ${region} is approved by ${build.map((b) => `${b.name} (${b.role})`).join(", ") || "nobody active"}; never by its requester.`);
  }
  const assetId = input.assetId?.trim().toUpperCase();
  if (assetId) {
    const a = (await loadEstate(db)).find((x) => x.assetId === assetId);
    if (a) {
      const owner = await person(db, a.ownerId);
      const steward = await person(db, await regionSteward(db, a.ownerId));
      review = { owner, steward };
      notes.push(
        `${a.assetId} reviews go to ${owner ? `${owner.name}${owner.active ? "" : " (inactive)"}` : "no owner"}, ` +
          `then escalate to ${steward?.name ?? "no active steward"} after 14 days (or at once without an active owner).`,
      );
    } else notes.push(`Unknown asset ${input.assetId}.`);
  }
  return { build, review, rationale: notes.join(" ") };
}

export type PortfolioSummary = {
  before: PortfolioCounts;
  now: PortfolioCounts;
  changes: PortfolioChanges;
  pending: { total: number; escalated: number; byType: Record<string, number> };
  nextEvent: { date: string; kind: string; id: string } | null;
};

export async function portfolioSummary(db: Client): Promise<PortfolioSummary> {
  const [counts, pending, next] = await Promise.all([getPortfolioCounts(db), listPendingProposals(db), nextDueEvent(db)]);
  const byType: Record<string, number> = {};
  for (const p of pending) byType[p.type] = (byType[p.type] ?? 0) + 1;
  return {
    ...counts,
    pending: { total: pending.length, escalated: pending.filter((p) => p.status === "escalated").length, byType },
    nextEvent: next,
  };
}
export { BLOAT_MIN_EXTRA, BLOAT_RATIO, proposeMerge, suggestMerge, type MergeSide, type MergeSuggestion, type MergeSuggestions, type MergeVerdict } from "./merge";
