import { db } from "@/db/client";
import { decideBuild } from "@/services/build";
import { LifecycleError, decide, getProposal } from "@/services/lifecycle";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { actor, action: "approve" | "reject", reason } — reject requires a reason.
// Build proposals go to the build service, which computes the insight on approval.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withLifecycle(async (clock) => {
    if (b.action !== "approve" && b.action !== "reject") {
      throw new LifecycleError("action must be approve or reject", "invalid");
    }
    const input = {
      proposalId: id,
      actor: requireString(b.actor, "actor"),
      action: b.action,
      reason: typeof b.reason === "string" ? b.reason : undefined,
    } as const;
    const p = await getProposal(db(), id);
    if (p?.type === "build_temporary") return decideBuild(db(), input, clock.date);
    return { proposal: await decide(db(), input, clock.date) };
  });
}
