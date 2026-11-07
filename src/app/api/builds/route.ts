import { db } from "@/db/client";
import { proposeBuild } from "@/services/build";
import { LifecycleError } from "@/services/lifecycle";
import { RequestNotFoundError } from "@/services/steward/analyze";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// { requestId, answer?: { product, market }, requesterId? } — runs the steward
// analysis and stores a build proposal only when it recommends a build.
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
      return await proposeBuild(
        db(),
        {
          requestId: requireString(b.requestId, "requestId"),
          answer,
          requesterId: typeof b.requesterId === "string" ? b.requesterId : undefined,
        },
        clock.date,
      );
    } catch (err) {
      if (err instanceof RequestNotFoundError) throw new LifecycleError(err.message, "not_found");
      throw err;
    }
  });
}
