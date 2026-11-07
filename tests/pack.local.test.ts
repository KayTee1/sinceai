// Local-only check against the real Bayer workbook. Skipped unless PACK_XLSX
// points to it. Imports into a disposable temp directory; nothing is committed
// or sent anywhere. Expected values come from docs/DATA_SOURCES.md and SCOPE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import readXlsxFile from "read-excel-file/node";
import { EXPECTED_ROW_COUNTS } from "../src/db/expected";
import { importWorkbook } from "../src/db/import-workbook";
import { openDb } from "../src/db/open";
import { computeKpi } from "../src/services/semantic/compute";
import { createStewardTools } from "../src/mastra/tools/steward-tools";
import { analysisView } from "../src/mastra/tools/steward-views";
import { modelVisible, runChat, toolResults, userMessage } from "./helpers/mock-agent";
import { analyzeRequest } from "../src/services/steward/analyze";

const PACK = process.env.PACK_XLSX;
const skip = !PACK || !existsSync(PACK) ? "PACK_XLSX not set to an existing workbook" : false;

describe("Bayer pack (local)", { skip }, () => {
  let dir: string;
  let db: Client;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "steward-pack-"));
    const dest = join(dir, "pack.db");
    await importWorkbook({ sheets: await readXlsxFile(PACK!), dest });
    db = openDb(dest);
  });
  after(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imports every table sheet with the documented row counts", async () => {
    for (const [sheet, count] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const r = await db.execute(`SELECT count(*) AS n, min(_source_row) AS lo, max(_source_row) AS hi FROM "${sheet}"`);
      assert.deepEqual([Number(r.rows[0].n), Number(r.rows[0].lo), Number(r.rows[0].hi)], [count, 2, count + 1], sheet);
    }
  });

  it("preserves blanks, value_type and decoded dates", async () => {
    const blank = await db.execute(`SELECT count(*) AS n FROM Analytics_Assets WHERE owner_id IS NULL`);
    assert.equal(Number(blank.rows[0].n), 21);
    const vt = await db.execute(`SELECT value_type, count(*) AS n FROM Product_Market_Monthly GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(
      vt.rows.map((r) => [r.value_type, Number(r.n)]),
      [
        ["actual_like_synthetic", 491],
        ["forecast_like_synthetic", 489],
      ],
    );
    const months = await db.execute(`SELECT min(month) AS lo, max(month) AS hi FROM Product_Market_Monthly`);
    assert.deepEqual([months.rows[0].lo, months.rows[0].hi], ["2026-01-01", "2026-10-01"]);
  });

  it("REQ-0001: asks which scope is meant (Business_Requests row 2)", async () => {
    const a = await analyzeRequest(db, "REQ-0001");
    assert.equal(a.recommendation.kind, "clarify");
    assert.deepEqual(a.request.source, { sheet: "Business_Requests", row: 2, id: "REQ-0001" });
    assert.deepEqual(a.clarification.options, [
      { from: "context", product: "Beyonttra", market: "EMEA" },
      { from: "text", product: "Nubeqa", market: "Global" },
    ]);
  });

  it("REQ-0001: flags KPI-004 vs. KPI-005 and the other requested metrics", async () => {
    const a = await analyzeRequest(db, "REQ-0001", { product: "Nubeqa", market: "Global" });
    assert.deepEqual(
      a.kpiChecks.map((k) => [k.canonicalMetric, k.approved?.id]),
      [
        ["Net Sales Growth", "KPI-004"],
        ["Forecast Variance", "KPI-042"],
        ["Market Access Coverage", "KPI-027"],
      ],
    );
    const growth = a.kpiChecks[0];
    assert.deepEqual(
      growth.variants.map((v) => v.id),
      ["KPI-005"],
    );
    assert.equal(growth.conflict, true);
    for (const c of a.candidates) {
      assert.equal(c.score, Object.values(c.scoreParts).reduce((s, v) => s + v, 0));
      assert.ok(c.coverage.unknown.length > 0);
    }
    assert.notEqual(a.recommendation.kind, "clarify");
  });

  // T15: every cell recomputed with independent SQL; no pack values are
  // written into this file.
  type Cell = { p: string; m: string; month: string; vt: string; net: number; fc: number; mac: number; fvp: number; pvt: string | null; pnet: number | null };
  async function cells(): Promise<Cell[]> {
    const r = await db.execute(`
      SELECT product_id AS p, market_id AS m, month, value_type AS vt,
             net_sales_m_eur_syn AS net, forecast_m_eur_syn AS fc,
             market_access_coverage_pct_syn AS mac, forecast_variance_pct AS fvp,
             lag(value_type) OVER w AS pvt, lag(net_sales_m_eur_syn) OVER w AS pnet
      FROM Product_Market_Monthly
      WINDOW w AS (PARTITION BY product_id, market_id ORDER BY month)
      ORDER BY 1, 2, 3`);
    return r.rows as unknown as Cell[];
  }
  const ACTUAL = "actual_like_synthetic";
  const close = (a: number | null, b: number, msg: string) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

  it("T15: KPI-001, KPI-042 and KPI-027 match the source row for every actual-like cell, and nothing else", async () => {
    const all = await cells();
    assert.equal(all.length, 980);
    for (const c of all) {
      const where = { productIds: [c.p], marketIds: [c.m], month: c.month };
      const [sales, variance, access] = await Promise.all(
        ["KPI-001", "KPI-042", "KPI-027"].map((kpiId) => computeKpi(db, { kpiId, ...where })),
      );
      const msg = `${c.p}/${c.m}/${c.month}`;
      if (c.vt !== ACTUAL) {
        for (const r of [sales, variance, access]) assert.deepEqual([r.status, r.issues], ["insufficient_data", ["other_value_type"]], msg);
        continue;
      }
      close(sales.value, c.net, `KPI-001 ${msg}`);
      close(variance.value, c.net - c.fc, `KPI-042 ${msg}`);
      close(access.value, c.mac, `KPI-027 ${msg}`);
      // KPI-042 agrees with the pack's own forecast_variance_pct (1 decimal) where the forecast is positive.
      if (c.fc > 0) assert.ok(Math.abs(((variance.value as number) / c.fc) * 100 - c.fvp) <= 0.051, `variance pct ${msg}`);
    }
  });

  it("T15: KPI-004 is computed exactly when both months are actual-like with a positive prior", async () => {
    let computed = 0;
    for (const c of await cells()) {
      const r = await computeKpi(db, { kpiId: "KPI-004", productIds: [c.p], marketIds: [c.m], month: c.month });
      const msg = `${c.p}/${c.m}/${c.month}`;
      const expected = c.vt === ACTUAL && c.pvt === ACTUAL && (c.pnet as number) > 0;
      assert.equal(r.status, expected ? "computed" : "insufficient_data", msg);
      if (expected) {
        computed++;
        close(r.value, ((c.net - (c.pnet as number)) / (c.pnet as number)) * 100, msg);
      }
    }
    assert.ok(computed > 0);
  });

  it("T15: aggregates are ratios of sums or refused, never blended", async () => {
    const all = await cells();
    // Find a month where Nubeqa is actual-like in both months for at least two markets.
    const pairs = all.filter((c) => c.p === "P-NUB" && c.vt === ACTUAL && c.pvt === ACTUAL && (c.pnet as number) > 0);
    const month = pairs.map((c) => c.month).find((m) => pairs.filter((c) => c.month === m).length >= 2)!;
    const group = pairs.filter((c) => c.month === month);
    const r = await computeKpi(db, { kpiId: "KPI-004", productIds: ["P-NUB"], marketIds: group.map((c) => c.m), month });
    const now = group.reduce((s, c) => s + c.net, 0);
    const prior = group.reduce((s, c) => s + (c.pnet as number), 0);
    close(r.value, ((now - prior) / prior) * 100, "ratio of sums");

    const global = await computeKpi(db, { kpiId: "KPI-004", productIds: ["P-NUB"], marketIds: [...new Set(all.map((c) => c.m))], month: "2026-10-01" });
    assert.equal(global.status, "insufficient_data"); // some markets are forecast-like; none are dropped
    const access = await computeKpi(db, { kpiId: "KPI-027", productIds: ["P-NUB"], marketIds: group.map((c) => c.m), month });
    assert.equal(access.status, "unsupported");
  });

  it("T15: REQ-0001 checks computability of KPI-004, KPI-042 and KPI-027 per country", async () => {
    const a = await analyzeRequest(db, "REQ-0001", { product: "Nubeqa", market: "Global" });
    assert.deepEqual(
      a.computability.map((c) => [c.kpiId, c.probe?.month, c.probe?.byMarket.length]),
      [
        ["KPI-004", "2026-10-01", 14],
        ["KPI-042", "2026-10-01", 14],
        ["KPI-027", "2026-10-01", 14],
      ],
    );
    for (const c of a.computability) {
      const markets = c.probe!.byMarket;
      const ok = markets.filter((m) => m.status === "computed").length;
      assert.equal(c.status, ok === markets.length ? "computable" : ok > 0 ? "incomplete" : "insufficient_data", c.kpiId);
      for (const m of markets) {
        assert.equal(m.value !== null, m.status === "computed", `${c.kpiId} ${m.marketId}`);
        const direct = await computeKpi(db, { kpiId: c.kpiId, productIds: c.probe!.productIds, marketIds: [m.marketId], month: c.probe!.month });
        assert.deepEqual([m.value, m.filters, m.provenance], [direct.value, direct.filters, direct.provenance], `${c.kpiId} ${m.marketId}`);
        if (m.status === "computed") assert.ok(m.provenance.rows.length > 0 && m.provenance.query !== null);
      }
    }
    assert.notEqual(a.recommendation.kind, "build_proposal"); // assets map every metric
  });

  // T16: Mastra adapters on the real workbook (read-only, temp import).
  const exec = (tool: unknown, input: unknown) =>
    (tool as { execute: (i: never, c: never) => Promise<unknown> }).execute(input as never, {} as never);

  it("T16: analyze-request equals analyzeRequest for REQ-0001, before and after clarification", async () => {
    const tools = createStewardTools(() => db);
    const clarifyOut = await exec(tools.analyzeRequest, { requestId: "REQ-0001" });
    assert.deepEqual(clarifyOut, await analyzeRequest(db, "REQ-0001"));
    const answer = { product: "Nubeqa", market: "Global" };
    const resolved = (await exec(tools.analyzeRequest, { requestId: "REQ-0001", answer })) as Awaited<ReturnType<typeof analyzeRequest>>;
    assert.deepEqual(resolved, await analyzeRequest(db, "REQ-0001", answer));
    const view = analysisView(resolved);
    assert.equal(view.recommendation.kind, resolved.recommendation.kind);
    assert.deepEqual(view.kpiChecks.map((k) => k.approvedKpiId), ["KPI-004", "KPI-042", "KPI-027"]);
    assert.ok(JSON.stringify(view).length < 15_000, `compact view ${JSON.stringify(view).length} bytes`);
    assert.ok(JSON.stringify(resolved).length > 40_000, "full result keeps provenance");
  });

  it("T16: compute-kpi equals computeKpi for Nubeqa DE", async () => {
    const tools = createStewardTools(() => db);
    const out = await exec(tools.computeKpi, { kpiId: "KPI-004", product: "Nubeqa", market: "DE", month: "2026-10-01" });
    const direct = await computeKpi(db, { kpiId: "KPI-004", productIds: ["P-NUB"], marketIds: ["DE"], month: "2026-10-01" });
    assert.deepEqual(out, { breakdown: "total", result: direct });
  });

  it("T16: a follow-up turn replays the compact view, not the 55 KB analysis", async () => {
    const tools = createStewardTools(() => db);
    const answer = { product: "Nubeqa", market: "Global" };
    const first = await runChat({
      tools,
      script: [{ toolCalls: [{ id: "c1", name: "analyzeRequest", input: { requestId: "REQ-0001", answer } }] }, { text: "Summary" }],
      messages: [userMessage("u1", "REQ-0001, Nubeqa Global")],
    });
    const second = await runChat({
      tools,
      script: [{ text: "ok" }],
      messages: [userMessage("u1", "REQ-0001, Nubeqa Global"), first.assistant!, userMessage("u2", "Why no build?")],
    });
    const full = JSON.stringify(await analyzeRequest(db, "REQ-0001", answer)).length;
    const visible = JSON.stringify(modelVisible(second.prompts[0])).length;
    assert.deepEqual(toolResults(second.prompts[0]).c1.value, analysisView(await analyzeRequest(db, "REQ-0001", answer)));
    assert.ok(visible < full / 3, `model-visible follow-up ${visible} bytes vs full analysis ${full} bytes`);
    // No structured provenance anywhere, including Mastra's providerOptions copy.
    const raw = JSON.stringify(second.prompts[0]);
    for (const banned of ['"provenance"', '"query"', '"rows"', "SELECT "]) assert.ok(!raw.includes(banned), banned);
  });
});
