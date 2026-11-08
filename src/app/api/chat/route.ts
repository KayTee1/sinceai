import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra } from "@/mastra";
import { reportChatError } from "@/lib/chat-error";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 503 },
    );
  }
  const params = await req.json();
  try {
    const stream = await handleChatStream({
      mastra,
      agentId: "orchestrator",
      version: "v7",
      params,
      defaultOptions: { maxSteps: 8 },
      // Model failures mid-stream: a short message for the chat, details in the server log only.
      onError: reportChatError,
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    // Failures before the stream starts get the same treatment.
    return Response.json({ error: reportChatError(error) }, { status: 502 });
  }
}
