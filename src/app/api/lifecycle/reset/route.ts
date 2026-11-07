import { db } from "@/db/client";
import { resetLifecycle } from "@/services/lifecycle";
import { withLifecycle } from "@/lib/lifecycle-server";

// Demo reset: reseeds app-owned lifecycle state; imported pack tables are untouched.
export async function POST() {
  return withLifecycle(async () => {
    await resetLifecycle(db());
    return { ok: true };
  });
}
