// T24 (B3): finding-to-proposal contracts. Kept apart from types.ts (owned by
// the periodic-reassessment branch, shared contract C5).
import type { Proposal } from "../lifecycle";
import type { OverlapEvidence } from "./types";

/**
 * Only merge is supported. A retire proposal (proposeRetire) is not offered:
 * it is a lease-review style proposal decided by one owner (or the steward),
 * so the kept asset's owner would not take part, and rejecting it renews the
 * asset's lease, a side effect an overlap finding never asked for.
 */
export type FindingProposalAction = "merge";

/**
 * Derived from the lifecycle proposals row on every read (open / escalated =
 * pending). `missing`: the row is gone; the link is stale history only.
 */
export type FindingProposalOutcome = "pending" | "approved" | "rejected" | "expired" | "missing";

export type FindingProposalLink = {
  linkId: string;
  findingId: string;
  proposalId: string;
  action: FindingProposalAction;
  /** Merged away (archived on approval). Chosen by the manager, not by the comparator. */
  sourceId: string;
  /** Kept. Chosen by the manager. */
  targetId: string;
  /** Who raised it (demo identity over HTTP; see access.ts). */
  actor: string;
  createdAt: string;
  simDate: string;
  /**
   * Codex B3-F2: the comparator's preferred direction in the evidence
   * snapshot, recorded as comparison evidence only. It never authorises
   * anything and may be the opposite of sourceId -> targetId.
   */
  comparatorPreferredDirection: MergeDirection;
  /** True when the manager's direction is the opposite of comparatorPreferredDirection. */
  againstComparator: boolean;
  /** Finding fingerprint the proposal was raised on (equal to the re-run comparator's at that moment). */
  fingerprint: string;
  /** The re-run comparator's evidence the backend validated the raise against. */
  evidence: OverlapEvidence;
  /** Authoritative: derived on read from the lifecycle proposals row. */
  outcome: FindingProposalOutcome;
  /** Cached copy last written at a scheduler write boundary (raise / syncFindingProposals). Diagnostic only; never use it for display or decisions. */
  storedOutcome: FindingProposalOutcome;
  outcomeSyncedAt: string | null;
  /** Decision rows recorded on the proposal, oldest first. */
  decisions: { actor: string; action: string; reason: string | null; simDate: string }[];
};

export type EligibilityCode =
  | "unsupported_rule"
  | "finding_not_open"
  | "already_pending"
  | "already_approved"
  | "rejected_same_evidence"
  | "stale_client"
  | "stale_evidence"
  | "asset_unknown"
  | "asset_not_active"
  | "asset_no_kpis"
  | "asset_under_review"
  | "direction_not_in_finding"
  | "target_does_not_cover_scope"
  | "target_lacks_kpis"
  | "temporary_over_certified"
  | "proposal_id_taken";

export type EligibilityReason = { code: EligibilityCode; message: string };

export type MergeDirection = { sourceId: string; targetId: string };

/**
 * One way to merge the finding's pair: `sourceId` merged away into
 * `targetId`. `allowed` comes from the checks only; `comparatorPreferred`
 * (the re-run comparator would merge this way) is comparison evidence and
 * never makes a direction allowed or blocked.
 */
export type DirectionCheck = MergeDirection & { allowed: boolean; reasons: EligibilityReason[]; comparatorPreferred: boolean };

/** Unmet conditions for switching the POST route on (see FINDING_PROPOSALS_ENABLED). */
export type FindingProposalBlockerId = "B0" | "MERGE-APPROVERS";
export type FindingProposalBlocker = { id: FindingProposalBlockerId; description: string };

export type FindingProposalPreview = {
  findingId: string;
  action: FindingProposalAction;
  /** Service-level eligibility (for the requested direction, or for at least one direction when none is given). */
  eligible: boolean;
  /** Why not; empty when eligible. Includes the requested direction's reasons. */
  reasons: EligibilityReason[];
  /** Whether POST is switched on in this build (FINDING_PROPOSALS_ENABLED). */
  enabled: boolean;
  /** Present while switched off: every unmet enabling condition (FINDING_PROPOSALS_BLOCKERS). */
  blockedBy?: FindingProposalBlockerId[];
  findingFingerprint: string;
  /** Re-run comparator's fingerprint for the pair now; null when it could not be evaluated or the overlap is gone. */
  currentFingerprint: string | null;
  /** Both directions with their own checks. The comparator's preferred direction is not a recommendation. */
  directions: DirectionCheck[];
  /** The re-run comparator's preferred direction (comparison evidence only); null when it could not be evaluated. */
  comparatorPreferredDirection: MergeDirection | null;
  /** The pending link, else the newest link whose proposal row still exists, else null. */
  link: FindingProposalLink | null;
  /** Every link for this finding, oldest first. */
  links: FindingProposalLink[];
};

export type RaiseFindingProposalInput = {
  findingId: string;
  actor: string;
  action: FindingProposalAction;
  sourceId: string;
  targetId: string;
  /** The finding fingerprint the manager inspected; must still be current. */
  expectedFingerprint: string;
};

export type RaiseFindingProposalResult = {
  /** false: an open proposal already linked this finding and is returned unchanged. */
  created: boolean;
  link: FindingProposalLink;
  proposal: Proposal;
};
