import { Agent } from "@mastra/core/agent";
import { db } from "@/db/client";
import { ORCHESTRATOR_INSTRUCTIONS, createOrchestratorTools } from "./orchestrator-config";
import { agentSummarize } from "./pipeline-agents";

// T16B: governed steward and build-proposal tools over the deterministic
// services. get-business-request and find-kpi-definitions are no longer in the
// map: analyzeRequest loads and analyses requests, and checkKpiDefinitions
// replaces the LIKE-based KPI check. T22: search-estate replaces search-assets
// (it also sees app-built and archived assets). All stay exported in catalog-tools.ts.
export const orchestrator = new Agent({
  id: "orchestrator",
  name: "Bonsai",
  description: "Turns analytics questions into reuse-first recommendations over the Bayer catalog.",
  instructions: ORCHESTRATOR_INSTRUCTIONS,
  model: "anthropic/claude-sonnet-5-5",
  // T23: the Discovery agent and Conflict detector word the pipeline's findings.
  tools: createOrchestratorTools(db, { summarize: agentSummarize }),
});
