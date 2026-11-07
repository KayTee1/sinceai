// Runs Mastra tools through the real agent loop and AI SDK chat stream
// (handleChatStream, as in src/app/api/chat/route.ts) with a scripted mock
// model: no LLM, no network, no API key. Records every prompt the model
// received and every UI stream chunk.
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { handleChatStream } from "@mastra/ai-sdk";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";

export type ScriptStep = { toolCalls: { id: string; name: string; input: unknown }[] } | { text: string };

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export async function runChat(opts: {
  tools: Record<string, unknown>;
  script: ScriptStep[];
  messages: UIMessage[];
}): Promise<{ prompts: unknown[][]; chunks: UIMessageChunk[]; assistant: UIMessage | undefined }> {
  const prompts: unknown[][] = [];
  let step = 0;
  const model = new MockLanguageModelV3({
    doStream: async (call) => {
      prompts.push(call.prompt as unknown[]);
      const s = opts.script[Math.min(step++, opts.script.length - 1)];
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if ("toolCalls" in s) {
        for (const t of s.toolCalls) parts.push({ type: "tool-call", toolCallId: t.id, toolName: t.name, input: JSON.stringify(t.input) });
      } else {
        parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: s.text }, { type: "text-end", id: "t" });
      }
      parts.push({ type: "finish", finishReason: { unified: "toolCalls" in s ? "tool-calls" : "stop", raw: undefined }, usage: USAGE });
      return { stream: convertArrayToReadableStream(parts as never[]) };
    },
  });
  // Mastra's model type expects doGenerate to return a stream result; the agent
  // loop only calls doStream, so the AI SDK mock is cast here (tests only).
  const agent = new Agent({ id: "test-agent", name: "test-agent", instructions: "test", model: model as never, tools: opts.tools as never });
  const mastra = new Mastra({ agents: { testAgent: agent }, logger: false });
  const stream = (await handleChatStream({
    mastra,
    agentId: "testAgent",
    version: "v7",
    params: { messages: opts.messages },
    defaultOptions: { maxSteps: opts.script.length },
  } as never)) as unknown as ReadableStream<UIMessageChunk>;

  const [forChunks, forMessage] = stream.tee();
  const chunks: UIMessageChunk[] = [];
  const reader = forChunks.getReader();
  const collect = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  let assistant: UIMessage | undefined;
  for await (const m of readUIMessageStream({ stream: forMessage })) assistant = m;
  await collect;
  return { prompts, chunks, assistant };
}

export const userMessage = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

/** Tool results the model saw in one prompt, by tool call ID. */
export function toolResults(prompt: unknown[]): Record<string, { type: string; value: unknown }> {
  const out: Record<string, { type: string; value: unknown }> = {};
  for (const m of prompt as { role: string; content: unknown }[]) {
    if (!Array.isArray(m.content)) continue;
    for (const c of m.content as { type: string; toolCallId: string; output: { type: string; value: unknown } }[]) {
      if (c.type === "tool-result") out[c.toolCallId] = c.output;
    }
  }
  return out;
}

/**
 * The prompt without providerOptions. Mastra copies each toModelOutput value
 * into providerOptions.mastra.modelOutput (that is how the compact view
 * survives a replay); the model-visible content is the rest.
 */
export function modelVisible(prompt: unknown[]): unknown {
  const strip = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(strip)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "providerOptions").map(([k, v]) => [k, strip(v)]))
        : x;
  return strip(prompt);
}
