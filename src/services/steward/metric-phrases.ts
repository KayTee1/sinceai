// TEAM-AUTHORED mapping (ours, not from the Bayer pack): extra request phrases
// that name a canonical metric from KPI_Catalog. Every canonical metric name in
// the catalog also matches itself. Keep this list short and explicit; a phrase
// that is not here is not interpreted.
export const METRIC_PHRASES: Record<string, string> = {
  "sales growth": "Net Sales Growth",
  "market access": "Market Access Coverage",
  "gross-to-net": "Gross-to-Net Rate",
  "gross to net": "Gross-to-Net Rate",
  "forecast accuracy": "Demand Forecast Accuracy",
  otif: "On-Time In-Full",
  "on-time in-full": "On-Time In-Full",
  "reimbursement status": "Reimbursement Status Coverage",
};
