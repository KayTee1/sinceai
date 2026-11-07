// KPI computation (T15) against the team-authored fact fixture (tests/fixtures/facts.ts).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { checkComputability } from "../src/services/semantic/computability";
import { computeKpi, computeKpiByMarket, InvalidKpiQueryError, priorMonth } from "../src/services/semantic/compute";
import { D14_MAPPING } from "../src/services/semantic/d14-mapping";
import { analyzeRequest } from "../src/services/steward/analyze";
import { loadVocabulary } from "../src/services/steward/requests";
import { FACT_EXPECTED, FACT_SHEETS } from "./fixtures/facts";

let dir: string;
let db: Client;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "semantic-test-"));
  const dest = join(dir, "facts.db");
  await importWorkbook({ sheets: FACT_SHEETS, dest, expected: FACT_EXPECTED });
  db = openDb(dest);
});

after(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const OCT = "2026-10-01";
const q = (kpiId: string, productIds: string[], marketIds: string[], extra: object = {}) => ({ kpiId, productIds, marketIds, month: OCT, ...extra });

describe("computeKpi: computed values", () => {
  it("KPI-004 growth for one cell, with filters and provenance", async () => {
    const r = await computeKpi(db, q("KPI-004", ["P-ALP"], ["DE"]));
    assert.equal(r.status, "computed");
    assert.equal(r.value, 25);
    assert.equal(r.unit, "%");
    assert.deepEqual(r.filters, {
      productIds: ["P-ALP"],
      marketIds: ["DE"],
      month: OCT,
      priorMonth: "2026-09-01",
      valueType: "actual_like_synthetic",
    });
    assert.deepEqual(r.provenance.catalog, { sheet: "KPI_Catalog", row: 3, id: "KPI-004" });
    assert.deepEqual(r.provenance.rows, [
      { sheet: "Product_Market_Monthly", row: 2, id: "P-ALP|DE|2026-09-01" },
      { sheet: "Product_Market_Monthly", row: 3, id: "P-ALP|DE|2026-10-01" },
    ]);
    assert.match(r.provenance.mapping, /D14.*team-authored.*proposed/);
    assert.match(r.provenance.query!.sql, /FROM Product_Market_Monthly/);
    assert.deepEqual(r.provenance.query!.args, ["P-ALP", "DE", "2026-09-01", OCT]);
  });

  it("KPI-004 over several markets is a ratio of sums, not a mean of growth rates", async () => {
    const r = await computeKpi(db, q("KPI-004", ["P-ALP"], ["DE", "FR"]));
    assert.equal(r.status, "computed");
    assert.equal(r.value, 10); // (16.5 - 15) / 15; the mean of 25 % and -20 % would be 2.5 %
    assert.equal(r.provenance.rows.length, 4);
  });

  it("KPI-001 and KPI-042 sum additive M EUR measures", async () => {
    const sales = await computeKpi(db, q("KPI-001", ["P-ALP"], ["DE", "FR", "US"]));
    assert.deepEqual([sales.status, sales.value, sales.unit], ["computed", 46.5, "M EUR"]);
    const variance = await computeKpi(db, q("KPI-042", ["P-ALP"], ["DE", "FR"]));
    assert.deepEqual([variance.status, variance.value, variance.unit], ["computed", 1.5, "M EUR"]);
    const negative = await computeKpi(db, q("KPI-042", ["P-ALP"], ["FR"]));
    assert.equal(negative.value, -1);
  });

  it("KPI-027 for one cell returns the source percentage", async () => {
    const r = await computeKpi(db, q("KPI-027", ["P-ALP"], ["DE"]));
    assert.deepEqual([r.status, r.value, r.unit], ["computed", 70, "%"]);
  });

  it("forecast-like rows are computed only when asked for, and labelled", async () => {
    const r = await computeKpi(db, q("KPI-001", ["P-BET"], ["FR"], { valueType: "forecast_like_synthetic" }));
    assert.deepEqual([r.status, r.value, r.filters.valueType], ["computed", 7, "forecast_like_synthetic"]);
  });

  it("orders inputs and returns the same result every time", async () => {
    const a = await computeKpi(db, q("KPI-004", ["P-ALP"], ["FR", "DE", "DE"]));
    const b = await computeKpi(db, q("KPI-004", ["P-ALP"], ["DE", "FR"]));
    assert.deepEqual(a, b);
  });
});

describe("computeKpi: insufficient data", () => {
  it("never mixes value types, in the current or the prior month", async () => {
    const current = await computeKpi(db, q("KPI-001", ["P-BET"], ["FR"]));
    assert.equal(current.status, "insufficient_data");
    assert.deepEqual(current.issues, ["other_value_type"]);
    assert.equal(current.value, null);
    assert.match(current.reasons[0], /forecast_like_synthetic \(row 11\); requested actual_like_synthetic/);

    const prior = await computeKpi(db, q("KPI-004", ["P-ALP"], ["US"]));
    assert.equal(prior.status, "insufficient_data");
    assert.match(prior.reasons[0], /P-ALP \/ US \/ 2026-09-01 is forecast_like_synthetic/);
  });

  it("does not drop a mismatched cell from an aggregate", async () => {
    // US prior month is forecast-like: the total over all markets is not computed from the rest.
    const r = await computeKpi(db, q("KPI-004", ["P-ALP"], ["DE", "FR", "US"]));
    assert.equal(r.status, "insufficient_data");
    assert.equal(r.value, null);
  });

  it("reports a missing row", async () => {
    const r = await computeKpi(db, q("KPI-042", ["P-BET"], ["US"]));
    assert.equal(r.status, "insufficient_data");
    assert.deepEqual(r.issues, ["missing_row"]);
    assert.match(r.reasons[0], /No Product_Market_Monthly row for P-BET \/ US \/ 2026-10-01/);
  });

  it("treats growth over a zero prior month as undefined", async () => {
    const r = await computeKpi(db, q("KPI-004", ["P-BET"], ["DE"]));
    assert.equal(r.status, "insufficient_data");
    assert.deepEqual(r.issues, ["zero_prior_period"]);
    // The difference is still defined.
    assert.equal((await computeKpi(db, q("KPI-042", ["P-BET"], ["DE"]))).value, 0);
  });

  it("reports a month outside the data as missing rows", async () => {
    const r = await computeKpi(db, { ...q("KPI-001", ["P-ALP"], ["DE"]), month: "2027-01-01" });
    assert.equal(r.status, "insufficient_data");
  });
});

describe("computeKpi: unsupported", () => {
  it("does not aggregate a percentage over several cells", async () => {
    for (const r of [await computeKpi(db, q("KPI-027", ["P-ALP"], ["DE", "FR"])), await computeKpi(db, q("KPI-027", ["P-ALP", "P-BET"], ["DE"]))]) {
      assert.equal(r.status, "unsupported");
      assert.equal(r.value, null);
      assert.match(r.reasons[0], /not aggregated over 2 cells/);
    }
  });

  it("refuses an approved KPI outside the mapping", async () => {
    const r = await computeKpi(db, q("KPI-090", ["P-ALP"], ["DE"]));
    assert.equal(r.status, "unsupported");
    assert.match(r.reasons[0], /Cannot compute KPI-090 from this pack/);
    assert.equal(r.provenance.query, null);
  });

  it("refuses a D14 KPI that is not implemented yet, with the reason", async () => {
    const r = await computeKpi(db, q("KPI-014", ["P-ALP"], ["DE"]));
    assert.equal(r.status, "unsupported");
    assert.match(r.reasons[0], /not implemented/);
  });

  it("refuses a non-approved variant even when its metric is mapped", async () => {
    const r = await computeKpi(db, q("KPI-005", ["P-ALP"], ["DE"]));
    assert.equal(r.status, "unsupported");
    assert.match(r.reasons.join(" "), /duplicate_candidate \/ local; only approved canonical KPIs are computed/);
  });

  it("refuses a KPI not in the catalog", async () => {
    const r = await computeKpi(db, q("KPI-404", ["P-ALP"], ["DE"]));
    assert.equal(r.status, "unsupported");
    assert.equal(r.kpiName, null);
  });

  it("refuses a catalog unit that does not match the mapping", async () => {
    const d = mkdtempSync(join(tmpdir(), "semantic-unit-"));
    const sheets = FACT_SHEETS.map((s) =>
      s.sheet === "KPI_Catalog" ? { ...s, data: s.data.map((r) => (r[0] === "KPI-001" ? [...r.slice(0, 3), "units", ...r.slice(4)] : r)) } : s,
    );
    await importWorkbook({ sheets, dest: join(d, "x.db"), expected: FACT_EXPECTED });
    const other = openDb(join(d, "x.db"));
    try {
      const r = await computeKpi(other, q("KPI-001", ["P-ALP"], ["DE"]));
      assert.equal(r.status, "unsupported");
      assert.match(r.reasons[0], /unit for KPI-001 is "units", but the mapping expects "EUR"/);
    } finally {
      other.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("inputs and helpers", () => {
  it("rejects malformed queries", async () => {
    await assert.rejects(computeKpi(db, { ...q("KPI-001", ["P-ALP"], ["DE"]), month: "2026-10" }), InvalidKpiQueryError);
    await assert.rejects(computeKpi(db, q("KPI-001", [], ["DE"])), InvalidKpiQueryError);
    await assert.rejects(computeKpi(db, q("KPI-001", ["P-ALP"], ["DE"], { valueType: "blended" })), InvalidKpiQueryError);
  });

  it("finds the prior month across a year boundary", () => {
    assert.equal(priorMonth("2026-01-01"), "2025-12-01");
    assert.equal(priorMonth("2026-12-01"), "2026-11-01");
    assert.equal(priorMonth("2026-10-01"), "2026-09-01");
  });

  it("regression: rejects calendar months outside 01-12 instead of reporting missing data", async () => {
    for (const month of ["2026-00-01", "2026-13-01", "2026-1-01", "2026-10-02"]) {
      assert.throws(() => priorMonth(month), InvalidKpiQueryError, month);
      for (const kpiId of ["KPI-001", "KPI-004"]) {
        await assert.rejects(computeKpi(db, { ...q(kpiId, ["P-ALP"], ["DE"]), month }), InvalidKpiQueryError, `${kpiId} ${month}`);
      }
    }
  });

  it("accepts January and asks for the previous December", async () => {
    const r = await computeKpi(db, { ...q("KPI-004", ["P-ALP"], ["DE"]), month: "2026-01-01" });
    assert.equal(r.filters.priorMonth, "2025-12-01");
    assert.equal(r.status, "insufficient_data"); // valid input; the fixture simply has no such rows
    assert.deepEqual(r.provenance.query?.args, ["P-ALP", "DE", "2025-12-01", "2026-01-01"]);
  });

  it("maps exactly the KPIs REQ-0001 needs plus their base", () => {
    assert.deepEqual(Object.keys(D14_MAPPING).sort(), ["KPI-001", "KPI-004", "KPI-027", "KPI-042"]);
  });

  it("computes one result per market", async () => {
    const r = await computeKpiByMarket(db, q("KPI-004", ["P-ALP"], ["US", "DE", "FR"]));
    assert.deepEqual(
      r.map((x) => [x.marketId, x.result.status, x.result.value]),
      [
        ["DE", "computed", 25],
        ["FR", "computed", -20],
        ["US", "insufficient_data", null],
      ],
    );
  });
});

describe("computability in the steward analysis", () => {
  it("proposes a build when the gap KPI is computable, without approving or building", async () => {
    const a = await analyzeRequest(db, "REQ-S01");
    assert.equal(a.recommendation.kind, "build_proposal");
    assert.deepEqual(
      a.computability.map((c) => [c.kpiId, c.status, c.probe?.month, c.probe?.byMarket.map((m) => m.status)]),
      [
        ["KPI-004", "computable", OCT, ["computed", "computed"]],
        ["KPI-042", "computable", OCT, ["computed", "computed"]],
      ],
    );
    assert.ok(a.recommendation.rationale.some((r) => r.includes("still needs approval, and nothing has been built")));
    assert.ok(!a.recommendation.rationale.some((r) => r.includes("Not yet checked")));
    // Per-market values are kept alongside the statuses.
    assert.deepEqual(
      a.computability[0].probe?.byMarket.map((m) => [m.marketId, m.value, m.unit]),
      [
        ["DE", 25, "%"],
        ["FR", -20, "%"],
      ],
    );
  });

  it("does not propose a build when a gap KPI is unsupported", async () => {
    const a = await analyzeRequest(db, "REQ-S02");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    const units = a.computability.find((c) => c.kpiId === "KPI-014")!;
    assert.equal(units.status, "unsupported");
    assert.ok(a.recommendation.rationale.some((r) => r.includes("cannot deliver KPI-014 (unsupported)")));
  });

  it("regression: analysis-level per-market results carry the same provenance as computeKpi", async () => {
    for (const id of ["REQ-S01", "REQ-S04"]) {
      const a = await analyzeRequest(db, id);
      for (const c of a.computability) {
        for (const m of c.probe!.byMarket) {
          const direct = await computeKpi(db, {
            kpiId: c.kpiId,
            productIds: c.probe!.productIds,
            marketIds: [m.marketId],
            month: c.probe!.month,
            valueType: c.probe!.valueType,
          });
          const { marketId, ...fromAnalysis } = m;
          assert.equal(marketId, direct.filters.marketIds[0]);
          assert.deepEqual(fromAnalysis, {
            status: direct.status,
            value: direct.value,
            unit: direct.unit,
            issues: direct.issues,
            reasons: direct.reasons,
            filters: direct.filters,
            provenance: direct.provenance,
          }, `${id} ${c.kpiId} ${marketId}`);
        }
      }
    }
    // A computed value is traceable without rerunning: formula, catalog row, query and source rows.
    const a = await analyzeRequest(db, "REQ-S01");
    const de = a.computability.find((c) => c.kpiId === "KPI-004")!.probe!.byMarket.find((m) => m.marketId === "DE")!;
    assert.equal(de.value, 25);
    assert.match(de.provenance.formula!, /Net Sales Growth =/);
    assert.deepEqual(de.provenance.catalog, { sheet: "KPI_Catalog", row: 3, id: "KPI-004" });
    assert.deepEqual(de.provenance.query?.args, ["P-ALP", "DE", "2026-09-01", OCT]);
    assert.deepEqual(de.provenance.rows, [
      { sheet: "Product_Market_Monthly", row: 2, id: "P-ALP|DE|2026-09-01" },
      { sheet: "Product_Market_Monthly", row: 3, id: "P-ALP|DE|2026-10-01" },
    ]);
    assert.deepEqual(de.filters, { productIds: ["P-ALP"], marketIds: ["DE"], month: OCT, priorMonth: "2026-09-01", valueType: "actual_like_synthetic" });
  });

  it("regression: one of three markets computable is incomplete and blocks a governed build", async () => {
    const a = await analyzeRequest(db, "REQ-S04");
    assert.deepEqual(a.clarification.resolved, { product: "Betavex", market: "Global" });
    // The coverage gap alone would justify a build proposal.
    assert.deepEqual(
      a.metricCoverage.map((m) => [m.approvedKpiId, m.assetIds]),
      [
        ["KPI-001", ["AST-3"]],
        ["KPI-042", []],
      ],
    );
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.notEqual(a.recommendation.kind, "build_proposal");
    assert.ok(a.recommendation.rationale.some((r) => r.includes("cannot deliver KPI-001 (incomplete), KPI-042 (incomplete) for every requested market")));

    const variance = a.computability.find((c) => c.kpiId === "KPI-042")!;
    assert.equal(variance.status, "incomplete");
    assert.deepEqual(
      variance.probe?.byMarket.map((m) => [m.marketId, m.status, m.value, m.unit, m.issues]),
      [
        ["DE", "computed", 0, "M EUR", []],
        ["FR", "insufficient_data", null, "M EUR", ["other_value_type"]],
        ["US", "insufficient_data", null, "M EUR", ["missing_row"]],
      ],
    );
    // Detailed reasons survive for the failed markets.
    assert.match(variance.probe!.byMarket[1].reasons[0], /P-BET \/ FR \/ 2026-10-01 is forecast_like_synthetic/);
    assert.match(variance.probe!.byMarket[2].reasons[0], /No Product_Market_Monthly row for P-BET \/ US \/ 2026-10-01/);
    assert.ok(variance.reasons.some((r) => r.includes("computable for 1 of 3 market(s) (DE)")));
  });

  it("handles a scope with no markets or products safely", async () => {
    const vocab = await loadVocabulary(db);
    for (const scope of [
      { product: "Alphazol", market: "Atlantis" },
      { product: "Nothing", market: "DE" },
    ]) {
      const [c] = await checkComputability(db, [{ kpiId: "KPI-042", canonicalMetric: "Forecast Variance" }], scope, vocab);
      assert.deepEqual([c.status, c.probe], ["insufficient_data", null]);
    }
    assert.deepEqual(await computeKpiByMarket(db, q("KPI-042", ["P-ALP"], [])), []);
  });

  it("does not propose a build when the latest month has no rows for the scope", async () => {
    const a = await analyzeRequest(db, "REQ-S03");
    assert.equal(a.recommendation.kind, "insufficient_evidence");
    assert.deepEqual(
      a.computability.map((c) => [c.kpiId, c.status, c.probe?.byMarket[0].issues]),
      [
        ["KPI-001", "insufficient_data", ["missing_row"]],
        ["KPI-042", "insufficient_data", ["missing_row"]],
      ],
    );
  });
});
