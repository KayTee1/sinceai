// T22: estate reads, the duplicate gate, early retire, drafts and the estate
// tools. Fixture: the T15 facts with a Lead (OWN-1), a requester (OWN-R) and a
// steward (OWN-S) in EMEA. AST-1 (Alphazol / EMEA) maps KPI-004 only, so
// REQ-S01 (KPI-004 + KPI-042) recommends a build.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { ORCHESTRATOR_INSTRUCTIONS, createOrchestratorTools } from "../src/mastra/agents/orchestrator-config";
import { parseMergeCommand, parseRetireCommand, type MergeProposalView, type RetireView } from "../src/mastra/tools/estate-tools";
import type { DuplicateView, RestoreOfferView } from "../src/mastra/tools/estate-views";
import { decideBuild, proposeBuild } from "../src/services/build";
import {
  checkDuplicate,
  getAsset,
  listArchived,
  portfolioSummary,
  proposeMerge,
  searchEstate,
  suggestMerge,
  whoApproves,
} from "../src/services/estate";
import { getAssetAudit } from "../src/services/lifecycle";
import {
  LifecycleError,
  decide,
  getAssetState,
  getProposal,
  listPendingProposals,
  processDue,
  proposeRetire,
  resetLifecycle,
} from "../src/services/lifecycle";
import { analyzeRequest } from "../src/services/steward/analyze";
import { CHAT_REQUEST_SHEET, DraftRequestError, draftRequest } from "../src/services/steward/drafts";
import { FACT_SHEETS } from "./fixtures/facts";
import { runChat, userMessage } from "./helpers/mock-agent";

const OWNERS: ParsedSheet = {
  sheet: "Owners",
  data: [
    ["owner_id", "owner_name", "role", "scope", "status"],
    ["OWN-1", "Fixture Lead", "Commercial Lead", "EMEA", "active"],
    ["OWN-R", "Fixture Requester", "Analyst", "EMEA", "active"],
    ["OWN-S", "Fixture Steward", "Data Steward", "EMEA", "active"],
  ],
};
// Merge fixture (ours): AST-2 (Betavex US, OWN-R, busy) is covered by AST-3
// (Betavex Global, OWN-1) with the same KPI, and by AST-4, a Global
// "everything" board with five unrelated KPIs. AST-2 feeds AST-9.
const TAIL = ["active", "certified", "Dashboard", "Power BI", "WS-1", "2026-09-01"];
function patch(s: ParsedSheet): ParsedSheet {
  if (s.sheet === "Owners") return OWNERS;
  if (s.sheet === "Analytics_Assets") {
    const rows = s.data.map((r, i) => (i > 0 && r[0] === "AST-2" ? [...r.slice(0, 5), "OWN-R", ...r.slice(6)] : r));
    return { sheet: s.sheet, data: [...rows, ["AST-4", "Betavex Global Everything", "SM-1", "Betavex", "Global", "OWN-S", ...TAIL]] };
  }
  if (s.sheet === "Asset_KPI_Map") {
    const extra = ["KPI-001", "KPI-004", "KPI-005", "KPI-014", "KPI-027", "KPI-042"].map((k) => ["AST-4", k, "primary"]);
    return { sheet: s.sheet, data: [...s.data, ...extra] };
  }
  return s;
}
// Lease-review evidence reads usage telemetry and lineage.
const SHEETS = [
  ...FACT_SHEETS.map(patch),
  {
    sheet: "Asset_Usage",
    data: [
      ["asset_id", "month", "views", "unique_users"],
      ["AST-2", "2026-10-01", 900, 300],
      ["AST-3", "2026-10-01", 120, 40],
    ],
  },
  { sheet: "Lineage_Edges", data: [["source_id", "target_id", "edge_type", "relationship"], ["AST-2", "AST-9", "ASSET_TO_ASSET", "feeds"]] },
].filter((s, i, all) => all.findIndex((x) => x.sheet === s.sheet) === i);
const EXPECTED = Object.fromEntries(SHEETS.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));
const DAY = "2026-11-03";
const ALPHAZOL_EMEA = { product: "Alphazol", market: "EMEA" };

const dir = mkdtempSync(join(tmpdir(), "estate-test-"));
let db: Client;
let imported = false;

beforeEach(async () => {
  if (!imported) {
    const dest = join(dir, "estate.db");
    await importWorkbook({ sheets: SHEETS, dest, expected: EXPECTED });
    db = openDb(dest);
    imported = true;
  }
  await resetLifecycle(db, 0);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function archiveAst1() {
  const p = await proposeRetire(db, { assetId: "AST-1", reason: "Duplicate of a newer board." }, DAY);
  await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY);
}

async function buildRequestS01() {
  const r = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
  assert.equal(r.status, "proposed");
  return (r as { proposal: { id: string } }).proposal.id;
}

describe("searchEstate", () => {
  it("finds catalog assets whose scope covers the query, with lifecycle state", async () => {
    const r = await searchEstate(db, { ...ALPHAZOL_EMEA, kpiIds: ["KPI-004"] });
    const ast1 = r.assets.find((a) => a.assetId === "AST-1");
    assert.ok(ast1);
    assert.deepEqual([ast1.origin, ast1.status, ast1.coversAllKpis], ["catalog", "active", true]);
    assert.ok(r.assets.every((a) => a.product === "Alphazol" || a.product === "All Pharma"));
  });

  it("filters by status", async () => {
    await archiveAst1();
    assert.ok((await searchEstate(db, { status: "archived" })).assets.some((a) => a.assetId === "AST-1"));
    assert.ok(!(await searchEstate(db, { status: "active" })).assets.some((a) => a.assetId === "AST-1"));
  });
});

describe("checkDuplicate", () => {
  it("reuse when an active asset covers every KPI; partial when it covers some", async () => {
    assert.equal((await checkDuplicate(db, { scope: ALPHAZOL_EMEA, kpiIds: ["KPI-004"] })).verdict, "reuse");
    const partial = await checkDuplicate(db, { scope: ALPHAZOL_EMEA, kpiIds: ["KPI-004", "KPI-042"] });
    assert.equal(partial.verdict, "partial");
    assert.deepEqual(partial.partial.map((a) => a.assetId), ["AST-1"]);
  });

  it("restore when only an archived asset covers it", async () => {
    await archiveAst1();
    const d = await checkDuplicate(db, { scope: ALPHAZOL_EMEA, kpiIds: ["KPI-004"] });
    assert.equal(d.verdict, "restore");
    assert.deepEqual(d.archived.map((a) => a.assetId), ["AST-1"]);
  });

  it("pending while a build waits, then reuse of the app-built insight once approved", async () => {
    const proposalId = await buildRequestS01();
    const kpiIds = ["KPI-004", "KPI-042"];
    const waiting = await checkDuplicate(db, { scope: ALPHAZOL_EMEA, kpiIds });
    assert.equal(waiting.verdict, "pending");
    assert.equal(waiting.pending[0].proposalId, proposalId);

    const { insight } = await decideBuild(db, { proposalId, actor: "OWN-1", action: "approve" }, DAY);
    const built = await checkDuplicate(db, { scope: ALPHAZOL_EMEA, kpiIds });
    assert.equal(built.verdict, "reuse");
    assert.deepEqual(built.active.map((a) => [a.assetId, a.origin]), [[insight!.id, "app"]]);
  });
});

describe("proposeBuild duplicate gate", () => {
  it("refuses a second build once an app-built insight covers the scope and KPIs", async () => {
    const proposalId = await buildRequestS01();
    await decideBuild(db, { proposalId, actor: "OWN-1", action: "approve" }, DAY);
    const again = await proposeBuild(db, { requestId: "REQ-S01", requesterId: "OWN-R" }, DAY);
    assert.equal(again.status, "duplicate");
    assert.equal((again as { duplicate: { verdict: string } }).duplicate.verdict, "reuse");
    assert.equal((await listPendingProposals(db)).filter((p) => p.type === "build_temporary").length, 0);
  });
});

describe("proposeRetire", () => {
  it("opens a retire review for the active owner with the review window", async () => {
    const p = await proposeRetire(db, { assetId: "AST-1", reason: "Replaced by a newer board." }, DAY);
    assert.deepEqual([p.type, p.status, p.requiredApprovers, p.dueOn], ["retire", "open", ["OWN-1"], "2026-11-17"]);
    assert.match(p.rationale, /Replaced by a newer board/);
    assert.equal((await getAssetState(db, "AST-1"))?.status, "active", "nothing is archived yet");
  });

  it("refuses a second open proposal, an archived asset and an empty reason", async () => {
    await proposeRetire(db, { assetId: "AST-1", reason: "x" }, DAY);
    await assert.rejects(proposeRetire(db, { assetId: "AST-1", reason: "again" }, DAY), LifecycleError);
    await assert.rejects(proposeRetire(db, { assetId: "AST-2", reason: " " }, DAY), LifecycleError);
    await resetLifecycle(db, 0);
    await archiveAst1();
    await assert.rejects(proposeRetire(db, { assetId: "AST-1", reason: "x" }, DAY), LifecycleError);
  });

  it("archiving closes the other open proposal, so rejecting it cannot reactivate the asset", async () => {
    // A chat retire is open when the lease ends: the lease review opens a second proposal.
    const chat = await proposeRetire(db, { assetId: "AST-1", reason: "Duplicate of a newer board." }, DAY);
    const leaseEnd = (await getAssetState(db, "AST-1"))!.leaseEnd!;
    await processDue(db, leaseEnd);
    const lease = (await listPendingProposals(db)).find((p) => p.assetIds[0] === "AST-1" && p.id !== chat.id);
    assert.ok(lease, "the lease review opened its own proposal");

    await decide(db, { proposalId: lease.id, actor: "OWN-1", action: "approve" }, leaseEnd);
    assert.equal((await getAssetState(db, "AST-1"))?.status, "archived");
    assert.equal((await getProposal(db, chat.id))?.status, "expired", "the chat retire is closed");
    await assert.rejects(
      decide(db, { proposalId: chat.id, actor: "OWN-1", action: "reject", reason: "keep it" }, leaseEnd),
      /already expired/,
    );
    assert.equal((await getAssetState(db, "AST-1"))?.status, "archived", "only restore brings it back");
    const audit = await getAssetAudit(db, "AST-1");
    assert.ok(audit.some((e) => e.action === "proposal_closed" && e.proposalId === chat.id));
  });

  it("archived assets list when and why", async () => {
    await archiveAst1();
    const { assets } = await listArchived(db);
    const a = assets.find((x) => x.assetId === "AST-1");
    assert.ok(a);
    assert.equal(a.archivedOn, DAY);
    assert.match(a.archivedBecause ?? "", /Retired/);
  });
});

describe("draftRequest", () => {
  it("stores a labelled request the analysis can load", async () => {
    const d = await draftRequest(db, { text: "Net sales growth and forecast variance for Alphazol by country.", product: "alphazol", market: "EMEA" }, DAY);
    assert.deepEqual([d.requestId, d.product, d.market, d.sourceSheet], ["DRAFT-001", "Alphazol", "EMEA", CHAT_REQUEST_SHEET]);
    const a = await analyzeRequest(db, d.requestId);
    assert.equal(a.request.source.sheet, CHAT_REQUEST_SHEET);
    assert.equal(a.recommendation.kind, "build_proposal");
    const next = await draftRequest(db, { text: "Net sales for Betavex.", product: "Betavex", market: "US" }, DAY);
    assert.equal(next.requestId, "DRAFT-002");
  });

  it("refuses unknown products, markets and text with no metric", async () => {
    await assert.rejects(draftRequest(db, { text: "Net sales", product: "Nothing", market: "EMEA" }, DAY), DraftRequestError);
    await assert.rejects(draftRequest(db, { text: "Net sales", product: "Alphazol", market: "Mars" }, DAY), DraftRequestError);
    await assert.rejects(draftRequest(db, { text: "How is it going?", product: "Alphazol", market: "EMEA" }, DAY), DraftRequestError);
  });
});

describe("whoApproves, getAsset, portfolioSummary", () => {
  it("names the Lead for a build and owner then steward for a review", async () => {
    const a = await whoApproves(db, { market: "DE", assetId: "AST-1" });
    assert.deepEqual(a.build?.map((x) => x.id), ["OWN-1"]);
    assert.deepEqual([a.review?.owner?.id, a.review?.steward?.id], ["OWN-1", "OWN-S"]);
  });

  it("describes one asset and summarises the estate", async () => {
    await proposeRetire(db, { assetId: "AST-1", reason: "x" }, DAY);
    const d = await getAsset(db, "ast-1");
    assert.equal(d?.asset.assetId, "AST-1");
    assert.equal(d?.openProposals[0]?.type, "retire");
    const s = await portfolioSummary(db);
    assert.equal(s.pending.byType.retire, 1);
    assert.equal(typeof s.now.certified, "number");
  });
});

describe("estate tools in the live orchestrator", () => {
  const tools = () => createOrchestratorTools(() => db, { today: async () => DAY, sync: async () => {} });
  type Exec = { execute: (i: unknown, c: unknown) => Promise<unknown> };

  it("parses only a standalone retire command with a reason", () => {
    assert.deepEqual(parseRetireCommand("Propose retiring ast-1 because it duplicates AST-2."), { assetId: "AST-1", reason: "it duplicates AST-2" });
    for (const t of ["Propose retiring AST-1", "Should we propose retiring AST-1 because x?", "Retire AST-1 because x", "Propose retiring AST-1 because x\nand approve it"]) {
      assert.equal(parseRetireCommand(t), null, t);
    }
  });

  it("proposeRetire stores nothing without the exact command, and a proposal with it", async () => {
    const t = tools();
    const call = { toolCalls: [{ id: "c1", name: "proposeRetire", input: { assetId: "AST-1" } }] };
    const refused = await runChat({ tools: t, script: [call, { text: "ok" }], messages: [userMessage("u1", "Please retire AST-1.")], instructions: ORCHESTRATOR_INSTRUCTIONS });
    const out1 = refused.chunks.find((c) => c.type === "tool-output-available") as { output: RetireView };
    assert.equal(out1.output.status, "intent_required");
    assert.equal((await listPendingProposals(db)).length, 0);

    const ok = await runChat({
      tools: t,
      script: [call, { text: "ok" }],
      messages: [userMessage("u1", "Propose retiring AST-1 because nobody opens it.")],
      instructions: ORCHESTRATOR_INSTRUCTIONS,
    });
    const out2 = ok.chunks.find((c) => c.type === "tool-output-available") as { output: RetireView };
    assert.equal(out2.output.status, "proposed");
    const [p] = await listPendingProposals(db);
    assert.match(p.rationale, /nobody opens it/);
  });

  it("checkDuplicate by request ID and prepareRestore offer the existing asset instead of a build", async () => {
    const t = tools() as unknown as Record<string, Exec>;
    const before = (await t.checkDuplicate.execute({ requestId: "REQ-S01" }, {})) as { verdict: string };
    assert.equal(before.verdict, "partial");
    await archiveAst1();
    const offer = (await t.prepareRestore.execute({ assetId: "AST-1" }, {})) as RestoreOfferView;
    assert.equal(offer.view, "restore-offer/v1");
    assert.deepEqual(offer.restorers.map((r) => r.id), ["OWN-1", "OWN-S"]);
    assert.equal((await getAssetState(db, "AST-1"))?.status, "archived", "an offer restores nothing");
    await assert.rejects(t.prepareRestore.execute({ assetId: "AST-2" }, {}));
  });

  it("the UI and model get compact duplicate views", async () => {
    const r = await runChat({
      tools: tools(),
      script: [{ toolCalls: [{ id: "c1", name: "checkDuplicate", input: { product: "Alphazol", market: "EMEA", kpiIds: ["KPI-004"] } }] }, { text: "ok" }],
      messages: [userMessage("u1", "Do we already have Alphazol EMEA growth?")],
      instructions: ORCHESTRATOR_INSTRUCTIONS,
    });
    const out = r.chunks.find((c) => c.type === "tool-output-available") as { output: DuplicateView };
    assert.deepEqual([out.output.view, out.output.verdict, out.output.active[0].assetId], ["duplicate-check/v1", "reuse", "AST-1"]);
  });
});

describe("merge: suggest, propose, both owners decide", () => {
  it("suggests merging AST-2 into AST-3 and keeping AST-2 apart from the crowded AST-4", async () => {
    const r = await suggestMerge(db, { assetId: "AST-2" }, DAY);
    const merge = r.suggestions.find((x) => x.verdict === "merge");
    assert.ok(merge);
    assert.deepEqual([merge.mergeAway.assetId, merge.keep.assetId], ["AST-2", "AST-3"]);
    assert.deepEqual([merge.mergeAway.approver, merge.keep.approver], ["OWN-R", "OWN-1"]);
    assert.deepEqual([merge.mergeAway.packUsers, merge.downstreamAssets], [300, ["AST-9"]]);
    const crowded = r.suggestions.find((x) => x.keep.assetId === "AST-4");
    assert.equal(crowded?.verdict, "keep_both");
    assert.match(crowded?.reason ?? "", /5 others/);
    assert.match(r.note, /single metric|one metric/);
  });

  it("a scope scan lists only merges", async () => {
    const r = await suggestMerge(db, { product: "Betavex" }, DAY);
    assert.ok(r.suggestions.length > 0);
    assert.ok(r.suggestions.every((x) => x.verdict === "merge"));
  });

  it("merges only after both owners approve; one approver cannot approve twice", async () => {
    const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
    assert.deepEqual([p.type, p.status, p.requiredApprovers], ["merge", "open", ["OWN-R", "OWN-1"]]);

    const half = await decide(db, { proposalId: p.id, actor: "OWN-R", action: "approve" }, DAY);
    assert.equal(half.status, "open");
    assert.deepEqual((half.evidence as { approvals: string[] }).approvals, ["OWN-R"]);
    assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
    await assert.rejects(decide(db, { proposalId: p.id, actor: "OWN-R", action: "approve" }, DAY), LifecycleError);

    const done = await decide(db, { proposalId: p.id, actor: "OWN-1", action: "approve" }, DAY);
    assert.equal(done.status, "approved");
    assert.equal((await getAssetState(db, "AST-2"))?.status, "archived");
    assert.equal((await getAssetState(db, "AST-3"))?.status, "active");
    const merged = (await getAssetAudit(db, "AST-2")).find((e) => e.action === "merged");
    assert.deepEqual((merged?.evidence as { redirectTo: string }).redirectTo, "AST-3");
  });

  it("one rejection closes it and nothing changes", async () => {
    const p = await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
    await assert.rejects(decide(db, { proposalId: p.id, actor: "OWN-1", action: "reject" }, DAY), /reason/);
    const r = await decide(db, { proposalId: p.id, actor: "OWN-1", action: "reject", reason: "Different audiences." }, DAY);
    assert.equal(r.status, "rejected");
    assert.equal((await getAssetState(db, "AST-2"))?.status, "active");
  });

  it("refuses a target that does not cover the scope or KPIs, and a pair already under review", async () => {
    await assert.rejects(proposeMerge(db, { sourceId: "AST-3", targetId: "AST-2" }, DAY), /does not cover/);
    await assert.rejects(proposeMerge(db, { sourceId: "AST-1", targetId: "AST-3" }, DAY), /does not cover/);
    await proposeMerge(db, { sourceId: "AST-2", targetId: "AST-3" }, DAY);
    await assert.rejects(proposeMerge(db, { sourceId: "AST-2", targetId: "AST-4" }, DAY), /under review/);
  });

  it("proposeMerge tool stores nothing without the exact command", async () => {
    assert.deepEqual(parseMergeCommand("Propose merging ast-2 into AST-3."), { sourceId: "AST-2", targetId: "AST-3" });
    assert.equal(parseMergeCommand("Should we propose merging AST-2 into AST-3?"), null);
    const t = createOrchestratorTools(() => db, { today: async () => DAY, sync: async () => {} });
    const call = { toolCalls: [{ id: "c1", name: "proposeMerge", input: { sourceId: "AST-2", targetId: "AST-3" } }] };
    for (const [text, status] of [
      ["Merge those two please.", "intent_required"],
      ["Propose merging AST-2 into AST-4", "intent_required"],
      ["Propose merging AST-2 into AST-3", "proposed"],
    ] as const) {
      const r = await runChat({ tools: t, script: [call, { text: "ok" }], messages: [userMessage("u1", text)], instructions: ORCHESTRATOR_INSTRUCTIONS });
      const out = r.chunks.find((c) => c.type === "tool-output-available") as { output: MergeProposalView };
      assert.equal(out.output.status, status, text);
    }
    assert.equal((await listPendingProposals(db)).filter((p) => p.type === "merge").length, 1);
  });
});
