import "server-only";
import { db } from "@/db/client";
import { LifecycleError, ensureLifecycle, tick, type Clock } from "@/services/lifecycle";

/** Prepares lifecycle tables, brings the clock up to real time, then runs `fn`. */
export async function withLifecycle<T>(fn: (clock: Clock) => Promise<T>): Promise<Response> {
  try {
    const client = db();
    await ensureLifecycle(client);
    const clock = await tick(client);
    return Response.json(await fn(clock));
  } catch (err) {
    if (err instanceof LifecycleError) {
      const status = err.code === "not_found" ? 404 : err.code === "not_allowed" ? 403 : 400;
      return Response.json({ error: err.message }, { status });
    }
    console.error(err);
    return Response.json({ error: "Lifecycle request failed" }, { status: 500 });
  }
}

/** Reads a JSON body; returns {} for an empty or invalid body. */
export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LifecycleError(`${field} is required`, "invalid");
  return value.trim();
}
