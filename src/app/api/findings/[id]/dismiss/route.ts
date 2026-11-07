import { db } from "@/db/client";
import { dismissFinding } from "@/services/duplicates";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { actor, reason } — dismiss a duplicate finding; a reason is required.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withLifecycle(async (clock) => ({
    finding: await dismissFinding(
      db(),
      {
        findingId: id,
        actor: requireString(b.actor ?? "manager", "actor"),
        reason: typeof b.reason === "string" ? b.reason : undefined,
      },
      clock.date,
    ),
  }));
}
