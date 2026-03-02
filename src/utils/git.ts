import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Check if the given directory is a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repository.
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get list of files changed since last index (or all tracked files if no ref given).
 */
export function getChangedFiles(dir: string, sinceRef?: string): string[] {
  try {
    if (sinceRef) {
      const output = execSync(`git diff --name-only ${sinceRef} HEAD`, {
        cwd: dir,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return output.trim().split("\n").filter(Boolean);
    }
    // List all tracked files
    const output = execSync("git ls-files", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the current HEAD commit hash (short).
 */
export function getCurrentCommitHash(dir: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Read .gitignore patterns from a directory.
 */
export function getGitignorePatterns(dir: string): string[] {
  const gitignorePath = join(dir, ".gitignore");
  if (!existsSync(gitignorePath)) return [];

  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Get the remote origin URL.
 */
export function getRemoteUrl(dir: string): string | null {
  try {
    return execSync("git remote get-url origin", {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}
