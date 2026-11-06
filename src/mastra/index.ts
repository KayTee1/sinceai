import { Mastra } from "@mastra/core/mastra";
import { orchestrator } from "./agents/orchestrator";

export const mastra = new Mastra({
  agents: { orchestrator },
});
