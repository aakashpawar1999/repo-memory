import { existsSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { ScannedFile } from "./scanner.js";

export interface DetectedConventions {
  /** Project type (e.g., 'Next.js', 'Express', 'Flask', 'CLI') */
  projectType: string | null;
  /** Package manager */
  packageManager: string | null;
  /** Build tool */
  buildTool: string | null;
  /** Test framework */
  testFramework: string | null;
  /** Test file pattern */
  testPattern: string | null;
  /** Primary language */
  primaryLanguage: string;
  /** Naming convention for files */
  fileNaming:
    | "kebab-case"
    | "camelCase"
    | "PascalCase"
    | "snake_case"
    | "mixed";
  /** Naming convention for functions (from symbol analysis) */
  functionNaming: "camelCase" | "snake_case" | "PascalCase" | "mixed";
  /** Entry points */
  entryPoints: string[];
  /** Build command */
  buildCommand: string | null;
  /** Test command */
  testCommand: string | null;
  /** Dev command */
  devCommand: string | null;
  /** Linter */
  linter: string | null;
  /** Formatter */
  formatter: string | null;
}

/**
 * Auto-detect project conventions from file structure and config files.
 */
export function detectConventions(
  files: ScannedFile[],
  rootDir: string,
): DetectedConventions {
  const filePaths = files.map((f) => f.path);
  const conventions: DetectedConventions = {
    projectType: null,
    packageManager: null,
    buildTool: null,
    testFramework: null,
    testPattern: null,
    primaryLanguage: detectPrimaryLanguage(files),
    fileNaming: detectFileNaming(filePaths),
    functionNaming: "mixed",
    entryPoints: [],
    buildCommand: null,
    testCommand: null,
    devCommand: null,
    linter: null,
    formatter: null,
  };

  // Detect from package.json
  const pkgPath = join(rootDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      conventions.packageManager = detectPackageManager(rootDir);
      conventions.buildCommand = pkg.scripts?.build
        ? `${conventions.packageManager} run build`
        : null;
      conventions.testCommand = pkg.scripts?.test
        ? `${conventions.packageManager} test`
        : null;
      conventions.devCommand = pkg.scripts?.dev
        ? `${conventions.packageManager} run dev`
        : pkg.scripts?.start
          ? `${conventions.packageManager} start`
          : null;

      // Entry points from main/module fields
      if (pkg.main) conventions.entryPoints.push(pkg.main);
      if (pkg.module) conventions.entryPoints.push(pkg.module);

      // Detect project type from dependencies
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.next) conventions.projectType = "Next.js";
      else if (allDeps.nuxt) conventions.projectType = "Nuxt";
      else if (allDeps["@sveltejs/kit"]) conventions.projectType = "SvelteKit";
      else if (allDeps.vite && allDeps.react)
        conventions.projectType = "React + Vite";
      else if (allDeps.react) conventions.projectType = "React";
      else if (allDeps.vue) conventions.projectType = "Vue";
      else if (allDeps.svelte) conventions.projectType = "Svelte";
      else if (allDeps.express) conventions.projectType = "Express";
      else if (allDeps.fastify) conventions.projectType = "Fastify";
      else if (allDeps.hono) conventions.projectType = "Hono";
      else if (allDeps.electron) conventions.projectType = "Electron";

      // Test framework
      if (allDeps.vitest) conventions.testFramework = "Vitest";
      else if (allDeps.jest) conventions.testFramework = "Jest";
      else if (allDeps.mocha) conventions.testFramework = "Mocha";
      else if (allDeps.ava) conventions.testFramework = "AVA";

      // Build tool
      if (allDeps.tsup) conventions.buildTool = "tsup";
      else if (allDeps.esbuild) conventions.buildTool = "esbuild";
      else if (allDeps.webpack) conventions.buildTool = "Webpack";
      else if (allDeps.rollup) conventions.buildTool = "Rollup";
      else if (allDeps.vite) conventions.buildTool = "Vite";
      else if (allDeps.turbopack || allDeps.turbo)
        conventions.buildTool = "Turbopack";

      // Linter
      if (allDeps.eslint || allDeps["@eslint/js"])
        conventions.linter = "ESLint";
      else if (allDeps.biome || allDeps["@biomejs/biome"])
        conventions.linter = "Biome";

      // Formatter
      if (allDeps.prettier) conventions.formatter = "Prettier";
      else if (allDeps.biome || allDeps["@biomejs/biome"])
        conventions.formatter = "Biome";
    } catch {
      // Invalid package.json
    }
  }

  // Detect Python projects
  if (existsSync(join(rootDir, "pyproject.toml"))) {
    conventions.packageManager = "pip";
    try {
      const pyproject = readFileSync(join(rootDir, "pyproject.toml"), "utf-8");
      if (pyproject.includes("poetry")) conventions.packageManager = "poetry";
      if (pyproject.includes("uv")) conventions.packageManager = "uv";
      if (pyproject.includes("django")) conventions.projectType = "Django";
      if (pyproject.includes("flask")) conventions.projectType = "Flask";
      if (pyproject.includes("fastapi")) conventions.projectType = "FastAPI";
      if (pyproject.includes("pytest")) conventions.testFramework = "pytest";
    } catch {}
  } else if (existsSync(join(rootDir, "requirements.txt"))) {
    conventions.packageManager = "pip";
  } else if (existsSync(join(rootDir, "Pipfile"))) {
    conventions.packageManager = "pipenv";
  }

  // Detect Go projects
  if (existsSync(join(rootDir, "go.mod"))) {
    conventions.packageManager = "go modules";
    conventions.projectType = "Go";
    conventions.buildCommand = "go build";
    conventions.testCommand = "go test ./...";
  }

  // Detect Rust projects
  if (existsSync(join(rootDir, "Cargo.toml"))) {
    conventions.packageManager = "cargo";
    conventions.projectType = "Rust";
    conventions.buildCommand = "cargo build";
    conventions.testCommand = "cargo test";
  }

  // Detect test patterns
  conventions.testPattern = detectTestPattern(filePaths);

  // Detect entry points from common patterns
  if (conventions.entryPoints.length === 0) {
    conventions.entryPoints = detectEntryPoints(
      filePaths,
      conventions.primaryLanguage,
    );
  }

  // Detect function naming from file content
  conventions.functionNaming = detectFunctionNaming(files);

  return conventions;
}

function detectPrimaryLanguage(files: ScannedFile[]): string {
  const counts = new Map<string, number>();
  const codeExts = new Set([
    "typescript",
    "javascript",
    "python",
    "go",
    "rust",
    "java",
    "kotlin",
    "c",
    "cpp",
    "csharp",
    "ruby",
    "php",
    "swift",
  ]);

  for (const file of files) {
    if (codeExts.has(file.language)) {
      counts.set(file.language, (counts.get(file.language) || 0) + 1);
    }
  }

  let maxLang = "unknown";
  let maxCount = 0;
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxLang = lang;
      maxCount = count;
    }
  }

  return maxLang;
}

function detectPackageManager(rootDir: string): string {
  if (
    existsSync(join(rootDir, "bun.lockb")) ||
    existsSync(join(rootDir, "bun.lock"))
  )
    return "bun";
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectFileNaming(
  paths: string[],
): "kebab-case" | "camelCase" | "PascalCase" | "snake_case" | "mixed" {
  let kebab = 0,
    camel = 0,
    pascal = 0,
    snake = 0;

  for (const p of paths) {
    const name = basename(p, extname(p));
    if (name.includes("-")) kebab++;
    else if (name.includes("_")) snake++;
    else if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) camel++;
    else if (/^[A-Z]/.test(name)) pascal++;
  }

  const total = kebab + camel + pascal + snake;
  if (total === 0) return "mixed";

  if (kebab / total > 0.5) return "kebab-case";
  if (camel / total > 0.5) return "camelCase";
  if (pascal / total > 0.5) return "PascalCase";
  if (snake / total > 0.5) return "snake_case";
  return "mixed";
}

function detectFunctionNaming(
  files: ScannedFile[],
): "camelCase" | "snake_case" | "PascalCase" | "mixed" {
  let camel = 0,
    snake = 0,
    pascal = 0;

  for (const file of files.slice(0, 50)) {
    const funcMatches = file.content.matchAll(
      /(?:function|def|fn|func)\s+([a-zA-Z_]\w*)/g,
    );
    for (const match of funcMatches) {
      const name = match[1];
      if (name.includes("_") && name !== name.toUpperCase()) snake++;
      else if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) camel++;
      else if (/^[A-Z]/.test(name)) pascal++;
    }
  }

  const total = camel + snake + pascal;
  if (total === 0) return "mixed";
  if (camel / total > 0.5) return "camelCase";
  if (snake / total > 0.5) return "snake_case";
  if (pascal / total > 0.5) return "PascalCase";
  return "mixed";
}

function detectTestPattern(paths: string[]): string | null {
  const testFiles = paths.filter(
    (p) =>
      p.includes(".test.") ||
      p.includes(".spec.") ||
      p.includes("_test.") ||
      p.includes("test_") ||
      p.startsWith("test/") ||
      p.startsWith("tests/") ||
      p.includes("__tests__/"),
  );

  if (testFiles.length === 0) return null;

  if (testFiles.some((p) => p.includes("__tests__/")))
    return "Colocated (__tests__/ directories)";
  if (testFiles.some((p) => p.includes(".spec.")))
    return "Colocated (*.spec.* files)";
  if (testFiles.some((p) => p.includes(".test.")))
    return "Colocated (*.test.* files)";
  if (testFiles.some((p) => p.startsWith("tests/") || p.startsWith("test/")))
    return "Separate (test/ or tests/ directory)";
  if (testFiles.some((p) => p.includes("_test.")))
    return "Colocated (*_test.* files)";

  return null;
}

function detectEntryPoints(paths: string[], language: string): string[] {
  const candidates: string[] = [];
  const entryNames: Record<string, string[]> = {
    typescript: [
      "src/index.ts",
      "src/main.ts",
      "src/app.ts",
      "src/server.ts",
      "index.ts",
      "main.ts",
      "src/cli.ts",
    ],
    javascript: [
      "src/index.js",
      "src/main.js",
      "src/app.js",
      "src/server.js",
      "index.js",
      "main.js",
      "src/cli.js",
    ],
    python: [
      "src/main.py",
      "main.py",
      "app.py",
      "src/app.py",
      "__main__.py",
      "manage.py",
      "cli.py",
    ],
    go: ["main.go", "cmd/main.go"],
    rust: ["src/main.rs", "src/lib.rs"],
  };

  const names = entryNames[language] || [];
  for (const name of names) {
    if (paths.includes(name)) {
      candidates.push(name);
    }
  }

  return candidates.slice(0, 3);
}
