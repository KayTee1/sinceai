// Steward services against the team-authored fixture (tests/fixtures).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook, type ParsedSheet } from "../src/db/import-workbook";
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

  it("finds a positive per-metric gap but proposes no build for KPIs outside the computable mapping", async () => {
    // T15: a build may use only KPIs in the computable mapping. The fixture's
    // KPI IDs are not in D14, so the gap is reported and no build is proposed.
    // The positive build path is covered in semantic.test.ts (REQ-S01).
    const a = await analyzeRequest(db, "REQ-T03");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.deepEqual(a.metricCoverage, [
      { canonicalMetric: "Net Sales", approvedKpiId: "KPI-B1", assetIds: ["AST-4"] },
      { canonicalMetric: "Forecast Variance", approvedKpiId: "KPI-E1", assetIds: [] },
    ]);
    assert.ok(a.recommendation.rationale.some((r) => r.includes("Forecast Variance (KPI-E1)")));
    assert.deepEqual(
      a.computability.map((c) => [c.kpiId, c.status]),
      [
        ["KPI-B1", "unsupported"],
        ["KPI-E1", "unsupported"],
      ],
    );
    assert.ok(a.recommendation.rationale.some((r) => r.includes("cannot deliver KPI-B1 (unsupported), KPI-E1 (unsupported)")));
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

// Regressions from the Codex review of PR #14. Each builds its own database
// from the fixture plus extra team-authored rows.
const ASSET_TAIL = ["Dashboard", "Power BI", "WS-1", "2026-09-01"];

async function dbWith(extra: Record<string, unknown[][]>): Promise<{ db: Client; done: () => void }> {
  const sheets: ParsedSheet[] = FIXTURE_SHEETS.map((s) => ({
    sheet: s.sheet,
    data: [...s.data.map((r) => [...r]), ...(extra[s.sheet] ?? [])],
  }));
  const expected = Object.fromEntries(sheets.filter((s) => s.sheet !== "START_HERE").map((s) => [s.sheet, s.data.length - 1]));
  const tmp = mkdtempSync(join(tmpdir(), "steward-regress-"));
  await importWorkbook({ sheets, dest: join(tmp, "db.db"), expected });
  const handle = openDb(join(tmp, "db.db"));
  return {
    db: handle,
    done: () => {
      handle.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

describe("review regressions", () => {
  it("F1: two approved definitions never count as coverage or allow reuse", async () => {
    const { db: d, done } = await dbWith({
      KPI_Catalog: [
        ["KPI-F1", "Units Shipped", "Units Shipped", "units", "canonical", "approved", "Fixture definition"],
        ["KPI-F2", "Units Shipped Alt", "Units Shipped", "units", "canonical", "approved", "Fixture definition"],
      ],
      Analytics_Assets: [["AST-7", "Alphazol Units DE", "SM-1", "Alphazol", "DE", "OWN-1", "active", "certified", ...ASSET_TAIL]],
      Asset_KPI_Map: [
        ["AST-7", "KPI-A1", "primary"],
        ["AST-7", "KPI-F1", "primary"],
        ["AST-7", "KPI-F2", "secondary"],
      ],
      Business_Requests: [
        ["REQ-T09", "2026-10-09", "Alphazol", "DE", "Net sales growth and units shipped for Alphazol.", "low", "new"],
      ],
    });
    try {
      const a = await analyzeRequest(d, "REQ-T09");
      const units = a.kpiChecks.find((k) => k.canonicalMetric === "Units Shipped")!;
      assert.equal(units.approved, null);
      assert.ok(units.reasons.some((r) => r.includes("2 approved canonical definitions: KPI-F1, KPI-F2")));
      const ast7 = a.candidates.find((c) => c.assetId === "AST-7")!;
      assert.equal(ast7.coversAllMetrics, false);
      assert.ok(ast7.coverage.gaps.some((g) => g.detail.startsWith("no single approved definition for this metric")));
      assert.ok(!ast7.coverage.known.some((k) => k.detail.includes("KPI-F")));
      assert.ok(a.candidates.every((c) => !c.coversAllMetrics));
      assert.equal(a.recommendation.kind, "insufficient_evidence");
      assert.match(a.recommendation.rationale[0], /No single approved canonical KPI for: Units Shipped/);
    } finally {
      done();
    }
  });

  it("F2: a low-scoring complete match beyond the limit still drives reuse and is shown", async () => {
    const partials = Array.from({ length: 11 }, (_, i) => `AST-P${String(i + 1).padStart(2, "0")}`);
    const { db: d, done } = await dbWith({
      Analytics_Assets: [
        ...partials.map((id) => [id, `Betavex Growth FR ${id}`, "SM-1", "Betavex", "FR", "OWN-1", "active", "certified", ...ASSET_TAIL]),
        ["AST-C1", "Pharma Sales Complete", "SM-1", "All Pharma", "Global", "OWN-1", "active", "none", ...ASSET_TAIL],
      ],
      Asset_KPI_Map: [
        ...partials.map((id) => [id, "KPI-A1", "primary"]),
        ["AST-C1", "KPI-A1", "primary"],
        ["AST-C1", "KPI-B1", "primary"],
      ],
      Business_Requests: [
        ["REQ-T10", "2026-10-10", "Betavex", "FR", "Net sales growth and net sales for Betavex in France.", "low", "new"],
      ],
    });
    try {
      const a = await analyzeRequest(d, "REQ-T10");
      // 11 partials score 9 (3 + 2 + 2 + 2); the complete match scores 8 (6 + 1 + 1).
      assert.equal(a.candidates.length, 10);
      assert.equal(a.candidates.at(-1)!.assetId, "AST-C1");
      assert.equal(a.candidates.at(-1)!.score, 8);
      assert.ok(a.candidates.slice(0, -1).every((c) => c.score === 9 && !c.coversAllMetrics));
      const scores = a.candidates.map((c) => c.score);
      assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
      assert.equal(a.recommendation.kind, "reuse_candidates");
      assert.ok(a.recommendation.evidence.some((e) => e.id === "AST-C1"));

      // The recommendation does not depend on the presentation limit.
      for (const limit of [1, 3, 50]) {
        const b = await analyzeRequest(d, "REQ-T10", undefined, { limit });
        assert.deepEqual(b.recommendation, a.recommendation, `limit ${limit}`);
        assert.ok(b.candidates.some((c) => c.assetId === "AST-C1"), `limit ${limit}`);
        assert.ok(b.candidates.length <= limit);
      }
    } finally {
      done();
    }
  });
});
