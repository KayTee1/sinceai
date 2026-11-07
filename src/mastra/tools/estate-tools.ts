// Estate tools for the live orchestrator (T22). Thin adapters over
// src/services/estate, src/services/steward/drafts and the lifecycle engine.
//
// Reads: searchEstate, checkDuplicate, listArchived, getAsset, whoSignsOff,
// portfolioSummary, suggestMerge, prepareRestore (an offer; restoring is a
// person's click).
// Writes: draftRequest stores a labelled request (no proposal, nothing
// approved). proposeRetire and proposeMerge store proposals, and only when the
// user's latest message is exactly "Propose retiring <ASSET-ID> because
// <reason>" or "Propose merging <SOURCE-ID> into <TARGET-ID>" (same rule as
// propose-build, Codex F2/F3). A merge needs both owners' approval. No tool
// approves, rejects, restores, archives or registers anything.
import type { Client } from "@libsql/client";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  checkDuplicate,
  getAsset,
  listArchived,
  portfolioSummary,
  proposeMerge,
  searchEstate,
  suggestMerge,
  whoApproves,
  type DuplicateCheck,
  type MergeSuggestions,
} from "../../services/estate";
import { ensureLifecycle, getAssetState, proposeRetire, regionSteward, tick, type Proposal } from "../../services/lifecycle";
import { analyzeRequest } from "../../services/steward/analyze";
import { DraftRequestError, draftRequest } from "../../services/steward/drafts";
import { latestUserText } from "./build-tools";
import {
  archivedView,
  approversView,
  assetView,
  draftView,
  duplicateView,
  estateItem,
  estateSearchView,
  mergeSuggestionsView,
  portfolioView,
  type RestoreOfferView,
} from "./estate-views";
import { passErrors } from "./steward-views";

const json = (value: unknown) => ({ type: "json" as const, value });

/** Same projection for the model and the UI stream; validation errors pass through. */
function compact<T>(project: (x: T) => unknown) {
  const view = passErrors(project);
  return {
    toModelOutput: (x: unknown) => json(view(x as T)),
    transform: { display: { output: ({ output }: { output?: unknown }) => view(output as T) } },
  };
}

/** A well-formed input that names nothing the estate knows; reported to the model as a tool error. */
export class EstateToolInputError extends Error {}

/** The only accepted retire command: one sentence, a reason after "because". */
export const RETIRE_COMMAND_SYNTAX = "Propose retiring <ASSET-ID> because <reason>";
const RETIRE_COMMAND = /^propose retiring ([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*) because (.+?)\.?$/i;

export function parseRetireCommand(text: string): { assetId: string; reason: string } | null {
  const t = text.trim().replace(/[ \t]+/g, " ");
  if (t.includes("\n") || t.includes("?")) return null;
  const m = RETIRE_COMMAND.exec(t);
  return m ? { assetId: m[1].toUpperCase(), reason: m[2].trim() } : null;
}

/** The only accepted merge command: one sentence naming the asset merged away, then the one kept. */
export const MERGE_COMMAND_SYNTAX = "Propose merging <SOURCE-ID> into <TARGET-ID>";
const ID = "[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*";
const MERGE_COMMAND = new RegExp(`^propose merging (${ID}) into (${ID})\\.?$`, "i");

export function parseMergeCommand(text: string): { sourceId: string; targetId: string } | null {
  const m = MERGE_COMMAND.exec(text.trim().replace(/[ \t]+/g, " "));
  return m ? { sourceId: m[1].toUpperCase(), targetId: m[2].toUpperCase() } : null;
}

export type MergeToolOutput = { status: "proposed"; proposal: Proposal } | { status: "intent_required"; message: string };

export type MergeProposalView =
  | { view: "merge-proposal/v1"; status: "proposed"; proposalId: string; sourceId: string; targetId: string; requiredApprovers: string[]; next: string }
  | { view: "merge-proposal/v1"; status: "intent_required"; message: string };

export function mergeProposalView(o: MergeToolOutput): MergeProposalView {
  if (o.status === "intent_required") return { view: "merge-proposal/v1", status: o.status, message: o.message };
  const ev = o.proposal.evidence as { sourceId: string; targetId: string };
  return {
    view: "merge-proposal/v1",
    status: "proposed",
    proposalId: o.proposal.id,
    sourceId: ev.sourceId,
    targetId: ev.targetId,
    requiredApprovers: o.proposal.requiredApprovers,
    next: "Waiting for every listed approver (both owners) to approve on the proposal card. Nothing is merged or archived yet.",
  };
}

export type RetireToolOutput =
  | { status: "proposed"; proposal: Proposal }
  | { status: "intent_required"; message: string };

export type RetireView =
  | { view: "retire-proposal/v1"; status: "proposed"; proposalId: string; assetId: string; requiredApprovers: string[]; proposalStatus: string; dueOn: string | null; next: string }
  | { view: "retire-proposal/v1"; status: "intent_required"; message: string };

export function retireView(o: RetireToolOutput): RetireView {
  if (o.status === "intent_required") return { view: "retire-proposal/v1", status: o.status, message: o.message };
  return {
    view: "retire-proposal/v1",
    status: "proposed",
    proposalId: o.proposal.id,
    assetId: o.proposal.assetIds[0],
    requiredApprovers: o.proposal.requiredApprovers,
    proposalStatus: o.proposal.status,
    dueOn: o.proposal.dueOn,
    next: "Pending a human decision on the proposal card (owner, or the data steward once escalated). Nothing is archived yet.",
  };
}

async function syncLifecycle(db: Client): Promise<string> {
  await ensureLifecycle(db);
  return (await tick(db)).date;
}

const name = z.string().trim().min(1).max(100);
const assetIdSchema = z.string().trim().min(1).max(64).describe("Asset or insight ID, e.g. AST-0123 or INS-TEAM-REQ-01-1");

export function createEstateTools(getDb: () => Client, opts: { sync?: (db: Client) => Promise<string> } = {}) {
  const sync = opts.sync ?? syncLifecycle;
  const ready = async () => {
    const db = getDb();
    const date = await sync(db);
    return { db, date };
  };

  const searchEstateTool = createTool({
    id: "search-estate",
    description:
      "Read-only search over the whole estate: imported catalog dashboards and app-built insights, with tier and " +
      "status (active, lease_due, archived). Filter by product, market, KPI IDs, words in the name, or status. " +
      "Exploration only; for a governed answer to a request use analyzeRequest.",
    inputSchema: z.object({
      product: name.nullish().describe("Product name or All Pharma"),
      market: name.nullish().describe("Market ID, region or Global"),
      kpiIds: z.array(z.string().trim().min(1).max(32)).max(10).nullish(),
      text: z.string().trim().max(100).nullish().describe("Words that must all appear in the asset name"),
      status: z.enum(["active", "archived", "any"]).nullish(),
    }),
    execute: async (q) => {
      const { db } = await ready();
      return searchEstate(db, {
        product: q.product ?? undefined,
        market: q.market ?? undefined,
        kpiIds: q.kpiIds ?? undefined,
        text: q.text ?? undefined,
        status: q.status ?? "any",
        limit: 50,
      });
    },
    ...compact(estateSearchView),
  });

  const checkDuplicateTool = createTool({
    id: "check-duplicate",
    description:
      "Read-only gate before anything new is built: does an active or app-built asset, an archived asset, or a build " +
      "already waiting cover this scope and every KPI? Give a stored request ID (uses its analysed scope and approved " +
      "KPIs) or a product, market and KPI IDs. Verdicts: reuse, pending, restore, partial, none.",
    inputSchema: z.object({
      requestId: z.string().trim().min(1).max(64).nullish(),
      answer: z.object({ product: name, market: name }).nullish().describe("Only for a request that needed clarification"),
      product: name.nullish(),
      market: name.nullish(),
      kpiIds: z.array(z.string().trim().min(1).max(32)).max(10).nullish(),
    }),
    execute: async (q): Promise<DuplicateCheck> => {
      const { db } = await ready();
      if (q.requestId) {
        const a = await analyzeRequest(db, q.requestId, q.answer ?? undefined);
        if (!a.clarification.resolved) throw new EstateToolInputError(`${a.request.id} needs a scope clarification first.`);
        const kpiIds = a.kpiChecks.flatMap((k) => (k.approved ? [k.approved.id] : []));
        return checkDuplicate(db, { scope: a.clarification.resolved, kpiIds });
      }
      if (!q.product || !q.market || !q.kpiIds?.length) {
        throw new EstateToolInputError("Give a requestId, or a product, market and at least one KPI ID.");
      }
      return checkDuplicate(db, { scope: { product: q.product, market: q.market }, kpiIds: q.kpiIds });
    },
    ...compact(duplicateView),
  });

  const listArchivedTool = createTool({
    id: "list-archived",
    description:
      "Read-only: archived assets (newest first) with when and why they were archived and the tier a restore returns " +
      "them to. Filter by product, market or words in the name.",
    inputSchema: z.object({ product: name.nullish(), market: name.nullish(), text: z.string().trim().max(100).nullish() }),
    execute: async (q) => {
      const { db } = await ready();
      return listArchived(db, { product: q.product ?? undefined, market: q.market ?? undefined, text: q.text ?? undefined, limit: 50 });
    },
    ...compact(archivedView),
  });

  const getAssetTool = createTool({
    id: "get-asset",
    description: "Read-only: one asset's scope, tier, status, lease or TTL end, owner, KPIs, usage, open proposals and recent timeline.",
    inputSchema: z.object({ assetId: assetIdSchema }),
    execute: async ({ assetId }) => {
      const { db } = await ready();
      const d = await getAsset(db, assetId);
      if (!d) throw new EstateToolInputError(`Unknown asset ${assetId}.`);
      return d;
    },
    ...compact(assetView),
  });

  const whoSignsOffTool = createTool({
    id: "who-signs-off",
    description:
      "Read-only: who would decide. With a market: the Leads who approve a build there. With an asset ID: its owner " +
      "for reviews and the data steward it escalates to.",
    inputSchema: z.object({ market: name.nullish(), assetId: assetIdSchema.nullish() }),
    execute: async (q) => {
      const { db } = await ready();
      if (!q.market && !q.assetId) throw new EstateToolInputError("Give a market or an asset ID.");
      return whoApproves(db, { market: q.market ?? undefined, assetId: q.assetId ?? undefined });
    },
    ...compact(approversView),
  });

  const portfolioSummaryTool = createTool({
    id: "portfolio-summary",
    description:
      "Read-only: estate counts by tier before the app and now, what changed (renewed, retired, built, ...), " +
      "what is waiting for a decision and the next scheduled lifecycle event.",
    inputSchema: z.object({}),
    execute: async () => {
      const { db } = await ready();
      return portfolioSummary(db);
    },
    ...compact(portfolioView),
  });

  const prepareRestoreTool = createTool({
    id: "prepare-restore",
    description:
      "Read-only: offers to restore an archived asset instead of building a new one. Shows a card with a Restore " +
      "button for the owner (or the data steward). It restores nothing itself; a person clicks Restore.",
    inputSchema: z.object({ assetId: assetIdSchema }),
    execute: async ({ assetId }): Promise<RestoreOfferView> => {
      const { db } = await ready();
      const id = assetId.toUpperCase();
      const state = await getAssetState(db, id);
      if (!state) throw new EstateToolInputError(`Unknown asset ${assetId}.`);
      if (state.status !== "archived") throw new EstateToolInputError(`${id} is not archived (${state.status}).`);
      const archived = (await listArchived(db, { limit: 1000 })).assets.find((a) => a.assetId === id);
      const detail = await getAsset(db, id);
      if (!archived || !detail) throw new EstateToolInputError(`Unknown asset ${assetId}.`);
      const restorers: { id: string; name: string }[] = [];
      if (detail.asset.ownerId && detail.asset.ownerActive) restorers.push({ id: detail.asset.ownerId, name: detail.asset.ownerName ?? detail.asset.ownerId });
      const steward = await regionSteward(db, detail.asset.ownerId);
      if (steward && !restorers.some((r) => r.id === steward)) {
        const s = await db.execute({ sql: `SELECT owner_name FROM Owners WHERE owner_id = ?`, args: [steward] });
        restorers.push({ id: steward, name: (s.rows[0]?.owner_name as string | undefined) ?? steward });
      }
      return {
        view: "restore-offer/v1",
        asset: {
          ...estateItem({ ...archived, kpiMatches: [], coversAllKpis: false }),
          archivedOn: archived.archivedOn,
          archivedBecause: archived.archivedBecause,
          restoresTo: archived.restoredTier,
        },
        restorers,
        next: `Restoring returns ${id} to ${archived.restoredTier} with a new lease (a Temporary insight gets a fresh 30-day TTL). A person clicks Restore on the card.`,
      };
    },
    ...compact((x: RestoreOfferView) => x),
  });

  const draftRequestTool = createTool({
    id: "draft-request",
    description:
      "Stores a typed question as a request (DRAFT-nnn, labelled 'drafted in chat', never a Bayer request) so it can " +
      "go through the governed analysis. Use it when the user asks for a new dashboard or insight in their own words. " +
      "Pass the user's question as text and the product and market they named (ask if missing). Then call " +
      "analyzeRequest with the returned ID. It proposes and approves nothing.",
    inputSchema: z.object({
      text: z.string().trim().min(5).max(400).describe("The user's question, in their words"),
      product: name.describe("Catalog product name or All Pharma"),
      market: name.describe("Market ID or name, region, or Global"),
    }),
    execute: async (input) => {
      const { db, date } = await ready();
      try {
        return await draftRequest(db, input, date);
      } catch (err) {
        if (err instanceof DraftRequestError) throw new EstateToolInputError(err.message);
        throw err;
      }
    },
    ...compact(draftView),
  });

  const proposeRetireTool = createTool({
    id: "propose-retire",
    description:
      "Stores a retire proposal for an asset before its lease ends, for its owner (or the data steward) to decide. " +
      `Use ONLY when the user's latest message is exactly "${RETIRE_COMMAND_SYNTAX}". Pass that asset ID. ` +
      "The reason is taken from the user's message. It never archives anything; a person decides on the proposal card.",
    inputSchema: z.object({ assetId: assetIdSchema }),
    execute: async ({ assetId }, context): Promise<RetireToolOutput> => {
      const userText = latestUserText((context as { agent?: { messages?: unknown } } | undefined)?.agent?.messages);
      const command = userText === null ? null : parseRetireCommand(userText);
      if (!command || command.assetId !== assetId.trim().toUpperCase()) {
        return {
          status: "intent_required",
          message: `No proposal was stored. To propose a retire the user sends exactly: "${RETIRE_COMMAND_SYNTAX}" for this asset.`,
        };
      }
      const { db, date } = await ready();
      return { status: "proposed", proposal: await proposeRetire(db, { assetId: command.assetId, reason: command.reason }, date) };
    },
    ...compact(retireView),
  });

  const suggestMergeTool = createTool({
    id: "suggest-merge",
    description:
      "Read-only: dashboards that overlap an asset (or every active asset in a scope) and whether to merge them. " +
      "Verdicts: merge (the kept dashboard covers every KPI for the same or a broader scope), keep_both (it covers " +
      "them but adds many unrelated KPIs, so merging would bury the focused one's users), partial (it lacks some " +
      "KPIs). Usage is per dashboard; interest in a single metric is unknown. It proposes nothing.",
    inputSchema: z.object({ assetId: assetIdSchema.nullish(), product: name.nullish(), market: name.nullish() }),
    execute: async (q): Promise<MergeSuggestions> => {
      const { db, date } = await ready();
      if (!q.assetId && !q.product && !q.market) throw new EstateToolInputError("Give an asset ID, or a product and/or market.");
      return suggestMerge(db, { assetId: q.assetId ?? undefined, product: q.product ?? undefined, market: q.market ?? undefined }, date);
    },
    ...compact(mergeSuggestionsView),
  });

  const proposeMergeTool = createTool({
    id: "propose-merge",
    description:
      "Stores a merge proposal: the source dashboard is merged into the target, which must cover its scope and every " +
      "KPI. Both owners must approve on the proposal card (a data steward stands in for an inactive owner). " +
      `Use ONLY when the user's latest message is exactly "${MERGE_COMMAND_SYNTAX}", with the same two IDs. ` +
      "It never merges or archives anything itself.",
    inputSchema: z.object({ sourceId: assetIdSchema, targetId: assetIdSchema }),
    execute: async ({ sourceId, targetId }, context): Promise<MergeToolOutput> => {
      const userText = latestUserText((context as { agent?: { messages?: unknown } } | undefined)?.agent?.messages);
      const command = userText === null ? null : parseMergeCommand(userText);
      if (!command || command.sourceId !== sourceId.trim().toUpperCase() || command.targetId !== targetId.trim().toUpperCase()) {
        return {
          status: "intent_required",
          message: `No proposal was stored. To propose a merge the user sends exactly: "${MERGE_COMMAND_SYNTAX}".`,
        };
      }
      const { db, date } = await ready();
      return { status: "proposed", proposal: await proposeMerge(db, command, date) };
    },
    ...compact(mergeProposalView),
  });

  return {
    suggestMerge: suggestMergeTool,
    proposeMerge: proposeMergeTool,
    searchEstate: searchEstateTool,
    checkDuplicate: checkDuplicateTool,
    listArchived: listArchivedTool,
    getAsset: getAssetTool,
    whoSignsOff: whoSignsOffTool,
    portfolioSummary: portfolioSummaryTool,
    prepareRestore: prepareRestoreTool,
    draftRequest: draftRequestTool,
    proposeRetire: proposeRetireTool,
  };
}
