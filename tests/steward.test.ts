// Steward services against the team-authored fixture (tests/fixtures).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { analyzeRequest, RequestNotFoundError } from "../src/services/steward/analyze";
import { ALWAYS_UNKNOWN } from "../src/services/steward/discovery";
import { checkKpis, loadKpis, matchMetrics } from "../src/services/steward/kpis";
import { FIXTURE_EXPECTED, FIXTURE_SHEETS } from "./fixtures/catalog";

let dir: string;
let db: Client;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "steward-test-"));
  const dest = join(dir, "fixture.db");
  await importWorkbook({ sheets: FIXTURE_SHEETS, dest, expected: FIXTURE_EXPECTED });
  db = openDb(dest);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("metric matching", () => {
  it("prefers the longest phrase and does not double count", () => {
    const m = matchMetrics("net sales growth and net sales", ["Net Sales", "Net Sales Growth"]);
    assert.deepEqual(
      m.map((x) => x.canonicalMetric),
      ["Net Sales Growth", "Net Sales"],
    );
  });

  it("uses team phrases only for metrics the catalog has", () => {
    assert.deepEqual(matchMetrics("market access by country", ["Net Sales"]), []);
    assert.equal(matchMetrics("market access by country", ["Market Access Coverage"])[0].phrase, "market access");
  });

  it("ignores partial words", () => {
    assert.deepEqual(matchMetrics("net salesforce", ["Net Sales"]), []);
  });
});

describe("KPI definition check", () => {
  it("flags a variant of the approved KPI with IDs and statuses", async () => {
    const [check] = checkKpis("net sales growth", await loadKpis(db));
    assert.equal(check.approved?.id, "KPI-A1");
    assert.deepEqual(
      check.variants.map((v) => v.id),
      ["KPI-A2"],
    );
    assert.equal(check.conflict, true);
    assert.match(check.reasons[0], /KPI-A2 .* duplicate_candidate \/ local; KPI-A1 is the approved definition/);
    assert.deepEqual(check.approved?.source, { sheet: "KPI_Catalog", row: 2, id: "KPI-A1" });
  });

  it("reports a metric without an approved definition and reused names", async () => {
    const [check] = checkKpis("launch index", await loadKpis(db));
    assert.equal(check.approved, null);
    assert.ok(check.reasons.some((r) => r.includes("No approved canonical definition")));
    assert.ok(check.reasons.some((r) => r.includes('Name "Launch Index" is used by KPI-D1 and KPI-D2')));
  });

  it("does not flag a metric with only its approved KPI", async () => {
    const [check] = checkKpis("forecast variance", await loadKpis(db));
    assert.equal(check.conflict, false);
    assert.deepEqual(check.reasons, []);
  });
});

describe("analyzeRequest", () => {
  it("asks for clarification when text and context disagree", async () => {
    const a = await analyzeRequest(db, "REQ-T01");
    assert.equal(a.recommendation.kind, "clarify");
    assert.equal(a.clarification.needed, true);
    assert.equal(a.clarification.resolved, null);
    assert.deepEqual(a.clarification.detected, { products: ["Alphazol"], markets: ["Global"] });
    assert.deepEqual(
      a.clarification.conflicts.map((c) => c.field),
      ["product", "market"],
    );
    assert.deepEqual(a.clarification.options, [
      { from: "context", product: "Betavex", market: "EMEA" },
      { from: "text", product: "Alphazol", market: "Global" },
    ]);
    assert.deepEqual(a.candidates, []);
    assert.deepEqual(a.request.source, { sheet: "Business_Requests", row: 2, id: "REQ-T01" });
  });

  it("uses the requester's answer and only accepts offered options", async () => {
    const a = await analyzeRequest(db, "REQ-T01", { product: "Alphazol", market: "Global" });
    assert.deepEqual(a.clarification.resolved, { product: "Alphazol", market: "Global" });
    assert.equal(a.recommendation.kind, "reuse_candidates");
    assert.deepEqual(
      a.candidates.map((c) => c.assetId),
      ["AST-2"],
    );
    // Facts are reported, not hidden: missing owner, retire candidate, failed refresh.
    assert.deepEqual(a.candidates[0].owner, { id: null, name: null, active: false });
    assert.equal(a.candidates[0].facts.lifecycleStatus, "candidate_retire");
    assert.equal(a.candidates[0].facts.modelRefreshStatus, "failed");
    await assert.rejects(analyzeRequest(db, "REQ-T01", { product: "Betavex", market: "Global" }), /not one of the offered options/);
  });

  it("ranks reuse candidates with explained scores and honest coverage", async () => {
    const a = await analyzeRequest(db, "REQ-T02");
    assert.equal(a.recommendation.kind, "reuse_candidates");
    assert.deepEqual(
      a.candidates.map((c) => [c.assetId, c.score, c.coversAllMetrics]),
      [
        ["AST-1", 9, true],
        ["AST-3", 6, false],
        ["AST-2", 5, true],
      ],
    );
    const top = a.candidates[0];
    assert.deepEqual(top.scoreParts, { metricApproved: 3, productScope: 2, marketScope: 2, endorsement: 2 });
    assert.equal(
      top.score,
      Object.values(top.scoreParts).reduce((s, v) => s + v, 0),
    );
    assert.deepEqual(top.coverage.unknown, ALWAYS_UNKNOWN);
    assert.ok(top.coverage.known.some((k) => k.detail.startsWith("maps KPI-A1")));
    assert.deepEqual(top.source, { sheet: "Analytics_Assets", row: 2, id: "AST-1" });
    // The variant-only asset is a gap, not coverage.
    const local = a.candidates[1];
    assert.match(local.coverage.gaps[0].detail, /only non-approved variant\(s\): KPI-A2/);
    // No coverage claim about period, dimensions or filters anywhere.
    for (const c of a.candidates) {
      assert.ok(!c.coverage.known.some((k) => /period|dimension|filter/i.test(k.aspect)));
    }
  });

  it("proposes a build only for a positive per-metric gap", async () => {
    const a = await analyzeRequest(db, "REQ-T03");
    assert.equal(a.recommendation.kind, "build_proposal");
    assert.deepEqual(a.metricCoverage, [
      { canonicalMetric: "Net Sales", approvedKpiId: "KPI-B1", assetIds: ["AST-4"] },
      { canonicalMetric: "Forecast Variance", approvedKpiId: "KPI-E1", assetIds: [] },
    ]);
    assert.ok(a.recommendation.rationale.some((r) => r.includes("Forecast Variance (KPI-E1)")));
    assert.ok(a.recommendation.rationale.some((r) => r.includes("Not yet checked")));
  });

  it("returns insufficient_evidence when no metric is named", async () => {
    const a = await analyzeRequest(db, "REQ-T04");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.deepEqual(a.kpiChecks, []);
  });

  it("does not propose a build from an empty search", async () => {
    const a = await analyzeRequest(db, "REQ-T05");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.deepEqual(a.candidates, []);
    assert.ok(a.recommendation.rationale.some((r) => r.includes("Absence of search results")));
  });

  it("does not propose a build when metrics are covered by different assets", async () => {
    const a = await analyzeRequest(db, "REQ-T06");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.ok(a.recommendation.rationale[0].includes("no single asset maps all of them"));
  });

  it("does not propose a build on a metric without an approved KPI", async () => {
    const a = await analyzeRequest(db, "REQ-T07");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.ok(a.recommendation.rationale[0].includes("No single approved canonical KPI for: Launch Index"));
  });

  it("narrows an All Pharma context by one explicit product", async () => {
    const a = await analyzeRequest(db, "REQ-T08");
    assert.equal(a.clarification.needed, false);
    assert.deepEqual(a.clarification.resolved, { product: "Alphazol", market: "DE" });
    assert.ok(a.clarification.notes.some((n) => n.includes("narrows context All Pharma to Alphazol")));
  });

  it("is deterministic", async () => {
    assert.deepEqual(await analyzeRequest(db, "REQ-T02"), await analyzeRequest(db, "REQ-T02"));
  });

  it("rejects an unknown request", async () => {
    await assert.rejects(analyzeRequest(db, "REQ-NOPE"), RequestNotFoundError);
  });
});
