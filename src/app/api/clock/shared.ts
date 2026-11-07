import { db } from "@/db/client";
import { controlClock, type ClockAction } from "@/services/lifecycle";
import { runSimulatedTriggers, simSettings, type SimTriggerResult } from "@/services/scheduler";
import { body, requireString, withLifecycle } from "@/lib/lifecycle-server";

// God-mode clock control (D12). `actor` is the acting identity for the audit.
//
// B5 (T26): with SCHEDULER_SIM_TRIGGER=1 (and SCHEDULER_DEMO_ACTIONS=1), after
// the clock action has been stored the governance jobs due at the new
// simulated date run (services/scheduler/simulated.ts). The clock action itself
// is unchanged and is never undone by a scheduler problem: a scheduler error is
// reported in `scheduler.error`. Without the setting the response is as before.
export async function clockRoute(req: Request, toAction: (b: Record<string, unknown>) => ClockAction) {
  const b = await body(req);
  return withLifecycle(async () => {
    const result = await controlClock(db(), toAction(b), requireString(b.actor ?? "manager", "actor"));
    const settings = simSettings();
    if (!settings.autoOnClock) return result;
    let scheduler: SimTriggerResult | { error: string };
    try {
      scheduler = await runSimulatedTriggers(db(), { source: "clock_action", reassessEveryDays: settings.reassessEveryDays });
    } catch (err) {
      console.error(err);
      scheduler = { error: err instanceof Error ? err.message : String(err) };
    }
    return { ...result, scheduler };
  });
}
