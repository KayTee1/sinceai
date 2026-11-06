import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { rows } from "@/db/client";

// Read-only tools over the imported catalog. They return source IDs so the
// agent can cite evidence; they never write.

export const getBusinessRequest = createTool({
  id: "get-business-request",
  description: "Look up a business request from the catalog by ID, e.g. REQ-0001.",
  inputSchema: z.object({ requestId: z.string().describe("Request ID such as REQ-0001") }),
  execute: async ({ requestId }) => {
    const [req] = await rows<Record<string, unknown>>(
      `SELECT request_id, request_date, product_context, market_context, request_text, urgency, status
       FROM Business_Requests WHERE request_id = ?`,
      [requestId.trim().toUpperCase()],
    );
    return req ? { found: true, request: { ...req } } : { found: false, request: null };
  },
});

type AssetHit = {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  platform: string;
  product_scope: string;
  market_scope: string;
  endorsement: string;
  lifecycle_status: string;
  owner_name: string | null;
  owner_status: string | null;
  kpis: string | null;
};

export const searchAssets = createTool({
  id: "search-assets",
  description:
    "Keyword search over existing BI assets (dashboards, reports, apps, workbooks). " +
    "Use before proposing any new build. Optional product and market narrow the scope.",
  inputSchema: z.object({
    keywords: z.array(z.string()).describe("Words to match in asset names, e.g. ['sales','forecast']"),
    product: z.string().optional().describe("Product name, e.g. Nubeqa"),
    market: z.string().optional().describe("Market ID (DE, US, ...) or 'Global'"),
  }),
  execute: async ({ keywords, product, market }) => {
    const all = await rows<AssetHit>(`
      SELECT a.asset_id, a.asset_name, a.asset_type, a.platform, a.product_scope, a.market_scope,
             a.endorsement, a.lifecycle_status, o.owner_name, o.status AS owner_status,
             (SELECT group_concat(k.kpi_name, ', ') FROM Asset_KPI_Map m
                JOIN KPI_Catalog k ON k.kpi_id = m.kpi_id WHERE m.asset_id = a.asset_id) AS kpis
      FROM Analytics_Assets a LEFT JOIN Owners o ON o.owner_id = a.owner_id`);

    const words = keywords.map((k) => k.toLowerCase()).filter(Boolean);
    const endorsementBoost: Record<string, number> = { certified: 2, promoted: 1 };
    const scored = all
      .filter((a) => !product || a.product_scope === product || a.product_scope === "All Pharma")
      .filter((a) => !market || a.market_scope === market || a.market_scope === "Global")
      .map((a) => {
        const text = `${a.asset_name} ${a.kpis ?? ""}`.toLowerCase();
        const matched = words.filter((w) => text.includes(w));
        return { ...a, matched, score: matched.length * 3 + (endorsementBoost[a.endorsement] ?? 0) };
      })
      .filter((a) => a.matched.length > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 8);

    return { total: scored.length, assets: scored };
  },
});

export const findKpiDefinitions = createTool({
  id: "find-kpi-definitions",
  description:
    "Find KPI definitions for a metric name and every variant sharing its canonical metric. " +
    "Use to detect conflicting definitions (same name, different definition or status).",
  inputSchema: z.object({ metric: z.string().describe("Metric name, e.g. 'Net Sales'") }),
  execute: async ({ metric }) => {
    const like = `%${metric}%`;
    const kpis = await rows<Record<string, unknown>>(
      `SELECT kpi_id, kpi_name, canonical_metric, unit, definition_status, approval_status, description
       FROM KPI_Catalog
       WHERE canonical_metric IN (SELECT canonical_metric FROM KPI_Catalog WHERE kpi_name LIKE ? OR canonical_metric LIKE ?)
       ORDER BY canonical_metric, kpi_id`,
      [like, like],
    );
    const list = kpis.map((k) => ({ ...k }));
    const conflict = list.some((k) => k.approval_status !== "approved" || k.definition_status !== "canonical");
    return { kpis: list, conflict };
  },
});
