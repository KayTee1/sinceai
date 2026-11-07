// Business request loading and deterministic scope clarification.
// Detects only explicit, exact references to catalog products, market names,
// region names and the word "global" in the request text. Anything else is
// left to the structured context; any disagreement asks the requester.
import type { Client } from "@libsql/client";
import { CHAT_REQUEST_SHEET, findChatRequest } from "./drafts";
import { TEAM_REQUEST_SHEET, findTeamRequest } from "./team-requests";
import type { Clarification, Scope, ScopeConflict, SourceRef } from "./types";

export const ALL_PRODUCTS = "All Pharma";
export const GLOBAL = "Global";

export type RequestRow = {
  request_id: string;
  request_date: string | null;
  product_context: string;
  market_context: string;
  request_text: string;
  urgency: string | null;
  status: string;
  _source_row: number;
};

/** A request with the sheet the loader actually read it from (F5: not inferred from its ID). */
export type LoadedRequest = RequestRow & { _source_sheet: string };

export type Vocabulary = {
  products: { id: string; name: string; row: number }[];
  markets: { id: string; name: string; region: string; row: number }[];
  regions: string[];
};

export async function loadRequest(db: Client, requestId: string): Promise<LoadedRequest | null> {
  const res = await db.execute({
    sql: `SELECT request_id, request_date, product_context, market_context, request_text, urgency, status, _source_row
          FROM Business_Requests WHERE request_id = ?`,
    args: [requestId.trim().toUpperCase()],
  });
  // Pack requests first; then team-authored demo requests (F1, labelled ours).
  // Each branch records its own sheet, so the source follows where the row came from.
  const pack = res.rows[0] as unknown as RequestRow | undefined;
  if (pack) return { ...pack, _source_sheet: "Business_Requests" };
  const team = findTeamRequest(requestId);
  if (team) return { ...team, _source_sheet: TEAM_REQUEST_SHEET };
  // Then requests drafted from a typed chat question (T22, labelled ours).
  const draft = await findChatRequest(db, requestId);
  return draft ? { ...draft, _source_sheet: CHAT_REQUEST_SHEET } : null;
}

export async function loadVocabulary(db: Client): Promise<Vocabulary> {
  const [p, m] = await Promise.all([
    db.execute(`SELECT product_id, product_name, _source_row FROM Products ORDER BY _source_row`),
    db.execute(`SELECT market_id, market_name, region, _source_row FROM Markets ORDER BY _source_row`),
  ]);
  const markets = m.rows.map((r) => ({
    id: String(r.market_id),
    name: String(r.market_name),
    region: String(r.region),
    row: Number(r._source_row),
  }));
  return {
    products: p.rows.map((r) => ({ id: String(r.product_id), name: String(r.product_name), row: Number(r._source_row) })),
    markets,
    regions: [...new Set(markets.map((x) => x.region))],
  };
}

export function requestSource(r: LoadedRequest): SourceRef {
  return { sheet: r._source_sheet, row: r._source_row, id: r.request_id };
}

function mentions(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text);
}

/** Explicit product and market-scope references in the text, in catalog order. */
export function detectScopes(text: string, vocab: Vocabulary): { products: string[]; markets: string[] } {
  const products = vocab.products.filter((p) => mentions(text, p.name)).map((p) => p.name);
  const markets: string[] = [];
  if (mentions(text, "global") || mentions(text, "globally")) markets.push(GLOBAL);
  for (const region of vocab.regions) if (mentions(text, region)) markets.push(region);
  // Market names only; two-letter IDs (IT, US, ...) are too ambiguous in free text.
  for (const m of vocab.markets) if (mentions(text, m.name)) markets.push(m.id);
  return { products, markets };
}

type FieldResult = { value: string | null; conflict?: ScopeConflict; note?: string };

function resolveField(field: "product" | "market", context: string, text: string[], wildcard: string): FieldResult {
  if (text.length === 0) return { value: context, note: `${field} taken from request context only (${context})` };
  if (text.length === 1 && text[0] === context) return { value: context };
  if (text.length === 1 && context === wildcard && text[0] !== wildcard) {
    return { value: text[0], note: `${field}: text narrows context ${wildcard} to ${text[0]}` };
  }
  return { value: null, conflict: { field, context, text } };
}

function describe(c: ScopeConflict): string {
  return `${c.field} "${c.context}" in the request context vs. ${c.text.map((t) => `"${t}"`).join(", ")} in the text`;
}

export function clarify(request: RequestRow, vocab: Vocabulary, answer?: Scope): Clarification {
  const detected = detectScopes(request.request_text, vocab);
  const product = resolveField("product", request.product_context, detected.products, ALL_PRODUCTS);
  const market = resolveField("market", request.market_context, detected.markets, GLOBAL);
  const conflicts = [product.conflict, market.conflict].filter((c): c is ScopeConflict => !!c);
  const notes = [product.note, market.note].filter((n): n is string => !!n);

  if (conflicts.length === 0) {
    return { needed: false, detected, conflicts, resolved: { product: product.value!, market: market.value! }, notes };
  }

  const contextOption = { from: "context" as const, product: request.product_context, market: request.market_context };
  const productChoices = product.conflict ? product.conflict.text : [product.value!];
  const marketChoices = market.conflict ? market.conflict.text : [market.value!];
  const textOptions = productChoices.flatMap((p) => marketChoices.map((m) => ({ from: "text" as const, product: p, market: m })));
  const options = [contextOption, ...textOptions];
  const question = `The request disagrees with itself: ${conflicts.map(describe).join("; ")}. Which scope is meant?`;

  if (answer) {
    const match = options.find((o) => o.product === answer.product && o.market === answer.market);
    if (!match) {
      throw new Error(`Answer ${answer.product} / ${answer.market} is not one of the offered options`);
    }
    return {
      needed: false,
      detected,
      conflicts,
      question,
      options,
      resolved: { product: match.product, market: match.market },
      notes: [...notes, `scope chosen by the requester (${match.from} option)`],
    };
  }
  return { needed: true, detected, conflicts, question, options, resolved: null, notes };
}
