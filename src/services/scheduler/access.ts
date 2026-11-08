// Who may run, dismiss and recover over HTTP (T24).
//
// The prototype has no server-side authentication: every route trusts a
// client-supplied `actor` (D13 role toggle; ARCHITECTURE "production path":
// real SSO/RBAC later). A client-asserted "manager" is attribution, not
// authentication. So scheduler write routes are OFF unless whoever runs the
// server opts into that demo trust model with SCHEDULER_DEMO_ACTIONS=1, and
// even then only the manager identity the Manager view already sends
// ("manager", as for clock control and owner-less restore) is accepted.
// Read routes stay open like the app's other GET routes. The service layer
// and the CLI (operator with access to the database file) are unaffected.
import { SchedulerError } from "./types";

export const DEMO_ACTIONS_ENV = "SCHEDULER_DEMO_ACTIONS";
export const MANAGER_ACTOR = "manager";

export function authorizeDemoAction(actor: unknown, env: Record<string, string | undefined> = process.env): string {
  if (env[DEMO_ACTIONS_ENV] !== "1") {
    throw new SchedulerError(
      `Scheduler actions over HTTP are disabled: the prototype has no authentication, so a manager identity cannot be verified. ` +
        `Set ${DEMO_ACTIONS_ENV}=1 on the server to accept the demo's client-asserted manager, or use the scheduler CLI.`,
      "not_allowed",
    );
  }
  if (typeof actor !== "string" || actor.trim() !== MANAGER_ACTOR) {
    throw new SchedulerError(`Only the manager may run scheduler actions (actor "${MANAGER_ACTOR}", demo identity, not authenticated)`, "not_allowed");
  }
  return MANAGER_ACTOR;
}
