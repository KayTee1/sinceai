// Reuse confirmation (T21, Miro step 6): the requester picks a reuse candidate
// in chat ("Use this"). It counts as an app use of that asset by the requester
// and is audited. No approver is needed (D14).
import type { Client } from "@libsql/client";
import { LifecycleError, POLICY_VERSION, appendAudit, getAssetState, recordUsage } from "../lifecycle";
import { analyzeRequest } from "../steward/analyze";
import type { Scope } from "../steward/types";
import { mappedRequester } from "./build";

export type ReuseConfirmation = {
  requestId: string;
  assetId: string;
  requesterId: string;
  requesterSource: "team_mapping";
  date: string;
};

/**
 * Re-runs the authoritative analysis and logs the reuse only when it still
 * recommends reuse and the asset is one of its candidates.
 */
export async function confirmReuse(
  db: Client,
  input: { requestId: string; assetId: string; answer?: Scope },
  date: string,
): Promise<ReuseConfirmation> {
  const analysis = await analyzeRequest(db, input.requestId, input.answer);
  const scope = analysis.clarification.resolved;
  if (analysis.recommendation.kind !== "reuse_candidates" || !scope) {
    throw new LifecycleError(
      `${analysis.request.id} does not recommend reuse (${analysis.recommendation.kind}); nothing was logged`,
      "invalid",
    );
  }
  const candidate = analysis.candidates.find((c) => c.assetId === input.assetId);
  if (!candidate) {
    throw new LifecycleError(`${input.assetId} is not a reuse candidate for ${analysis.request.id}; nothing was logged`, "invalid");
  }
  // Discovery reads the imported catalog only; an archived asset must be restored first (T22).
  if ((await getAssetState(db, candidate.assetId))?.status === "archived") {
    throw new LifecycleError(`${candidate.assetId} is archived; restore it before reusing it. Nothing was logged.`, "invalid");
  }
  // Business_Requests has no requester (D12): same labelled mapping as a build.
  const requesterId = await mappedRequester(db, scope.market);
  if (!requesterId) throw new LifecycleError(`No active person found to act as requester for ${analysis.request.id}`, "invalid");

  await recordUsage(db, { assetId: candidate.assetId, userId: requesterId }, date);
  await appendAudit(db, {
    simDate: date,
    actor: requesterId,
    action: "reuse_confirmed",
    assetId: candidate.assetId,
    policyVersion: POLICY_VERSION,
    rationale: `${requesterId} (team mapping) confirmed ${candidate.assetId} answers ${analysis.request.id} for ${scope.product} · ${scope.market}; logged as an app use.`,
    evidence: { requestId: analysis.request.id, scope, requesterSource: "team_mapping" },
  });
  return { requestId: analysis.request.id, assetId: candidate.assetId, requesterId, requesterSource: "team_mapping", date };
}
