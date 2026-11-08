// Request pipeline workflow (T23): the analysis leg of the Miro page-2
// sequence as a Mastra workflow. Each step records step events
// (services/pipeline) so the Pipeline view can draw the run live:
//
//   Analyst → Orchestrator: question; Orchestrator: parse intent
//   Orchestrator → Discovery agent → Metadata catalog: hybrid search
//   Discovery agent → Semantic layer: compare definitions
//   Discovery agent → Orchestrator: candidates + conflict + reasoning
//   Orchestrator → Analyst: suggest reuse / propose a build
//
// The run then waits for a person: "Use this" (reuse) or "Submit build
// proposal" then a Lead's approval (build). Those continue the same run
// through services/pipeline (onReuseConfirmed, onBuildProposed,
// onBuildDecided). All facts come from the deterministic services; the
// Discovery and Conflict agents only word the one-line finding, with a
// template fallback.
import type { Client } from "@libsql/client";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { checkDuplicate, type DuplicateCheck } from "../../services/estate";
import { emit, getRun, startRun, updateRun, type Agent, type RunPath } from "../../services/pipeline";
import { analyzeRequest } from "../../services/steward/analyze";
import type { StewardAnalysis } from "../../services/steward/types";

/** Words a one-line finding for an agent from deterministic facts; returns the fallback on any failure. */
export type Summarize = (agent: Agent, facts: Record<string, unknown>, fallback: string) => Promise<string>;

export const templateSummary: Summarize = async (_agent, _facts, fallback) => fallback;

export type PipelineDeps = {
  getDb: () => Client;
  today: (db: Client) => Promise<string>;
  summarize?: Summarize;
};

const Carry = z.object({
  runId: z.string(),
  requestId: z.string(),
  answer: z.object({ product: z.string(), market: z.string() }).nullish(),
  analysis: z.any(),
  duplicate: z.any().nullish(),
  stop: z.boolean(),
});
type CarryT = Omit<z.infer<typeof Carry>, "analysis" | "duplicate"> & { analysis: StewardAnalysis; duplicate?: DuplicateCheck | null };

export type PipelineResult = {
  runId: string;
  path: RunPath;
  status: string;
  analysis: StewardAnalysis;
  duplicate: DuplicateCheck | null;
};

const approvedIds = (a: StewardAnalysis) => a.kpiChecks.flatMap((k) => (k.approved ? [k.approved.id] : []));

export function createRequestPipeline(deps: PipelineDeps) {
  const summarize = deps.summarize ?? templateSummary;

  const intent = createStep({
    id: "intent",
    inputSchema: z.object({ runId: z.string(), requestId: z.string(), answer: z.object({ product: z.string(), market: z.string() }).nullish() }),
    outputSchema: Carry,
    execute: async ({ inputData }) => {
      const db = deps.getDb();
      const { runId, requestId, answer } = inputData;
      const a = await analyzeRequest(db, requestId, answer ?? undefined);
      await emit(db, runId, { step: "intent", agent: "Analyst", status: "done", summary: `"${a.request.text}"`, evidence: [a.request.id] });
      const metrics = a.kpiChecks.map((k) => k.canonicalMetric);
      const scope = a.clarification.resolved;
      await updateRun(db, runId, { scope });
      if (!scope) {
        await emit(db, runId, {
          step: "intent",
          agent: "Orchestrator",
          status: "done",
          summary: `Metrics: ${metrics.join(", ") || "none found"}; scope unclear`,
          evidence: [a.request.id],
        });
        await emit(db, runId, {
          step: "clarify",
          agent: "Orchestrator",
          status: "waiting_input",
          summary: a.clarification.question ?? "Which scope is meant?",
          evidence: (a.clarification.options ?? []).map((o) => `${o.product} · ${o.market}`),
        });
        await updateRun(db, runId, { status: "waiting_input", path: "clarify" });
        return { runId, requestId, answer, analysis: a, duplicate: null, stop: true };
      }
      await emit(db, runId, {
        step: "intent",
        agent: "Orchestrator",
        status: "done",
        summary: `Parsed: ${metrics.join(", ") || "no known metric"} · ${scope.product} · ${scope.market}`,
        evidence: [a.request.id, ...approvedIds(a)],
      });
      return { runId, requestId, answer, analysis: a, duplicate: null, stop: false };
    },
  });

  const discovery = createStep({
    id: "discovery",
    inputSchema: Carry,
    outputSchema: Carry,
    execute: async ({ inputData }) => {
      const c = inputData as CarryT;
      if (c.stop) return c;
      const db = deps.getDb();
      const a = c.analysis;
      await emit(db, c.runId, { step: "discovery", agent: "Orchestrator", status: "done", summary: "Find related assets" });
      await emit(db, c.runId, { step: "discovery", agent: "Discovery agent", status: "done", summary: "Hybrid search (keyword + vectors)" });
      const definitions = a.kpiChecks.reduce((n, k) => n + k.variants.length, 0);
      const complete = a.candidates.filter((x) => x.coversAllMetrics).length;
      const fallback = `${a.candidates.length} dashboards, ${definitions} metric definitions${complete ? ` (${complete} cover everything)` : ""}`;
      const summary = await summarize(
        "Discovery agent",
        {
          dashboardsFound: a.candidates.length,
          completeMatches: complete,
          metricDefinitions: definitions,
          top: a.candidates.slice(0, 3).map((x) => ({ id: x.assetId, name: x.name, coversAllMetrics: x.coversAllMetrics })),
        },
        fallback,
      );
      await emit(db, c.runId, {
        step: "discovery",
        agent: "Metadata catalog",
        status: "done",
        summary,
        // "#name=value" entries are counts for the storyboard's counters.
        evidence: [...a.candidates.slice(0, 5).map((x) => x.assetId), `#dashboards=${a.candidates.length}`, `#definitions=${definitions}`],
      });
      return c;
    },
  });

  const conflict = createStep({
    id: "conflict",
    inputSchema: Carry,
    outputSchema: Carry,
    execute: async ({ inputData }) => {
      const c = inputData as CarryT;
      if (c.stop) return c;
      const db = deps.getDb();
      const checks = c.analysis.kpiChecks;
      await emit(db, c.runId, {
        step: "conflict",
        agent: "Discovery agent",
        status: "done",
        summary: `Compare ${checks.map((k) => `"${k.canonicalMetric}"`).join(", ") || "metric"} definitions`,
      });
      const conflicts = checks.filter((k) => k.conflict);
      const fallback = conflicts.length
        ? `Conflict: ${conflicts
            .map((k) => `${k.canonicalMetric} ${k.approved?.id ?? "?"} vs ${k.variants.filter((v) => v.id !== k.approved?.id).map((v) => v.id).join(", ")}`)
            .join("; ")}`
        : "No conflicting definitions";
      const summary = await summarize(
        "Conflict detector",
        {
          conflicts: conflicts.map((k) => ({
            metric: k.canonicalMetric,
            approved: k.approved?.id ?? null,
            variants: k.variants.filter((v) => v.id !== k.approved?.id).map((v) => ({ id: v.id, name: v.name, approval: v.approvalStatus })),
          })),
        },
        fallback,
      );
      await emit(db, c.runId, {
        step: "conflict",
        agent: "Semantic layer",
        status: "done",
        summary,
        evidence: [...conflicts.flatMap((k) => k.variants.map((v) => v.id)), `#conflicts=${conflicts.length}`],
      });
      return c;
    },
  });

  const duplicate = createStep({
    id: "duplicate",
    inputSchema: Carry,
    outputSchema: Carry,
    execute: async ({ inputData }) => {
      const c = inputData as CarryT;
      if (c.stop) return c;
      const db = deps.getDb();
      const a = c.analysis;
      const d = await checkDuplicate(db, { scope: a.clarification.resolved!, kpiIds: approvedIds(a) });
      const kind = {
        reuse_candidates: "catalog: reuse candidates found",
        build_proposal: "catalog: no full match",
        insufficient_evidence: "catalog: not enough evidence",
        clarify: "catalog: scope unclear",
      }[a.recommendation.kind];
      const estate = {
        reuse: "an active asset already covers it",
        pending: "the same build already waits for approval",
        restore: "only an archived asset covers it",
        partial: "partial overlaps only",
        none: "nothing similar",
      }[d.verdict];
      await emit(db, c.runId, {
        step: "duplicate",
        agent: "Discovery agent",
        status: "done",
        summary: `Candidates + conflict + reasoning: ${kind} · estate: ${estate}`,
        evidence: [...a.recommendation.evidence.map((e) => e.id).filter((x): x is string => !!x).slice(0, 5), ...d.active.map((x) => x.assetId)],
      });
      return { ...c, duplicate: d };
    },
  });

  const recommend = createStep({
    id: "recommend",
    inputSchema: Carry,
    outputSchema: Carry,
    execute: async ({ inputData }) => {
      const c = inputData as CarryT;
      if (c.stop) return c;
      const db = deps.getDb();
      const a = c.analysis;
      const d = c.duplicate ?? null;
      const conflicted = a.kpiChecks.some((k) => k.conflict) ? ", flag conflict" : "";
      const kind = a.recommendation.kind;

      if (kind === "reuse_candidates") {
        const best = a.candidates.find((x) => x.coversAllMetrics) ?? a.candidates[0];
        await emit(db, c.runId, {
          step: "recommend",
          agent: "Orchestrator",
          status: "done",
          summary: `Suggest reuse of ${best?.assetId ?? "a candidate"}${conflicted}`,
          evidence: best ? [best.assetId] : [],
        });
        await emit(db, c.runId, { step: "confirm_reuse", agent: "Analyst", status: "waiting_input", summary: "Use this dashboard?" });
        await updateRun(db, c.runId, { status: "waiting_input", path: "reuse" });
      } else if (kind === "build_proposal" && d && (d.verdict === "reuse" || d.verdict === "pending" || d.verdict === "restore")) {
        const path: RunPath = d.verdict === "reuse" ? "reuse" : d.verdict;
        await emit(db, c.runId, { step: "recommend", agent: "Orchestrator", status: "done", summary: d.rationale });
        await emit(db, c.runId, { step: "done", agent: "Orchestrator", status: "done", summary: "No build: the estate already covers it" });
        await updateRun(db, c.runId, { status: "done", path, assetId: d.active[0]?.assetId ?? d.archived[0]?.assetId ?? null });
      } else if (kind === "build_proposal") {
        await emit(db, c.runId, { step: "recommend", agent: "Orchestrator", status: "done", summary: `Nothing fits: propose a Temporary build${conflicted}` });
        await emit(db, c.runId, { step: "propose", agent: "Orchestrator", status: "waiting_input", summary: "Submit build proposal?" });
        await updateRun(db, c.runId, { status: "waiting_input", path: "build" });
      } else {
        // rationale[0] is the analysis's decision reason; later lines are supporting facts.
        await emit(db, c.runId, { step: "recommend", agent: "Orchestrator", status: "done", summary: `Not enough evidence: ${a.recommendation.rationale[0] ?? kind}` });
        await emit(db, c.runId, { step: "done", agent: "Orchestrator", status: "done", summary: "No reuse or build suggested" });
        await updateRun(db, c.runId, { status: "done", path: "insufficient" });
      }
      return c;
    },
  });

  const workflow = createWorkflow({
    id: "request-pipeline",
    inputSchema: z.object({ runId: z.string(), requestId: z.string(), answer: z.object({ product: z.string(), market: z.string() }).nullish() }),
    outputSchema: Carry,
  })
    .then(intent)
    .then(discovery)
    .then(conflict)
    .then(duplicate)
    .then(recommend)
    .commit();

  /** Starts a run, executes the analysis leg and returns where it stopped. */
  async function run(input: { requestId: string; answer?: { product: string; market: string } | null }): Promise<PipelineResult> {
    const db = deps.getDb();
    const started = await startRun(db, { requestId: input.requestId, date: await deps.today(db) });
    const wf = await workflow.createRun();
    const result = await wf.start({ inputData: { runId: started.runId, requestId: input.requestId, answer: input.answer ?? null } });
    if (result.status !== "success") {
      const message = result.status === "failed" ? String(result.error instanceof Error ? result.error.message : result.error) : result.status;
      await emit(db, started.runId, { step: "done", agent: "Orchestrator", status: "failed", summary: message });
      await updateRun(db, started.runId, { status: "failed" });
      throw result.status === "failed" && result.error instanceof Error ? result.error : new Error(message);
    }
    const out = result.result as CarryT;
    const final = await getRun(db, started.runId);
    return { runId: started.runId, path: final?.path ?? null, status: final?.status ?? "done", analysis: out.analysis, duplicate: out.duplicate ?? null };
  }

  return { workflow, run };
}
