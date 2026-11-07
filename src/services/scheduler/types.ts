// T24 (B1): governance scheduler contracts. One job today (incremental
// overlap); the mode and trigger unions are where Mode 3 (periodic
// reassessment) and clock / cron triggers will be added later.
import type { MergeVerdict } from "../estate";

/** Mode 2 only in B1. Mode 3 ("reassessment") is a later branch. */
export type SchedulerMode = "incremental";
/** Manual only in B1. Simulated-clock and cron triggers are later branches. */
export type TriggerSource = "manual";
export type JobId = "incremental_overlap";
export type RunStatus = "running" | "succeeded" | "failed";
export type FindingStatus = "open" | "dismissed";

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

/** Audit-log IDs (exclusive, inclusive] this run reads. IDs restart after a demo reset; see schema.ts. */
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
};

export type RunSummary = {
  window: ChangeWindow;
  eventsRead: number;
  relevantEvents: number;
  ignoredSchedulerEvents: number;
  assessments: AssetAssessment[];
  findings: FindingCounts;
  limitations: string[];
};

export type RunError = {
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

/** What a finding's identity and "material change" are judged on: scope and KPIs of both assets, and the verdict. */
export type OverlapBasis = {
  verdict: "merge";
  assets: { assetId: string; product: string; market: string; kpiIds: string[] }[];
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
