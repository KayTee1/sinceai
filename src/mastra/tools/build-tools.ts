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
// - Explicit, bound authorization (Codex F2/F3): the latest user message, read
//   from the agent's execution context (never the model's arguments or
//   reasoning), must be exactly one submit command (SUBMIT_COMMAND_SYNTAX) for
//   the same request ID the tool was called with, and name the same scope as
//   the tool's `answer` (or neither names one). A confirmed scope must also be
//   the scope the analysis resolves to. Anything else (questions, negations,
//   quotations, hypotheticals, extra sentences, another request or scope)
//   returns intent_required and stores nothing. There is no fuzzy matching:
//   unclear messages are refused, not guessed.
// - No requester input: the chat has no signed-in identity, so the requester
//   always comes from the service's region mapping (D12, labelled
//   "team_mapping"). The model cannot pick who requests, and so cannot steer
//   who approves.
//
// Request provenance (F5): the view labels the request with the sheet stored
// in the proposal's evidence (the sheet the loader read it from), never one
// inferred from the ID. A missing sheet is shown as "unknown" and listed in
// `knownIssues`, never defaulted to Business_Requests.
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { proposeBuild, type ProposeBuildResult } from "../../services/build/build";
import { ensureLifecycle, tick, type BuildEvidence, type Proposal } from "../../services/lifecycle";
import { analyzeRequest } from "../../services/steward/analyze";
import { TEAM_REQUEST_SHEET } from "../../services/steward/team-requests";
import { passErrors } from "./steward-views";

/** The only accepted submission syntax, shown to the model and the user. */
export const SUBMIT_COMMAND_SYNTAX = "Submit a build proposal for <REQUEST-ID> [with product <PRODUCT> and market <MARKET>]";

const ID = "[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*";
const NAME = "[A-Za-z0-9]+(?:[ /&-][A-Za-z0-9]+)*";
/**
 * Whole-message match only: one affirmative command, an optional final period,
 * nothing before or after. No question mark, quote, newline or second sentence.
 */
const SUBMIT_COMMAND = new RegExp(`^submit a build proposal for (${ID})(?: with product (${NAME}) and market (${NAME}))?\\.?$`, "i");

export type SubmitCommand = { requestId: string; scope: { product: string; market: string } | null };

const canonId = (id: string) => id.trim().toUpperCase();
const canonName = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
const sameScope = (a: { product: string; market: string }, b: { product: string; market: string }) =>
  canonName(a.product) === canonName(b.product) && canonName(a.market) === canonName(b.market);

/** Parse a standalone submit command; null for anything else. Spaces and tabs collapse; newlines do not. */
export function parseSubmitCommand(text: string): SubmitCommand | null {
  const m = SUBMIT_COMMAND.exec(text.trim().replace(/[ \t]+/g, " "));
  if (!m) return null;
  return { requestId: canonId(m[1]), scope: m[2] && m[3] ? { product: m[2], market: m[3] } : null };
}

export type AuthorizationFailure = "no_command" | "request_mismatch" | "scope_mismatch";

/**
 * Is this tool call exactly what the user's latest message commands? The
 * request ID must match (case-insensitive), and the tool's answer must equal
 * the commanded scope, or both must be absent.
 */
export function authorizeSubmission(
  userText: string | null,
  call: { requestId: string; answer?: { product: string; market: string } | null },
): { ok: true; command: SubmitCommand } | { ok: false; reason: AuthorizationFailure } {
  const command = userText === null ? null : parseSubmitCommand(userText);
  if (!command) return { ok: false, reason: "no_command" };
  if (command.requestId !== canonId(call.requestId)) return { ok: false, reason: "request_mismatch" };
  const answer = call.answer ?? null;
  if (!command.scope !== !answer) return { ok: false, reason: "scope_mismatch" };
  if (command.scope && answer && !sameScope(command.scope, answer)) return { ok: false, reason: "scope_mismatch" };
  return { ok: true, command };
}

const REFUSAL: Record<AuthorizationFailure, string> = {
  no_command: "the user's latest message is not a standalone submit command",
  request_mismatch: "the user's submit command names a different request than this call",
  scope_mismatch: "the product and market in this call are not the ones the user's submit command confirmed",
};

function intentRequired(reason: AuthorizationFailure): IntentRequired {
  return {
    status: "intent_required",
    reason,
    message:
      `No proposal was stored: ${REFUSAL[reason]}. Explain the analysis and tell the user that to submit they must send ` +
      `exactly: "${SUBMIT_COMMAND_SYNTAX}" (scope only for a request that needed clarification, as one of the offered options).`,
  };
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

type IntentRequired = { status: "intent_required"; reason: AuthorizationFailure; message: string };

export type ProposeBuildToolOutput = ProposeBuildResult | IntentRequired;

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
  | { view: "build-proposal/v1"; status: "intent_required"; reason: AuthorizationFailure; message: string };

const PENDING_NOTE =
  "Pending human approval. Nothing is built, approved or registered yet. An authorised Lead (or the region's data " +
  "steward once escalated) decides in the approval inbox; the requester cannot approve their own build.";

export const MISSING_REQUEST_SOURCE =
  "The stored proposal evidence names no source sheet for this request; its provenance is unknown.";

/** Compact chat view: the proposal's identity, scope, KPIs, approvers and status; no stored evidence sources. */
export function buildProposalView(o: ProposeBuildToolOutput): BuildProposalView {
  if (o.status === "intent_required") return { view: "build-proposal/v1", status: o.status, reason: o.reason, message: o.message };
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
  const requestSheet = ev.source?.find((s) => s.ids?.includes(ev.requestId))?.sheet ?? null;
  const teamAuthored = requestSheet === TEAM_REQUEST_SHEET;
  return {
    view: "build-proposal/v1",
    status: o.status,
    request: { id: ev.requestId, sourceSheet: requestSheet ?? "unknown", teamAuthored },
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
    knownIssues: requestSheet ? [] : [MISSING_REQUEST_SOURCE],
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
      `latest message is exactly "${SUBMIT_COMMAND_SYNTAX}", with the same request ID and scope. ` +
      "The backend re-runs the authoritative analysis and stores a proposal only if it still recommends a build; " +
      "otherwise it returns not_proposed. This never approves or builds anything: a human Lead decides in the " +
      "approval inbox. Pass `answer` only when the user's command names a product and market, copied exactly.",
    inputSchema: z.object({
      requestId: z.string().trim().min(1).max(64).describe("Stored business request ID, e.g. TEAM-REQ-01"),
      answer: z
        .object({ product: scopeName, market: scopeName })
        .nullish()
        .describe("Only when the user's submit command names a product and market: exactly those"),
    }),
    execute: async ({ requestId, answer }, context): Promise<ProposeBuildToolOutput> => {
      const userText = latestUserText((context as { agent?: { messages?: unknown } } | undefined)?.agent?.messages);
      const auth = authorizeSubmission(userText, { requestId, answer });
      if (!auth.ok) return intentRequired(auth.reason);
      const db = getDb();
      if (answer) {
        // A confirmed scope must be the one the analysis resolves to. For a
        // request without a scope conflict the service ignores `answer`, so
        // without this check a confirmed scope could silently differ from
        // the stored one. A non-offered option still throws here (T14).
        const resolved = (await analyzeRequest(db, requestId, answer)).clarification.resolved;
        if (!resolved || !sameScope(resolved, answer)) return intentRequired("scope_mismatch");
      }
      return proposeBuild(db, { requestId, answer: answer ?? undefined }, await today(db));
    },
    toModelOutput: (x: unknown) => json(view(x as ProposeBuildToolOutput)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as ProposeBuildToolOutput) } },
  });

  return { proposeBuild: proposeBuildTool };
}
