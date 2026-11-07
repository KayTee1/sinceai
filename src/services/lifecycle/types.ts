import type { Client, Transaction } from "@libsql/client";

export type Db = Client | Transaction;

export type Tier = "temporary" | "personal" | "team" | "certified";
export type AssetStatus = "active" | "lease_due" | "archived";

export type AssetState = {
  assetId: string;
  origin: "pack" | "app";
  name: string | null; // only for app-created assets; pack names stay in Analytics_Assets
  ownerId: string | null;
  tier: Tier;
  status: AssetStatus;
  leaseEnd: string | null;
  ttlEnd: string | null;
  prevTier: Tier | null;
  sourceEndorsement: string | null;
};

export type ReviewEvidence = {
  avgMonthlyUsers: number | null;
  usageMonths: string[];
  appOpens90d: number;
  sourceLifecycleStatus: string | null;
  ownerStatus: "active" | "inactive" | "missing";
  downstreamAssets: string[];
  source: { sheet: string; ids: string[] }[];
};

export type ProposalType = "renew" | "retire";
export type ProposalStatus = "open" | "escalated" | "approved" | "rejected" | "expired";

export type Proposal = {
  id: string;
  version: number;
  type: ProposalType;
  assetIds: string[];
  rationale: string;
  evidence: ReviewEvidence;
  requiredApprovers: string[];
  status: ProposalStatus;
  createdOn: string;
  dueOn: string | null;
};

export type Clock = { date: string; running: boolean; anchorMs: number };

export type AuditEntry = {
  id: number;
  simDate: string;
  actor: string;
  action: string;
  assetId: string | null;
  proposalId: string | null;
  policyVersion: string | null;
  rationale: string;
  evidence: unknown;
  createdAt: string;
};

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_allowed" | "invalid",
  ) {
    super(message);
  }
}
