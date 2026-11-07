// T24: governance scheduler contracts. Two jobs: incremental overlap
// (Mode 2, B1) and periodic reassessment of known findings (Mode 3, B2).
// Clock / cron triggers are later branches.
import type { MergeVerdict } from "../estate";

export type SchedulerMode = "incremental" | "reassessment";
/** Manual only. Simulated-clock and cron triggers are later branches. */
export type TriggerSource = "manual";
export type JobId = "incremental_overlap" | "periodic_reassessment";
export type RunStatus = "running" | "succeeded" | "failed";
/**
 * open / dismissed: B1. resolved: a reassessment found the overlap no longer
 * holds (see `Finding.resolution`). superseded: reserved by the shared
 * contract; nothing produces it yet (one rule, and the dedup key does not
 * include the rule version, so no newer finding can cover the same pair).
 */
export type FindingStatus = "open" | "dismissed" | "resolved" | "superseded";
export const FINDING_STATUSES: readonly FindingStatus[] = ["open", "dismissed", "resolved", "superseded"];

export type RuleRef = { ruleId: string; version: string };

export type JobDescriptor = {
  jobId: JobId;
  mode: SchedulerMode;
  title: string;
  description: string;
  triggers: TriggerSource[];
  rules: RuleRef[];
  /** Audit actions that make an asset a target for this job. */
  watchedActions: string[];
  /** What this job cannot see; reported, never treated as healthy. */
  limitations: string[];
};

/**
 * Audit-log IDs (exclusive, inclusive]. Incremental runs read exactly these
 * rows. Periodic reassessment runs read none: their window is a reference,
 * from the previous successful periodic run's upper bound (0 if none) to
 * MAX(audit_log.id) when the run was claimed. IDs restart after a demo reset;
 * see schema.ts.
 */
export type ChangeWindow = { fromAuditId: number; toAuditId: number };

export type ChangeTrigger = { auditId: number; action: string; simDate: string };

export type AssessmentOutcome =
  /** Compared with the active estate. */
  | "evaluated"
  /** Asset exists but its overlap cannot be assessed (e.g. maps no KPIs). Not healthy, just unknown. */
  | "unsupported"
  /** Archived again by the time the run looked; nothing to compare. */
  | "inactive"
  /** No lifecycle or catalog record for the ID. */
  | "unknown";

export type AssetAssessment = {
  assetId: string;
  triggers: ChangeTrigger[];
  outcome: AssessmentOutcome;
  reason: string;
  /** Overlapping active assets by suggestMerge verdict. Only "merge" becomes a finding. */
  overlaps: Record<MergeVerdict, number>;
  findingKeys: string[];
};

export type FindingCounts = {
  created: number;
  /** Open finding seen again with changed evidence. */
  updated: number;
  /** Open finding seen again with the same evidence. */
  unchanged: number;
  /** Dismissed finding whose evidence changed: open again (audited). */
  reopened: number;
  /** Dismissed finding seen again with the evidence it was dismissed on: stays dismissed. */
  suppressed: number;
  /** Reassessment only: the overlap no longer holds. Absent on incremental runs. */
  resolved?: number;
};

export type RunSummary = {
  window: ChangeWindow;
  eventsRead: number;
  relevantEvents: number;
  ignoredSchedulerEvents: number;
  assessments: AssetAssessment[];
  findings: FindingCounts;
  limitations: string[];
  /** Periodic reassessment runs only (additive, C2). */
  reassessment?: ReassessmentSummary;
};

/** Why a reassessment closed a finding. */
export type ResolutionReason =
  /** One side is archived now: nothing to merge (not a retire signal). */
  | "asset_inactive"
  /** One side has no lifecycle or catalog record any more. */
  | "asset_unknown"
  /** Neither side's scope covers the other any more, or they share no KPI. */
  | "no_overlap"
  /** The pair still overlaps but suggestMerge's verdict is keep_both or partial now. */
  | "verdict_changed";

export type ResolvedAssetState = {
  assetId: string;
  /** Lifecycle status, or "unknown" when there is no record. */
  status: string;
  product: string | null;
  market: string | null;
  tier: string | null;
  kpiIds: string[];
};

/** The evidence a reassessment resolved a finding on. */
export type ResolutionEvidence = {
  assets: ResolvedAssetState[];
  /** suggestMerge's verdict for the pair now, or null when it reports no pair (or a side could not be compared). */
  verdict: MergeVerdict | null;
  /** suggestMerge's reasoning for that verdict, if any. */
  suggestionReason: string | null;
  sharedKpis: string[];
  /** Fingerprint of the evidence the finding held before it was resolved. */
  previousFingerprint: string;
};

export type FindingResolution = {
  reason: ResolutionReason;
  message: string;
  /** Status the finding had when it was resolved. A dismissed finding keeps its dismissal while resolved. */
  fromStatus: "open" | "dismissed";
  at: string;
  simDate: string;
  runId: string;
  evidence: ResolutionEvidence;
};

export type ReassessmentOutcome =
  /** Still a merge overlap with the same fingerprint (open): last seen + count only. */
  | "unchanged"
  /** Still a merge overlap, material evidence changed (open): evidence replaced. */
  | "updated"
  /** Dismissed, still overlapping with the evidence it was dismissed on: stays dismissed. */
  | "suppressed"
  /** Dismissed, still overlapping with changed evidence: open again (audited). */
  | "reopened"
  /** The overlap no longer holds: status resolved (audited). */
  | "resolved"
  /** A side exists but cannot be compared (no built insight, or maps no KPIs): left as it was. */
  | "indeterminate"
  /** The finding changed (another run, a dismissal) between evaluation and commit: left as it is now. */
  | "skipped";

export type FindingReassessment = {
  findingId: string;
  dedupKey: string;
  assetIds: string[];
  fromStatus: FindingStatus;
  /** Status after the commit (equals fromStatus when nothing changed). */
  toStatus: FindingStatus;
  outcome: ReassessmentOutcome;
  reason: string;
  previousFingerprint: string;
  /** Fingerprint observed now (null when the overlap no longer holds or could not be assessed). */
  fingerprint: string | null;
  resolution?: { reason: ResolutionReason; evidence: ResolutionEvidence };
};

export type ReassessmentCounts = Record<ReassessmentOutcome, number>;

/** A pending proposal resting on evidence that changed or no longer holds. Reported only; the scheduler never touches proposals. */
export type StaleProposal = {
  proposalId: string;
  type: string;
  status: string;
  /** Assets the proposal names (for a merge: source and target). */
  assetIds: string[];
  findingId: string;
  /**
   * linked: the finding's proposalId (B3); same_pair: the proposal names both
   * of the finding's assets; shares_asset: it names one of them.
   */
  relation: "linked" | "same_pair" | "shares_asset";
  findingOutcome: "updated" | "reopened" | "resolved";
  reason: string;
};

export type ReassessmentSummary = {
  /** Findings in scope at evaluation time, by status (open and dismissed only). */
  scope: { open: number; dismissed: number };
  /** Assets the run compared: only those named by findings in scope. */
  assetsCompared: string[];
  counts: ReassessmentCounts;
  results: FindingReassessment[];
  staleProposals: StaleProposal[];
};

export type RunError = {
  /**
   * evaluation_failed: comparing the estate failed. commit_failed: anything
   * between evaluation and the end of the commit transaction failed (the
   * transaction rolled back; nothing of the run was written). abandoned: a
   * manager recovered the run by hand.
   */
  code: "evaluation_failed" | "commit_failed" | "abandoned";
  stage: "evaluate" | "commit" | "recovery";
  message: string;
  at: string;
  /** Who abandoned the run (recovery only). */
  actor?: string;
};

export type SchedulerRun = {
  runId: string;
  jobId: JobId;
  mode: SchedulerMode;
  trigger: TriggerSource;
  actor: string;
  /** Simulated date the run evaluated at (stored clock date; the scheduler does not tick the clock). */
  simDate: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  window: ChangeWindow;
  rules: RuleRef[];
  policyVersion: string;
  summary: RunSummary | null;
  error: RunError | null;
};

export type OverlapSide = {
  assetId: string;
  name: string;
  origin: "catalog" | "app";
  product: string;
  market: string;
  tier: string;
  ownerId: string | null;
  kpiIds: string[];
  packUsers: number | null;
  appOpens90d: number;
};

/** What a finding's "material change" is judged on: the verdict and, per asset, scope, KPIs and governance tier (overlap.ts fingerprintOf). */
export type OverlapBasis = {
  verdict: "merge";
  assets: { assetId: string; product: string; market: string; tier: string; kpiIds: string[] }[];
};

export type OverlapEvidence = {
  kind: "active_overlap";
  /** The changed asset that led to this observation. */
  changedAssetId: string;
  triggers: ChangeTrigger[];
  /** suggestMerge's verdict and reasoning, unchanged. A finding is not a merge decision. */
  verdict: "merge";
  mergeAway: OverlapSide;
  keep: OverlapSide;
  sharedKpis: string[];
  extraKpis: string[];
  downstreamAssets: string[];
  reason: string;
  usageNote: string;
  basis: OverlapBasis;
  source: { sheet: string; ids: string[] }[];
};

export type Finding = {
  findingId: string;
  dedupKey: string;
  ruleId: string;
  ruleVersion: string;
  assetIds: string[];
  status: FindingStatus;
  evidence: OverlapEvidence;
  fingerprint: string;
  firstSeen: { at: string; simDate: string; runId: string };
  lastSeen: { at: string; simDate: string; runId: string };
  observations: number;
  dismissal: { actor: string; reason: string; at: string; simDate: string; fingerprint: string } | null;
  /** Reserved for a later finding-to-proposal step; always null in B1. */
  proposalId: string | null;
  /** Set while status is resolved: why and on what evidence (Mode 3). Cleared when the finding reopens. */
  resolution: FindingResolution | null;
};

export class SchedulerError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_allowed" | "invalid" | "conflict",
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}
