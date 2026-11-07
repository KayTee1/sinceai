// Requests drafted from a typed chat question (T22). Before T22 a typed
// question had no governed path to a build: only stored requests could be
// analysed and proposed. A draft is a stored request written by the app, kept
// in its own table (chat_requests) and labelled as ours in every source
// reference, so it can never pass as Bayer's Business_Requests. The same
// deterministic analysis, duplicate check and approval rules then apply.
import type { Client } from "@libsql/client";
import { checkKpis, loadKpis } from "./kpis";
import { ALL_PRODUCTS, GLOBAL, loadVocabulary, type RequestRow } from "./requests";

export const CHAT_REQUEST_SHEET = "Chat_Requests (drafted in chat)";

/** A draft that names nothing the catalog knows; the message says what to fix. */
export class DraftRequestError extends Error {}

export type DraftedRequest = {
  requestId: string;
  text: string;
  product: string;
  market: string;
  metrics: string[];
  sourceSheet: typeof CHAT_REQUEST_SHEET;
  createdOn: string;
};

async function hasDraftTable(db: Client): Promise<boolean> {
  const r = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_requests'`);
  return r.rows.length > 0;
}

export async function findChatRequest(db: Client, requestId: string): Promise<RequestRow | null> {
  if (!(await hasDraftTable(db))) return null;
  const r = await db.execute({
    sql: `SELECT request_id, request_date, product_context, market_context, request_text FROM chat_requests WHERE request_id = ?`,
    args: [requestId.trim().toUpperCase()],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    request_id: String(row.request_id),
    request_date: String(row.request_date),
    product_context: String(row.product_context),
    market_context: String(row.market_context),
    request_text: String(row.request_text),
    urgency: null,
    status: "new",
    _source_row: 0,
  };
}

/**
 * Stores a typed question as a request with a catalog scope. The product must
 * be a catalog product or All Pharma; the market a market ID or name, a region
 * or Global (stored as the ID, region or Global, like the pack's contexts).
 * The text must name at least one metric the KPI catalog knows.
 */
export async function draftRequest(
  db: Client,
  input: { text: string; product: string; market: string },
  date: string,
): Promise<DraftedRequest> {
  const text = input.text.trim();
  if (!text) throw new DraftRequestError("The request text is empty.");
  const vocab = await loadVocabulary(db);

  const productIn = input.product.trim().toLowerCase();
  const product =
    productIn === ALL_PRODUCTS.toLowerCase()
      ? ALL_PRODUCTS
      : vocab.products.find((p) => p.name.toLowerCase() === productIn || p.id.toLowerCase() === productIn)?.name;
  if (!product) {
    throw new DraftRequestError(
      `Unknown product "${input.product}". Use one of: ${[...vocab.products.map((p) => p.name), ALL_PRODUCTS].join(", ")}.`,
    );
  }

  const marketIn = input.market.trim().toLowerCase();
  const market =
    marketIn === GLOBAL.toLowerCase()
      ? GLOBAL
      : (vocab.markets.find((m) => m.id.toLowerCase() === marketIn || m.name.toLowerCase() === marketIn)?.id ??
        vocab.regions.find((r) => r.toLowerCase() === marketIn));
  if (!market) {
    throw new DraftRequestError(
      `Unknown market "${input.market}". Use a market (e.g. ${vocab.markets.slice(0, 3).map((m) => m.id).join(", ")}), ` +
        `a region (${vocab.regions.join(", ")}) or Global.`,
    );
  }

  const metrics = checkKpis(text, await loadKpis(db)).map((k) => k.canonicalMetric);
  if (metrics.length === 0) {
    throw new DraftRequestError("The text names no metric from the KPI catalog (e.g. net sales, forecast variance).");
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS chat_requests (
     request_id TEXT PRIMARY KEY, request_date TEXT NOT NULL, product_context TEXT NOT NULL,
     market_context TEXT NOT NULL, request_text TEXT NOT NULL, created_on TEXT NOT NULL)`);
  const n = Number((await db.execute(`SELECT COUNT(*) AS n FROM chat_requests`)).rows[0]?.n ?? 0);
  const requestId = `DRAFT-${String(n + 1).padStart(3, "0")}`;
  await db.execute({
    sql: `INSERT INTO chat_requests (request_id, request_date, product_context, market_context, request_text, created_on)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [requestId, date, product, market, text, new Date().toISOString()],
  });
  return { requestId, text, product, market, metrics, sourceSheet: CHAT_REQUEST_SHEET, createdOn: date };
}
