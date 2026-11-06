// KPI definition lookup and conflict check over KPI_Catalog.
// Conflicts are definitional (status and approval differences between KPIs that
// share a canonical metric). No formulas or monetary gaps are inferred.
import type { Client } from "@libsql/client";
import { METRIC_PHRASES } from "./metric-phrases";
import type { KpiCheck, KpiDefinition } from "./types";

export async function loadKpis(db: Client): Promise<KpiDefinition[]> {
  const res = await db.execute(
    `SELECT kpi_id, kpi_name, canonical_metric, unit, definition_status, approval_status, _source_row
     FROM KPI_Catalog ORDER BY _source_row`,
  );
  return res.rows.map((r) => ({
    id: String(r.kpi_id),
    name: String(r.kpi_name),
    canonicalMetric: String(r.canonical_metric),
    unit: String(r.unit),
    definitionStatus: String(r.definition_status),
    approvalStatus: String(r.approval_status),
    source: { sheet: "KPI_Catalog", row: Number(r._source_row), id: String(r.kpi_id) },
  }));
}

export function isApprovedCanonical(k: KpiDefinition): boolean {
  return k.definitionStatus === "canonical" && k.approvalStatus === "approved";
}

/**
 * Canonical metrics named explicitly in the text, in order of appearance.
 * Longest phrase wins; matched spans are not reused ("net sales growth" is
 * Net Sales Growth, not also Net Sales).
 */
export function matchMetrics(text: string, canonicalMetrics: string[]): { canonicalMetric: string; phrase: string }[] {
  const phrases = new Map<string, string>();
  for (const m of canonicalMetrics) phrases.set(m.toLowerCase(), m);
  for (const [p, m] of Object.entries(METRIC_PHRASES)) if (canonicalMetrics.includes(m)) phrases.set(p, m);

  const lower = text.toLowerCase();
  const taken: boolean[] = new Array(lower.length).fill(false);
  const hits: { canonicalMetric: string; phrase: string; at: number }[] = [];
  const isWordChar = (ch: string | undefined) => !!ch && /[a-z0-9]/.test(ch);

  for (const phrase of [...phrases.keys()].sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (let at = lower.indexOf(phrase, from); at !== -1; at = lower.indexOf(phrase, from)) {
      from = at + 1;
      const end = at + phrase.length;
      if (isWordChar(lower[at - 1]) || isWordChar(lower[end])) continue;
      if (taken.slice(at, end).some(Boolean)) continue;
      taken.fill(true, at, end);
      const metric = phrases.get(phrase)!;
      if (!hits.some((h) => h.canonicalMetric === metric)) hits.push({ canonicalMetric: metric, phrase, at });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map(({ canonicalMetric, phrase }) => ({ canonicalMetric, phrase }));
}

export function checkMetric(canonicalMetric: string, matchedPhrase: string, kpis: KpiDefinition[]): KpiCheck {
  const group = kpis.filter((k) => k.canonicalMetric === canonicalMetric);
  const approvedAll = group.filter(isApprovedCanonical);
  const approved = approvedAll.length === 1 ? approvedAll[0] : null;
  const variants = group.filter((k) => k !== approved);
  const reasons: string[] = [];

  if (approvedAll.length === 0) reasons.push(`No approved canonical definition for ${canonicalMetric}`);
  if (approvedAll.length > 1) {
    reasons.push(`${approvedAll.length} approved canonical definitions: ${approvedAll.map((k) => k.id).join(", ")}`);
  }
  for (const v of variants) {
    if (approvedAll.length > 1 && isApprovedCanonical(v)) continue;
    reasons.push(
      `${v.id} "${v.name}" shares canonical metric ${canonicalMetric} but is ${v.definitionStatus} / ${v.approvalStatus}` +
        (approved ? `; ${approved.id} is the approved definition` : ""),
    );
  }
  const byName = new Map<string, KpiDefinition[]>();
  for (const k of group) byName.set(k.name, [...(byName.get(k.name) ?? []), k]);
  for (const [name, same] of byName) {
    if (same.length > 1) reasons.push(`Name "${name}" is used by ${same.map((k) => k.id).join(" and ")}`);
  }

  return {
    canonicalMetric,
    matchedPhrase,
    approved,
    variants,
    conflict: reasons.length > 0,
    reasons,
  };
}

export function checkKpis(text: string, kpis: KpiDefinition[]): KpiCheck[] {
  const canonical = [...new Set(kpis.map((k) => k.canonicalMetric))];
  return matchMetrics(text, canonical).map((m) => checkMetric(m.canonicalMetric, m.phrase, kpis));
}
