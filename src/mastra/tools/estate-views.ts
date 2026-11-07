// Compact chat views of the estate reads (T22). Same rule as steward-views.ts:
// select and rename fields only; never compute, round or reword a value. Lists
// are capped so a busy estate does not flood the chat history.
import type {
  ArchivedAsset,
  AssetDetail,
  Approvers,
  DuplicateCheck,
  EstateHit,
  EstateSearchResult,
  MergeSide,
  MergeSuggestions,
  PortfolioSummary,
} from "../../services/estate";
import type { DraftedRequest } from "../../services/steward/drafts";

export const ESTATE_SHOWN = 6;

export type EstateItemView = {
  assetId: string;
  name: string;
  origin: "catalog" | "app";
  scope: string;
  tier: string;
  status: string;
  owner: string | null;
  ownerActive: boolean;
  kpiIds: string[];
  coversAllKpis: boolean;
};

export function estateItem(a: EstateHit): EstateItemView {
  return {
    assetId: a.assetId,
    name: a.name,
    origin: a.origin,
    scope: `${a.product} · ${a.market}`,
    tier: a.tier,
    status: a.status,
    owner: a.ownerName ?? a.ownerId,
    ownerActive: a.ownerActive,
    kpiIds: a.kpiIds,
    coversAllKpis: a.coversAllKpis,
  };
}

export type EstateSearchView = { view: "estate-search/v1"; total: number; shown: number; assets: EstateItemView[]; note: string };

export function estateSearchView(r: EstateSearchResult): EstateSearchView {
  const assets = r.assets.slice(0, ESTATE_SHOWN).map(estateItem);
  return {
    view: "estate-search/v1",
    total: r.total,
    shown: assets.length,
    assets,
    note: "Catalog metadata and app state only: period, dimensions and filters of an asset are unknown.",
  };
}

export type DuplicateView = {
  view: "duplicate-check/v1";
  scope: string;
  kpiIds: string[];
  verdict: DuplicateCheck["verdict"];
  rationale: string;
  active: EstateItemView[];
  archived: EstateItemView[];
  partial: EstateItemView[];
  pending: DuplicateCheck["pending"];
};

export function duplicateView(d: DuplicateCheck): DuplicateView {
  return {
    view: "duplicate-check/v1",
    scope: `${d.scope.product} · ${d.scope.market}`,
    kpiIds: d.kpiIds,
    verdict: d.verdict,
    rationale: d.rationale,
    active: d.active.slice(0, ESTATE_SHOWN).map(estateItem),
    archived: d.archived.slice(0, ESTATE_SHOWN).map(estateItem),
    partial: d.partial.slice(0, 3).map(estateItem),
    pending: d.pending,
  };
}

export type ArchivedView = {
  view: "archived-list/v1";
  total: number;
  assets: (EstateItemView & { archivedOn: string | null; archivedBecause: string | null; restoresTo: string })[];
  next: string;
};

export function archivedView(r: { total: number; assets: ArchivedAsset[] }): ArchivedView {
  return {
    view: "archived-list/v1",
    total: r.total,
    assets: r.assets.slice(0, ESTATE_SHOWN).map((a) => ({
      ...estateItem({ ...a, kpiMatches: [], coversAllKpis: false }),
      archivedOn: a.archivedOn,
      archivedBecause: a.archivedBecause,
      restoresTo: a.restoredTier,
    })),
    next: "Archived assets are restorable. Restoring is a person's click on the asset's Restore button (prepareRestore).",
  };
}

export type AssetView = {
  view: "asset-detail/v1";
  asset: EstateItemView & { leaseEnd: string | null; ttlEnd: string | null };
  usage: AssetDetail["usage"];
  openProposals: AssetDetail["openProposals"];
  timeline: AssetDetail["timeline"];
};

export function assetView(d: AssetDetail): AssetView {
  return {
    view: "asset-detail/v1",
    asset: { ...estateItem({ ...d.asset, kpiMatches: [], coversAllKpis: false }), leaseEnd: d.asset.leaseEnd, ttlEnd: d.asset.ttlEnd },
    usage: d.usage,
    openProposals: d.openProposals,
    timeline: d.timeline,
  };
}

export type ApproversView = Approvers & { view: "approvers/v1" };
export const approversView = (a: Approvers): ApproversView => ({ view: "approvers/v1", ...a });

export type PortfolioView = PortfolioSummary & { view: "portfolio/v1" };
export const portfolioView = (p: PortfolioSummary): PortfolioView => ({ view: "portfolio/v1", ...p });

export type DraftView = DraftedRequest & { view: "draft-request/v1"; next: string };
export const draftView = (d: DraftedRequest): DraftView => ({
  view: "draft-request/v1",
  ...d,
  next: `Stored as ${d.requestId} (drafted in chat, not a Bayer request). Now call analyzeRequest with ${d.requestId}.`,
});

export type RestoreOfferView = {
  view: "restore-offer/v1";
  asset: EstateItemView & { archivedOn: string | null; archivedBecause: string | null; restoresTo: string };
  /** People who may click Restore: the owner when active, else the region's data steward. */
  restorers: { id: string; name: string }[];
  next: string;
};

export type MergeSideView = EstateItemView & { packUsers: number | null; appOpens90d: number; approver: string | null };

export type MergeSuggestionsView = {
  view: "merge-suggestions/v1";
  total: number;
  suggestions: {
    verdict: "merge" | "keep_both" | "partial";
    mergeAway: MergeSideView;
    keep: MergeSideView;
    sharedKpis: string[];
    missingKpis: string[];
    extraKpis: string[];
    downstreamAssets: string[];
    reason: string;
  }[];
  note: string;
};

const sideView = (s: MergeSide): MergeSideView => ({
  ...estateItem({ ...s, kpiMatches: [], coversAllKpis: false }),
  packUsers: s.packUsers,
  appOpens90d: s.appOpens90d,
  approver: s.approver,
});

export function mergeSuggestionsView(r: MergeSuggestions): MergeSuggestionsView {
  return {
    view: "merge-suggestions/v1",
    total: r.total,
    suggestions: r.suggestions.map((x) => ({
      verdict: x.verdict,
      mergeAway: sideView(x.mergeAway),
      keep: sideView(x.keep),
      sharedKpis: x.sharedKpis,
      missingKpis: x.missingKpis,
      extraKpis: x.extraKpis,
      downstreamAssets: x.downstreamAssets,
      reason: x.reason,
    })),
    note: r.note,
  };
}
