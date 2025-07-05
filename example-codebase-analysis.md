# 📊 Codebase Health Analysis Report

## 🧾 Project Overview

- **Name:** `Acme Platform`
- **Tech Stack:**

  - **Frontend:** React + Redux + TypeScript
  - **Backend:** Node.js (Express) + TypeScript
  - **Database:** PostgreSQL (Prisma ORM)
  - **CI/CD:** GitHub Actions + Docker + Heroku

- **Size:** ~120k LOC
- **Team Size:** 8 engineers
- **Age:** 2.5 years
- **Goal:** Improve maintainability, reduce regression bugs, and speed up onboarding

---

## ✅ Executive Summary

| Category          | Score (1–5) | Notes                                                                  |
| ----------------- | ----------- | ---------------------------------------------------------------------- |
| Code Quality      | 3           | Some modules are clean, others overly complex with tight coupling      |
| Testing           | 2           | Backend coverage OK, frontend weak; many critical flows untested       |
| Architecture      | 3           | Decent layering, but some business logic leaks into routes/controllers |
| Dev Experience    | 4           | Fast local setup and strong CI pipeline                                |
| Documentation     | 2           | Sparse README, no high-level system overview                           |
| Dependency Health | 2           | Several vulnerable and outdated packages                               |
| Maintainability   | 3           | High churn in key files; some commented-out code and TODOs             |

---

## 🔍 Detailed Findings

### 1. 📦 Code Quality & Static Analysis

- **Tools Used:** SonarQube, ESLint, Prettier
- **Findings:**
  - 430+ code smells (duplication, long functions, poor naming)
  - 85 functions exceed complexity thresholds
  - 12 files over 1,000 lines long (violation of SRP)
  - Redux store contains mixed concerns (logic & presentation)

---

### 2. 🧪 Testing & Coverage

- **Overall Coverage:** 43%

  - Backend: ~62%
  - Frontend: ~29%

- **Gaps:**
  - No tests for core workflows (checkout, payment)
  - Flaky frontend tests on CI
  - No integration or E2E tests
- **Tools:** Jest, React Testing Library, Codecov

---

### 3. 🏗️ Architecture & Design

- **Strengths:**

  - Backend uses services/controllers pattern
  - TypeScript used across stack
  - Modular file structure

- **Weaknesses:**
  - Business logic mixed in route handlers
  - No domain modeling or bounded contexts
  - No documented architecture (e.g., C4 or ADRs)

---

### 4. 🔐 Dependency & Security Health

- **Tools:** `npm audit`, Snyk, OWASP Dependency-Check
- **Issues Found:**
  - 18 moderate & 4 high-severity vulnerabilities
  - `axios`, `jsonwebtoken`, and `lodash` outdated
  - No automatic update tooling (e.g., Dependabot)

---

### 5. 🧪 Dev Experience

- **Strengths:**

  - Dev environment launches via Docker in <5 minutes
  - CI runs in ~6 minutes with caching
  - Pre-commit lint/format hooks via `husky`

- **Weaknesses:**
  - README lacks setup clarity
  - CI tests occasionally fail (flaky tests)
  - No consistent branching or PR review strategy

---

### 6. 📄 Documentation & Onboarding

- **Gaps Identified:**

  - Outdated README (references deprecated packages)
  - No architecture diagrams or module overviews
  - No onboarding guide or contribution docs

- **Feedback from developers:**
  > “Takes at least 5 days to be productive in the backend. Most logic is learned via code spelunking.”

---

## 🧩 Recommendations

### 🔧 Quick Wins (Week 1–2)

- [ ] Add `Dependabot` for dependency updates
- [ ] Fix outdated and vulnerable packages
- [ ] Enable CI coverage gating (min 60%)
- [ ] Add `/docs/architecture.md` with diagrams
- [ ] Fix top 5 high-churn files identified by `git log` and `CodeScene`

---

### 🧱 Medium-Term (Month 1–2)

- [ ] Extract business logic to service/domain layers
- [ ] Increase frontend test coverage (esp. for Redux logic)
- [ ] Introduce integration tests using `Supertest` or `Playwright`
- [ ] Modularize Redux into feature slices
- [ ] Clean out commented-out code and unresolved TODOs

---

### 📐 Long-Term Strategy (3–6 Months)

- [ ] Introduce ADR (Architecture Decision Record) system
- [ ] Refactor key modules using DDD-style boundaries
- [ ] Create test pyramid strategy (unit, integration, E2E)
- [ ] Run quarterly code health audits
- [ ] Document module ownership & rotating maintainers

---

## 🔚 Conclusion

The `Acme Platform` codebase is functional and generally well-structured, but suffers from:

- Low frontend test coverage
- Architecture drift in backend
- Inconsistent dependency and documentation hygiene

Tackling these issues will enhance maintainability, lower onboarding time, and reduce critical bugs.

---

//////////////////////////original workflow /////////////////////////////////////
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
