import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/config.js";
import { getLanguageStats, scanRepository } from "../src/indexer/scanner.js";
import { parseFile, type ParsedFile } from "../src/indexer/parser.js";
import {
  buildDependencyGraph,
  getTopDependedOn,
} from "../src/indexer/dependency-resolver.js";
import { detectConventions } from "../src/indexer/conventions.js";
import { MemoryDatabase } from "../src/store/database.js";
import { generateMemoryFile } from "../src/generator/memory-generator.js";

/**
 * A small on-disk fixture repository: two modules importing a shared one, plus
 * a file that must be ignored. Exercises scan -> parse -> resolve -> store ->
 * generate the same way `repo-memory init` does.
 */
let rootDir: string;

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "repo-memory-index-"));
  mkdirSync(join(rootDir, "src"), { recursive: true });
  mkdirSync(join(rootDir, "node_modules", "left-pad"), { recursive: true });

  writeFileSync(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { build: "tsc", test: "vitest run" },
      devDependencies: { vitest: "^3.0.0" },
    }),
  );
  writeFileSync(
    join(rootDir, "src", "shared.ts"),
    `export function helper(value: string): string {
  return value.trim();
}
`,
  );
  writeFileSync(
    join(rootDir, "src", "a.ts"),
    `import { helper } from "./shared.js";

export function runA(): string {
  return helper("a");
}
`,
  );
  writeFileSync(
    join(rootDir, "src", "b.ts"),
    `import { helper } from "./shared.js";

export class RunnerB {
  run(): string {
    return helper("b");
  }
}
`,
  );
  // Must never be scanned: node_modules is in the default ignore list.
  writeFileSync(
    join(rootDir, "node_modules", "left-pad", "index.js"),
    "module.exports = function leftPad() {};\n",
  );
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("scanRepository", () => {
  it("finds source files, detects languages, and honours the ignore list", async () => {
    const files = await scanRepository(rootDir, loadConfig(rootDir));
    const paths = files.map((f) => f.path);

    expect(paths).toEqual(
      expect.arrayContaining(["src/a.ts", "src/b.ts", "src/shared.ts"]),
    );
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);

    const ts = files.find((f) => f.path === "src/a.ts");
    expect(ts?.language).toBe("typescript");
    expect(ts?.hash).toBeTruthy();
    expect(ts?.lineCount).toBeGreaterThan(0);

    expect(getLanguageStats(files)[0].language).toBe("typescript");
  });
});

describe("buildDependencyGraph", () => {
  it("resolves relative imports to files and counts fan-in", async () => {
    const files = await scanRepository(rootDir, loadConfig(rootDir));
    const parsed = files
      .filter((f) => f.language === "typescript")
      .map(parseFile);

    const graph = buildDependencyGraph(
      parsed,
      files.map((f) => f.path),
      rootDir,
    );

    const internal = graph.edges.filter((e) => !e.isExternal);
    expect(internal.map((e) => e.target)).toEqual(
      expect.arrayContaining(["src/shared.ts"]),
    );

    // shared.ts is imported by both a.ts and b.ts, so it tops the fan-in list.
    expect(getTopDependedOn(graph, 1)[0]).toMatchObject({
      path: "src/shared.ts",
      fanIn: 2,
    });
  });
});

describe("detectConventions", () => {
  it("reads build and test commands out of package.json", async () => {
    const files = await scanRepository(rootDir, loadConfig(rootDir));
    const conventions = detectConventions(files, rootDir);

    expect(conventions.primaryLanguage).toBe("typescript");
    expect(conventions.buildCommand).toContain("build");
    expect(conventions.testCommand).toContain("test");
  });
});

describe("index and generate", () => {
  it("stores symbols, searches them, and renders MEMORY.md", async () => {
    const config = loadConfig(rootDir);
    const files = await scanRepository(rootDir, config);
    const parsed: ParsedFile[] = files
      .filter((f) => f.language === "typescript")
      .map(parseFile);

    const db = new MemoryDatabase(join(rootDir, ".repo-memory", "index.db"));
    const fileIds = new Map<string, number>();

    db.transaction(() => {
      for (const file of files) {
        fileIds.set(
          file.path,
          db.upsertFile(
            file.path,
            file.language,
            file.hash,
            file.size,
            file.lineCount,
          ),
        );
      }
      for (const file of parsed) {
        const fileId = fileIds.get(file.path)!;
        db.clearFileSymbols(fileId);
        for (const symbol of file.symbols) db.insertSymbol(fileId, symbol);
      }
    });

    const stats = db.getStats();
    expect(stats.files).toBe(files.length);
    expect(stats.symbols).toBeGreaterThan(0);

    const hits = db.searchSymbols("helper", 10) as Array<{
      name: string;
      file_path: string;
    }>;
    expect(hits.map((h) => h.name)).toContain("helper");
    expect(hits[0].file_path).toBe("src/shared.ts");

    const graph = buildDependencyGraph(
      parsed,
      files.map((f) => f.path),
      rootDir,
    );
    const memory = generateMemoryFile({
      db,
      config,
      conventions: detectConventions(files, rootDir),
      depGraph: graph,
      files,
      rootDir,
    });

    expect(memory).toContain("Repository Memory");
    expect(memory).toContain("src/shared.ts");
    expect(memory).toContain("helper");

    db.close();
  });
});
