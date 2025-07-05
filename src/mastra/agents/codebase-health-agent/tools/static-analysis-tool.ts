import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";

export const staticAnalysisTool = createTool({
  id: "static-analysis-tool",
  description:
    "Performs static analysis on GitHub repositories by examining file structures and code patterns",
  inputSchema: z.object({
    repoUrl: z
      .string()
      .url()
      .describe("GitHub repository URL (e.g., https://github.com/owner/repo)"),
    branch: z.string().default("main").describe("Branch to analyze"),
    depth: z
      .number()
      .min(1)
      .max(5)
      .default(1)
      .describe("Depth of directory traversal (1-5)"),
    fileExtensions: z
      .array(z.string())
      .default(["js", "ts", "jsx", "tsx", "py", "java", "go"])
      .describe("File extensions to analyze"),
    analyzePatterns: z
      .array(z.string())
      .default(["function", "class", "import", "export"])
      .describe("Code patterns to search for"),
  }),
  outputSchema: z.object({
    structure: z.array(
      z.object({
        path: z.string(),
        type: z.enum(["file", "dir"]),
        size: z.number().optional(),
        extension: z.string().optional(),
      })
    ),
    analysis: z.array(
      z.object({
        filePath: z.string(),
        patternsFound: z.array(z.string()),
        lineCount: z.number(),
      })
    ),
    stats: z.object({
      totalFiles: z.number(),
      totalLines: z.number(),
      fileTypes: z.record(z.number()),
      patternDistribution: z.record(z.number()),
    }),
  }),
  execute: async ({ context }) => {
    const { repoUrl, branch, depth, fileExtensions, analyzePatterns } = context;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Extract owner and repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (!match) throw new Error("Invalid GitHub repository URL");
    const [_, owner, repo] = match;

    try {
      const structure: Array<{
        path: string;
        type: "file" | "dir";
        size?: number;
        extension?: string;
      }> = [];
      const analysis: Array<{
        filePath: string;
        patternsFound: string[];
        lineCount: number;
      }> = [];
      const stats = {
        totalFiles: 0,
        totalLines: 0,
        fileTypes: {} as Record<string, number>,
        patternDistribution: {} as Record<string, number>,
      };

      // Recursive function to get repository contents
      const getContents = async (path: string, currentDepth: number) => {
        if (currentDepth > depth) return;

        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          ref: branch,
          path,
        });

        if (Array.isArray(response.data)) {
          // Handle directory contents
          for (const item of response.data) {
            if (item.type === "dir") {
              structure.push({
                path: item.path,
                type: "dir",
              });
              await getContents(item.path, currentDepth + 1);
            } else if (item.type === "file") {
              const extension = item.name.split(".").pop()?.toLowerCase();
              if (extension && fileExtensions.includes(extension)) {
                structure.push({
                  path: item.path,
                  type: "file",
                  size: item.size,
                  extension,
                });

                // Get file content
                const fileResponse = await octokit.rest.repos.getContent({
                  owner,
                  repo,
                  ref: branch,
                  path: item.path,
                  mediaType: {
                    format: "raw",
                  },
                });

                // Handle file content (now as raw text)
                const content = fileResponse.data as unknown as string;
                const lines = content.split("\n");
                const foundPatterns: string[] = [];

                for (const pattern of analyzePatterns) {
                  if (content.includes(pattern)) {
                    foundPatterns.push(pattern);
                    stats.patternDistribution[pattern] =
                      (stats.patternDistribution[pattern] || 0) + 1;
                  }
                }

                analysis.push({
                  filePath: item.path,
                  patternsFound: foundPatterns,
                  lineCount: lines.length,
                });

                stats.totalFiles++;
                stats.totalLines += lines.length;
                stats.fileTypes[extension] =
                  (stats.fileTypes[extension] || 0) + 1;
              }
            }
          }
        }
      };

      await getContents("", 1);

      return {
        structure,
        analysis,
        stats,
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
