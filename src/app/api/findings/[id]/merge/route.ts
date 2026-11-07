import { db } from "@/db/client";
import { proposeMerge } from "@/services/duplicates";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { actor, targetId } — propose merging the group into targetId (one proposal per other dashboard).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withLifecycle(async (clock) =>
    proposeMerge(
      db(),
      { findingId: id, targetId: requireString(b.targetId, "targetId"), actor: requireString(b.actor ?? "manager", "actor") },
      clock.date,
    ),
  );
}
