import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { model } from "../../../config";
import { Octokit } from "octokit";

const agent = new Agent({
  name: "Codebase Analysis Agent",
  model,
  instructions: `
        You are a senior software engineer specializing in codebase health analysis. Analyze the provided codebase metrics and generate comprehensive recommendations.

        Structure your response exactly as follows:

        🏆 CODEBASE HEALTH SCORE: [X/100]
        ═══════════════════════════

        📊 KEY METRICS
        • Activity: [score/100] - [summary]
        • Testing: [score/100] - [summary]
        • Maintenance: [score/100] - [summary]
        • Documentation: [score/100] - [summary]
        • Security: [score/100] - [summary]

        🚀 STRENGTHS
        • [Strength 1 with specific examples]
        • [Strength 2 with specific examples]

        🛠️ IMPROVEMENT AREAS
        • [Area 1] - [Specific action items]
        • [Area 2] - [Specific action items]

        🔧 RECOMMENDED ACTIONS
        1. [Priority 1 action with owner suggestion]
        2. [Priority 2 action with timeline]
        3. [Priority 3 action with resources]

        ⚠️ CRITICAL ISSUES
        • [Critical issue 1 with severity]
        • [Critical issue 2 with impact]

        Guidelines:
        - Be specific about file paths, packages, or components when possible
        - Reference industry standards where applicable
        - Prioritize recommendations by impact/effort
        - Include concrete metrics in your analysis
        - Suggest tools that could help with improvements
        - Consider both technical debt and team productivity
        - Maintain professional but approachable tone
      `,
});

const repoAnalysisSchema = z.object({
  repoUrl: z.string().url(),
  lastCommitDays: z.number(),
  testCoverage: z.number(),
  openIssues: z.number(),
  hasReadme: z.boolean(),
  hasLicense: z.boolean(),
  dependencyCount: z.number(),
});

const fetchRepoData = createStep({
  id: "fetch-repo-data",
  description: "Fetches repository metrics from GitHub",
  inputSchema: z.object({
    repoUrl: z.string().url().describe("GitHub repository URL"),
  }),
  outputSchema: repoAnalysisSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    if (!owner || !repo) {
      throw new Error("Invalid GitHub URL format");
    }

    // Get repository commits
    const commits = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });
    const lastCommitDate = commits.data[0]?.commit?.author?.date;
    const lastCommitDays = lastCommitDate
      ? Math.floor(
          (Date.now() - new Date(lastCommitDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 365;

    // Get repository issues
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
    });

    // Check for documentation files
    const hasReadme = await checkFileExists(octokit, owner, repo, "README.md");
    const hasLicense = await checkFileExists(octokit, owner, repo, "LICENSE");

    // Count test files (simplified example)
    const testFiles = await countFiles(octokit, owner, repo, "test/");

    return {
      repoUrl: inputData.repoUrl,
      lastCommitDays,
      testCoverage: testFiles > 0 ? 70 : 0, // Simplified coverage estimate
      openIssues: issues.data.length,
      hasReadme,
      hasLicense,
      dependencyCount: 0, // Would normally come from package.json analysis
    };
  },
});

const generateAnalysis = createStep({
  id: "generate-analysis",
  description: "Generates codebase health analysis and recommendations",
  inputSchema: repoAnalysisSchema,
  outputSchema: z.object({
    report: z.string(),
  }),
  execute: async ({ inputData }) => {
    const metrics = inputData;

    if (!metrics) {
      throw new Error("Metrics data not found");
    }

    const prompt = `Analyze the following codebase metrics and generate recommendations:
      ${JSON.stringify(metrics, null, 2)}
      `;

    const response = await agent.stream([
      {
        role: "user",
        content: prompt,
      },
    ]);

    let reportText = "";

    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      reportText += chunk;
    }

    return {
      report: reportText,
    };
  },
});

const codebaseWorkflow = createWorkflow({
  id: "codebase-analysis",
  inputSchema: z.object({
    repoUrl: z.string().url().describe("GitHub repository URL to analyze"),
  }),
  outputSchema: z.object({
    report: z.string(),
  }),
})
  .then(fetchRepoData)
  .then(generateAnalysis);

codebaseWorkflow.commit();

// Helper functions
async function checkFileExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
) {
  try {
    await octokit.rest.repos.getContent({ owner, repo, path });
    return true;
  } catch {
    return false;
  }
}

async function countFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
) {
  try {
    const contents = await octokit.rest.repos.getContent({ owner, repo, path });
    return Array.isArray(contents.data) ? contents.data.length : 1;
  } catch {
    return 0;
  }
}

export { codebaseWorkflow };
