import { db } from "@/db/client";
import { restore } from "@/services/lifecycle";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { actor, reason? } — restores an archived asset (previous tier, new lease or TTL).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withLifecycle(async (clock) => ({
    state: await restore(
      db(),
      { assetId: id, actor: requireString(b.actor, "actor"), reason: typeof b.reason === "string" ? b.reason : undefined },
      clock.date,
    ),
  }));
}
