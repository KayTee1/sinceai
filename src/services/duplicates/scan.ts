// Duplicate scan (T20): a scheduled job on the simulated clock (every 10
// days; production: a real cron calling the same function). It fingerprints
// every active catalog dashboard, groups those above the similarity
// threshold, and records findings. Findings are observations for a person to
// triage; the scan never proposes, merges or archives anything itself.
import { appendAudit } from "../lifecycle/audit";
import { addDays } from "../lifecycle/policy";
import type { Db } from "../lifecycle/types";
import { fingerprinter, type Fingerprint } from "./fingerprint";

export const SCAN_JOB_ID = "duplicate-scan";
export const SCAN_EVERY_DAYS = 10;
export const SIMILARITY_THRESHOLD = 0.6;

export type FindingStatus = "open" | "dismissed" | "proposed";

export type DuplicateFinding = {
  id: string;
  runId: string;
  firstSeen: string;
  lastSeen: string;
  assetIds: string[];
  similarity: number; // highest pairwise similarity in the group
  evidence: {
    fingerprintVersion: string;
    shared: string[]; // features every member has
    members: { assetId: string; features: string[]; hex: string; key: string }[];
    pairs: { a: string; b: string; similarity: number }[];
  };
  status: FindingStatus;
  reason: string | null;
  decidedBy: string | null;
  decidedOn: string | null;
};

type Row = {
  id: string;
  run_id: string;
  first_seen: string;
  last_seen: string;
  asset_ids: string;
  similarity: number;
  evidence: string;
  status: FindingStatus;
  reason: string | null;
  decided_by: string | null;
  decided_on: string | null;
};

const toFinding = (r: Row): DuplicateFinding => ({
  id: r.id,
  runId: r.run_id,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  assetIds: JSON.parse(r.asset_ids),
  similarity: Number(r.similarity),
  evidence: JSON.parse(r.evidence),
  status: r.status,
  reason: r.reason,
  decidedBy: r.decided_by,
  decidedOn: r.decided_on,
});

export async function getFinding(db: Db, id: string): Promise<DuplicateFinding | null> {
  const r = await db.execute({ sql: `SELECT * FROM findings WHERE id = ?`, args: [id] });
  return r.rows[0] ? toFinding(r.rows[0] as unknown as Row) : null;
}

export async function listFindings(db: Db): Promise<DuplicateFinding[]> {
  const r = await db.execute(
    `SELECT * FROM findings ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, similarity DESC, id`,
  );
  return (r.rows as unknown as Row[]).map(toFinding);
}

export async function listScanRuns(db: Db, limit = 5) {
  const r = await db.execute({ sql: `SELECT * FROM scan_runs ORDER BY run_date DESC, id DESC LIMIT ?`, args: [limit] });
  return r.rows.map((x) => ({
    id: x.id as string,
    runDate: x.run_date as string,
    actor: x.actor as string,
    assets: Number(x.assets),
    groups: Number(x.groups),
    newFindings: Number(x.new_findings),
    fingerprintVersion: x.fingerprint_version as string,
  }));
}

export async function nextScanDate(db: Db): Promise<string | null> {
  const r = await db.execute({ sql: `SELECT next_run FROM scheduled_jobs WHERE job_id = ?`, args: [SCAN_JOB_ID] });
  return (r.rows[0]?.next_run as string | undefined) ?? null;
}

/** Union-find groups of dashboards linked by a pair at or above the threshold. */
function groupPairs(fps: Fingerprint[]) {
  const parent = new Map(fps.map((f) => [f.assetId, f.assetId]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const s = fingerprinter.similarity(fps[i], fps[j]);
      if (s >= SIMILARITY_THRESHOLD) {
        pairs.push({ a: fps[i].assetId, b: fps[j].assetId, similarity: Math.round(s * 1000) / 1000 });
        parent.set(find(fps[i].assetId), find(fps[j].assetId));
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const p of pairs)
    for (const id of [p.a, p.b]) {
      const root = find(id);
      const g = groups.get(root) ?? [];
      if (!g.includes(id)) g.push(id);
      groups.set(root, g);
    }
  return [...groups.values()].map((ids) => {
    const members = ids.sort();
    return { assetIds: members, pairs: pairs.filter((p) => members.includes(p.a)) };
  });
}

/**
 * Runs one scan at `date`. A group already open or proposed is refreshed, not
 * duplicated; a group dismissed earlier is not raised again unless a member's
 * fingerprint changed since the dismissal.
 */
export async function runDuplicateScan(db: Db, date: string, actor = "scheduler") {
  const assets = await db.execute(`
    SELECT a.asset_id, a.product_scope, a.market_scope
    FROM Analytics_Assets a JOIN asset_state s ON s.asset_id = a.asset_id
    WHERE s.status != 'archived' ORDER BY a.asset_id`);
  const metrics = await db.execute(`
    SELECT m.asset_id, k.canonical_metric FROM Asset_KPI_Map m JOIN KPI_Catalog k ON k.kpi_id = m.kpi_id`);
  const byAsset = new Map<string, string[]>();
  for (const r of metrics.rows) {
    const list = byAsset.get(r.asset_id as string) ?? [];
    list.push(r.canonical_metric as string);
    byAsset.set(r.asset_id as string, list);
  }
  const fps = fingerprinter.build(
    assets.rows.map((a) => ({
      assetId: a.asset_id as string,
      productScope: a.product_scope as string,
      marketScope: a.market_scope as string,
      canonicalMetrics: byAsset.get(a.asset_id as string) ?? [],
    })),
  );
  const fpById = new Map(fps.map((f) => [f.assetId, f]));
  const groups = groupPairs(fps);

  const runId = `SCAN-${date}-${Date.now().toString(36)}`;
  const existing = (await db.execute(`SELECT * FROM findings`)).rows as unknown as Row[];
  let created = 0;
  for (const g of groups) {
    const members = g.assetIds.map((id) => {
      const f = fpById.get(id)!;
      return { assetId: id, features: f.features, hex: f.hex, key: f.key };
    });
    const shared = members.reduce<string[]>(
      (acc, m, i) => (i === 0 ? m.features : acc.filter((x) => m.features.includes(x))),
      [],
    );
    const evidence = { fingerprintVersion: fingerprinter.version, shared, members, pairs: g.pairs };
    const similarity = Math.max(...g.pairs.map((p) => p.similarity));
    const groupKey = g.assetIds.join("+");
    const prior = existing.filter((r) => (JSON.parse(r.asset_ids) as string[]).join("+") === groupKey);
    const live = prior.find((r) => r.status === "open" || r.status === "proposed");
    if (live) {
      await db.execute({
        sql: `UPDATE findings SET last_seen = ?, run_id = ?, evidence = ?, similarity = ? WHERE id = ?`,
        args: [date, runId, JSON.stringify(evidence), similarity, live.id],
      });
      continue;
    }
    const dismissed = prior.find((r) => r.status === "dismissed");
    if (dismissed) {
      const before = (JSON.parse(dismissed.evidence).members as { key: string }[]).map((m) => m.key).join("#");
      if (before === members.map((m) => m.key).join("#")) continue; // unchanged since dismissal
    }
    await db.execute({
      sql: `INSERT INTO findings (id, run_id, first_seen, last_seen, asset_ids, similarity, evidence, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      args: [`DUP-${groupKey}-${date}`, runId, date, date, JSON.stringify(g.assetIds), similarity, JSON.stringify(evidence)],
    });
    created++;
  }

  await db.execute({
    sql: `INSERT INTO scan_runs (id, run_date, actor, assets, groups, new_findings, fingerprint_version)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, date, actor, fps.length, groups.length, created, fingerprinter.version],
  });
  await appendAudit(db, {
    simDate: date,
    actor,
    action: "duplicate_scan",
    rationale:
      `Fingerprinted ${fps.length} active dashboards (${fingerprinter.version}); ` +
      `${groups.length} groups at ≥${Math.round(SIMILARITY_THRESHOLD * 100)}% similarity, ${created} new findings. ` +
      `Findings wait for triage; nothing was changed.`,
  });
  return { runId, assets: fps.length, groups: groups.length, newFindings: created };
}

/** Scheduled run: scan, then move the job's next run forward by 10 days. */
export async function runScheduledScan(db: Db, date: string) {
  await runDuplicateScan(db, date, "scheduler");
  await db.execute({
    sql: `UPDATE scheduled_jobs SET next_run = ?, last_run = ? WHERE job_id = ?`,
    args: [addDays(date, SCAN_EVERY_DAYS), date, SCAN_JOB_ID],
  });
}
