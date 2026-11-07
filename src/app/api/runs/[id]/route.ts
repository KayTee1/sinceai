import { connection } from "next/server";
import { db } from "@/db/client";
import { LifecycleError } from "@/services/lifecycle";
import { getRun } from "@/services/pipeline";
import { withLifecycle } from "@/lib/lifecycle-server";

// One request pipeline run with its step events.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  return withLifecycle(async () => {
    const run = await getRun(db(), id);
    if (!run) throw new LifecycleError(`Unknown run ${id}`, "not_found");
    return { run };
  });
}
