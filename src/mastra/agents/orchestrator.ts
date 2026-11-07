import { Agent } from "@mastra/core/agent";
import { db } from "@/db/client";
import { searchAssets } from "../tools/catalog-tools";
import { ORCHESTRATOR_INSTRUCTIONS, createOrchestratorTools } from "./orchestrator-config";

// T16B: governed steward and build-proposal tools over the deterministic
// services. get-business-request and find-kpi-definitions are no longer in the
// map: analyzeRequest loads and analyses requests, and checkKpiDefinitions
// replaces the LIKE-based KPI check. They stay exported in catalog-tools.ts.
export const orchestrator = new Agent({
  id: "orchestrator",
  name: "Analytics Steward",
  description: "Turns analytics questions into reuse-first recommendations over the Bayer catalog.",
  instructions: ORCHESTRATOR_INSTRUCTIONS,
  model: "anthropic/claude-sonnet-5-5",
  tools: { ...createOrchestratorTools(db), searchAssets },
});
