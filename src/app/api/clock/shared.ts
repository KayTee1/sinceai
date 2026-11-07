import { db } from "@/db/client";
import { controlClock, type ClockAction } from "@/services/lifecycle";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// God-mode clock control (D12). `actor` is the acting identity for the audit.
export async function clockRoute(req: Request, toAction: (b: Record<string, unknown>) => ClockAction) {
  const b = await body(req);
  return withLifecycle(async () => controlClock(db(), toAction(b), requireString(b.actor ?? "manager", "actor")));
}
