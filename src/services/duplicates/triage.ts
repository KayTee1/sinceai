// Triage of duplicate findings (T20): a person decides what a finding means.
// "Propose merge" turns it into one merge proposal per merged-away dashboard
// for that dashboard's owner (the existing inbox); "Dismiss" records why the
// group is fine (e.g. a legitimate regional variant). Nothing merges without
// the owner's approval.
import type { Client } from "@libsql/client";
import { appendAudit } from "../lifecycle/audit";
import { getAssetState, regionSteward } from "../lifecycle/engine";
import { POLICY_VERSION } from "../lifecycle/policy";
import { LifecycleError, type MergeEvidence } from "../lifecycle/types";
import { getFinding } from "./scan";

async function openFinding(db: Client, id: string) {
  const f = await getFinding(db, id);
  if (!f) throw new LifecycleError(`Unknown finding ${id}`, "not_found");
  if (f.status !== "open") throw new LifecycleError(`Finding ${id} is already ${f.status}`, "invalid");
  return f;
}

export async function dismissFinding(
  db: Client,
  input: { findingId: string; actor: string; reason?: string },
  date: string,
) {
  const f = await openFinding(db, input.findingId);
  const reason = input.reason?.trim();
  if (!reason) throw new LifecycleError("Dismiss requires a reason", "invalid");
  await db.execute({
    sql: `UPDATE findings SET status = 'dismissed', reason = ?, decided_by = ?, decided_on = ? WHERE id = ?`,
    args: [reason, input.actor, date, f.id],
  });
  await appendAudit(db, {
    simDate: date,
    actor: input.actor,
    action: "finding_dismissed",
    rationale: `Duplicate finding ${f.id} (${f.assetIds.join(", ")}) dismissed: ${reason}. Not raised again unless a fingerprint changes.`,
  });
  return (await getFinding(db, f.id))!;
}

export async function proposeMerge(
  db: Client,
  input: { findingId: string; targetId: string; actor: string },
  date: string,
) {
  const f = await openFinding(db, input.findingId);
  if (!f.assetIds.includes(input.targetId)) throw new LifecycleError(`${input.targetId} is not in ${f.id}`, "invalid");
  const target = await getAssetState(db, input.targetId);
  if (!target || target.status === "archived") {
    throw new LifecycleError(`Target ${input.targetId} must be an active dashboard`, "invalid");
  }
  const names = await db.execute({
    sql: `SELECT asset_id, asset_name FROM Analytics_Assets WHERE asset_id IN (${f.assetIds.map(() => "?").join(",")})`,
    args: f.assetIds,
  });
  const name = new Map(names.rows.map((r) => [r.asset_id as string, r.asset_name as string]));

  const tx = await db.transaction("write");
  const proposalIds: string[] = [];
  try {
    for (const source of f.assetIds.filter((id) => id !== input.targetId)) {
      const state = await getAssetState(tx, source);
      if (!state || state.status === "archived") continue;
      const owner = state.ownerId
        ? await tx.execute({ sql: `SELECT status FROM Owners WHERE owner_id = ?`, args: [state.ownerId] })
        : null;
      const ownerActive = owner?.rows[0]?.status === "active";
      // The source's owner decides; without an active owner, the region's steward (Rule 8).
      const approver = ownerActive ? state.ownerId : await regionSteward(tx, state.ownerId);
      const pair = f.evidence.pairs.find(
        (p) => (p.a === source && p.b === input.targetId) || (p.b === source && p.a === input.targetId),
      );
      const evidence: MergeEvidence = {
        kind: "merge",
        findingId: f.id,
        targetId: input.targetId,
        targetName: name.get(input.targetId) ?? input.targetId,
        similarity: pair?.similarity ?? f.similarity,
        shared: f.evidence.shared,
      };
      const id = `PRP-MERGE-${source}-${date}`;
      const rationale =
        `Duplicate scan: ${name.get(source) ?? source} is ${Math.round(evidence.similarity * 100)}% similar to ` +
        `${evidence.targetName} (${input.targetId}). Proposed: merge into it; this dashboard is archived (restorable).`;
      await tx.execute({
        sql: `INSERT INTO proposals (id, version, type, asset_ids, rationale, evidence, required_approvers, status, created_on, due_on)
              VALUES (?, 1, 'merge', ?, ?, ?, ?, ?, ?, NULL)`,
        args: [
          id,
          JSON.stringify([source]),
          rationale,
          JSON.stringify(evidence),
          JSON.stringify(approver ? [approver] : []),
          ownerActive ? "open" : "escalated",
          date,
        ],
      });
      await appendAudit(tx, {
        simDate: date,
        actor: input.actor,
        action: "merge_proposed",
        assetId: source,
        proposalId: id,
        policyVersion: POLICY_VERSION,
        rationale,
        evidence,
      });
      proposalIds.push(id);
    }
    await tx.execute({
      sql: `UPDATE findings SET status = 'proposed', decided_by = ?, decided_on = ?, reason = ? WHERE id = ?`,
      args: [input.actor, date, `Merge into ${input.targetId}`, f.id],
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { finding: (await getFinding(db, f.id))!, proposalIds };
}
