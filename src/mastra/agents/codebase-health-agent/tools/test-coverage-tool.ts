import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";
import xml2js from "xml2js";

// Types
type CoverageFile = { path: string; type: "lcov" | "cobertura" | "istanbul" };
type CoverageData = {
  lines: { total: number; covered: number; percentage: number };
  branches?: { total: number; covered: number; percentage?: number };
  functions?: { total: number; covered: number; percentage?: number };
};

// Tool Definition
export const testCoverageTool = createTool({
  id: "test-coverage",
  description: "Analyzes test coverage reports in GitHub repositories",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    branch: z.string().default("main"),
    depth: z.number().min(1).max(3).default(2),
  }),
  outputSchema: z.object({
    coverage: z.number().min(0).max(100),
    reportCount: z.number(),
    hasLowCoverage: z.boolean(),
    recommendations: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const { repoUrl, branch, depth } = context;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [_, owner, repo] =
      repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];
    if (!owner || !repo) throw new Error("Invalid GitHub URL");

    // Find and parse coverage reports
    const reports = await findAndParseReports(
      octokit,
      owner,
      repo,
      branch,
      depth
    );
    if (reports.length === 0) return noReportsFound();

    // Calculate metrics
    const coverage = calculateAverageCoverage(reports);
    return {
      coverage,
      reportCount: reports.length,
      hasLowCoverage: coverage < 70,
      recommendations: generateRecommendations(coverage, reports.length),
    };
  },
});

// Core Functions
async function findAndParseReports(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  depth: number
): Promise<CoverageData[]> {
  const patterns = {
    lcov: ["**/lcov.info"],
    cobertura: ["**/cobertura.xml"],
    istanbul: ["**/coverage-final.json"],
  };

  const reports: CoverageData[] = [];
  const files = await findFiles(octokit, owner, repo, branch, patterns, depth);

  for (const file of files) {
    try {
      const content = await getFileContent(
        octokit,
        owner,
        repo,
        branch,
        file.path
      );
      reports.push(await parseReport(content, file.type));
    } catch (error: any) {
      console.warn(`Skipping ${file.path}:`, error.message);
    }
  }

  return reports;
}

async function findFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  patterns: Record<string, string[]>,
  depth: number,
  path = "",
  currentDepth = 1
): Promise<CoverageFile[]> {
  if (currentDepth > depth) return [];

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      ref: branch,
      path,
    });
    if (!Array.isArray(data)) return [];

    const files: CoverageFile[] = [];
    for (const item of data) {
      if (item.type === "dir") {
        files.push(
          ...(await findFiles(
            octokit,
            owner,
            repo,
            branch,
            patterns,
            depth,
            item.path,
            currentDepth + 1
          ))
        );
      } else if (item.type === "file") {
        for (const [type, typePatterns] of Object.entries(patterns)) {
          if (
            typePatterns.some((p) =>
              new RegExp(p.replace("**", ".*")).test(item.path)
            )
          ) {
            files.push({ path: item.path, type: type as CoverageFile["type"] });
            break;
          }
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function parseReport(
  content: string,
  type: string
): Promise<CoverageData> {
  const parsers = {
    lcov: parseLcov,
    cobertura: parseCobertura,
    istanbul: parseIstanbul,
  };
  return (
    parsers[type as keyof typeof parsers]?.(content) ??
    Promise.reject("Unsupported report type")
  );
}

// Parsers (simplified implementations)
function parseLcov(content: string): CoverageData {
  const lines = content.split("\n");
  const totals = lines.filter(
    (l) => l.startsWith("LF:") || l.startsWith("LH:")
  );
  const lineData = totals.reduce(
    (acc, line) => {
      const [key, value] = line.split(":");
      return { ...acc, [key]: parseInt(value) };
    },
    { LF: 0, LH: 0 }
  );

  return {
    lines: {
      total: lineData.LF,
      covered: lineData.LH,
      percentage: lineData.LF
        ? Math.round((lineData.LH / lineData.LF) * 100)
        : 0,
    },
  };
}

async function parseCobertura(content: string): Promise<CoverageData> {
  const { coverage } = await xml2js.parseStringPromise(content);
  return {
    lines: {
      total: parseInt(coverage.$.linesValid),
      covered: parseInt(coverage.$.linesCovered),
      percentage: Math.round(parseFloat(coverage.$.lineRate) * 100),
    },
  };
}

function parseIstanbul(content: string): CoverageData {
  const { total } = JSON.parse(content);
  return {
    lines: {
      total: total.lines.total,
      covered: total.lines.covered,
      percentage: total.lines.pct,
    },
  };
}

// Helpers
function calculateAverageCoverage(reports: CoverageData[]): number {
  const percentages = reports.map((r) => r.lines.percentage);
  return Math.round(
    percentages.reduce((sum, p) => sum + p, 0) / percentages.length
  );
}

function generateRecommendations(
  coverage: number,
  reportCount: number
): string[] {
  const recs = [];
  if (coverage < 70)
    recs.push(`Increase coverage (currently ${coverage}%) to at least 70%`);
  if (reportCount === 1)
    recs.push(
      "Consider generating multiple coverage reports for different test types"
    );
  if (recs.length === 0)
    recs.push("Coverage looks good! Maintain current standards");
  return recs;
}

function noReportsFound() {
  return {
    coverage: 0,
    reportCount: 0,
    hasLowCoverage: true,
    recommendations: [
      "No coverage reports found",
      "Add coverage tracking using tools like Jest, Istanbul, or Cobertura",
    ],
  };
}

async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<string> {
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    ref: branch,
    path,
    mediaType: { format: "raw" },
  });
  return data as unknown as string;
}
