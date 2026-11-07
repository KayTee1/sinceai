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
  type DecisionInput,
  type Proposal,
} from "../lifecycle";
import { scopeIds } from "../semantic/computability";
import { computeKpiByMarket } from "../semantic/compute";
import type { KpiResult } from "../semantic/types";
import { analyzeRequest } from "../steward/analyze";
import { loadVocabulary } from "../steward/requests";
import type { Scope } from "../steward/types";

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
  | { status: "not_proposed"; recommendation: string; rationale: string[] };

/** Region a scope's market belongs to: a region name, a market ID's region, or Global. */
async function scopeRegion(db: Client, market: string): Promise<string> {
  if (market === "Global") return "Global";
  const r = await db.execute({ sql: `SELECT region FROM Markets WHERE market_id = ?`, args: [market] });
  return (r.rows[0]?.region as string | undefined) ?? market;
}

// D12: Business_Requests has no requester, so unless one is given we pick the
// first active non-Lead, non-steward owner in the scope's region (our mapping, labelled).
async function defaultRequester(db: Client, region: string): Promise<string | null> {
  const r = await db.execute({
    sql: `SELECT owner_id FROM Owners WHERE status = 'active' AND scope = ?
          ORDER BY (role LIKE '%Lead%' OR role = 'Data Steward'), owner_id LIMIT 1`,
    args: [region],
  });
  return (r.rows[0]?.owner_id as string | undefined) ?? null;
}

/** D12 requester for a scope's market: our labelled team mapping, shared by builds and reuse confirmations. */
export async function mappedRequester(db: Client, market: string): Promise<string | null> {
  return defaultRequester(db, await scopeRegion(db, market));
}

async function ownerRow(db: Client, id: string) {
  const r = await db.execute({ sql: `SELECT owner_id, scope, status FROM Owners WHERE owner_id = ?`, args: [id] });
  return r.rows[0];
}

/**
 * Runs the steward analysis and, only when it recommends a build, stores a
 * build_temporary proposal for the requester's team Lead (D13/D14).
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

  const pending = await db.execute({
    sql: `SELECT id FROM proposals WHERE type = 'build_temporary' AND status IN ('open', 'escalated')
          AND json_extract(evidence, '$.requestId') = ? AND json_extract(evidence, '$.scope.product') = ?
          AND json_extract(evidence, '$.scope.market') = ?`,
    args: [requestId, scope.product, scope.market],
  });
  if (pending.rows[0]) return { status: "already_proposed", proposal: (await getProposal(db, pending.rows[0].id as string))! };

  let requesterId = input.requesterId?.trim() || null;
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

  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
            VALUES (?, 1, 'build_temporary', ?, ?, ?, ?, 'open', ?, NULL)`,
      args: [proposalId, JSON.stringify([insightId]), rationale, JSON.stringify(evidence), JSON.stringify(approvers), date],
    });
    await appendAudit(tx, {
      simDate: date,
      actor: "steward",
      action: "build_proposed",
      assetId: insightId,
      proposalId,
      policyVersion: POLICY_VERSION,
      rationale,
      evidence,
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { status: "proposed", proposal: (await getProposal(db, proposalId))! };
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
