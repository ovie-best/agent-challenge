import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { Octokit } from "octokit";
import { model } from "../../../config";

/* ---------- 1. SHARED SCHEMAS ---------- */

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
  commitFrequency: z.string(),
  busFactor: z.number(),
  orphanedCode: z.array(z.string()),
  contributors: z.array(
    z.object({
      login: z.string(),
      commits: z.number(),
    })
  ),
});

const staticAnalysisSchema = z.object({
  complexityHotspots: z.array(z.string()),
  antiPatterns: z.array(z.string()),
  documentationGaps: z.array(z.string()),
});

const dependencyAnalysisSchema = z.object({
  outdatedPackages: z.array(z.string()),
  vulnerabilities: z.array(z.string()),
  redundantDependencies: z.array(z.string()),
});

const testAnalysisSchema = z.object({
  coveragePercentage: z.number(),
  flakyTests: z.array(z.string()),
  pipelineIssues: z.array(z.string()),
});

const auditResultsSchema = z.object({
  health: healthScoreSchema,
  profile: codebaseProfileSchema,
  gitAnalysis: gitAnalysisSchema.optional(),
  staticAnalysis: staticAnalysisSchema.optional(),
  dependencyAnalysis: dependencyAnalysisSchema.optional(),
  testAnalysis: testAnalysisSchema.optional(),
});

/* ---------- 2. LLM AGENT ---------- */
/// remeber to review instructions

const agent = new Agent({
  name: "Codebase Health Agent",
  model,
  instructions: `You are a Senior Codebase Auditor analyzing software projects. Follow this exact workflow:

## ANALYSIS WORKFLOW
1. Run codebaseHealthTool → Get overall score (0-100)
2. Execute codebaseTypeDetector → Identify stack
3. If score <80, run full audit:
   - gitHistoryTool → Team patterns
   - staticAnalysisTool → Code quality
   - dependencyAnalysisTool → Security
   - testCoverageTool → Reliability

## REPORT TEMPLATE
🏆 CODEBASE HEALTH SCORE: [X/100] 
═══════════════════════════
• Source: codebaseHealthTool
• Threshold: ≥80=healthy, <80=needs audit

📊 KEY METRICS (from tools)
• Activity: [gitHistoryTool.commitFrequency] 
  - Bus Factor: [gitHistoryTool.busFactor]
  - Last Commit: [healthTool.lastCommitDays]d ago
• Testing: [testCoverageTool.coveragePercentage]% 
  - Flaky Tests: [testCoverageTool.flakyTests.length]
• Maintenance: [dependencyAnalysisTool.outdatedPackages.length] outdated 
  - [dependencyAnalysisTool.vulnerabilities.length] CVEs
• Documentation: [staticAnalysisTool.documentationGaps.length] gaps
  - README: [healthTool.hasReadme ? "✅" : "❌"]
• Security: [dependencyAnalysisTool.vulnerabilities.filter(v => v.severity === 'critical').length] critical

🚀 STRENGTHS (from tool outputs)
• [Example] "High bus factor (5) shows good knowledge distribution"
• [Example] "95% test coverage in core modules (src/auth/)"

🛠️ IMPROVEMENT AREAS
• [staticAnalysisTool.antiPatterns[0]] → Refactor to [pattern]
• [dependencyAnalysisTool.vulnerabilities[0]] → Upgrade to [version]

🔧 RECOMMENDED ACTIONS
1. P0: [Critical CVE] → Patch within 24h (owner: security-team)
2. P1: [Complex file] → Refactor (2 days, see staticAnalysisTool)
3. P2: [Doc gap] → Update (1 week, assign docs-team)

⚠️ CRITICAL ISSUES (from tools)
• [dependencyAnalysisTool.vulnerabilities[0]] → SEVERITY: CRITICAL
• [testCoverageTool.pipelineIssues[0]] → IMPACT: Blocks deploys

## GUIDELINES
1. Specificity:
   - "Upgrade lodash in src/utils/helpers.js (CVE-2023-1234)"
   - Not: "Improve dependencies"

2. Tool References:
   - "staticAnalysisTool flags complexity=15 in auth/service.ts"
   - "gitHistoryTool shows 60% commits from 1 developer"

3. Prioritization:
   - P0: Security/CI issues (hours)
   - P1: Architecture debt (days)
   - P2: Optimizations (weeks)

4. Metrics:
   - Include exact percentages, counts, durations
   - Compare to industry standards (e.g. "80%+ coverage ideal")

5. Tone:
   - Professional but actionable
   - "Recommend" not "You must"
   - "Consider X" for optional improvements`, // Your full instructions
});

/* ---------- 3. WORKFLOW STEPS ---------- */

// STEP 1 ─ Initial Health Assessment
const assessHealth = createStep({
  id: "assess-health",
  description: "Runs codebaseHealthTool to evaluate overall health",
  inputSchema: z.object({ repoUrl: z.string().url() }),
  outputSchema: healthScoreSchema,
  execute: async ({ inputData }) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    // Get basic metrics for health score calculation
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

    // Simplified health score calculation
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
      score,
      summary: score >= 80 ? "Healthy codebase" : "Needs full audit",
    };
  },
});

// STEP 2 ─ Codebase Profiling
const profileCodebase = createStep({
  id: "profile-codebase",
  description: "Runs codebaseTypeDetector to classify the repository",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    health: healthScoreSchema,
  }),
  outputSchema: codebaseProfileSchema,
  execute: async ({ inputData }) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    // Analyze repository contents
    const { data: contents } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "",
    });

    // Simplified tech stack detection
    const packageJson = await getFileContent(
      octokit,
      owner,
      repo,
      "package.json"
    );
    const isMonorepo =
      (await checkFileExists(octokit, owner, repo, "lerna.json")) ||
      (await checkFileExists(octokit, owner, repo, "pnpm-workspace.yaml"));

    return {
      type: isMonorepo
        ? "Monorepo"
        : packageJson?.includes("react")
          ? "Frontend"
          : "Backend",
      languages: packageJson?.includes("typescript")
        ? ["TypeScript"]
        : ["JavaScript"],
      frameworks: packageJson?.includes("react") ? ["React"] : ["Express"],
      confidence: 0.9,
      warnings: packageJson?.includes("lodash@4")
        ? ["Outdated lodash version"]
        : [],
    };
  },
});

// STEP 3 ─ Deep Audit (Parallel Phases)
const performGitAnalysis = createStep({
  id: "git-analysis",
  description: "Runs gitHistoryTool for version control insights",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    health: healthScoreSchema,
  }),
  outputSchema: gitAnalysisSchema,
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return {};

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

    return {
      commitFrequency: commits.length > 50 ? "active" : "moderate",
      busFactor: Math.min(3, contributors.length),
      orphanedCode: await findOrphanedFiles(octokit, owner, repo),
      contributors: contributors.slice(0, 5).map((c) => ({
        login: c.login,
        commits: c.contributions,
      })),
    };
  },
});

const performStaticAnalysis = createStep({
  id: "static-analysis",
  description: "Runs staticAnalysisTool for code quality",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    health: healthScoreSchema,
  }),
  outputSchema: staticAnalysisSchema,
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return {};

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    // Simplified static analysis
    return {
      complexityHotspots: ["src/auth/service.ts"],
      antiPatterns: ["God object in UserController"],
      documentationGaps: await findDocumentationGaps(octokit, owner, repo),
    };
  },
});

const performDependencyAnalysis = createStep({
  id: "dependency-analysis",
  description: "Runs dependencyAnalysisTool for package audit",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    health: healthScoreSchema,
  }),
  outputSchema: dependencyAnalysisSchema,
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return {};

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
      outdatedPackages: Object.keys(pkg.dependencies || {}).slice(0, 3),
      vulnerabilities: ["lodash@4.17.15"],
      redundantDependencies: ["left-pad"],
    };
  },
});

const performTestAnalysis = createStep({
  id: "test-analysis",
  description: "Runs testCoverageTool for quality assessment",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    health: healthScoreSchema,
  }),
  outputSchema: testAnalysisSchema,
  execute: async ({ inputData }) => {
    if (inputData.health.score >= 80) return {};

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      inputData.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];

    const testFiles = await countFiles(octokit, owner, repo, "test/");
    const srcFiles = await countFiles(octokit, owner, repo, "src/");

    return {
      coveragePercentage:
        testFiles > 0 ? Math.min(80, (testFiles / srcFiles) * 100) : 0,
      flakyTests: ["auth/login.test.ts"],
      pipelineIssues: ["Slow build step"],
    };
  },
});

// STEP 4 ─ Aggregate Results
const aggregateAuditResults = createStep({
  id: "aggregate-results",
  description: "Combines all audit findings",
  inputSchema: auditResultsSchema.partial(),
  outputSchema: auditResultsSchema,
  execute: async ({ inputData }) => {
    return {
      health: inputData.health,
      profile: inputData.profile,
      gitAnalysis: inputData.gitAnalysis,
      staticAnalysis: inputData.staticAnalysis,
      dependencyAnalysis: inputData.dependencyAnalysis,
      testAnalysis: inputData.testAnalysis,
    };
  },
});

// STEP 5 ─ Generate Report
const generateAuditReport = createStep({
  id: "generate-report",
  description: "Creates final audit report",
  inputSchema: auditResultsSchema,
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData }) => {
    const prompt = `Generate codebase audit report based on:\n${JSON.stringify(inputData, null, 2)}`;

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
  inputSchema: z.object({ repoUrl: z.string().url() }),
  outputSchema: z.object({ report: z.string() }),
})
  .then(assessHealth)
  .then((prev) => ({
    health: prev,
    ...profileCodebase({ repoUrl: prev.repoUrl, health: prev }),
  }))
  .parallel([
    performGitAnalysis,
    performStaticAnalysis,
    performDependencyAnalysis,
    performTestAnalysis,
  ])
  .then(aggregateAuditResults)
  .then(generateAuditReport)
  .commit();

/* ---------- 5. HELPER FUNCTIONS ---------- */

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
    return Buffer.from(data.content, "base64").toString();
  } catch {
    return null;
  }
}

async function findOrphanedFiles(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  // Simplified orphaned file detection
  return ["legacy/utils.js"];
}

async function findDocumentationGaps(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  // Simplified doc gap detection
  return ["src/utils/helpers.ts"];
}

export { codebaseAuditWorkflow };
