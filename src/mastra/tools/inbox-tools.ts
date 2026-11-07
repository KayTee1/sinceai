// Read-only approval inbox for the live orchestrator (T21).
//
// The assistant can list and explain pending proposals, but it has no way to
// decide one. Approve and Reject are buttons on the proposal card in chat; a
// click goes to POST /api/proposals/:id/decision as a human approver, exactly
// like the side inbox. This module never writes to the database apart from the
// lifecycle tick that the inbox API also runs before reading.
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  ensureLifecycle,
  listPendingProposals,
  tick,
  type BuildEvidence,
  type Proposal,
  type ReviewEvidence,
} from "../../services/lifecycle";

const TYPES = ["renew", "retire", "promote", "build_temporary"] as const;

export type ProposalListItem = {
  id: string;
  type: Proposal["type"];
  status: Proposal["status"];
  assetId: string | null;
  assetName: string | null;
  /** Build proposals only: the business request it came from. */
  requestId: string | null;
  rationale: string;
  requiredApprovers: string[];
  createdOn: string;
  dueOn: string | null;
  /** Lease reviews only: usage facts the owner decides on. */
  usage: { appOpens90d: number; avgMonthlyUsers: number | null; ownerStatus: ReviewEvidence["ownerStatus"] } | null;
};

export type ProposalListResult = { total: number; proposals: ProposalListItem[] };
export type ProposalListView = ProposalListResult & { view: "proposal-list/v1"; shown: number; next: string };

/** At most this many proposals go to the model and the chat; `total` still counts all matches. */
export const PROPOSALS_SHOWN = 8;

const NEXT =
  "Each proposal is shown in chat as a card with Approve and Reject buttons. Only a human approver decides by " +
  "clicking them; you cannot approve, reject or register anything.";

export function proposalListView(r: ProposalListResult): ProposalListView {
  return { view: "proposal-list/v1", total: r.total, shown: Math.min(r.total, PROPOSALS_SHOWN), proposals: r.proposals.slice(0, PROPOSALS_SHOWN), next: NEXT };
}

async function assetNames(db: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await db.execute({
    sql: `SELECT asset_id, asset_name FROM Analytics_Assets WHERE asset_id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  return new Map(r.rows.map((x) => [x.asset_id as string, x.asset_name as string]));
}

function item(p: Proposal, names: Map<string, string>): ProposalListItem {
  const assetId = p.assetIds[0] ?? null;
  const ev = p.evidence;
  const build = "kind" in ev && ev.kind === "build" ? (ev as BuildEvidence) : null;
  const review = !("kind" in ev) ? (ev as ReviewEvidence) : null;
  return {
    id: p.id,
    type: p.type,
    status: p.status,
    assetId,
    assetName: assetId ? (names.get(assetId) ?? null) : null,
    requestId: build?.requestId ?? null,
    rationale: p.rationale,
    requiredApprovers: p.requiredApprovers,
    createdOn: p.createdOn,
    dueOn: p.dueOn,
    usage: review
      ? { appOpens90d: review.appOpens90d, avgMonthlyUsers: review.avgMonthlyUsers, ownerStatus: review.ownerStatus }
      : null,
  };
}

/** Production sync: bring the lifecycle up to the clock, as GET /api/proposals does (withLifecycle). */
async function syncLifecycle(db: Client): Promise<void> {
  await ensureLifecycle(db);
  await tick(db);
}

export function createInboxTools(getDb: () => Client, opts: { sync?: (db: Client) => Promise<void> } = {}) {
  const sync = opts.sync ?? syncLifecycle;
  const json = (value: unknown) => ({ type: "json" as const, value });

  const listPendingProposalsTool = createTool({
    id: "list-pending-proposals",
    description:
      "Read-only: lists proposals waiting in the approval inbox (lease renew/retire reviews, promotions and build " +
      "proposals), soonest due first. Optionally filter by type or to escalated ones only. Use it when the user asks " +
      "what is waiting, what needs a decision, or about a specific proposal. It never approves or rejects; the chat " +
      "shows each proposal as a card where a human approver decides.",
    inputSchema: z.object({
      type: z.enum(TYPES).nullish().describe("Only this proposal type"),
      escalatedOnly: z.boolean().nullish().describe("Only proposals escalated to a data steward"),
    }),
    execute: async ({ type, escalatedOnly }): Promise<ProposalListResult> => {
      const db = getDb();
      await sync(db);
      const all = (await listPendingProposals(db)).filter(
        (p) => (!type || p.type === type) && (!escalatedOnly || p.status === "escalated"),
      );
      const names = await assetNames(db, [...new Set(all.slice(0, PROPOSALS_SHOWN).flatMap((p) => p.assetIds.slice(0, 1)))]);
      return { total: all.length, proposals: all.map((p) => item(p, names)) };
    },
    toModelOutput: (x: unknown) => json(proposalListView(x as ProposalListResult)),
    transform: { display: { output: ({ output }: { output?: unknown }) => proposalListView(output as ProposalListResult) } },
  });

  return { listPendingProposals: listPendingProposalsTool };
}
