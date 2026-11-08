import "server-only";
import { db } from "@/db/client";
import { LifecycleError, hasLifecycle } from "@/services/lifecycle";
import { SchedulerError, authorizeDemoAction, ensureScheduler } from "@/services/scheduler";

const STATUS: Record<SchedulerError["code"], number> = { not_found: 404, not_allowed: 403, invalid: 400, conflict: 409 };

/**
 * Scheduler route wrapper. Unlike withLifecycle it neither seeds nor ticks
 * the lifecycle (ticking processes due events, a lifecycle write); the
 * scheduler only reads lifecycle state at the stored clock date.
 */
export function withScheduler<T>(fn: () => Promise<T>): Promise<Response> {
  return respond(async () => {
    await prepare();
    return fn();
  });
}

/**
 * Write routes: the demo gate (access.ts) is checked first, so a refused
 * request neither creates scheduler tables nor touches the database.
 */
export function withSchedulerAction<T>(actor: unknown, fn: (actor: string) => Promise<T>): Promise<Response> {
  return respond(async () => {
    const allowed = authorizeDemoAction(actor);
    await prepare();
    return fn(allowed);
  });
}

class NotReady extends Error {}

async function prepare() {
  const client = db();
  if (!(await hasLifecycle(client))) throw new NotReady("Lifecycle is not initialised yet; open the app once first");
  await ensureScheduler(client);
}

async function respond<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof NotReady) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof SchedulerError) return Response.json({ error: err.message, ...(err.detail ?? {}) }, { status: STATUS[err.code] });
    if (err instanceof LifecycleError) {
      const status = err.code === "not_found" ? 404 : err.code === "not_allowed" ? 403 : 400;
      return Response.json({ error: err.message }, { status });
    }
    console.error(err);
    return Response.json({ error: "Scheduler request failed" }, { status: 500 });
  }
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SchedulerError(`${field} is required`, "invalid");
  return value.trim();
}
