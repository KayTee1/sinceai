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

export function classifyChatError(error: unknown): ChatErrorKind {
  const e = fields(error);
  const status = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (status === 402 || message.includes("credit balance")) return "credit";
  if (status === 401 || status === 403 || message.includes("api key") || message.includes("authentication")) return "auth";
  if (status === 429 || message.includes("rate limit")) return "rate_limit";
  if (
    (status !== undefined && status >= 500) ||
    message.includes("overloaded") ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("etimedout")
  ) {
    return "unavailable";
  }
  return "unknown";
}

/** The text streamed to the chat for a failed model call. */
export function chatErrorMessage(error: unknown): string {
  return `${MESSAGES[classifyChatError(error)]} ${CHAT_ERROR_SUFFIX}`;
}

/**
 * What the server logs: kind, name, status, provider URL and a shortened
 * message. Never the request body (system prompt, catalog rows), headers or stack.
 */
export function chatErrorLog(error: unknown): Record<string, unknown> {
  const e = fields(error);
  const message = typeof e.message === "string" ? e.message : String(error);
  return {
    kind: classifyChatError(error),
    name: typeof e.name === "string" ? e.name : undefined,
    statusCode: typeof e.statusCode === "number" ? e.statusCode : undefined,
    url: typeof e.url === "string" ? e.url : undefined,
    isRetryable: typeof e.isRetryable === "boolean" ? e.isRetryable : undefined,
    message: message.length > 300 ? `${message.slice(0, 300)}…` : message,
  };
}

/** Logs a failed model call once on the server and returns the chat text. */
export function reportChatError(error: unknown): string {
  console.error("[chat] model request failed", chatErrorLog(error));
  return chatErrorMessage(error);
}
