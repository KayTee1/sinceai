// Mastra adapter over the T17 build-proposal service (T16B).
//
// `propose-build` calls proposeBuild() unchanged. The service re-runs the
// authoritative steward analysis and stores a build_temporary proposal only
// when that analysis recommends a build (clarification and eligibility are
// checked there, not here). A proposal is not an approval: nothing is built or
// registered until a Lead decides in the approval inbox
// (POST /api/proposals/:id/decision). This module has no approve, reject or
// register path.
//
// Two guards are ours:
// - Explicit intent: the latest user message must ask to submit or propose a
//   build (SUBMIT_INTENT). The model cannot create a proposal on a turn where
//   the user only asked for an analysis, even if it calls the tool.
// - No requester input: the chat has no signed-in identity, so the requester
//   always comes from the service's region mapping (D12, labelled
//   "team_mapping"). The model cannot pick who requests, and so cannot steer
//   who approves.
//
// Known T17 defect, not worked around here: build.ts stores
// `{ sheet: "Business_Requests" }` as the request source for every build, so a
// TEAM-REQ-01 proposal's stored evidence and audit row cite the Bayer sheet.
// The view labels the request from the request loader and states the defect.
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { proposeBuild, type ProposeBuildResult } from "../../services/build/build";
import { ensureLifecycle, tick, type BuildEvidence, type Proposal } from "../../services/lifecycle";
import { TEAM_REQUEST_SHEET, isTeamRequest } from "../../services/steward/team-requests";
import { passErrors } from "./steward-views";

/**
 * The latest user message must ask for a build proposal to be submitted, e.g.
 * "Submit a build proposal for TEAM-REQ-01" or "Please propose the build".
 * Deliberately narrow: an analysis request ("Handle TEAM-REQ-01") never matches.
 */
export const SUBMIT_INTENT =
  /\b(submit|propose|file|raise|create|send|open)\b[^.?!\n]{0,40}\b(build|proposal)\b|\bbuild proposal\b[^.?!\n]{0,20}\b(submit|send|file|go ahead)\b/i;
const NEGATED = /\b(don'?t|do not|never|no need to|without)\b[^.?!\n]{0,20}\b(submit|propose|file|raise|create|send|open)\b/i;

export function hasSubmitIntent(text: string): boolean {
  return SUBMIT_INTENT.test(text) && !NEGATED.test(text);
}

type MessageLike = { role?: string; content?: unknown; parts?: unknown };

function textOf(m: MessageLike): string {
  const pieces: string[] = [];
  const collect = (x: unknown) => {
    if (typeof x === "string") pieces.push(x);
    else if (Array.isArray(x)) for (const p of x) collect(p);
    else if (x && typeof x === "object") {
      const o = x as { type?: string; text?: unknown; parts?: unknown; content?: unknown };
      if (o.type === "text" && typeof o.text === "string") pieces.push(o.text);
      else if (o.parts) collect(o.parts);
      else if (Array.isArray(o.content)) collect(o.content);
    }
  };
  collect(m.content ?? m.parts);
  return pieces.join(" ");
}

/** Text of the latest user message in the agent's conversation, or null outside an agent loop. */
export function latestUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as MessageLike;
    if (m?.role === "user") return textOf(m);
  }
  return null;
}

export type ProposeBuildToolOutput =
  | ProposeBuildResult
  | { status: "intent_required"; message: string };

export type BuildProposalView =
  | {
      view: "build-proposal/v1";
      status: "proposed" | "already_proposed";
      request: { id: string; sourceSheet: string; teamAuthored: boolean };
      proposal: {
        id: string;
        type: Proposal["type"];
        status: Proposal["status"];
        insightId: string | null;
        scope: BuildEvidence["scope"];
        kpis: { kpiId: string; name: string | null; status: string }[];
        gaps: string[];
        requesterId: string;
        requesterSource: BuildEvidence["requesterSource"];
        requiredApprovers: string[];
        createdOn: string;
      };
      next: string;
      knownIssues: string[];
    }
  | { view: "build-proposal/v1"; status: "not_proposed"; recommendation: string; rationale: string[]; next: string }
  | { view: "build-proposal/v1"; status: "intent_required"; message: string };

const PENDING_NOTE =
  "Pending human approval. Nothing is built, approved or registered yet. An authorised Lead (or the region's data " +
  "steward once escalated) decides in the approval inbox; the requester cannot approve their own build.";

export const BUILD_SOURCE_DEFECT =
  "Known T17 defect: the stored proposal evidence and audit row cite Business_Requests as the request source " +
  "(src/services/build/build.ts), although this request is team-authored. Owner: T17 build service.";

/** Compact chat view: the proposal's identity, scope, KPIs, approvers and status; no stored evidence sources. */
export function buildProposalView(o: ProposeBuildToolOutput): BuildProposalView {
  if (o.status === "intent_required") return { view: "build-proposal/v1", status: o.status, message: o.message };
  if (o.status === "not_proposed") {
    return {
      view: "build-proposal/v1",
      status: o.status,
      recommendation: o.recommendation,
      rationale: o.rationale,
      next: "No proposal was stored. The steward analysis does not recommend a build; follow its recommendation.",
    };
  }
  const p = o.proposal;
  const ev = p.evidence as BuildEvidence;
  const teamAuthored = isTeamRequest(ev.requestId);
  return {
    view: "build-proposal/v1",
    status: o.status,
    request: { id: ev.requestId, sourceSheet: teamAuthored ? TEAM_REQUEST_SHEET : "Business_Requests", teamAuthored },
    proposal: {
      id: p.id,
      type: p.type,
      status: p.status,
      insightId: p.assetIds[0] ?? null,
      scope: ev.scope,
      kpis: ev.kpis.map((k) => ({ kpiId: k.kpiId, name: k.name, status: k.status })),
      gaps: ev.gaps,
      requesterId: ev.requesterId,
      requesterSource: ev.requesterSource,
      requiredApprovers: p.requiredApprovers,
      createdOn: p.createdOn,
    },
    next: PENDING_NOTE,
    knownIssues: teamAuthored ? [BUILD_SOURCE_DEFECT] : [],
  };
}

/** Production date: the lifecycle clock, as POST /api/builds uses it (withLifecycle). */
async function lifecycleDate(db: Client): Promise<string> {
  await ensureLifecycle(db);
  return (await tick(db)).date;
}

const scopeName = z.string().trim().min(1).max(100);

export function createBuildTools(getDb: () => Client, opts: { today?: (db: Client) => Promise<string> } = {}) {
  const today = opts.today ?? lifecycleDate;
  const view = passErrors(buildProposalView);
  const json = (value: unknown) => ({ type: "json" as const, value });

  const proposeBuildTool = createTool({
    id: "propose-build",
    description:
      "Submits a build proposal for a stored business request into the human approval inbox. Use ONLY when the user's " +
      "latest message explicitly asks to submit or propose the build, after analyze-request recommended build_proposal. " +
      "The backend re-runs the authoritative analysis and stores a proposal only if it still recommends a build; " +
      "otherwise it returns not_proposed. This never approves or builds anything: a human Lead decides in the " +
      "approval inbox. For a request that needed clarification, pass the user's chosen option as `answer`.",
    inputSchema: z.object({
      requestId: z.string().trim().min(1).max(64).describe("Stored business request ID, e.g. TEAM-REQ-01"),
      answer: z
        .object({ product: scopeName, market: scopeName })
        .nullish()
        .describe("Only for a request that needed clarification: the option the user picked, exact product and market"),
    }),
    execute: async ({ requestId, answer }, context): Promise<ProposeBuildToolOutput> => {
      const userText = latestUserText((context as { agent?: { messages?: unknown } } | undefined)?.agent?.messages);
      if (userText === null || !hasSubmitIntent(userText)) {
        return {
          status: "intent_required",
          message:
            "No proposal was stored: the user's latest message does not explicitly ask to submit a build proposal. " +
            "Explain the analysis and ask whether they want to submit one.",
        };
      }
      const db = getDb();
      return proposeBuild(db, { requestId, answer: answer ?? undefined }, await today(db));
    },
    toModelOutput: (x: unknown) => json(view(x as ProposeBuildToolOutput)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as ProposeBuildToolOutput) } },
  });

  return { proposeBuild: proposeBuildTool };
}
