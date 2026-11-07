import { db } from "@/db/client";
import { LifecycleError, decide } from "@/services/lifecycle";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { actor, action: "approve" | "reject", reason } — reject requires a reason.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withLifecycle(async (clock) => {
    if (b.action !== "approve" && b.action !== "reject") {
      throw new LifecycleError("action must be approve or reject", "invalid");
    }
    const proposal = await decide(
      db(),
      {
        proposalId: id,
        actor: requireString(b.actor, "actor"),
        action: b.action,
        reason: typeof b.reason === "string" ? b.reason : undefined,
      },
      clock.date,
    );
    return { proposal };
  });
}
