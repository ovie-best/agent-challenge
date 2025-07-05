import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";
import semver from "semver";

interface GitHubVulnerability {
  severity?: string;
  summary?: string;
  vulnerable_version_range: string;
  url?: string;
}

export const dependencyAnalysisTool = createTool({
  id: "dependency-analysis",
  description: "Zero-dependency analysis using native fetch",
  inputSchema: z.object({
    repoUrl: z.string().url(),
    branch: z.string().default("main"),
    weights: z
      .object({
        freshness: z.number().min(0).max(1).default(0.4),
        vulnerability: z.number().min(0).max(1).default(0.3),
        maintenance: z.number().min(0).max(1).default(0.2),
        license: z.number().min(0).max(1).default(0.1),
      })
      .refine(
        (w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 0.01,
        {
          message: "Weights must sum to 1",
        }
      )
      .default({}),
  }),
  outputSchema: z.object({
    score: z.number().min(0).max(100),
    healthStatus: z.enum(["excellent", "good", "fair", "poor", "critical"]),
    metrics: z.object({
      freshness: z.number().min(0).max(100),
      vulnerability: z.number().min(0).max(100),
      maintenance: z.number().min(0).max(100),
      license: z.number().min(0).max(100),
    }),
    details: z.object({
      totalDependencies: z.number(),
      outdatedDependencies: z.number(),
      vulnerableDependencies: z.number(),
      deprecatedDependencies: z.number(),
      incompatibleLicenses: z.number(),
      avgDaysOutdated: z.number(),
      criticalVulnerabilities: z.number(),
      highVulnerabilities: z.number(),
    }),
    problematicDependencies: z.array(
      z.object({
        name: z.string(),
        currentVersion: z.string(),
        latestVersion: z.string(),
        daysOutdated: z.number(),
        vulnerabilities: z
          .array(
            z.object({
              severity: z.string(),
              title: z.string(),
            })
          )
          .optional(),
        license: z.string().optional(),
        deprecated: z.boolean().optional(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { repoUrl, branch, weights } = context;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Extract owner/repo
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (!match) throw new Error("Invalid GitHub URL");
    const [_, owner, repo] = match;

    // Initialize metrics
    const metrics = {
      freshness: 100,
      vulnerability: 100,
      maintenance: 100,
      license: 100,
    };

    const details = {
      totalDependencies: 0,
      outdatedDependencies: 0,
      vulnerableDependencies: 0,
      deprecatedDependencies: 0,
      incompatibleLicenses: 0,
      avgDaysOutdated: 0,
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
    };

    const problematicDeps: Array<{
      name: string;
      currentVersion: string;
      latestVersion: string;
      daysOutdated: number;
      vulnerabilities?: Array<{ severity: string; title: string }>;
      license?: string;
      deprecated?: boolean;
    }> = [];

    try {
      // 1. Get package.json using Octokit
      const packageJson = await getFileContent(
        octokit,
        owner,
        repo,
        branch,
        "package.json"
      );
      if (!packageJson) throw new Error("No package.json found");

      const pkg = JSON.parse(packageJson);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      details.totalDependencies = Object.keys(allDeps).length;

      // 2. Analyze each dependency
      const analyses = await Promise.all(
        Object.entries(allDeps).map(async ([name, versionRange]) => {
          const currentVersion = (versionRange as string).replace(/^[\^~]/, "");
          let daysOutdated = 0;
          const result = {
            name,
            currentVersion,
            latestVersion: "",
            daysOutdated: 0,
            vulnerabilities: [] as Array<{ severity: string; title: string }>,
            license: undefined as string | undefined,
            deprecated: false,
          };

          try {
            // Get package data from npm registry
            const pkgData = await fetchNpmPackage(name);
            result.latestVersion = pkgData["dist-tags"]?.latest;

            // Version freshness
            if (
              result.latestVersion &&
              semver.lt(currentVersion, result.latestVersion)
            ) {
              details.outdatedDependencies++;
              const publishTime = pkgData.time?.[result.latestVersion];
              daysOutdated = publishTime
                ? Math.floor(
                    Date.now() - new Date(publishTime).getTime() / 86400000
                  )
                : 0;
              result.daysOutdated = daysOutdated;
            }

            // Maintenance status
            if (pkgData.versions?.[result.latestVersion]?.deprecated) {
              details.deprecatedDependencies++;
              result.deprecated = true;
            }

            // License check
            result.license =
              pkgData.license ||
              pkgData.versions?.[result.latestVersion]?.license;
            if (result.license && isIncompatibleLicense(result.license)) {
              details.incompatibleLicenses++;
            }

            // Vulnerability check
            const vulns = await fetchVulnerabilities(name, currentVersion);
            if (vulns.length > 0) {
              details.vulnerableDependencies++;
              details.criticalVulnerabilities += vulns.filter(
                (v: GitHubVulnerability) => v.severity === "critical"
              ).length;
              details.highVulnerabilities += vulns.filter(
                (v: GitHubVulnerability) => v.severity === "high"
              ).length;
              result.vulnerabilities = vulns;
            }

            // Track problematic deps
            if (
              daysOutdated > 0 ||
              vulns.length > 0 ||
              result.deprecated ||
              (result.license && isIncompatibleLicense(result.license))
            ) {
              problematicDeps.push(result);
            }

            return { daysOutdated };
          } catch (err) {
            console.warn(`Skipping ${name}: ${err}`);
            return { daysOutdated: 0 };
          }
        })
      );

      // Calculate averages
      const outdatedAnalyses = analyses.filter((a) => a.daysOutdated > 0);
      details.avgDaysOutdated =
        outdatedAnalyses.length > 0
          ? Math.round(
              outdatedAnalyses.reduce((sum, a) => sum + a.daysOutdated, 0) /
                outdatedAnalyses.length
            )
          : 0;

      // Calculate metrics
      metrics.freshness = Math.max(
        0,
        100 - (details.outdatedDependencies * 100) / details.totalDependencies
      );
      metrics.vulnerability = Math.max(
        0,
        100 -
          (details.criticalVulnerabilities * 5 +
            details.highVulnerabilities * 3 +
            (details.vulnerableDependencies -
              details.criticalVulnerabilities -
              details.highVulnerabilities) *
              1)
      );
      metrics.maintenance = Math.max(
        0,
        100 - (details.deprecatedDependencies * 100) / details.totalDependencies
      );
      metrics.license = Math.max(
        0,
        100 - (details.incompatibleLicenses * 100) / details.totalDependencies
      );

      // Final score
      const score = Math.min(
        100,
        Math.round(
          metrics.freshness * weights.freshness +
            metrics.vulnerability * weights.vulnerability +
            metrics.maintenance * weights.maintenance +
            metrics.license * weights.license
        )
      );

      return {
        score,
        healthStatus: getHealthStatus(score) as
          | "excellent"
          | "good"
          | "fair"
          | "poor"
          | "critical",
        metrics,
        details,
        problematicDependencies: problematicDeps.sort(
          (a, b) =>
            (b.vulnerabilities?.length || 0) -
              (a.vulnerabilities?.length || 0) ||
            b.daysOutdated - a.daysOutdated
        ),
      };
    } catch (error) {
      throw new Error(
        `Analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
});

// Helper: Fetch npm package data
async function fetchNpmPackage(name: string) {
  const response = await fetch(`https://registry.npmjs.org/${name}`);
  if (!response.ok) throw new Error(`Package ${name} not found`);
  return response.json();
}

// Helper: Fetch vulnerabilities from GitHub Advisory
async function fetchVulnerabilities(name: string, version: string) {
  try {
    const response = await fetch(
      `https://api.github.com/advisory/npm/${name}`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.vulnerabilities || [])
      .filter((v: any) => semver.satisfies(version, v.vulnerable_version_range))
      .map((v: any) => ({
        severity: v.severity?.toLowerCase() || "unknown",
        title: v.summary || "No title",
      }));
  } catch {
    return [];
  }
}

// Helper: Get file content from GitHub (using Octokit)
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

// Helper: Check license compatibility
function isIncompatibleLicense(license?: string): boolean {
  if (!license) return false;
  const incompatible = ["AGPL", "GPL", "LGPL", "SSPL"];
  return incompatible.some((l) => license.toUpperCase().includes(l));
}

// Helper: Determine health status
function getHealthStatus(score: number) {
  return score >= 90
    ? "excellent"
    : score >= 80
      ? "good"
      : score >= 60
        ? "fair"
        : score >= 40
          ? "poor"
          : "critical";
}
