import { connection } from "next/server";
import { db } from "@/db/client";
import { getAssetAudit, getAssetState } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Per-asset state and audit timeline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return withLifecycle(async () => ({
    state: await getAssetState(db(), id),
    audit: await getAssetAudit(db(), id),
  }));
}
