import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra } from "@/mastra";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 503 },
    );
  }
  const params = await req.json();
  const stream = await handleChatStream({
    mastra,
    agentId: "orchestrator",
    version: "v7",
    params,
    defaultOptions: { maxSteps: 8 },
  });
  return createUIMessageStreamResponse({ stream });
}
