// Mastra steward tool adapters (T16) against temporary team-authored fixture
// databases. Every adapter result is compared with a direct service call.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { createStewardTools, StewardToolInputError } from "../src/mastra/tools/steward-tools";
import { analysisView, CANDIDATES_SHOWN, isToolValidationError, kpiResultView, OMITTED_NOTE } from "../src/mastra/tools/steward-views";
import { InvalidKpiQueryError, computeKpi, computeKpiByMarket } from "../src/services/semantic/compute";
import { analyzeRequest, RequestNotFoundError } from "../src/services/steward/analyze";
import { checkKpis, loadKpis } from "../src/services/steward/kpis";
import { TEAM_REQUEST_SHEET } from "../src/services/steward/team-requests";
import { FIXTURE_EXPECTED, FIXTURE_SHEETS } from "./fixtures/catalog";
import { FACT_EXPECTED, FACT_SHEETS } from "./fixtures/facts";
import { runChat, toolResults, userMessage } from "./helpers/mock-agent";

let dir: string;
let catalogDb: Client; // T14 fixture: requests REQ-T01..T08, no fact rows
let factsDb: Client; // T15 fixture: requests REQ-S01..S04 and Product_Market_Monthly
let catalog: ReturnType<typeof createStewardTools>;
let facts: ReturnType<typeof createStewardTools>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "steward-tools-"));
  await importWorkbook({ sheets: FIXTURE_SHEETS, dest: join(dir, "catalog.db"), expected: FIXTURE_EXPECTED });
  await importWorkbook({ sheets: FACT_SHEETS, dest: join(dir, "facts.db"), expected: FACT_EXPECTED });
  catalogDb = openDb(join(dir, "catalog.db"));
  factsDb = openDb(join(dir, "facts.db"));
  catalog = createStewardTools(() => catalogDb);
  facts = createStewardTools(() => factsDb);
});

after(() => {
  catalogDb?.close();
  factsDb?.close();
  rmSync(dir, { recursive: true, force: true });
});

type AnyTool = { execute?: (input: never, ctx: never) => Promise<unknown>; toModelOutput?: (o: unknown) => unknown; transform?: unknown };
const run = (tool: unknown, input: unknown) => (tool as AnyTool).execute!(input as never, {} as never);
const modelView = (tool: unknown, output: unknown) => (tool as AnyTool).toModelOutput!(output) as { type: string; value: unknown };
const uiView = (tool: unknown, output: unknown) =>
  (tool as { transform: { display: { output: (c: { output: unknown }) => unknown } } }).transform.display.output({ output });
const OCT = "2026-10-01";

/**
 * No structured provenance anywhere in a chat payload: no provenance objects,
 * SQL, source-row lists or SourceRefs. Diagnostic reason strings may still
 * name a workbook row; see the "diagnostic reasons" test.
 */
function assertNoStructuredProvenance(x: unknown, label: string) {
  const s = JSON.stringify(x);
  for (const banned of ['"provenance"', '"query"', '"rows"', '"sql"', "SELECT ", '"source"', '"evidence"', '"catalog"']) {
    assert.ok(!s.includes(banned), `${label} contains ${banned}`);
  }
}

describe("analyze-request", () => {
  it("returns exactly the service result for a clarification", async () => {
    const out = await run(catalog.analyzeRequest, { requestId: "REQ-T01" });
    assert.deepEqual(out, await analyzeRequest(catalogDb, "REQ-T01"));
    const view = modelView(catalog.analyzeRequest, out);
    assert.equal(view.type, "json");
    const v = view.value as ReturnType<typeof analysisView>;
    assert.equal(v.recommendation.kind, "clarify");
    assert.equal(v.clarification.needed, true);
    assert.deepEqual(v.clarification.options, [
      { from: "context", product: "Betavex", market: "EMEA" },
      { from: "text", product: "Alphazol", market: "Global" },
    ]);
    assert.match(v.clarification.question!, /Which scope is meant/);
  });

  it("resolves with the requester's answer and keeps the authoritative recommendation", async () => {
    const answer = { product: "Alphazol", market: "Global" };
    const out = (await run(catalog.analyzeRequest, { requestId: "REQ-T01", answer })) as Awaited<ReturnType<typeof analyzeRequest>>;
    const direct = await analyzeRequest(catalogDb, "REQ-T01", answer);
    assert.deepEqual(out, direct);
    const v = analysisView(out);
    assert.deepEqual(v.recommendation.kind, direct.recommendation.kind);
    assert.deepEqual(v.recommendation.rationale, direct.recommendation.rationale);
    assert.deepEqual(v.clarification.resolved, answer);
  });

  it("accepts a null answer, case and whitespace like the service, and team-authored IDs", async () => {
    const direct = await analyzeRequest(catalogDb, "REQ-T02");
    assert.deepEqual(await run(catalog.analyzeRequest, { requestId: "  req-t02 ", answer: null }), direct);
    assert.equal(((await run(facts.analyzeRequest, { requestId: "REQ-S01" })) as typeof direct).request.id, "REQ-S01");
  });

  it("shows KPI conflicts and reuse candidates in the compact view", async () => {
    const out = await run(catalog.analyzeRequest, { requestId: "REQ-T02" });
    const v = analysisView(out as Awaited<ReturnType<typeof analyzeRequest>>);
    assert.equal(v.recommendation.kind, "reuse_candidates");
    assert.deepEqual(
      v.kpiChecks.map((k) => [k.approvedKpiId, k.conflict, k.variants.map((x) => `${x.id} ${x.definitionStatus}/${x.approvalStatus}`)]),
      [["KPI-A1", true, ["KPI-A2 duplicate_candidate/local"]]],
    );
    const ast1 = v.candidates.shown.find((c) => c.assetId === "AST-1")!;
    assert.deepEqual([ast1.coversAllMetrics, ast1.endorsement, ast1.owner.active], [true, "certified", true]);
    assert.ok(ast1.unknown.length > 0);
    assert.ok(v.recommendation.evidenceIds.includes("AST-1"));
  });

  it("rejects an unknown request with the service's RequestNotFoundError", async () => {
    await assert.rejects(run(catalog.analyzeRequest, { requestId: "REQ-NOPE" }), RequestNotFoundError);
  });

  it("returns a validation error object for a malformed input", async () => {
    const out = await run(catalog.analyzeRequest, { requestId: "" });
    assert.ok(isToolValidationError(out));
    // The model and the UI still see the error, not an empty projection.
    assert.deepEqual(modelView(catalog.analyzeRequest, out), { type: "json", value: out });
    assert.deepEqual(uiView(catalog.analyzeRequest, out), out);
  });

  it("rejects an answer that is not one of the offered options", async () => {
    await assert.rejects(
      run(catalog.analyzeRequest, { requestId: "REQ-T01", answer: { product: "Betavex", market: "Global" } }),
      /not one of the offered options/,
    );
  });

  it("keeps computability, a build proposal and service provenance; the view drops only row detail", async () => {
    const out = (await run(facts.analyzeRequest, { requestId: "REQ-S01" })) as Awaited<ReturnType<typeof analyzeRequest>>;
    assert.deepEqual(out, await analyzeRequest(factsDb, "REQ-S01"));
    assert.equal(out.recommendation.kind, "build_proposal");
    // Full provenance is still there at the service boundary.
    const de = out.computability[0].probe!.byMarket.find((m) => m.marketId === "DE")!;
    assert.equal(de.provenance.rows.length, 2);
    assert.ok(de.provenance.query);

    const v = modelView(facts.analyzeRequest, out).value as ReturnType<typeof analysisView>;
    assertNoStructuredProvenance(v, "analysis view");
    assert.equal(v.omitted, OMITTED_NOTE);
    // Every value in the view is copied from the result, not recomputed.
    for (const [i, c] of v.computability.entries()) {
      const full = out.computability[i];
      assert.deepEqual([c.kpiId, c.status, c.month, c.valueType], [full.kpiId, full.status, full.probe!.month, full.probe!.valueType]);
      assert.deepEqual(
        c.byMarket,
        full.probe!.byMarket.map((m) => ({ marketId: m.marketId, status: m.status, value: m.value, unit: m.unit, issues: m.issues })),
      );
    }
    assert.deepEqual(v.computability[0].byMarket.map((m) => [m.marketId, m.value, m.unit]), [
      ["DE", 25, "%"],
      ["FR", -20, "%"],
    ]);
    // Model and UI receive the same projection.
    assert.deepEqual(uiView(facts.analyzeRequest, out), v);
    assert.ok(JSON.stringify(v).length < JSON.stringify(out).length);
  });

  it("keeps an incomplete computability (one of three markets) as insufficient evidence", async () => {
    const out = (await run(facts.analyzeRequest, { requestId: "REQ-S04" })) as Awaited<ReturnType<typeof analyzeRequest>>;
    const v = analysisView(out);
    assert.equal(v.recommendation.kind, "insufficient_evidence");
    assert.deepEqual(
      v.computability.find((c) => c.kpiId === "KPI-042")!.byMarket.map((m) => [m.marketId, m.status, m.value, m.issues]),
      [
        ["DE", "computed", 0, []],
        ["FR", "insufficient_data", null, ["other_value_type"]],
        ["US", "insufficient_data", null, ["missing_row"]],
      ],
    );
  });
});

describe("analyze-request: complete match beyond the compact limit (Codex F1)", () => {
  // Same scenario as the T14 regression (steward.test.ts, F2): 11 partial
  // matches score 9; the only complete match, AST-C1, scores 8 and is 10th of
  // the service's 10 candidates.
  let d: Client;
  let tools: ReturnType<typeof createStewardTools>;
  const ASSET_TAIL = ["Dashboard", "Power BI", "WS-1", "2026-09-01"];
  const partials = Array.from({ length: 11 }, (_, i) => `AST-P${String(i + 1).padStart(2, "0")}`);
  const extra: Record<string, unknown[][]> = {
    Analytics_Assets: [
      ...partials.map((id) => [id, `Betavex Growth FR ${id}`, "SM-1", "Betavex", "FR", "OWN-1", "active", "certified", ...ASSET_TAIL]),
      ["AST-C1", "Pharma Sales Complete", "SM-1", "All Pharma", "Global", "OWN-1", "active", "none", ...ASSET_TAIL],
    ],
    Asset_KPI_Map: [...partials.map((id) => [id, "KPI-A1", "primary"]), ["AST-C1", "KPI-A1", "primary"], ["AST-C1", "KPI-B1", "primary"]],
    Business_Requests: [["REQ-T10", "2026-10-10", "Betavex", "FR", "Net sales growth and net sales for Betavex in France.", "low", "new"]],
  };

  before(async () => {
    const sheets: ParsedSheet[] = FIXTURE_SHEETS.map((x) => ({ sheet: x.sheet, data: [...x.data.map((r) => [...r]), ...(extra[x.sheet] ?? [])] }));
    const expected = Object.fromEntries(sheets.filter((x) => x.sheet !== "START_HERE").map((x) => [x.sheet, x.data.length - 1]));
    await importWorkbook({ sheets, dest: join(dir, "complete-match.db"), expected });
    d = openDb(join(dir, "complete-match.db"));
    tools = createStewardTools(() => d);
  });
  after(() => d?.close());

  it("keeps the complete match that drives reuse in both projections, within the limit", async () => {
    const out = (await run(tools.analyzeRequest, { requestId: "REQ-T10" })) as Awaited<ReturnType<typeof analyzeRequest>>;
    assert.deepEqual(out, await analyzeRequest(d, "REQ-T10"));
    // The authoritative result is unchanged: reuse, driven by AST-C1 in 10th place.
    assert.equal(out.recommendation.kind, "reuse_candidates");
    assert.equal(out.candidates.length, 10);
    assert.equal(out.candidates.findIndex((c) => c.coversAllMetrics), 9);

    for (const [label, view] of [
      ["toModelOutput", modelView(tools.analyzeRequest, out).value],
      ["transform.display", uiView(tools.analyzeRequest, out)],
    ] as const) {
      const v = view as ReturnType<typeof analysisView>;
      const ids = v.candidates.shown.map((c) => c.assetId);
      assert.equal(ids.length, CANDIDATES_SHOWN, label);
      assert.equal(new Set(ids).size, ids.length, `${label}: no duplicates`);
      // Service order kept: the four best partials, then the complete match in the last slot.
      assert.deepEqual(ids, [...out.candidates.slice(0, CANDIDATES_SHOWN - 1).map((c) => c.assetId), "AST-C1"], label);
      const c1 = v.candidates.shown.at(-1)!;
      assert.deepEqual([c1.coversAllMetrics, c1.score, c1.owner.active, c1.endorsement], [true, 8, true, "none"], label);
      assert.ok(c1.known.some((k) => k.includes("KPI-A1")) && c1.known.some((k) => k.includes("KPI-B1")), `${label}: coverage explains reuse`);
      assert.equal(v.candidates.total, 10, label);
      assert.equal(v.recommendation.kind, "reuse_candidates", label);
      assert.ok(v.recommendation.evidenceIds.includes("AST-C1"), label);
    }
  });

  it("does not change the list when a complete match is already in the top slots", async () => {
    const out = (await run(catalog.analyzeRequest, { requestId: "REQ-T02" })) as Awaited<ReturnType<typeof analyzeRequest>>;
    assert.deepEqual(
      analysisView(out).candidates.shown.map((c) => c.assetId),
      out.candidates.slice(0, CANDIDATES_SHOWN).map((c) => c.assetId),
    );
  });
});

describe("analyze-request: request source label (T16A)", () => {
  const cases = [
    { requestId: "TEAM-REQ-01", sourceSheet: TEAM_REQUEST_SHEET, teamAuthored: true },
    { requestId: "REQ-T02", sourceSheet: "Business_Requests", teamAuthored: false },
  ];
  for (const { requestId, sourceSheet, teamAuthored } of cases) {
    it(`${requestId}: model and UI views keep the source sheet, never a row`, async () => {
      const out = (await run(catalog.analyzeRequest, { requestId })) as Awaited<ReturnType<typeof analyzeRequest>>;
      // The adapter result is still the unchanged service result.
      assert.deepEqual(out, await analyzeRequest(catalogDb, requestId));
      assert.equal(out.request.source.sheet, sourceSheet);
      for (const [label, view] of [
        ["toModelOutput", modelView(catalog.analyzeRequest, out).value],
        ["transform.display", uiView(catalog.analyzeRequest, out)],
      ] as const) {
        const v = view as ReturnType<typeof analysisView>;
        assert.deepEqual(
          v.request,
          {
            id: out.request.id,
            text: out.request.text,
            productContext: out.request.productContext,
            marketContext: out.request.marketContext,
            status: out.request.status,
            sourceSheet,
            teamAuthored,
          },
          label,
        );
        assert.equal(v.recommendation.kind, out.recommendation.kind, label);
        assertNoStructuredProvenance(v, label);
      }
    });
  }
});

describe("compute-kpi", () => {
  const scope = { productIds: ["P-ALP"], marketIds: ["DE"], month: OCT };

  it("computes a KPI identical to computeKpi, defaulting to the latest month", async () => {
    const out = (await run(facts.computeKpi, { kpiId: "KPI-004", product: "Alphazol", market: "DE" })) as {
      breakdown: string;
      result: Awaited<ReturnType<typeof computeKpi>>;
    };
    const direct = await computeKpi(factsDb, { kpiId: "KPI-004", ...scope });
    assert.deepEqual(out, { breakdown: "total", result: direct });
    assert.deepEqual([out.result.status, out.result.value, out.result.unit, out.result.filters.month], ["computed", 25, "%", OCT]);
    // Provenance retained at the service boundary...
    assert.equal(out.result.provenance.rows.length, 2);
    // ...and only summarised in the chat view.
    const v = modelView(facts.computeKpi, out).value as ReturnType<typeof kpiResultView>;
    assert.deepEqual(v, kpiResultView(direct));
    assert.equal(v.sourceRowCount, 2);
    assert.match(v.formula!, /Net Sales Growth =/);
    assertNoStructuredProvenance(v, "kpi view");
  });

  it("resolves regions to markets and breaks down by market like computeKpiByMarket", async () => {
    const out = await run(facts.computeKpi, { kpiId: "KPI-004", product: "Alphazol", market: "EMEA", breakdown: "by_market" });
    const direct = await computeKpiByMarket(factsDb, { kpiId: "KPI-004", productIds: ["P-ALP"], marketIds: ["DE", "FR"], month: OCT });
    assert.deepEqual(out, { breakdown: "by_market", kpiId: "KPI-004", results: direct });
    const v = modelView(facts.computeKpi, out).value as { results: { marketId: string; value: number | null }[] };
    assert.deepEqual(v.results.map((r) => [r.marketId, r.value]), [
      ["DE", 25],
      ["FR", -20],
    ]);
    assertNoStructuredProvenance(v, "by-market view");
  });

  it("keeps unsupported and insufficient_data distinct", async () => {
    const notImplemented = await run(facts.computeKpi, { kpiId: "KPI-014", product: "Alphazol", market: "DE" });
    const unmapped = await run(facts.computeKpi, { kpiId: "KPI-090", product: "Alphazol", market: "DE" });
    const pctAggregate = await run(facts.computeKpi, { kpiId: "KPI-027", product: "Alphazol", market: "EMEA" });
    const missing = await run(facts.computeKpi, { kpiId: "KPI-042", product: "Betavex", market: "US" });
    const otherType = await run(facts.computeKpi, { kpiId: "KPI-001", product: "Betavex", market: "FR" });
    const status = (o: unknown) => {
      const r = (o as { result: Awaited<ReturnType<typeof computeKpi>> }).result;
      return [r.status, r.value, r.issues];
    };
    assert.deepEqual(status(notImplemented), ["unsupported", null, []]);
    assert.deepEqual(status(unmapped), ["unsupported", null, []]);
    assert.deepEqual(status(pctAggregate), ["unsupported", null, []]);
    assert.deepEqual(status(missing), ["insufficient_data", null, ["missing_row"]]);
    assert.deepEqual(status(otherType), ["insufficient_data", null, ["other_value_type"]]);
    // Forecast-like only when asked for, and labelled.
    const fc = (await run(facts.computeKpi, { kpiId: "KPI-001", product: "Betavex", market: "FR", valueType: "forecast_like_synthetic" })) as {
      result: Awaited<ReturnType<typeof computeKpi>>;
    };
    assert.deepEqual([fc.result.status, fc.result.value, fc.result.filters.valueType], ["computed", 7, "forecast_like_synthetic"]);
  });

  it("keeps diagnostic row locators in reasons, but no structured provenance or row contents (Codex F2)", async () => {
    const out = (await run(facts.computeKpi, { kpiId: "KPI-001", product: "Betavex", market: "FR" })) as {
      result: Awaited<ReturnType<typeof computeKpi>>;
    };
    const v = modelView(facts.computeKpi, out).value as ReturnType<typeof kpiResultView>;
    // The diagnosis is kept verbatim from the service, including its row locator.
    assert.deepEqual(v.reasons, out.result.reasons);
    assert.match(v.reasons[0], /P-BET \/ FR \/ 2026-10-01 is forecast_like_synthetic \(row 11\)/);
    // ...and the payload says so, without claiming that no row is ever named.
    assert.match(v.omitted, /Diagnostic reasons may still name a workbook row/);
    assert.doesNotMatch(v.omitted, /Row-level source references .* are omitted/);
    assertNoStructuredProvenance(v, "insufficient kpi view");
    // No raw source record: the forecast-like row's measures (net 7, forecast 6) are not in the view.
    assert.equal(v.value, null);
    assert.ok(!JSON.stringify(v).includes('"net_sales_m_eur_syn"') && !JSON.stringify(v).includes("_source_row"));
  });

  it("rejects unknown scopes and invalid months with explicit errors", async () => {
    await assert.rejects(run(facts.computeKpi, { kpiId: "KPI-004", product: "P-ALP", market: "DE" }), StewardToolInputError);
    await assert.rejects(run(facts.computeKpi, { kpiId: "KPI-004", product: "Alphazol", market: "Atlantis" }), StewardToolInputError);
    for (const month of ["2026-13-01", "2026-00-01", "2026-10"]) {
      await assert.rejects(run(facts.computeKpi, { kpiId: "KPI-004", product: "Alphazol", market: "DE", month }), InvalidKpiQueryError);
    }
    const bad = await run(facts.computeKpi, { kpiId: "KPI-004", product: "Alphazol", market: "DE", valueType: "blended" });
    assert.ok(isToolValidationError(bad));
    assert.deepEqual(modelView(facts.computeKpi, bad).value, bad);
  });
});

describe("check-kpi-definitions", () => {
  it("does not conflate Net Sales with Net Sales Growth", async () => {
    const kpis = await loadKpis(catalogDb);
    const sales = (await run(catalog.checkKpiDefinitions, { text: "Which Net Sales KPI should we use?" })) as { checks: unknown };
    assert.deepEqual(sales, { text: "Which Net Sales KPI should we use?", checks: checkKpis("Which Net Sales KPI should we use?", kpis) });
    const v = modelView(catalog.checkKpiDefinitions, sales).value as { checks: { canonicalMetric: string; approvedKpiId: string; variants: unknown[] }[] };
    assert.deepEqual(v.checks.map((c) => [c.canonicalMetric, c.approvedKpiId, c.variants.length]), [["Net Sales", "KPI-B1", 0]]);

    const growth = await run(catalog.checkKpiDefinitions, { text: "net sales growth" });
    const g = modelView(catalog.checkKpiDefinitions, growth).value as { checks: { canonicalMetric: string; approvedKpiId: string; conflict: boolean; variants: { id: string }[] }[] };
    assert.deepEqual(g.checks.map((c) => [c.canonicalMetric, c.approvedKpiId, c.conflict, c.variants.map((x) => x.id)]), [
      ["Net Sales Growth", "KPI-A1", true, ["KPI-A2"]],
    ]);
    assertNoStructuredProvenance(g, "kpi checks view");
  });

  it("returns no checks for text that names no catalog metric", async () => {
    const out = (await run(catalog.checkKpiDefinitions, { text: "migrate my old workbook" })) as { checks: unknown[] };
    assert.deepEqual(out.checks, []);
  });
});

describe("Mastra stream (mock model, no LLM)", () => {
  const S01 = { id: "c1", name: "analyzeRequest", input: { requestId: "REQ-S01" } };
  const BAD = { id: "c2", name: "analyzeRequest", input: { requestId: "" } };
  const MISSING = { id: "c3", name: "analyzeRequest", input: { requestId: "REQ-NOPE" } };
  const KPI = { id: "c4", name: "computeKpi", input: { kpiId: "KPI-004", product: "Alphazol", market: "DE" } };

  it("streams compact views to the UI and the model, and surfaces both kinds of error", async () => {
    const { prompts, chunks } = await runChat({
      tools: facts,
      script: [{ toolCalls: [S01, BAD, MISSING, KPI] }, { text: "done" }],
      messages: [userMessage("u1", "Handle REQ-S01")],
    });
    const byCall = Object.fromEntries(
      chunks.filter((c) => c.type === "tool-output-available" || c.type === "tool-output-error").map((c) => [(c as { toolCallId: string }).toolCallId, c]),
    ) as Record<string, { type: string; output?: unknown; errorText?: string }>;

    const s01View = analysisView(await analyzeRequest(factsDb, "REQ-S01"));
    const kpiView = kpiResultView(await computeKpi(factsDb, { kpiId: "KPI-004", productIds: ["P-ALP"], marketIds: ["DE"], month: OCT }));
    assert.deepEqual(byCall.c1.output, s01View);
    assert.deepEqual(byCall.c4.output, kpiView);
    assert.equal(byCall.c2.type, "tool-output-available");
    assert.ok(isToolValidationError(byCall.c2.output));
    assert.equal(byCall.c3.type, "tool-output-error");
    assert.match(byCall.c3.errorText!, /Business request not found: REQ-NOPE/);
    assertNoStructuredProvenance(chunks, "UI stream");

    const seen = toolResults(prompts[1]);
    assert.deepEqual(seen.c1, { type: "json", value: s01View });
    assert.deepEqual(seen.c4, { type: "json", value: kpiView });
    assert.equal((seen.c2.value as { error: boolean }).error, true);
    assert.equal(seen.c3.type, "error-text");
    assert.match(String(seen.c3.value), /Business request not found/);
    assertNoStructuredProvenance(prompts[1], "model prompt");
  });

  it("does not replay full provenance in a follow-up turn", async () => {
    const first = await runChat({
      tools: facts,
      script: [{ toolCalls: [{ id: "c1", name: "analyzeRequest", input: { requestId: "REQ-S04" } }] }, { text: "Which scope?" }],
      messages: [userMessage("u1", "Handle REQ-S04")],
    });
    assert.ok(first.assistant);
    const second = await runChat({
      tools: facts,
      script: [{ text: "ok" }],
      messages: [userMessage("u1", "Handle REQ-S04"), first.assistant!, userMessage("u2", "Explain the gaps")],
    });
    const replayed = toolResults(second.prompts[0]).c1;
    const full = await analyzeRequest(factsDb, "REQ-S04");
    assert.deepEqual(replayed, { type: "json", value: analysisView(full) });
    assertNoStructuredProvenance(second.prompts[0], "follow-up prompt");
    // The replayed tool result is the compact view, not the full result.
    // (Real-size numbers: pack.local.test.ts, REQ-0001 Nubeqa / Global.)
    assert.ok(JSON.stringify(replayed.value).length < JSON.stringify(full).length);
  });
});
