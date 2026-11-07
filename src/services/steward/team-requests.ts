// TEAM-AUTHORED demo requests (ours, not Bayer data). F1: no request in the
// pack reaches a build proposal, so the demo uses one request written by the
// team. Only the request text is ours; the analysis, KPIs, values and rules
// run unchanged on the real pack. Never written into Business_Requests, and
// every source reference names this sheet, so evidence cannot pass it off as
// Bayer's.
import type { RequestRow } from "./requests";

export const TEAM_REQUEST_SHEET = "Team_Requests (team-authored)";

export const TEAM_REQUESTS: RequestRow[] = [
  {
    // Reaches build_proposal on the real pack: Net Sales is covered by
    // existing assets, Forecast Variance by none in North America, and both
    // KPIs compute for US and CA (checked with the steward analysis).
    request_id: "TEAM-REQ-01",
    request_date: "2026-11-01",
    product_context: "Xarelto",
    market_context: "North America",
    request_text: "Net sales and forecast variance for Xarelto in North America, by country.",
    urgency: "normal",
    status: "new",
    _source_row: 1,
  },
];

export function findTeamRequest(requestId: string): RequestRow | null {
  const id = requestId.trim().toUpperCase();
  return TEAM_REQUESTS.find((r) => r.request_id === id) ?? null;
}

export function isTeamRequest(requestId: string): boolean {
  return findTeamRequest(requestId) !== null;
}
