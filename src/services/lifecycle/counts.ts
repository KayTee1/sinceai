// Before/after portfolio counts (D13, D14). "Before" is the seeded state at the
// last reset (pack endorsement -> tier, nothing archived or under review);
// "now" is the current asset_state; "changes" counts applied state changes
// from the audit log since the reset.
import { TIER_BY_ENDORSEMENT } from "./schema";
import type { Db } from "./types";

export type PortfolioCounts = {
  certified: number;
  team: number;
  personal: number;
  temporary: number;
  archived: number;
  underReview: number;
};

export type PortfolioChanges = Record<
  "renewed" | "retired" | "merged" | "restored" | "escalated" | "expired" | "promoted" | "built" | "rejected",
  number
>;

const CHANGE_ACTIONS: Record<keyof PortfolioChanges, string> = {
  renewed: "renewed",
  retired: "retired",
  merged: "merged",
  restored: "restored",
  escalated: "review_escalated",
  expired: "ttl_expired",
  promoted: "promoted",
  built: "temporary_registered",
  rejected: "proposal_rejected",
};

const empty = (): PortfolioCounts => ({ certified: 0, team: 0, personal: 0, temporary: 0, archived: 0, underReview: 0 });

export async function getPortfolioCounts(
  db: Db,
): Promise<{ before: PortfolioCounts; now: PortfolioCounts; changes: PortfolioChanges }> {
  const [states, audit] = await Promise.all([
    db.execute(`SELECT origin, tier, status, source_endorsement FROM asset_state`),
    db.execute(`SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action`),
  ]);

  const before = empty();
  const now = empty();
  for (const r of states.rows) {
    if (r.origin === "pack") before[TIER_BY_ENDORSEMENT[r.source_endorsement as string] ?? "personal"]++;
    if (r.status === "archived") now.archived++;
    else now[r.tier as keyof PortfolioCounts]++;
    if (r.status === "lease_due") now.underReview++;
  }

  const byAction = new Map(audit.rows.map((r) => [r.action as string, Number(r.n)]));
  const changes = Object.fromEntries(
    Object.entries(CHANGE_ACTIONS).map(([k, action]) => [k, byAction.get(action) ?? 0]),
  ) as PortfolioChanges;

  return { before, now, changes };
}
