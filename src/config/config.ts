import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RepoMemoryConfig {
  /** Glob patterns to ignore */
  ignore: string[];
  /** Max tokens for MEMORY.md output */
  maxTokens: number;
  /** Include line numbers in output */
  includeLineNumbers: boolean;
  /** Include function signatures */
  includeSignatures: boolean;
  /** Include dependency information */
  includeDependencies: boolean;
  /** Include conventions section */
  includeConventions: boolean;
  /** Minimum fan-in to be listed as key file */
  minFanIn: number;
  /** Maximum number of key symbols to list */
  maxKeySymbols: number;
  /** Maximum depth for architecture map */
  maxTreeDepth: number;
}

const DEFAULT_CONFIG: RepoMemoryConfig = {
  ignore: [
    "node_modules",
    "dist",
    "build",
    "out",
    ".git",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "__pycache__",
    ".pytest_cache",
    "venv",
    ".venv",
    "env",
    ".env",
    "vendor",
    "target",
    "coverage",
    ".repo-memory",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "poetry.lock",
    "Pipfile.lock",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.mp3",
    "*.mp4",
    "*.webm",
    "*.pdf",
    "*.zip",
    "*.tar",
    "*.gz",
  ],
  maxTokens: 32000,
  includeLineNumbers: true,
  includeSignatures: true,
  includeDependencies: true,
  includeConventions: true,
  minFanIn: 0,
  maxKeySymbols: 100,
  maxTreeDepth: 4,
};

/**
 * Load configuration from .repo-memory.json in the given directory,
 * merged with defaults.
 */
export function loadConfig(dir: string): RepoMemoryConfig {
  const configPath = join(dir, ".repo-memory.json");

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const userConfig = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        ignore: [...DEFAULT_CONFIG.ignore, ...(userConfig.ignore || [])],
      };
    } catch {
      // Invalid config, use defaults
    }
  }

  return { ...DEFAULT_CONFIG };
}
