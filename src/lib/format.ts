export function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonth(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

export function eurM(v: number, digits = 1) {
  return `€${v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}m`;
}

export function pct(v: number, digits = 1) {
  return `${v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function int(v: number) {
  return v.toLocaleString("en-GB");
}

/** Short lifecycle label for an asset: archived, under review, or lease/TTL end. */
export function leaseLabel(status: string, leaseEnd: string | null, tier?: string) {
  if (status === "archived") return "Archived";
  if (status === "lease_due") return "Review due";
  if (!leaseEnd) return "No lease";
  return `${tier === "temporary" ? "Expires" : "Lease"} ${formatDate(leaseEnd)}`;
}
