// Simulated clock (D12): 1 simulated day = 1 real second while running.
// Starts paused after reset. Fast-forward processes due events in date order
// (D14). No rewind. Clock actions are audited; plain ticks are not.
import type { Client } from "@libsql/client";
import { appendAudit } from "./audit";
import { nextDueEvent, processDue } from "./engine";
import { addDays } from "./policy";
import { LifecycleError, type Clock, type Db } from "./types";

export const MS_PER_SIM_DAY = 1000;

export async function readClock(db: Db): Promise<Clock> {
  const r = await db.execute(`SELECT sim_date, running, anchor_ms FROM app_clock WHERE id = 1`);
  const row = r.rows[0];
  if (!row) throw new LifecycleError("Lifecycle not initialised", "not_found");
  return { date: row.sim_date as string, running: Number(row.running) === 1, anchorMs: Number(row.anchor_ms) };
}

function elapsedDays(c: Clock, nowMs: number): number {
  return c.running ? Math.max(0, Math.floor((nowMs - c.anchorMs) / MS_PER_SIM_DAY)) : 0;
}

/**
 * Brings the stored date up to real time and processes events that became
 * due. Call before reading or changing lifecycle state.
 */
export async function tick(db: Client, nowMs = Date.now()): Promise<Clock> {
  const c = await readClock(db);
  const days = elapsedDays(c, nowMs);
  if (days === 0) return c;
  const date = addDays(c.date, days);
  await processDue(db, date);
  // Keep the sub-day remainder so time does not drift between ticks.
  const anchorMs = c.anchorMs + days * MS_PER_SIM_DAY;
  await db.execute({ sql: `UPDATE app_clock SET sim_date = ?, anchor_ms = ? WHERE id = 1`, args: [date, anchorMs] });
  return { ...c, date, anchorMs };
}

export type ClockAction =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "advance"; days: number }
  | { action: "next_due" };

export type ClockResult = { clock: Clock; processed: number; nextDue: string | null };

export async function controlClock(db: Client, a: ClockAction, actor: string, nowMs = Date.now()): Promise<ClockResult> {
  const before = await tick(db, nowMs);
  let target = before.date;
  let running = before.running;

  if (a.action === "pause") running = false;
  else if (a.action === "resume") running = true;
  else if (a.action === "advance") {
    if (!Number.isInteger(a.days) || a.days < 1 || a.days > 365) {
      throw new LifecycleError("days must be a whole number from 1 to 365", "invalid");
    }
    target = addDays(before.date, a.days);
  } else {
    const ev = await nextDueEvent(db);
    if (!ev) throw new LifecycleError("Nothing is due", "invalid");
    target = ev.date > before.date ? ev.date : before.date;
  }

  const processed = target > before.date || a.action === "next_due" ? await processDue(db, target) : 0;
  await db.execute({
    sql: `UPDATE app_clock SET sim_date = ?, running = ?, anchor_ms = ? WHERE id = 1`,
    args: [target, running ? 1 : 0, nowMs],
  });
  const label =
    a.action === "advance" ? `advance +${a.days}d` : a.action === "next_due" ? "jump to next due event" : a.action;
  await appendAudit(db, {
    simDate: target,
    actor,
    action: "clock_changed",
    rationale: `Clock ${label}: ${before.date} → ${target}; ${processed} due events processed.`,
  });
  const next = await nextDueEvent(db);
  return { clock: { date: target, running, anchorMs: nowMs }, processed, nextDue: next?.date ?? null };
}
