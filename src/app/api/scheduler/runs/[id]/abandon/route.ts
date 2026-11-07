import { db } from "@/db/client";
import { abandonRun, authorizeDemoAction } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { requireText, withScheduler } from "@/lib/scheduler-server";

// { actor, reason } — marks a run left running by a crash as failed (audited). Manager only, demo gate.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withScheduler(async () => ({
    run: await abandonRun(db(), { runId: id, actor: authorizeDemoAction(b.actor), reason: requireText(b.reason, "reason") }),
  }));
}
