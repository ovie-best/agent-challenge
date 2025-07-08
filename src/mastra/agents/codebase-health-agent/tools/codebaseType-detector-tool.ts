import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";

const FRAMEWORK_SIGNATURES = {
  // Frontend
  frontend: {
    react: ["react", "react-dom"],
    vue: ["vue", "vuex", "vue-router"],
    angular: ["@angular/core", "@angular/common"],
    svelte: ["svelte", "svelte-kit"],
    nextjs: ["next"],
    gatsby: ["gatsby"],
    astro: ["astro"],
    remix: ["@remix-run/react"],
    solid: ["solid-js"],
  },
  // Backend
  backend: {
    express: ["express"],
    nestjs: ["@nestjs/core"],
    django: ["django", "djangorestframework"],
    flask: ["flask"],
    laravel: ["laravel/framework"],
    spring: ["spring-core", "spring-boot"],
    fastapi: ["fastapi"],
    rails: ["rails"],
    phoenix: ["phoenix"],
    actix: ["actix-web"],
  },
  // Web3
  web3: {
    ethers: ["ethers"],
    web3js: ["web3"],
    hardhat: ["hardhat"],
    truffle: ["truffle"],
    wagmi: ["wagmi"],
    foundry: ["forge-std"],
    anchor: ["@project-serum/anchor"],
    solana: ["@solana/web3.js"],
  },
  // AI/ML
  ai: {
    tensorflow: ["@tensorflow/tfjs", "tensorflow"],
    pytorch: ["torch", "pytorch"],
    langchain: ["langchain"],
    llama: ["llama-index"],
    openai: ["openai"],
    huggingface: ["@huggingface/transformers"],
    keras: ["keras"],
    onnx: ["onnxruntime"],
  },
  // Mobile
  mobile: {
    reactnative: ["react-native"],
    flutter: ["flutter"],
    ionic: ["@ionic/core"],
    nativescript: ["nativescript"],
    capacitor: ["@capacitor/core"],
  },
  // Desktop
  desktop: {
    electron: ["electron"],
    tauri: ["@tauri-apps/api"],
    wails: ["wails"],
  },
  // CSS Frameworks
  css: {
    tailwind: ["tailwindcss"],
    bootstrap: ["bootstrap"],
    materialui: ["@mui/material"],
    chakra: ["@chakra-ui/react"],
    styledcomponents: ["styled-components"],
  },
  // Testing
  testing: {
    jest: ["jest"],
    mocha: ["mocha"],
    cypress: ["cypress"],
    playwright: ["playwright"],
    vitest: ["vitest"],
  },
  // Build Tools
  build: {
    webpack: ["webpack"],
    vite: ["vite"],
    rollup: ["rollup"],
    esbuild: ["esbuild"],
    parcel: ["parcel"],
  },
};

export const codebaseTypeDetector = createTool({
  id: "codebase-type-detector",
  description:
    "Detects the type of codebase (frontend, backend, web3, AI, etc.) with extended capabilities",
  inputSchema: z.object({
    repoUrl: z.string().url().describe("GitHub repository URL"),
    depth: z
      .number()
      .min(1)
      .max(5)
      .default(2)
      .describe(
        "Analysis depth (1=shallow, 3=with dev deps, 5=full scan with config files)"
      ),
    confidenceThreshold: z
      .number()
      .min(0.1)
      .max(1)
      .default(0.6)
      .describe("Minimum confidence score to consider detection valid"),
    includeConfigFiles: z
      .boolean()
      .default(false)
      .describe("Whether to analyze config files for additional indicators"),
  }),
  outputSchema: z.object({
    detectedTypes: z.array(
      z.enum([
        "frontend",
        "backend",
        "web3",
        "ai",
        "mobile",
        "desktop",
        "css",
        "testing",
        "build",
        "unknown",
      ])
    ),
    frameworks: z.record(z.array(z.string())),
    confidence: z.number().min(0).max(1),
    packageManager: z.enum([
      "npm",
      "yarn",
      "pnpm",
      "pip",
      "gradle",
      "cargo",
      "mix",
      "bundler",
      "unknown",
    ]),
    details: z.array(
      z.object({
        file: z.string(),
        indicators: z.array(z.string()),
      })
    ),
    warnings: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { repoUrl, depth, confidenceThreshold, includeConfigFiles } = context;
    const { owner, repo } = extractRepoInfo(repoUrl);
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // 1. Get package files and config files if requested
    const packageFiles = await detectPackageFiles(octokit, owner, repo);
    const configFiles = includeConfigFiles
      ? await detectConfigFiles(octokit, owner, repo)
      : [];

    // 2. Analyze dependencies and config files
    const analysis = await analyzeDependencies(
      octokit,
      owner,
      repo,
      [...packageFiles, ...configFiles],
      depth
    );

    // 3. Detect codebase type with enhanced sensitivity
    const result = detectCodebaseType(analysis, confidenceThreshold);

    return {
      detectedTypes: result.types,
      frameworks: result.frameworks,
      confidence: result.confidence,
      packageManager: analysis.packageManager,
      details: analysis.indicators,
      warnings: analysis.warnings,
    };
  },
});

// Helper functions
function extractRepoInfo(repoUrl: string) {
  const [_, owner, repo] =
    repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i) || [];
  if (!owner || !repo) throw new Error("Invalid GitHub URL format");
  return { owner, repo };
}

async function detectPackageFiles(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  const files = [];
  const packageFiles = [
    "package.json",
    "requirements.txt",
    "build.gradle",
    "pom.xml",
    "Cargo.toml",
    "mix.exs",
    "Gemfile",
  ];

  for (const file of packageFiles) {
    try {
      await octokit.rest.repos.getContent({ owner, repo, path: file });
      files.push(file);
    } catch {
      // File doesn't exist
    }
  }

  return files;
}

async function detectConfigFiles(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  const files = [];
  const configFiles = [
    "vite.config.js",
    "webpack.config.js",
    "tailwind.config.js",
    "next.config.js",
    "astro.config.mjs",
    "rollup.config.js",
    "jest.config.js",
    "cypress.config.js",
    "playwright.config.js",
  ];

  for (const file of configFiles) {
    try {
      await octokit.rest.repos.getContent({ owner, repo, path: file });
      files.push(file);
    } catch {
      // File doesn't exist
    }
  }

  return files;
}

async function analyzeDependencies(
  octokit: Octokit,
  owner: string,
  repo: string,
  packageFiles: string[],
  depth: number
) {
  const analysis: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    packageManager:
      | "npm"
      | "yarn"
      | "pnpm"
      | "pip"
      | "gradle"
      | "cargo"
      | "mix"
      | "bundler"
      | "unknown";
    indicators: Array<{ file: string; indicators: string[] }>;
    warnings: string[];
  } = {
    dependencies: {},
    devDependencies: {},
    packageManager: "unknown",
    indicators: [],
    warnings: [],
  };

  // package manager detection
  const lockFiles = {
    "package-lock.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
    "Cargo.lock": "cargo",
    "mix.lock": "mix",
    "Gemfile.lock": "bundler",
  };

  for (const [file, manager] of Object.entries(lockFiles)) {
    try {
      await octokit.rest.repos.getContent({ owner, repo, path: file });
      analysis.packageManager = manager as any;
      break;
    } catch {
      continue;
    }
  }

  // Analyze package.json if exists
  if (packageFiles.includes("package.json")) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "package.json",
      });

      if ("content" in data) {
        const content = JSON.parse(
          Buffer.from(data.content, "base64").toString()
        );
        analysis.dependencies = content.dependencies || {};
        if (depth >= 2) {
          analysis.devDependencies = content.devDependencies || {};
        }
        if (depth >= 4) {
          analysis.dependencies = {
            ...analysis.dependencies,
            ...(content.peerDependencies || {}),
            ...(content.optionalDependencies || {}),
          };
        }
        analysis.indicators.push({
          file: "package.json",
          indicators: Object.keys(content.dependencies || {}),
        });
      }
    } catch (error) {
      analysis.warnings.push(
        `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Analyze requirements.txt (Python)
  if (packageFiles.includes("requirements.txt")) {
    analysis.packageManager = "pip";
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "requirements.txt",
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        const packages = content
          .split("\n")
          .map((line) => line.trim().split(/[=<>]/)[0])
          .filter(Boolean);
        analysis.dependencies = Object.fromEntries(
          packages.map((pkg) => [pkg, "*"])
        );
        analysis.indicators.push({
          file: "requirements.txt",
          indicators: packages,
        });
      }
    } catch (error) {
      analysis.warnings.push(
        `Failed to parse requirements.txt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Analyze Cargo.toml (Rust)
  if (packageFiles.includes("Cargo.toml")) {
    analysis.packageManager = "cargo";
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "Cargo.toml",
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        // Simple parsing of dependencies section
        const matches = content.match(/\[dependencies\.?([^\]]*)\][^[]+/g);
        if (matches) {
          const deps = matches.flatMap((section) => {
            return [...section.matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
          });
          analysis.dependencies = Object.fromEntries(
            deps.map((dep) => [dep, "*"])
          );
          analysis.indicators.push({
            file: "Cargo.toml",
            indicators: deps,
          });
        }
      }
    } catch (error) {
      analysis.warnings.push(
        `Failed to parse Cargo.toml: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Analyze mix.exs (Elixir)
  if (packageFiles.includes("mix.exs")) {
    analysis.packageManager = "mix";
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "mix.exs",
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        // Simple parsing of deps function
        const depsMatch = content.match(/defp? deps do[^]+end/);
        if (depsMatch) {
          const depsSection = depsMatch[0];
          const deps = [...depsSection.matchAll(/{:([^,]+),/g)].map(
            (m) => m[1]
          );
          analysis.dependencies = Object.fromEntries(
            deps.map((dep) => [dep, "*"])
          );
          analysis.indicators.push({
            file: "mix.exs",
            indicators: deps,
          });
        }
      }
    } catch (error) {
      analysis.warnings.push(
        `Failed to parse mix.exs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Analyze Gemfile (Ruby)
  if (packageFiles.includes("Gemfile")) {
    analysis.packageManager = "bundler";
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "Gemfile",
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        const gems = [...content.matchAll(/gem ['"]([^'"]+)['"]/g)].map(
          (m) => m[1]
        );
        analysis.dependencies = Object.fromEntries(
          gems.map((gem) => [gem, "*"])
        );
        analysis.indicators.push({
          file: "Gemfile",
          indicators: gems,
        });
      }
    } catch (error) {
      analysis.warnings.push(
        `Failed to parse Gemfile: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Analyze config files for additional indicators when depth >= 3
  if (depth >= 3) {
    for (const file of packageFiles) {
      if (
        file.endsWith(".config.js") ||
        file.endsWith(".config.ts") ||
        file.includes("config.")
      ) {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: file,
          });

          if ("content" in data) {
            const content = Buffer.from(data.content, "base64").toString();
            // Look for framework-specific patterns
            const indicators: string[] = [];

            // Detect Next.js
            if (content.includes("next.config")) {
              indicators.push("next");
            }

            // Detect Vite
            if (content.includes("vite.config")) {
              indicators.push("vite");
            }

            // Detect Tailwind
            if (content.includes("tailwind.config")) {
              indicators.push("tailwindcss");
            }

            if (indicators.length > 0) {
              analysis.indicators.push({
                file,
                indicators,
              });
            }
          }
        } catch (error) {
          // Skip config files that can't be parsed
        }
      }
    }
  }

  return analysis;
}

function detectCodebaseType(
  analysis: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  },
  confidenceThreshold: number
): {
  types: Array<
    | "frontend"
    | "backend"
    | "web3"
    | "ai"
    | "mobile"
    | "desktop"
    | "css"
    | "testing"
    | "build"
    | "unknown"
  >;
  frameworks: Record<string, string[]>;
  confidence: number;
} {
  const allDeps = {
    ...analysis.dependencies,
    ...analysis.devDependencies,
  };
  const depNames = Object.keys(allDeps);

  const detectedTypes = new Set<
    | "frontend"
    | "backend"
    | "web3"
    | "ai"
    | "mobile"
    | "desktop"
    | "css"
    | "testing"
    | "build"
    | "unknown"
  >();
  const frameworks: Record<string, string[]> = {};
  let totalMatches = 0;

  // Check each category with enhanced matching
  for (const [category, categoryFrameworks] of Object.entries(
    FRAMEWORK_SIGNATURES
  )) {
    for (const [framework, identifiers] of Object.entries(categoryFrameworks)) {
      const matches = identifiers.filter((id) =>
        depNames.some((dep) => {
          // More flexible matching:
          // 1. Exact match
          if (dep === id) return true;
          // 2. Scoped package match (@org/package)
          if (id.startsWith("@") && dep.startsWith(id)) return true;
          // 3. Partial match for longer package names
          if (dep.includes(id) && id.length > 3) return true;
          return false;
        })
      );

      if (matches.length > 0) {
        detectedTypes.add(category as any);
        if (!frameworks[category]) {
          frameworks[category] = [];
        }
        frameworks[category].push(framework);
        totalMatches += matches.length;
      }
    }
  }

  // confidence calculation
  const totalPossibleIdentifiers = Object.values(FRAMEWORK_SIGNATURES)
    .flatMap(Object.values)
    .flat().length;

  // Confidence based on matches vs possible matches
  let confidence = totalMatches / totalPossibleIdentifiers;

  // Boost confidence if we have multiple indicators from different categories
  if (Object.keys(frameworks).length > 1) {
    confidence = Math.min(1, confidence * 1.2);
  }

  // Apply threshold
  if (confidence < confidenceThreshold) {
    detectedTypes.clear();
    detectedTypes.add("unknown");
    confidence = 0;
  }

  // Fallback to unknown if no matches
  if (detectedTypes.size === 0) {
    detectedTypes.add("unknown");
  }

  return {
    types: Array.from(detectedTypes),
    frameworks,
    confidence,
  };
}
