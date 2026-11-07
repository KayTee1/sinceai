// Discovery agent and Conflict detector (D11 P0 agents, T23). They only word
// the one-line finding shown on the Pipeline view arrow, from facts the
// deterministic services already computed. Any failure, timeout or an answer
// that is too long falls back to the template, so the run never depends on
// the model.
import { Agent } from "@mastra/core/agent";
import type { Summarize } from "../workflows/request-pipeline";

const RULES = `
You write ONE short line (max 14 words) for a live pipeline diagram, from the JSON facts given.
Use only IDs and numbers that appear in the facts. No preamble, no quotes, no markdown, no full stop needed.
All data is synthetic challenge data.`;

const discoveryAgent = new Agent({
  id: "discovery-agent",
  name: "Discovery agent",
  instructions: `You are the Discovery agent: you report what a catalog search found for an analytics request.${RULES}`,
  model: "anthropic/claude-haiku-5-5",
});

const conflictAgent = new Agent({
  id: "conflict-detector",
  name: "Conflict detector",
  instructions: `You are the Conflict detector: you report KPI definitions with the same name but a different status or definition, naming the approved one.${RULES}`,
  model: "anthropic/claude-haiku-5-5",
});

const AGENTS = { "Discovery agent": discoveryAgent, "Conflict detector": conflictAgent } as const;

const TIMEOUT_MS = 6000;

export const agentSummarize: Summarize = async (agent, facts, fallback) => {
  const a = AGENTS[agent as keyof typeof AGENTS];
  if (!a || !process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const out = await Promise.race([
      a.generate(`Facts: ${JSON.stringify(facts)}\nTemplate line (for reference): ${fallback}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    const text = (out as { text?: string } | null)?.text?.replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) return fallback;
    // Every number or ID it writes must already be in the facts or the template.
    const known = `${JSON.stringify(facts)} ${fallback}`;
    const tokens = text.match(/[A-Z]+-\d+|\d+(?:\.\d+)?/g) ?? [];
    if (tokens.some((t) => !known.includes(t))) return fallback;
    return text;
  } catch {
    return fallback;
  }
};

export const pipelineAgents = AGENTS;
