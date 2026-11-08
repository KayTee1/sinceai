// Turns a failed model call into a short message for the chat and a compact
// server-side log record. The client never receives the raw error: the default
// serializer streamed its JSON, including the stack trace and file paths.

export type ChatErrorKind = "credit" | "auth" | "rate_limit" | "unavailable" | "unknown";

const MESSAGES: Record<ChatErrorKind, string> = {
  credit: "The AI assistant is unavailable: the model provider account has no credit left.",
  auth: "The AI assistant is unavailable: the model provider rejected the API key.",
  rate_limit: "The AI assistant is busy right now (rate limited). Wait a moment and try again.",
  unavailable: "The AI assistant can't reach the model right now. Try again shortly.",
  unknown: "The AI assistant hit an error and stopped. Try again; details are in the server log.",
};

/** Added to every message: what still works without the model. */
export const CHAT_ERROR_SUFFIX = "Dashboards, the approval inbox and the clock still work.";

type ErrorLike = { name?: unknown; message?: unknown; statusCode?: unknown; url?: unknown; isRetryable?: unknown };

function fields(error: unknown): ErrorLike {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : { message: String(error) };
}

type Classified = { kind: ChatErrorKind; reason: string };

// `reason` names the signal that decided the kind (a fixed string, never
// copied from the error), so the log can say why without quoting the message.
function classify(error: unknown): Classified {
  const e = fields(error);
  const status = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (status === 402) return { kind: "credit", reason: "status 402" };
  if (message.includes("credit balance")) return { kind: "credit", reason: "message: credit balance" };
  if (status === 401 || status === 403) return { kind: "auth", reason: `status ${status}` };
  for (const marker of ["api key", "authentication"]) {
    if (message.includes(marker)) return { kind: "auth", reason: `message: ${marker}` };
  }
  if (status === 429) return { kind: "rate_limit", reason: "status 429" };
  if (message.includes("rate limit")) return { kind: "rate_limit", reason: "message: rate limit" };
  if (status !== undefined && status >= 500) return { kind: "unavailable", reason: "status 5xx" };
  for (const marker of ["overloaded", "fetch failed", "econnrefused", "etimedout"]) {
    if (message.includes(marker)) return { kind: "unavailable", reason: `message: ${marker}` };
  }
  return { kind: "unknown", reason: "no known signal" };
}

export function classifyChatError(error: unknown): ChatErrorKind {
  return classify(error).kind;
}

/** The text streamed to the chat for a failed model call. */
export function chatErrorMessage(error: unknown): string {
  return `${MESSAGES[classifyChatError(error)]} ${CHAT_ERROR_SUFFIX}`;
}

/** Provider URL without credentials, query string or fragment; undefined if unparseable. */
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return undefined;
  }
}

/** Error class names only (e.g. AI_APICallError); anything else is dropped. */
function safeName(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z_$][\w$.]{0,63}$/.test(value) ? value : undefined;
}

/**
 * What the server logs: kind, the signal that decided it, error class, status,
 * provider origin + path, retryability and message length. Never the message
 * text itself (providers echo keys, prompts and catalog rows into it), URL
 * query strings, the request body, headers or stack.
 */
export function chatErrorLog(error: unknown): Record<string, unknown> {
  const e = fields(error);
  const message = typeof e.message === "string" ? e.message : String(error);
  const { kind, reason } = classify(error);
  return {
    kind,
    reason,
    name: safeName(e.name),
    statusCode: typeof e.statusCode === "number" ? e.statusCode : undefined,
    url: safeUrl(e.url),
    isRetryable: typeof e.isRetryable === "boolean" ? e.isRetryable : undefined,
    messageLength: message.length,
  };
}

/** Logs a failed model call once on the server and returns the chat text. */
export function reportChatError(error: unknown): string {
  console.error("[chat] model request failed", chatErrorLog(error));
  return chatErrorMessage(error);
}

const GENERIC_DISPLAY = MESSAGES.unknown;
const MAX_DISPLAY = 400;

// Text that must never reach the chat: stack frames, file paths, serialized
// objects, and anything shaped like a credential.
const UNSAFE_DISPLAY: RegExp[] = [
  /\n\s*at\s/, // stack frame
  /^\s*at\s.+:\d+:\d+/m, // stack frame on its own line
  /node_modules|webpack|\.(?:ts|tsx|js|mjs|cjs):\d+/i, // source locations
  /(?:^|[\s(])(?:\/(?:Users|home|var|tmp|private|app|opt|srv)\/|[A-Za-z]:\\)/, // file paths
  /[{}\[\]]/, // serialized JSON or objects
  /\bsk-[A-Za-z0-9_-]{8,}/, // API keys (Anthropic / OpenAI style)
  /\bbearer\s+\S{8,}/i,
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]/i,
  /\beyJ[A-Za-z0-9_-]{10,}\./, // JWT
  /[A-Za-z0-9+/_-]{40,}/, // long opaque token
  /https?:\/\/\S*[?#]/i, // URL with query string or fragment
];

/**
 * Turns whatever the chat transport reports into text safe to show. Unwraps a
 * JSON `{ "error": "..." }` body (the route's 502 response) and then applies the
 * same checks to every string; anything doubtful becomes the generic message.
 */
export function safeChatErrorText(raw: unknown): string {
  let text = typeof raw === "string" ? raw.trim() : "";
  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const inner = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
      text = typeof inner === "string" ? inner.trim() : "";
    } catch {
      text = "";
    }
  }
  if (!text || text.length > MAX_DISPLAY) return GENERIC_DISPLAY;
  if (UNSAFE_DISPLAY.some((pattern) => pattern.test(text))) return GENERIC_DISPLAY;
  return text;
}
