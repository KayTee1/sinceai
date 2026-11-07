import { db } from "@/db/client";
import { recordUsage } from "@/services/lifecycle";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { assetId, viewerId } — logs an app open, kept apart from imported usage.
export async function POST(req: Request) {
  const b = await body(req);
  return withLifecycle(async (clock) => ({
    state: await recordUsage(
      db(),
      { assetId: requireString(b.assetId, "assetId"), userId: requireString(b.viewerId, "viewerId") },
      clock.date,
    ),
  }));
}
