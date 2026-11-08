// run-request-pipeline (T23): the orchestrator's entry point for a stored
// request. Runs the request-pipeline workflow (intent → discovery → conflict →
// estate duplicate check → recommendation), which records step events for the
// Pipeline view, and returns the same compact analysis view as
// analyze-request plus the run and where it stopped.
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ensureLifecycle, tick } from "../../services/lifecycle";
import { createRequestPipeline, type PipelineResult, type Summarize } from "../workflows/request-pipeline";
import { duplicateView, type DuplicateView } from "./estate-views";
import { analysisView, passErrors, type AnalysisView } from "./steward-views";

export type PipelineRunView = {
  view: "pipeline-run/v1";
  runId: string;
  path: PipelineResult["path"];
  status: string;
  analysis: AnalysisView;
  duplicate: DuplicateView | null;
  next: string;
};

const NEXT: Record<string, string> = {
  reuse: "Waiting for the requester: 'Use this' on the reuse card logs the reuse and finishes the run.",
  build: "Waiting for the requester: 'Submit build proposal' sends it to a Lead; the run resumes after the decision.",
  clarify: "Waiting for a scope choice; then run the pipeline again with that option as answer.",
  restore: "Finished: an archived asset covers it; offer prepareRestore instead of a build.",
  pending: "Finished: the same build already waits for approval.",
  insufficient: "Finished: not enough evidence for reuse or a build.",
};

export function pipelineRunView(r: PipelineResult): PipelineRunView {
  return {
    view: "pipeline-run/v1",
    runId: r.runId,
    path: r.path,
    status: r.status,
    analysis: analysisView(r.analysis),
    duplicate: r.duplicate ? duplicateView(r.duplicate) : null,
    next: NEXT[r.path ?? ""] ?? "Finished.",
  };
}

async function lifecycleDate(db: Client): Promise<string> {
  await ensureLifecycle(db);
  return (await tick(db)).date;
}

export function createPipelineTools(
  getDb: () => Client,
  opts: { today?: (db: Client) => Promise<string>; summarize?: Summarize } = {},
) {
  const pipeline = createRequestPipeline({ getDb, today: opts.today ?? lifecycleDate, summarize: opts.summarize });
  const json = (value: unknown) => ({ type: "json" as const, value });
  const view = passErrors(pipelineRunView);

  const runRequestPipeline = createTool({
    id: "run-request-pipeline",
    description:
      "Runs the governed request pipeline for a stored request (REQ-…, TEAM-REQ-…, DRAFT-…): parse intent, " +
      "discovery over the catalog, KPI conflict check, estate duplicate check, recommendation. The Pipeline view shows " +
      "it live. Returns the authoritative analysis (same as analyzeRequest), the estate duplicate check and where the run " +
      "waits. If clarification is needed, call again with the chosen option as answer. It proposes and approves nothing.",
    inputSchema: z.object({
      requestId: z.string().trim().min(1).max(64).describe("Stored request ID, e.g. REQ-0001 or DRAFT-001"),
      answer: z
        .object({ product: z.string().trim().min(1).max(100), market: z.string().trim().min(1).max(100) })
        .nullish()
        .describe("Only after a clarification: the chosen option's exact product and market"),
    }),
    execute: async ({ requestId, answer }) => pipeline.run({ requestId, answer }),
    toModelOutput: (x: unknown) => json(view(x as PipelineResult)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as PipelineResult) } },
  });

  return { runRequestPipeline, workflow: pipeline.workflow };
}
