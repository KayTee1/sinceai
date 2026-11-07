// Mastra adapter over the read-only build status service (T21).
//
// `get-build-status` answers persisted-state questions ("was it approved?",
// "where is the insight?", "why is it archived?") from storage, not from the
// analysis: analyzeRequest recomputes a recommendation and never reads
// proposals, built insights or lifecycle state.
//
// Read-only: getBuildStatus runs in a read-only transaction. No clock tick, no
// lifecycle processing, no proposal, no audit row. The tool needs no submit
// command because it cannot change anything.
//
// Visibility: the chat has no signed-in identity and the Agentic tab is shown
// to managers only. Every field here is already visible to managers in the
// approval inbox, the Dashboard and the asset timeline. No per-user visibility
// rule for build status exists in the contract (see docs/ARCHITECTURE.md).
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBuildStatus, type BuildRecord, type BuildStatus } from "../../services/build/status";
import { TEAM_REQUEST_SHEET } from "../../services/steward/team-requests";
import { passErrors } from "./steward-views";

/** Where things are in the app. Matches the UI (src/components); no URL exists for an insight. */
export const WHERE_TO_FIND = [
  "Built insights are listed under 'Built insights' on the Dashboard tab (Manager: Dashboard → Team dashboards; Employee: Dashboard), whether active or archived.",
  "Managers can also open one in Dashboard → Analytics catalog (search by insight ID); its timeline shows the audit history and, when archived, a Restore button.",
  "Pending proposals are decided in the approval inbox beside the chat on the Agentic tab.",
  "There is no dashboard URL. The MVP builds a computed Temporary insight (approved KPI values per market with their provenance), not a generated BI dashboard.",
];

export type BuildRecordView = BuildRecord & {
  request: { sourceSheet: string; teamAuthored: boolean };
  /** One-line restatement of the stored facts: approval, build and lifecycle kept apart. */
  facts: string[];
};

export type BuildStatusView = Omit<BuildStatus, "builds"> & {
  view: "build-status/v1";
  builds: BuildRecordView[];
  whereToFind: string[];
};

/** Restates stored fields only; never infers a state that is not stored. */
export function buildFacts(b: BuildRecord): string[] {
  const p = b.proposal;
  const facts: string[] = [];
  const pending = p.status === "open" || p.status === "escalated";
  if (pending) {
    facts.push(
      `Approval: ${p.id} is ${p.status}, waiting for ${p.requiredApprovers.join(", ") || "an assigned approver"} in the approval inbox. Nothing is approved or built.`,
    );
  } else if (b.decision) {
    facts.push(
      `Approval: ${p.id} was ${p.status} by ${b.decision.actor} on ${b.decision.simDate}` + (b.decision.reason ? ` (reason: ${b.decision.reason}).` : "."),
    );
  } else {
    facts.push(`Approval: ${p.id} is ${p.status}; no decision row is stored.`);
  }
  if (b.insight.built) {
    facts.push(`Build: insight ${b.insight.id} was built on ${b.insight.builtOn} (approved by ${b.insight.builtBy}).`);
  } else if (!pending) {
    facts.push(`Build: no insight ${b.insight.id} was built.`);
  }
  const l = b.lifecycle;
  if (l.registered) {
    const ends = l.ttlEnd ? `, TTL end ${l.ttlEnd}` : l.leaseEnd ? `, lease end ${l.leaseEnd}` : "";
    const last = l.lastEvent ? ` Last lifecycle event: ${l.lastEvent.action} on ${l.lastEvent.simDate} (${l.lastEvent.rationale})` : "";
    facts.push(
      `Lifecycle: ${b.insight.id} is ${l.status}, tier ${l.status === "archived" ? `${l.prevTier ?? l.tier} before archiving` : l.tier}${ends}.${last}` +
        (l.status === "archived" ? " Archiving does not change the approval; an archived insight can be restored." : ""),
    );
  }
  return facts;
}

export function buildRecordView(b: BuildRecord): BuildRecordView {
  const sheet = b.proposal.requestSourceSheet;
  return { ...b, request: { sourceSheet: sheet ?? "unknown", teamAuthored: sheet === TEAM_REQUEST_SHEET }, facts: buildFacts(b) };
}

export function buildStatusView(s: BuildStatus): BuildStatusView {
  return { view: "build-status/v1", ...s, builds: s.builds.map(buildRecordView), whereToFind: WHERE_TO_FIND };
}

export function createBuildStatusTools(getDb: () => Client) {
  const view = passErrors(buildStatusView);
  const json = (value: unknown) => ({ type: "json" as const, value });

  const getBuildStatusTool = createTool({
    id: "get-build-status",
    description:
      "Read-only. The stored status of builds: for a request ID (e.g. TEAM-REQ-01), a proposal ID (PRP-...) or an " +
      "insight ID (INS-...). Returns every matching build proposal with its approval status, the recorded decision " +
      "(actor, date, reason), whether the insight was built, and its current lifecycle state (active or archived, " +
      "tier, TTL end, last lifecycle event). Approval and lifecycle are separate facts: an approved build can be " +
      "archived. Use it for any question about whether something was proposed, approved, built, expired or archived, " +
      "or where a built insight is. It changes nothing and never submits a proposal.",
    inputSchema: z.object({
      by: z.enum(["request", "proposal", "insight"]).describe("Which kind of ID `id` is"),
      id: z.string().trim().min(1).max(80).describe("The request, proposal or insight ID, e.g. TEAM-REQ-01"),
    }),
    execute: async ({ by, id }): Promise<BuildStatus> => getBuildStatus(getDb(), { by, id }),
    toModelOutput: (x: unknown) => json(view(x as BuildStatus)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as BuildStatus) } },
  });

  return { getBuildStatus: getBuildStatusTool };
}
