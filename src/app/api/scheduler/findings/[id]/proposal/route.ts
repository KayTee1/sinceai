import { connection } from "next/server";
import { db } from "@/db/client";
import {
  FINDING_PROPOSALS_BLOCKED_BY,
  FINDING_PROPOSALS_ENABLED,
  previewFindingProposal,
  raiseFindingProposal,
  type FindingProposalAction,
} from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { requireText, withScheduler, withSchedulerAction } from "@/lib/scheduler-server";

const optional = (v: string | null) => (v && v.trim() ? v.trim() : undefined);

// Read-only eligibility preview. Query (all optional): sourceId, targetId (a merge direction), expectedFingerprint.
// -> FindingProposalPreview { eligible, reasons[], enabled, blockedBy?, link, links, directions (each with comparatorPreferred),
//    comparatorPreferredDirection (comparison evidence only), findingFingerprint, currentFingerprint }
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  return withScheduler(() =>
    previewFindingProposal(db(), {
      findingId: id,
      sourceId: optional(q.get("sourceId")),
      targetId: optional(q.get("targetId")),
      expectedFingerprint: optional(q.get("expectedFingerprint")),
    }),
  );
}

// { actor, action: "merge", sourceId (merged away), targetId (kept), expectedFingerprint } -> { created, link, proposal }.
// DISABLED until B0 is reviewed and in this branch's base (FINDING_PROPOSALS_ENABLED, services/scheduler/proposals.ts):
// answers 409 { error, blockedBy: "B0" } before reading the request or touching the database.
// When enabled: manager only through the demo gate (attribution, not authentication).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!FINDING_PROPOSALS_ENABLED) {
    return Response.json(
      {
        error: "Raising proposals from findings is switched off until the B0 lifecycle fix is reviewed and integrated",
        blockedBy: FINDING_PROPOSALS_BLOCKED_BY,
      },
      { status: 409 },
    );
  }
  const { id } = await ctx.params;
  const b = await body(req);
  return withSchedulerAction(b.actor, async (actor) =>
    raiseFindingProposal(db(), {
      findingId: id,
      actor,
      action: requireText(b.action, "action") as FindingProposalAction,
      sourceId: requireText(b.sourceId, "sourceId"),
      targetId: requireText(b.targetId, "targetId"),
      expectedFingerprint: requireText(b.expectedFingerprint, "expectedFingerprint"),
    }),
  );
}
