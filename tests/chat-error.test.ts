// Chat errors: the user sees a short message, never the raw error or stack;
// the server log keeps the diagnostics without the request body.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_ERROR_SUFFIX,
  chatErrorLog,
  chatErrorMessage,
  classifyChatError,
  safeChatErrorText,
} from "../src/lib/chat-error";

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
    assert.deepEqual(Object.keys(log).sort(), [
      "isRetryable",
      "kind",
      "messageLength",
      "name",
      "reason",
      "statusCode",
      "url",
    ]);
    assert.equal(log.statusCode, 400);
    assert.equal(log.kind, "credit");
    const json = JSON.stringify(log);
    assert.doesNotMatch(json, /SECRET SYSTEM PROMPT|sk-ant|stack/);
  });

  it("never logs secrets, prompt text or URL query parameters embedded in the error", () => {
    const sentinels = [
      "sk-ant-api03-LEAKSENTINEL0000",
      "Bearer LEAKSENTINELTOKEN1234",
      "PROMPT-SENTINEL-confidential-catalog-row",
      "querysecret=LEAKSENTINEL",
      "userinfo-sentinel",
    ];
    const e = apiError(
      `invalid x-api-key sk-ant-api03-LEAKSENTINEL0000 (Bearer LEAKSENTINELTOKEN1234) ` +
        `while sending "PROMPT-SENTINEL-confidential-catalog-row"`,
      401,
    );
    e.url = "https://userinfo-sentinel:pw@api.anthropic.com/v1/messages?querysecret=LEAKSENTINEL#frag";
    e.name = "Error: PROMPT-SENTINEL-confidential-catalog-row";
    const log = chatErrorLog(e);
    const json = JSON.stringify(log);
    for (const sentinel of sentinels) assert.ok(!json.includes(sentinel), `log leaked ${sentinel}`);
    assert.doesNotMatch(json, /LEAKSENTINEL|SENTINEL/);
    // Safe metadata survives.
    assert.equal(log.kind, "auth");
    assert.equal(log.reason, "status 401");
    assert.equal(log.statusCode, 401);
    assert.equal(log.url, "https://api.anthropic.com/v1/messages");
    assert.equal(log.name, undefined);
    assert.equal(log.messageLength, (e.message as string).length);
  });

  it("drops unparseable or non-http URLs from the log", () => {
    const e = apiError("x", 500);
    e.url = "not a url sk-ant-LEAKSENTINEL";
    assert.equal(chatErrorLog(e).url, undefined);
    e.url = "file:///Users/someone/.env";
    assert.equal(chatErrorLog(e).url, undefined);
  });

  it("logs a bounded, content-free record for oversized messages", () => {
    const log = chatErrorLog(new Error("SENTINEL ".repeat(10_000)));
    assert.equal(log.messageLength, 90_000);
    assert.ok(JSON.stringify(log).length < 400);
    assert.doesNotMatch(JSON.stringify(log), /SENTINEL/);
  });
});

describe("chat error display", () => {
  const generic = chatErrorMessage(new Error("?")).replace(` ${CHAT_ERROR_SUFFIX}`, "");
  const stack = "TypeError: boom\n    at handler (/Users/dev/app/src/app/api/chat/route.ts:22:7)\n    at node_modules/x.js:1:1";

  it("shows every server message unchanged, raw or JSON-wrapped", () => {
    for (const error of [
      apiError("Your credit balance is too low", 400),
      apiError("invalid x-api-key", 401),
      apiError("Too many requests", 429),
      apiError("Overloaded", 529),
      new Error("odd"),
    ]) {
      const text = chatErrorMessage(error);
      assert.equal(safeChatErrorText(text), text);
      assert.equal(safeChatErrorText(JSON.stringify({ error: text })), text);
    }
  });

  it("rejects stack traces, raw or inside a JSON error field", () => {
    assert.equal(safeChatErrorText(stack), generic);
    assert.equal(safeChatErrorText(JSON.stringify({ error: stack })), generic);
    assert.equal(safeChatErrorText(JSON.stringify({ error: "boom at handler (/app/route.ts:22:7)" })), generic);
  });

  it("rejects oversized errors, raw or inside a JSON error field", () => {
    const long = "a ".repeat(300);
    assert.equal(safeChatErrorText(long), generic);
    assert.equal(safeChatErrorText(JSON.stringify({ error: long })), generic);
  });

  it("rejects secrets and sensitive content inside a JSON error field", () => {
    for (const leak of [
      "invalid key sk-ant-api03-LEAKSENTINEL0000",
      "Authorization: Bearer LEAKSENTINELTOKEN1234",
      "api_key=LEAKSENTINEL",
      "see https://api.example.com/v1?token=LEAKSENTINEL",
      "failed at /Users/dev/.env",
      'bad request {"system":"PROMPT-SENTINEL"}',
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJMRUFLIn0.sig",
    ]) {
      assert.equal(safeChatErrorText(leak), generic, leak);
      assert.equal(safeChatErrorText(JSON.stringify({ error: leak })), generic, leak);
    }
  });

  it("falls back for non-string or malformed JSON errors and empty text", () => {
    assert.equal(safeChatErrorText(JSON.stringify({ error: { message: "x", stack } })), generic);
    assert.equal(safeChatErrorText(JSON.stringify({ message: "x" })), generic);
    assert.equal(safeChatErrorText('{"error": "unterminated'), generic);
    assert.equal(safeChatErrorText(""), generic);
    assert.equal(safeChatErrorText(undefined), generic);
  });

  it("still shows short, plain transport errors", () => {
    assert.equal(safeChatErrorText("Failed to fetch"), "Failed to fetch");
  });
});
