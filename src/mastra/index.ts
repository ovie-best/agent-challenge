import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { codeHealthAgent } from "./agents/codebase-health-agent/code-health-agent";
import { codebaseWorkflow } from "./agents/codebase-health-agent/workflows/codebase-health-workflow";

export const mastra = new Mastra({
  workflows: { codebaseWorkflow },
  agents: { codeHealthAgent },

  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    port: 8080,
    timeout: 10000,
  },
});
