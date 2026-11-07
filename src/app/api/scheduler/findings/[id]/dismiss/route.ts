import { db } from "@/db/client";
import { authorizeDemoAction, dismissFinding } from "@/services/scheduler";
import { body } from "@/lib/lifecycle-server";
import { requireText, withScheduler } from "@/lib/scheduler-server";

// { actor, reason } — dismisses an open finding; the reason is required and audited. Manager only, demo gate.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return withScheduler(async () => ({
    finding: await dismissFinding(db(), { findingId: id, actor: authorizeDemoAction(b.actor), reason: requireText(b.reason, "reason") }),
  }));
}
