import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";

export const codebaseHealthTool = createTool({
  id: "codebase-health",
  description: "Evaluates overall health of a codebase on a scale of 0-100%",
  inputSchema: z.object({
    repoUrl: z.string().url().describe("GitHub repository URL"),
    branch: z.string().default("main"),
    weights: z
      .object({
        testCoverage: z.number().min(0).max(1).default(0.25),
        activity: z.number().min(0).max(1).default(0.2),
        issues: z.number().min(0).max(1).default(0.15),
        documentation: z.number().min(0).max(1).default(0.1),
        complexity: z.number().min(0).max(1).default(0.1),
        dependencies: z.number().min(0).max(1).default(0.1),
        ci: z.number().min(0).max(1).default(0.1),
      })
      .default({}),
  }),
  outputSchema: z.object({
    score: z.number().min(0).max(100).describe("Overall health percentage"),
    metrics: z.object({
      testCoverage: z.number().min(0).max(1),
      activity: z.number().min(0).max(1),
      issues: z.number().min(0).max(1),
      documentation: z.number().min(0).max(1),
      complexity: z.number().min(0).max(1),
      dependencies: z.number().min(0).max(1),
      ci: z.number().min(0).max(1),
    }),
    details: z.object({
      lastCommitDaysAgo: z.number(),
      openIssues: z.number(),
      hasReadme: z.boolean(),
      hasLicense: z.boolean(),
      dependencyCount: z.number(),
      avgCyclomaticComplexity: z.number().optional(),
    }),
  }),
  execute: async ({ context }) => {
    const { repoUrl, branch, weights } = context;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Extract owner/repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (!match) throw new Error("Invalid GitHub URL");
    const [_, owner, repo] = match;

    // Initialize metrics
    const metrics = {
      testCoverage: 0,
      activity: 0,
      issues: 0,
      documentation: 0,
      complexity: 0,
      dependencies: 0,
      ci: 0,
    };

    const details = {
      lastCommitDaysAgo: 0,
      openIssues: 0,
      hasReadme: false,
      hasLicense: false,
      dependencyCount: 0,
    };

    try {
      // 1. Test Coverage Analysis
      const coverageFiles = await checkCoverageFiles(
        octokit,
        owner,
        repo,
        branch
      );
      metrics.testCoverage = Math.min(coverageFiles.length * 0.3, 1);

      // 2. Activity Analysis
      const commits = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 1,
      });
      details.lastCommitDaysAgo = commits.data[0]
        ? Math.floor(
            (Date.now() -
              new Date(commits.data[0].commit.author?.date || 0).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 365;
      metrics.activity = Math.max(0, 1 - details.lastCommitDaysAgo / 365);

      // 3. Issue Analysis
      const issues = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: "open",
        per_page: 100,
      });
      details.openIssues = issues.data.length;
      metrics.issues = Math.max(0, 1 - details.openIssues / 50);

      // 4. Documentation Check
      const readme = await checkFileExists(
        octokit,
        owner,
        repo,
        branch,
        "README.md"
      );
      const license = await checkFileExists(
        octokit,
        owner,
        repo,
        branch,
        "LICENSE"
      );
      details.hasReadme = readme;
      details.hasLicense = license;
      metrics.documentation = (readme ? 0.6 : 0) + (license ? 0.4 : 0);

      // 5. Dependency Health
      const packageJson = await getFileContent(
        octokit,
        owner,
        repo,
        branch,
        "package.json"
      );
      if (packageJson) {
        const pkg = JSON.parse(packageJson);
        details.dependencyCount =
          Object.keys(pkg.dependencies || {}).length +
          Object.keys(pkg.devDependencies || {}).length;
        metrics.dependencies = Math.max(0, 1 - details.dependencyCount / 100);
      }

      // 6. CI Health
      const workflows = await checkFileExists(
        octokit,
        owner,
        repo,
        branch,
        ".github/workflows"
      );
      metrics.ci = workflows ? 1 : 0;

      // Calculate weighted score
      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      const normalizedWeights = Object.fromEntries(
        Object.entries(weights).map(([k, v]) => [k, v / totalWeight])
      );

      const score = Math.round(
        100 *
          (metrics.testCoverage * normalizedWeights.testCoverage +
            metrics.activity * normalizedWeights.activity +
            metrics.issues * normalizedWeights.issues +
            metrics.documentation * normalizedWeights.documentation +
            metrics.dependencies * normalizedWeights.dependencies +
            metrics.ci * normalizedWeights.ci)
      );

      return {
        score,
        metrics,
        details,
      };
    } catch (error) {
      throw new Error(
        `Analysis failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
});

// Helper functions
async function checkFileExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string
) {
  try {
    await octokit.rest.repos.getContent({ owner, repo, ref: branch, path });
    return true;
  } catch {
    return false;
  }
}

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string
) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      ref: branch,
      path,
      mediaType: { format: "raw" },
    });
    return response.data as unknown as string;
  } catch {
    return null;
  }
}

async function checkCoverageFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
) {
  const coverageFiles = [
    "coverage/lcov.info",
    "coverage/coverage-final.json",
    "coverage.xml",
    "jest-coverage.json",
    ".nyc_output",
  ];

  const foundFiles = [];
  for (const file of coverageFiles) {
    if (await checkFileExists(octokit, owner, repo, branch, file)) {
      foundFiles.push(file);
    }
  }
  return foundFiles;
}
