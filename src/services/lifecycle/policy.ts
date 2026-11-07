// Lifecycle policy (D9, D12–D14). Thresholds are config, not hard rules.

export const POLICY_VERSION = "lifecycle-v4"; // v2 silence escalates (D16); v3 team use of Temporary (D17); v4 auto-renew when used (D21)

export const CLOCK_START = "2026-11-01"; // D13
export const TTL_DAYS = 30; // Temporary insights
export const LEASE_DAYS = 90; // Personal, Team, Certified
export const REVIEW_WINDOW_DAYS = 14; // owner review before escalation to the data steward (D13, D16)

// D21: at lease end an asset counts as used when it had any in-app view in the
// last 90 days, or its pack telemetry averages at least this many monthly users
// over the latest months. The pack is a snapshot ending Oct 2026, so its latest
// months stand in for current telemetry (production: live usage data). Used
// assets renew automatically; unused ones get a retire proposal.
export const LOW_USAGE_USERS = 10;
export const USAGE_MONTHS = 3;

// D17: a Temporary insight opened by this many distinct people in the owner's
// region (the team, D14) is proposed for Team, approved by a Lead there.
export const TEAM_USERS = 3;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// D13: imported leases start on the latest whole 90-day period after
// last_modified that is not after the clock start, so reviews spread out
// instead of all landing on day 90.
export function seededLeaseEnd(lastModified: string | null, clockStart: string): string {
  if (!lastModified) return addDays(clockStart, LEASE_DAYS);
  const lm = lastModified.slice(0, 10);
  const periods = Math.max(0, Math.floor(daysBetween(lm, clockStart) / LEASE_DAYS));
  return addDays(lm, (periods + 1) * LEASE_DAYS);
}
