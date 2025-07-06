import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { codebaseAuditAgent } from "./agents/codebase-health-agent/codebase-audit-agent";
import { codebaseAuditWorkflow } from "./agents/codebase-health-agent/workflows/codebase-audit-workflow";

export const mastra = new Mastra({
  workflows: { codebaseAuditWorkflow },
  agents: { codebaseAuditAgent },

  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    port: 8080,
    timeout: 10000,
  },
});
