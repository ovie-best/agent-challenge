import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";

export const gitHistoryTool = createTool({
  id: "github-history",
  description:
    "Fetches commit history from GitHub repositories using the GitHub API",
  inputSchema: z.object({
    repoUrl: z
      .string()
      .url()
      .describe("GitHub repository URL (e.g., https://github.com/owner/repo)"),
    branch: z.string().default("main").describe("Branch to analyze"),
    perPage: z
      .number()
      .min(1)
      .max(100)
      .default(30)
      .describe("Number of commits to fetch per page"),
    maxPages: z
      .number()
      .min(1)
      .default(1)
      .describe("Maximum number of pages to fetch"),
    since: z
      .string()
      .optional()
      .describe("Only show commits after this date (ISO 8601 format)"),
    until: z
      .string()
      .optional()
      .describe("Only show commits before this date (ISO 8601 format)"),
  }),
  outputSchema: z.object({
    commits: z.array(
      z.object({
        sha: z.string(),
        author: z.string(),
        date: z.string(),
        message: z.string(),
        url: z.string().url(),
      })
    ),
    stats: z.object({
      total: z.number(),
      contributors: z.array(z.string()),
      firstCommit: z.string().optional(),
      lastCommit: z.string().optional(),
    }),
  }),
  execute: async ({ context }) => {
    const { repoUrl, branch, perPage, maxPages, since, until } = context;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Extract owner and repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (!match) throw new Error("Invalid GitHub repository URL");
    const [_, owner, repo] = match;

    try {
      const commits = [];
      let page = 1;
      let hasMore = true;
      const contributors = new Set<string>();

      while (hasMore && page <= maxPages) {
        const response = await octokit.rest.repos.listCommits({
          owner,
          repo,
          sha: branch,
          per_page: perPage,
          page,
          since,
          until,
        });

        if (response.data.length === 0) {
          hasMore = false;
          break;
        }

        for (const commit of response.data) {
          commits.push({
            sha: commit.sha,
            author:
              commit.commit.author?.name || commit.author?.login || "Unknown",
            date: commit.commit.author?.date || "",
            message: commit.commit.message,
            url: commit.html_url,
          });

          if (commit.author?.login) {
            contributors.add(commit.author.login);
          }
        }

        page++;
      }

      return {
        commits,
        stats: {
          total: commits.length,
          contributors: Array.from(contributors),
          firstCommit: commits[commits.length - 1]?.date,
          lastCommit: commits[0]?.date,
        },
      };
    } catch (error) {
      throw new Error(
        `GitHub API request failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  },
});
