import { db } from "@/db/client";
import { confirmReuse } from "@/services/build";
import { LifecycleError } from "@/services/lifecycle";
import { RequestNotFoundError } from "@/services/steward/analyze";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { requestId, assetId, answer?: { product, market } } — the requester confirms
// a reuse candidate from chat ("Use this"). Logged as an app use and audited.
export async function POST(req: Request) {
  const b = await body(req);
  return withLifecycle(async (clock) => {
    const answer =
      b.answer && typeof b.answer === "object"
        ? {
            product: requireString((b.answer as Record<string, unknown>).product, "answer.product"),
            market: requireString((b.answer as Record<string, unknown>).market, "answer.market"),
          }
        : undefined;
    try {
      return await confirmReuse(
        db(),
        { requestId: requireString(b.requestId, "requestId"), assetId: requireString(b.assetId, "assetId"), answer },
        clock.date,
      );
    } catch (err) {
      if (err instanceof RequestNotFoundError) throw new LifecycleError(err.message, "not_found");
      throw err;
    }
  });
}
