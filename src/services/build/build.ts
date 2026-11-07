// Build step (golden path step 4): turn a steward analysis that recommends a
// build into a proposal, and on a Lead's approval compute the insight from
// certified KPIs and register it as Temporary (30-day TTL).
//
// Reads the steward analysis and KPI computation (T14/T15) unchanged. Numbers
// come only from computeKpiByMarket over source rows (Rule 2); the LLM never
// produces them. Nothing is built without an approved proposal (Rule 1).
import type { Client } from "@libsql/client";
import {
  LifecycleError,
  POLICY_VERSION,
  appendAudit,
  getProposal,
  recordDecision,
  regionSteward,
  registerTemporaryTx,
  validateDecision,
  type BuildEvidence,
  type Db,
  type DecisionInput,
  type Proposal,
  type ProposalStatus,
} from "../lifecycle";
import { scopeIds } from "../semantic/computability";
import { computeKpiByMarket } from "../semantic/compute";
import type { KpiResult } from "../semantic/types";
import { analyzeRequest } from "../steward/analyze";
import { loadVocabulary } from "../steward/requests";
import type { Scope } from "../steward/types";
import { buildRecord, type BuildRecord } from "./status";

export type InsightResult = {
  kpiId: string;
  kpiName: string | null;
  unit: string | null;
  month: string;
  byMarket: ({ marketId: string } & Pick<
    KpiResult,
    "status" | "value" | "unit" | "reasons" | "issues" | "filters" | "provenance"
  >)[];
};

export type Insight = {
  id: string;
  proposalId: string;
  requestId: string;
  name: string;
  ownerId: string;
  scope: Scope;
  results: InsightResult[];
  builtOn: string;
  builtBy: string;
};

export type ProposeBuildResult =
  | { status: "proposed"; proposal: Proposal }
  | { status: "already_proposed"; proposal: Proposal }
  /**
   * T21: this request and scope already have an approved build. Nothing new is
   * stored. `build` reports the insight and its lifecycle state, which may be
   * archived (Temporary TTL expired); rebuilding after expiry is not an agreed
   * path (restore is), so it is refused too.
   */
  | { status: "already_built"; proposal: Proposal; build: BuildRecord }
  | { status: "not_proposed"; recommendation: string; rationale: string[] };

/** Region a scope's market belongs to: a region name, a market ID's region, or Global. */
async function scopeRegion(db: Db, market: string): Promise<string> {
  if (market === "Global") return "Global";
  const r = await db.execute({ sql: `SELECT region FROM Markets WHERE market_id = ?`, args: [market] });
  return (r.rows[0]?.region as string | undefined) ?? market;
}

// D12: Business_Requests has no requester, so unless one is given we pick the
// first active non-Lead, non-steward owner in the scope's region (our mapping, labelled).
async function defaultRequester(db: Db, region: string): Promise<string | null> {
  const r = await db.execute({
    sql: `SELECT owner_id FROM Owners WHERE status = 'active' AND scope = ?
          ORDER BY (role LIKE '%Lead%' OR role = 'Data Steward'), owner_id LIMIT 1`,
    args: [region],
  });
  return (r.rows[0]?.owner_id as string | undefined) ?? null;
}

/** D12 requester for a scope's market: our labelled team mapping, shared by builds and reuse confirmations. */
export async function mappedRequester(db: Db, market: string): Promise<string | null> {
  return defaultRequester(db, await scopeRegion(db, market));
}

async function ownerRow(db: Db, id: string) {
  const r = await db.execute({ sql: `SELECT owner_id, scope, status FROM Owners WHERE owner_id = ?`, args: [id] });
  return r.rows[0];
}

/**
 * Pending or approved build proposal for this request, request source and
 * scope, approved first. Rejected proposals do not count: a new proposal may
 * follow a rejection (existing versioning, INS-<request>-<n>).
 *
 * The request's identity is its ID plus the sheet it was loaded from, as
 * recorded in the stored F5 evidence (`source` entry naming that sheet and
 * listing the request ID). A pack request and a team-authored request that
 * share an ID and scope are different requests; the ID prefix is never used.
 */
async function existingBuild(
  db: Db,
  requestId: string,
  requestSheet: string,
  scope: Scope,
): Promise<{ id: string; status: ProposalStatus } | null> {
  const r = await db.execute({
    sql: `SELECT id, status FROM proposals WHERE type = 'build_temporary' AND status IN ('open', 'escalated', 'approved')
          AND json_extract(evidence, '$.requestId') = ? AND json_extract(evidence, '$.scope.product') = ?
          AND json_extract(evidence, '$.scope.market') = ?
          AND EXISTS (
            SELECT 1 FROM json_each(evidence, '$.source') src
            WHERE json_extract(src.value, '$.sheet') = ?
              AND EXISTS (SELECT 1 FROM json_each(src.value, '$.ids') i WHERE i.value = ?)
          )
          ORDER BY status = 'approved' DESC, created_on DESC, rowid DESC LIMIT 1`,
    args: [requestId, scope.product, scope.market, requestSheet, requestId],
  });
  const row = r.rows[0];
  return row ? { id: row.id as string, status: row.status as ProposalStatus } : null;
}

// Submissions through one client run their check-and-store one at a time.
// Without this, concurrent calls race to BEGIN IMMEDIATE: the losers fail with
// SQLITE_BUSY (no busy timeout is set), and with @libsql/client 0.18 such a
// failure was seen to leave a pooled connection that later fails COMMIT
// ("SQL statements in progress"). The write transaction still guards other
// processes; there the loser gets SQLITE_BUSY and stores nothing.
const submitQueue = new WeakMap<Client, Promise<unknown>>();

function serialised<T>(db: Client, fn: () => Promise<T>): Promise<T> {
  const run = (submitQueue.get(db) ?? Promise.resolve()).then(() => fn()); // the stored tail never rejects
  submitQueue.set(db, run.catch(() => undefined));
  return run;
}

/**
 * Runs the steward analysis and, only when it recommends a build, stores a
 * build_temporary proposal for the requester's team Lead (D13/D14).
 *
 * Duplicates (T21): a pending proposal for the same request (ID and source
 * sheet) and scope returns
 * already_proposed; an approved one returns already_built, whatever its
 * insight's lifecycle state. The check, the insight numbering and the insert
 * run in one write transaction (BEGIN IMMEDIATE), queued per client, so
 * concurrent submissions cannot both store a proposal.
 */
export async function proposeBuild(
  db: Client,
  input: { requestId: string; answer?: Scope; requesterId?: string },
  date: string,
): Promise<ProposeBuildResult> {
  const analysis = await analyzeRequest(db, input.requestId, input.answer);
  if (analysis.recommendation.kind !== "build_proposal" || !analysis.clarification.resolved) {
    return { status: "not_proposed", recommendation: analysis.recommendation.kind, rationale: analysis.recommendation.rationale };
  }
  const scope = analysis.clarification.resolved;
  const requestId = analysis.request.id;
  // F5: cite the sheet the analysis loaded the request from (Business_Requests
  // or the team-authored sheet). No fallback: a missing source is an error.
  const requestSheet = analysis.request.source?.sheet;
  if (!requestSheet) throw new LifecycleError(`Request ${requestId} has no source sheet; refusing to guess its provenance`, "invalid");

  const { existing, proposalId } = await serialised(db, async () => {
    const tx = await db.transaction("write");
    try {
      const existing = await existingBuild(tx, requestId, requestSheet, scope);
      const proposalId = existing ? null : await storeProposal(tx, analysis, scope, requestSheet, input.requesterId, date);
      await tx.commit();
      return { existing, proposalId };
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      tx.close();
    }
  });
  if (existing) {
    const proposal = (await getProposal(db, existing.id))!;
    if (existing.status === "approved") return { status: "already_built", proposal, build: (await buildRecord(db, existing.id))! };
    return { status: "already_proposed", proposal };
  }
  return { status: "proposed", proposal: (await getProposal(db, proposalId!))! };
}

/** Stores the proposal and its audit row inside the caller's write transaction; returns its ID. */
async function storeProposal(
  db: Db,
  analysis: Awaited<ReturnType<typeof analyzeRequest>>,
  scope: Scope,
  requestSheet: string,
  givenRequester: string | undefined,
  date: string,
): Promise<string> {
  const requestId = analysis.request.id;
  let requesterId = givenRequester?.trim() || null;
  const requesterSource: BuildEvidence["requesterSource"] = requesterId ? "given" : "team_mapping";
  if (!requesterId) requesterId = await defaultRequester(db, await scopeRegion(db, scope.market));
  if (!requesterId) throw new LifecycleError(`No active person found to act as requester for ${requestId}`, "invalid");
  const requester = await ownerRow(db, requesterId);
  if (!requester || requester.status !== "active") {
    throw new LifecycleError(`Requester ${requesterId} is not an active owner`, "invalid");
  }

  // Approver: any active Lead in the requester's region except the requester; else the region's steward.
  const leads = await db.execute({
    sql: `SELECT owner_id FROM Owners WHERE role LIKE '%Lead%' AND status = 'active' AND scope = ? AND owner_id != ? ORDER BY owner_id`,
    args: [requester.scope as string, requesterId],
  });
  const steward = leads.rows.length ? null : await regionSteward(db, requesterId);
  const approvers = leads.rows.length ? leads.rows.map((r) => r.owner_id as string) : steward ? [steward] : [];

  const names = new Map(analysis.kpiChecks.flatMap((k) => (k.approved ? [[k.approved.id, k.approved.name] as const] : [])));
  const kpis = analysis.computability.map((c) => ({
    kpiId: c.kpiId,
    name: names.get(c.kpiId) ?? null,
    unit: c.probe?.byMarket[0]?.unit ?? null,
    status: c.status,
  }));
  const gaps = analysis.metricCoverage
    .filter((m) => m.assetIds.length === 0)
    .map((m) => `${m.canonicalMetric}${m.approvedKpiId ? ` (${m.approvedKpiId})` : ""}`);

  const count = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM proposals WHERE type = 'build_temporary' AND json_extract(evidence, '$.requestId') = ?`,
    args: [requestId],
  });
  const insightId = `INS-${requestId}-${Number(count.rows[0]?.n ?? 0) + 1}`;
  const proposalId = `PRP-${insightId}`;
  const evidence: BuildEvidence = {
    kind: "build",
    requestId,
    requestText: analysis.request.text,
    scope,
    requesterId,
    requesterSource,
    kpis,
    gaps,
    rationale: analysis.recommendation.rationale,
    source: [
      { sheet: requestSheet, ids: [requestId] },
      { sheet: "KPI_Catalog", ids: kpis.map((k) => k.kpiId) },
    ],
  };
  const rationale =
    `No existing asset covers ${gaps.join(", ") || "the request"} for ${scope.product} · ${scope.market}. ` +
    `Proposed: build a Temporary insight from certified KPIs ${kpis.map((k) => k.kpiId).join(", ")} ` +
    `for ${requesterId}. Expires after 30 days unless used again.`;

  await db.execute({
    sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
          VALUES (?, 1, 'build_temporary', ?, ?, ?, ?, 'open', ?, NULL)`,
    args: [proposalId, JSON.stringify([insightId]), rationale, JSON.stringify(evidence), JSON.stringify(approvers), date],
  });
  await appendAudit(db, {
    simDate: date,
    actor: "steward",
    action: "build_proposed",
    assetId: insightId,
    proposalId,
    policyVersion: POLICY_VERSION,
    rationale,
    evidence,
  });
  return proposalId;
}

async function latestFactMonth(db: Client): Promise<string> {
  const r = await db.execute(`SELECT max(month) AS month FROM Product_Market_Monthly`);
  const month = r.rows[0]?.month;
  if (!month) throw new LifecycleError("No facts to build from", "invalid");
  return String(month);
}

/** Computes every proposed KPI per market at the latest month (same grain as the computability probe). */
async function computeInsight(db: Client, evidence: BuildEvidence): Promise<InsightResult[]> {
  const ids = scopeIds(evidence.scope, await loadVocabulary(db));
  if (!ids) throw new LifecycleError(`Scope ${evidence.scope.product} · ${evidence.scope.market} is not in the catalog`, "invalid");
  const month = await latestFactMonth(db);
  const out: InsightResult[] = [];
  for (const k of evidence.kpis) {
    const byMarket = await computeKpiByMarket(db, { kpiId: k.kpiId, productIds: ids.productIds, marketIds: ids.marketIds, month });
    out.push({
      kpiId: k.kpiId,
      kpiName: byMarket[0]?.result.kpiName ?? k.name,
      unit: byMarket[0]?.result.unit ?? k.unit,
      month,
      byMarket: byMarket.map(({ marketId, result: r }) => ({
        marketId,
        status: r.status,
        value: r.value,
        unit: r.unit,
        reasons: r.reasons,
        issues: r.issues,
        filters: r.filters,
        provenance: r.provenance,
      })),
    });
  }
  return out;
}

/** A Lead's decision on a build proposal. Approve computes and registers the Temporary insight. */
export async function decideBuild(db: Client, input: DecisionInput, date: string): Promise<{ proposal: Proposal; insight: Insight | null }> {
  const draft = await getProposal(db, input.proposalId);
  if (!draft) throw new LifecycleError(`Unknown proposal ${input.proposalId}`, "not_found");
  if (draft.type !== "build_temporary") throw new LifecycleError(`${draft.id} is not a build proposal`, "invalid");
  const evidence = draft.evidence as BuildEvidence;
  // Compute before the write transaction; the services read through the client.
  const results = input.action === "approve" ? await computeInsight(db, evidence) : [];

  const tx = await db.transaction("write");
  let insight: Insight | null = null;
  try {
    const { p, reason } = await validateDecision(tx, input);
    await recordDecision(tx, p, input, reason, date);
    if (input.action === "approve") {
      const insightId = p.assetIds[0];
      insight = {
        id: insightId,
        proposalId: p.id,
        requestId: evidence.requestId,
        name: `${evidence.scope.product} · ${evidence.scope.market}: ${results.map((r) => r.kpiName ?? r.kpiId).join(", ")}`,
        ownerId: evidence.requesterId,
        scope: evidence.scope,
        results,
        builtOn: date,
        builtBy: input.actor,
      };
      await tx.execute({
        sql: `INSERT INTO insights (id, proposal_id, request_id, name, owner_id, scope, results, built_on, built_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          insight.id,
          p.id,
          insight.requestId,
          insight.name,
          insight.ownerId,
          JSON.stringify(insight.scope),
          JSON.stringify(results),
          date,
          input.actor,
        ],
      });
      await registerTemporaryTx(
        tx,
        { assetId: insightId, name: insight.name, ownerId: insight.ownerId, approvedBy: input.actor, proposalId: p.id },
        date,
      );
      const computed = results.flatMap((r) => r.byMarket).filter((m) => m.status === "computed").length;
      const total = results.flatMap((r) => r.byMarket).length;
      await appendAudit(tx, {
        simDate: date,
        actor: input.actor,
        action: "insight_built",
        assetId: insightId,
        proposalId: p.id,
        policyVersion: POLICY_VERSION,
        rationale:
          `Built from ${results.map((r) => r.kpiId).join(", ")} at ${results[0]?.month ?? "?"}: ` +
          `${computed} of ${total} KPI-market values computed from Product_Market_Monthly rows (actual-like). ` +
          `Values are synthetic challenge data.`,
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { proposal: (await getProposal(db, input.proposalId))!, insight };
}

type InsightRow = {
  id: string;
  proposal_id: string;
  request_id: string;
  name: string;
  owner_id: string;
  scope: string;
  results: string;
  built_on: string;
  built_by: string;
};

const toInsight = (r: InsightRow): Insight => ({
  id: r.id,
  proposalId: r.proposal_id,
  requestId: r.request_id,
  name: r.name,
  ownerId: r.owner_id,
  scope: JSON.parse(r.scope),
  results: JSON.parse(r.results),
  builtOn: r.built_on,
  builtBy: r.built_by,
});

export async function listInsights(db: Client): Promise<Insight[]> {
  const r = await db.execute(`SELECT * FROM insights ORDER BY built_on, id`);
  return (r.rows as unknown as InsightRow[]).map(toInsight);
}

export async function getInsight(db: Client, id: string): Promise<Insight | null> {
  const r = await db.execute({ sql: `SELECT * FROM insights WHERE id = ?`, args: [id] });
  return r.rows[0] ? toInsight(r.rows[0] as unknown as InsightRow) : null;
}
