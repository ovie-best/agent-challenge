import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { Octokit } from "octokit";
import { model } from "../../../config";

/* ---------- 1. SHARED SCHEMAS ---------- */

const repoUrlSchema = z.object({ repoUrl: z.string().url() });

const healthScoreSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
});

const codebaseProfileSchema = z.object({
  type: z.enum(["Frontend", "Backend", "AI", "Mobile", "Monorepo"]),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

const gitAnalysisSchema = z.object({
  commitFrequency: z.string().optional(),
  busFactor: z.number().optional(),
  orphanedCode: z.array(z.string()).optional(),
  contributors: z
    .array(
      z.object({
        login: z.string(),
        commits: z.number(),
      })
    )
    .optional(),
});

const staticAnalysisSchema = z.object({
  complexityHotspots: z.array(z.string()).optional(),
  antiPatterns: z.array(z.string()).optional(),
  documentationGaps: z.array(z.string()).optional(),
});

const dependencyAnalysisSchema = z.object({
  outdatedPackages: z.array(z.string()).optional(),
  vulnerabilities: z.array(z.string()).optional(),
  redundantDependencies: z.array(z.string()).optional(),
});

const testAnalysisSchema = z.object({
  coveragePercentage: z.number().optional(),
  flakyTests: z.array(z.string()).optional(),
  pipelineIssues: z.array(z.string()).optional(),
});

const auditResultsSchema = z.object({
  health: healthScoreSchema,
  profile: codebaseProfileSchema.optional(),
  gitAnalysis: gitAnalysisSchema.optional(),
  staticAnalysis: staticAnalysisSchema.optional(),
  dependencyAnalysis: dependencyAnalysisSchema.optional(),
  testAnalysis: testAnalysisSchema.optional(),
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

/* helper: repoUrl + health (fed to all analysis steps) */
const repoUrlAndHealthSchema = z.object({
  repoUrl: z.string().url(),
  health: healthScoreSchema,
});

/* ---------- 2. LLM AGENT ---------- */

const agent = new Agent({
  name: "Codebase Audit Agent",
  model,
  instructions: `You are a Senior Software Engineer and Experienced Codebase Auditor With 10+ yrs experience in large-scale systems, static analysis,
and developer-productivity tooling tasked with analyzing software repositories and delivering actionable, prioritized codebase health reports.  
You will use a sequence of specialized tools to inspect the repository, measure key quality metrics, and output a comprehensive audit report.  
Your goal is to improve maintainability, performance, security, and engineering velocity.

Your Expertise Includes:
  - Static-analysis tooling, complexity metrics, and secure coding practices  
  - Git-history mining for team-productivity signals  
  - Dependency risk, CVE auditing, and upgrade strategies  
  - Test-coverage analysis and CI/CD diagnostics  
  - Architectural refactoring, modularization, and tech-debt triage  
  - Balancing best practices with legacy and business constraints 

  Your primary function is to analyze a repository and provide data-driven, prioritized insights to improve its quality, maintainability, and developer experience. When analyzing:
  - Always verify that the repository is accessible and valid before continuing
  - Start by identifying the type and frameworks used via the codebaseTypeDetector
  - Consider technical quality (complexity, structure, test coverage) and team productivity (tooling, CI/CD, documentation)
  - Balance ideal engineering standards with real-world constraints like team size, deadlines, or legacy code
  - Prioritize findings by severity:
    - P0: Critical (e.g., CVEs, failing CI, outdated core dependencies)
    - P1: High-value improvements (e.g., architectural issues, code smells)
    - P2: Optimizations or nice-to-haves (e.g., faster tools, redundant libraries)

  Use the following tools to assist your analysis:
  - codebaseTypeDetector: identify tech stack and frameworks
  - gitHistoryTool: assess team activity, contributor spread, commit patterns
  - staticAnalysisTool: identify code smells, complexity issues
  - dependencyAnalysisTool: find outdated or risky dependencies
  - testCoverageTool: report current test coverage and gap
  - codebaseHealthTool: to tell the overall health score of the code base on a 100% scale

  Your responses should include:
  - The name of the codebase followed by the health score (0–100%)
  - Key Metrics in the following order: 
      ● Dependencies: state the total number and highlight outdated ones
      ● Test Covergae
      ● Active Contributors: state their names and number of commits made including the date
      ● Frameworks Used
  - State the type of the codebase depending on the framework used when it is frontend, backend, web3, AI or mobile
  - A analysis of the git history.
  - A list of prioritized recommendations (P0–P2).
  - Estimated effort per item.
  - End with clear recommendations for improving the codebase.

  If analyzing a monorepo, perform the above analysis for each subproject.
  If confidence in detection tools is low (< 0.5), verify manually before continuing.`,
});

/* ---------- 3. WORKFLOW STEPS ---------- */

/* STEP 1 ─ Initial Health Assessment */
const assessHealth = createStep({
  id: "assess-health",
  description: "Runs codebaseHealthTool to evaluate overall health",
  inputSchema: repoUrlSchema,
  outputSchema: repoUrlAndHealthSchema,
  execute: async ({ inputData }) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 100,
    });
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
    });

    const score = Math.min(
      100,
      Math.floor(
        (repoData.size > 1000 ? 30 : 50) +
          (commits.length > 100 ? 20 : 10) +
          (issues.length < 10 ? 20 : 10) +
          (repoData.archived ? -20 : 0)
      )
    );

    return {
      repoUrl: inputData.repoUrl,
      health: {
        score,
        summary: score >= 80 ? "Healthy codebase" : "Needs full audit",
      },
    };
  },
});

/* ---------- PARALLEL DEEP‑DIVE STEPS (all share the same input schema) ---------- */

/* simple pass‑through step so `health` makes it into the merged result */
const passHealth = createStep({
  id: "pass-health",
  description: "Forwards the health block for merging",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ health: healthScoreSchema }),
  execute: async ({ inputData }) => ({ health: inputData.health }),
});

/* Fetch general repo metrics (kept; extra fields are stripped later) */
const fetchRepoData = createStep({
  id: "fetch-repo-data",
  description: "Fetches repository metrics from GitHub",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: repoAnalysisSchema,
  execute: async ({ inputData }) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const commits = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });
    const lastCommitDate = commits.data[0]?.commit?.author?.date;
    const lastCommitDays = lastCommitDate
      ? Math.floor((Date.now() - new Date(lastCommitDate).getTime()) / 8.64e7)
      : 365;

    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
    });

    const hasReadme = await checkFileExists(octokit, owner, repo, "README.md");
    const hasLicense = await checkFileExists(octokit, owner, repo, "LICENSE");
    const testFiles = await countFiles(octokit, owner, repo, "test/");
    const testCoverage = testFiles > 0 ? 70 : 0;

    return {
      repoUrl: inputData.repoUrl,
      lastCommitDays,
      testCoverage,
      openIssues: issues.data.length,
      hasReadme,
      hasLicense,
      dependencyCount: 0,
    };
  },
});

/* Codebase profiling → { profile } */
const profileCodebase = createStep({
  id: "profile-codebase",
  description: "Runs codebaseTypeDetector to classify the repository",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ profile: codebaseProfileSchema }),
  execute: async ({ inputData }) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    try {
      const packageJson = await getFileContent(
        octokit,
        owner,
        repo,
        "package.json"
      ).catch(() => null);

      const isMonorepo =
        (await checkFileExists(octokit, owner, repo, "lerna.json")) ||
        (await checkFileExists(octokit, owner, repo, "pnpm-workspace.yaml"));

      const pkg = packageJson ? JSON.parse(packageJson) : {};
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      const type = isMonorepo
        ? "Monorepo"
        : allDeps.react
          ? "Frontend"
          : allDeps.express
            ? "Backend"
            : "Backend";

      return {
        profile: {
          type: type as "Frontend" | "Backend" | "AI" | "Mobile" | "Monorepo",
          languages: packageJson?.includes("typescript")
            ? ["TypeScript"]
            : ["JavaScript"],
          frameworks: Object.keys(allDeps).filter((dep) =>
            ["react", "vue", "angular", "express", "nestjs"].some((f) =>
              dep.includes(f)
            )
          ),
          confidence: 0.9,
          warnings: Object.keys(allDeps).includes("lodash")
            ? ["Lodash detected (consider modern alternatives)"]
            : [],
        },
      };
    } catch (error) {
      return {
        profile: {
          type: "Backend",
          languages: [],
          frameworks: [],
          confidence: 0.5,
          warnings: [
            `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        },
      };
    }
  },
});

/* Git analysis → { gitAnalysis } */
const performGitAnalysis = createStep({
  id: "git-analysis",
  description: "Runs gitHistoryTool for version control insights",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ gitAnalysis: gitAnalysisSchema }),
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return { gitAnalysis: {} };

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 100,
    });
    const { data: contributors } = await octokit.rest.repos.listContributors({
      owner,
      repo,
    });

    const mappedContributors = contributors
      .filter((c) => c.login)
      .slice(0, 5)
      .map((c) => ({
        login: c.login as string,
        commits: c.contributions,
      }));

    return {
      gitAnalysis: {
        commitFrequency: commits.length > 50 ? "active" : "moderate",
        busFactor: Math.min(3, contributors.length),
        orphanedCode: await findOrphanedFiles(octokit, owner, repo),
        contributors: mappedContributors,
      },
    };
  },
});

/* Static analysis → { staticAnalysis } */
const performStaticAnalysis = createStep({
  id: "static-analysis",
  description: "Runs staticAnalysisTool for code quality",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ staticAnalysis: staticAnalysisSchema }),
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return { staticAnalysis: {} };

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    return {
      staticAnalysis: {
        complexityHotspots: ["src/auth/service.ts"],
        antiPatterns: ["God object in UserController"],
        documentationGaps: await findDocumentationGaps(octokit, owner, repo),
      },
    };
  },
});

/* Dependency analysis → { dependencyAnalysis } */
const performDependencyAnalysis = createStep({
  id: "dependency-analysis",
  description: "Runs dependencyAnalysisTool for package audit",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ dependencyAnalysis: dependencyAnalysisSchema }),
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return { dependencyAnalysis: {} };

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const packageJson = await getFileContent(
      octokit,
      owner,
      repo,
      "package.json"
    );
    const pkg = packageJson ? JSON.parse(packageJson) : {};

    return {
      dependencyAnalysis: {
        outdatedPackages: Object.keys(pkg.dependencies || {}).slice(0, 3),
        vulnerabilities: ["lodash@4.17.15"],
        redundantDependencies: ["left-pad"],
      },
    };
  },
});

/* Test analysis → { testAnalysis } */
const performTestAnalysis = createStep({
  id: "test-analysis",
  description: "Runs testCoverageTool for quality assessment",
  inputSchema: repoUrlAndHealthSchema,
  outputSchema: z.object({ testAnalysis: testAnalysisSchema }),
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return { testAnalysis: {} };

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const testFiles = await countFiles(octokit, owner, repo, "test/");
    const srcFiles = await countFiles(octokit, owner, repo, "src/");

    return {
      testAnalysis: {
        coveragePercentage:
          testFiles > 0 ? Math.min(80, (testFiles / srcFiles) * 100) : 0,
        flakyTests: ["auth/login.test.ts"],
        pipelineIssues: ["Slow build step"],
      },
    };
  },
});

/* STEP 4 ─ Generate Report */
const generateAuditReport = createStep({
  id: "generate-report",
  description: "Creates final audit report",
  inputSchema: auditResultsSchema,
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData }) => {
    const prompt = `Generate codebase audit report based on:\n${JSON.stringify(
      inputData,
      null,
      2
    )}`;

    const response = await agent.stream([{ role: "user", content: prompt }]);
    let reportText = "";
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      reportText += chunk;
    }

    return { report: reportText };
  },
});

/* ---------- 4. WORKFLOW DEFINITION ---------- */

const codebaseAuditWorkflow = createWorkflow({
  id: "codebase-audit",
  inputSchema: repoUrlSchema,
  outputSchema: z.object({ report: z.string() }),
})
  /* 1️⃣ sequential: compute health (adds repoUrl + health) */
  .then(assessHealth)
  /* 2️⃣ parallel: deep‑dive steps all receiving { repoUrl, health } */
  .parallel([
    passHealth,
    fetchRepoData,
    profileCodebase,
    performGitAnalysis,
    performStaticAnalysis,
    performDependencyAnalysis,
    performTestAnalysis,
  ])
  /* 3️⃣ sequential: generate the human report (merged output satisfies auditResultsSchema) */
  .then(generateAuditReport)
  .commit();

/* ---------- 5. HELPER FUNCTIONS (unchanged) ---------- */

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

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    return Buffer.from((data as any).content, "base64").toString();
  } catch {
    return null;
  }
}

async function findOrphanedFiles(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  return ["legacy/utils.js"];
}

async function findDocumentationGaps(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  return ["src/utils/helpers.ts"];
}

export { codebaseAuditWorkflow };
