import fg from "fast-glob";
import ignore from "ignore";
import { readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { createHash } from "node:crypto";
import type { RepoMemoryConfig } from "../config/config.js";
import { getGitignorePatterns } from "../utils/git.js";
import { logger } from "../utils/logger.js";

export interface ScannedFile {
  /** Relative path from repo root */
  path: string;
  /** Absolute path */
  absolutePath: string;
  /** Detected language */
  language: string;
  /** Content hash for change detection */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Number of lines */
  lineCount: number;
  /** Raw content */
  content: string;
}

/** Map file extensions to language names */
const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".md": "markdown",
  ".mdx": "markdown",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".dockerfile": "dockerfile",
  ".vue": "vue",
  ".svelte": "svelte",
};

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  // Handle files without extensions
  const basename = filePath.split("/").pop()?.toLowerCase() || "";
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";
  if (basename === "cmakelists.txt") return "cmake";

  return "unknown";
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Scan a repository directory and return all indexable files.
 */
export async function scanRepository(
  rootDir: string,
  config: RepoMemoryConfig,
): Promise<ScannedFile[]> {
  // Build ignore rules
  const ig = ignore.default();

  // Add config ignore patterns
  ig.add(config.ignore);

  // Add .gitignore patterns
  const gitignorePatterns = getGitignorePatterns(rootDir);
  ig.add(gitignorePatterns);

  // Add .repo-memory-ignore patterns if they exist
  try {
    const customIgnore = readFileSync(
      join(rootDir, ".repo-memory-ignore"),
      "utf-8",
    );
    ig.add(
      customIgnore
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  } catch {
    // No custom ignore file
  }

  // Glob for all files
  const allFiles = await fg("**/*", {
    cwd: rootDir,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  // Filter through ignore rules
  const filteredFiles = ig.filter(allFiles);

  const files: ScannedFile[] = [];
  let skipped = 0;

  for (const relativePath of filteredFiles) {
    const absolutePath = join(rootDir, relativePath);

    try {
      const stat = statSync(absolutePath);

      // Skip very large files (> 1MB)
      if (stat.size > 1_000_000) {
        skipped++;
        continue;
      }

      // Skip binary files (check first 512 bytes)
      const content = readFileSync(absolutePath, "utf-8");
      if (isBinary(content)) {
        skipped++;
        continue;
      }

      const language = detectLanguage(relativePath);
      const lineCount = content.split("\n").length;

      files.push({
        path: relativePath,
        absolutePath,
        language,
        hash: computeHash(content),
        size: stat.size,
        lineCount,
        content,
      });
    } catch {
      // Skip files we can't read
      skipped++;
    }
  }

  if (skipped > 0) {
    logger.debug(`Skipped ${skipped} files (binary/large/unreadable)`);
  }

  return files;
}

/**
 * Simple heuristic to detect binary content.
 */
function isBinary(content: string): boolean {
  const sample = content.slice(0, 512);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
  }
  return nullCount > 0;
}

/**
 * Get language statistics from scanned files.
 */
export function getLanguageStats(
  files: ScannedFile[],
): { language: string; count: number; percentage: number }[] {
  const counts = new Map<string, number>();
  const codeFiles = files.filter(
    (f) =>
      f.language !== "unknown" &&
      f.language !== "json" &&
      f.language !== "yaml" &&
      f.language !== "toml" &&
      f.language !== "xml" &&
      f.language !== "markdown",
  );

  for (const file of codeFiles) {
    counts.set(file.language, (counts.get(file.language) || 0) + 1);
  }

  const total = codeFiles.length || 1;
  return Array.from(counts.entries())
    .map(([language, count]) => ({
      language,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}
