// Chat errors: the user sees a short message, never the raw error or stack;
// the server log keeps the diagnostics without the request body.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_ERROR_SUFFIX, chatErrorLog, chatErrorMessage, classifyChatError } from "../src/lib/chat-error";

function apiError(message: string, statusCode?: number) {
  const e = new Error(message) as Error & Record<string, unknown>;
  e.name = "AI_APICallError";
  e.statusCode = statusCode;
  e.url = "https://api.anthropic.com/v1/messages";
  e.isRetryable = false;
  e.requestBodyValues = { system: "SECRET SYSTEM PROMPT" };
  e.responseHeaders = { "x-api-key": "sk-ant-should-not-leak" };
  return e;
}

describe("chat errors", () => {
  it("classifies the provider failures we expect", () => {
    const credit = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.";
    assert.equal(classifyChatError(apiError(credit, 400)), "credit");
    assert.equal(classifyChatError(apiError("invalid x-api-key", 401)), "auth");
    assert.equal(classifyChatError(apiError("Too many requests", 429)), "rate_limit");
    assert.equal(classifyChatError(apiError("Overloaded", 529)), "unavailable");
    assert.equal(classifyChatError(new TypeError("fetch failed")), "unavailable");
    assert.equal(classifyChatError(apiError("Something odd", 400)), "unknown");
    assert.equal(classifyChatError("plain string"), "unknown");
  });

  it("gives the user a short message with no stack, paths or JSON", () => {
    const text = chatErrorMessage(apiError("Your credit balance is too low to access the Anthropic API.", 400));
    assert.match(text, /no credit left/);
    assert.ok(text.endsWith(CHAT_ERROR_SUFFIX));
    assert.doesNotMatch(text, /stack|node_modules|\{|at /);
  });

  it("logs diagnostics without the request body, headers or stack", () => {
    const log = chatErrorLog(apiError("Your credit balance is too low to access the Anthropic API.", 400));
    assert.deepEqual(Object.keys(log).sort(), ["isRetryable", "kind", "message", "name", "statusCode", "url"]);
    assert.equal(log.statusCode, 400);
    assert.equal(log.kind, "credit");
    const json = JSON.stringify(log);
    assert.doesNotMatch(json, /SECRET SYSTEM PROMPT|sk-ant|stack/);
  });

  it("shortens long messages in the log", () => {
    const log = chatErrorLog(new Error("x".repeat(1000)));
    assert.ok((log.message as string).length <= 301);
  });
});
