#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve, join, basename } from "node:path";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { loadConfig } from "./config/config.js";
import { scanRepository, getLanguageStats } from "./indexer/scanner.js";
import { parseFile } from "./indexer/parser.js";
import {
  buildDependencyGraph,
  getTopDependedOn,
} from "./indexer/dependency-resolver.js";
import { detectConventions } from "./indexer/conventions.js";
import { MemoryDatabase } from "./store/database.js";
import {
  generateMemoryFile,
  getMemoryTokenCount,
} from "./generator/memory-generator.js";
import { logger, setLogLevel, LogLevel } from "./utils/logger.js";
import { isGitRepo, getCurrentCommitHash } from "./utils/git.js";

const VERSION = "1.0.0";

const program = new Command();

program
  .name("repo-memory")
  .description("🧠 Create a persistent brain for any code repository")
  .version(VERSION);

// ─── INIT Command ────────────────────────────────────────────────────

program
  .command("init")
  .description("Index the repository and generate MEMORY.md")
  .option("-d, --dir <path>", "Repository directory", ".")
  .option("-v, --verbose", "Enable verbose logging")
  .option("--no-memory-file", "Skip generating MEMORY.md (only create index)")
  .option("--max-tokens <number>", "Maximum tokens for MEMORY.md", "32000")
  .action(async (options) => {
    if (options.verbose) setLogLevel(LogLevel.DEBUG);

    const rootDir = resolve(options.dir);
    const config = loadConfig(rootDir);
    if (options.maxTokens) config.maxTokens = parseInt(options.maxTokens, 10);

    console.log();
    console.log(
      chalk.bold.magenta("  🧠 repo-memory") + chalk.dim(` v${VERSION}`),
    );
    console.log(chalk.dim("  Creating repository brain...\n"));

    const startTime = Date.now();

    // Step 1: Scan
    const scanSpinner = ora({
      text: chalk.cyan("Scanning repository..."),
      color: "cyan",
    }).start();

    const files = await scanRepository(rootDir, config);
    const langStats = getLanguageStats(files);
    const primaryLang = langStats[0];

    scanSpinner.succeed(chalk.green(`Scanned ${files.length} files`));
    if (primaryLang) {
      logger.tree(
        `Primary language: ${capitalize(primaryLang.language)} (${primaryLang.percentage}%)`,
        false,
      );
    }
    logger.tree(`Languages detected: ${langStats.length}`, true);

    // Step 2: Parse
    const parseSpinner = ora({
      text: chalk.cyan("Parsing code structure..."),
      color: "cyan",
    }).start();

    const parsedFiles = files
      .filter(
        (f) =>
          f.language !== "unknown" &&
          f.language !== "json" &&
          f.language !== "yaml" &&
          f.language !== "markdown",
      )
      .map((f) => {
        try {
          return parseFile(f);
        } catch (err) {
          logger.debug(`Failed to parse ${f.path}: ${err}`);
          return null;
        }
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof parseFile>>[];

    const totalSymbols = parsedFiles.reduce(
      (sum, f) => sum + f.symbols.length,
      0,
    );
    parseSpinner.succeed(
      chalk.green(
        `Extracted ${totalSymbols} symbols from ${parsedFiles.length} files`,
      ),
    );

    // Step 3: Dependencies
    const depSpinner = ora({
      text: chalk.cyan("Resolving dependencies..."),
      color: "cyan",
    }).start();

    const filePaths = files.map((f) => f.path);
    const depGraph = buildDependencyGraph(parsedFiles, filePaths, rootDir);
    const internalEdges = depGraph.edges.filter((e) => !e.isExternal).length;
    const topDeps = getTopDependedOn(depGraph, 3);

    depSpinner.succeed(
      chalk.green(
        `Resolved ${internalEdges} internal + ${depGraph.edges.length - internalEdges} external dependencies`,
      ),
    );
    if (depGraph.circularDeps.length > 0) {
      logger.tree(
        `${chalk.yellow("⚠")} ${depGraph.circularDeps.length} circular dependencies detected`,
        false,
      );
    }
    if (topDeps.length > 0) {
      logger.tree(
        `Top fan-in: ${topDeps[0].path} (${topDeps[0].fanIn} dependents)`,
        true,
      );
    }

    // Step 4: Conventions
    const convSpinner = ora({
      text: chalk.cyan("Detecting conventions..."),
      color: "cyan",
    }).start();

    const conventions = detectConventions(files, rootDir);
    convSpinner.succeed(chalk.green("Conventions detected"));
    if (conventions.projectType) {
      logger.tree(`Project type: ${conventions.projectType}`, false);
    }
    if (conventions.testFramework) {
      logger.tree(`Testing: ${conventions.testFramework}`, true);
    }

    // Step 5: Store in SQLite
    const storeSpinner = ora({
      text: chalk.cyan("Building index..."),
      color: "cyan",
    }).start();

    const dbPath = join(rootDir, ".repo-memory", "index.db");
    const db = new MemoryDatabase(dbPath);

    db.transaction(() => {
      // Store files and symbols
      const fileIdMap = new Map<string, number>();

      for (const file of files) {
        const fileId = db.upsertFile(
          file.path,
          file.language,
          file.hash,
          file.size,
          file.lineCount,
        );
        fileIdMap.set(file.path, fileId);
      }

      for (const parsed of parsedFiles) {
        const fileId = fileIdMap.get(parsed.path);
        if (!fileId) continue;

        db.clearFileSymbols(fileId);
        for (const symbol of parsed.symbols) {
          db.insertSymbol(fileId, symbol);
        }
      }

      // Store dependencies
      for (const edge of depGraph.edges) {
        const sourceId = fileIdMap.get(edge.source);
        const targetId = edge.target ? fileIdMap.get(edge.target) : null;
        if (sourceId) {
          db.insertDependency(
            sourceId,
            targetId || null,
            edge.specifier,
            edge.isExternal,
          );
        }
      }

      // Store metadata
      db.setMetadata("version", VERSION);
      db.setMetadata("last_indexed", new Date().toISOString());
      db.setMetadata("commit", getCurrentCommitHash(rootDir) || "unknown");
      db.setMetadata("primary_language", primaryLang?.language || "unknown");
    });

    storeSpinner.succeed(chalk.green("Index built"));

    // Step 6: Generate MEMORY.md
    if (options.memoryFile !== false) {
      const genSpinner = ora({
        text: chalk.cyan("Generating MEMORY.md..."),
        color: "cyan",
      }).start();

      const memoryContent = generateMemoryFile({
        db,
        config,
        conventions,
        depGraph,
        files,
        rootDir,
      });

      const memoryPath = join(rootDir, "MEMORY.md");
      writeFileSync(memoryPath, memoryContent, "utf-8");

      const tokens = getMemoryTokenCount(memoryContent);
      genSpinner.succeed(
        chalk.green(`Generated MEMORY.md (${tokens.toLocaleString()} tokens)`),
      );
    }

    db.close();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log();
    console.log(chalk.bold.green("  ✅ Repository memory created!"));
    console.log(chalk.dim(`     Completed in ${elapsed}s`));
    console.log();
    console.log(
      chalk.dim("  📄 MEMORY.md") +
        chalk.dim(" — AI-readable repository knowledge"),
    );
    console.log(
      chalk.dim("  💾 .repo-memory/index.db") + chalk.dim(" — Queryable index"),
    );
    console.log();
    console.log(chalk.dim("  Next steps:"));
    console.log(
      chalk.dim("  • Update after changes: ") +
        chalk.cyan("repo-memory update"),
    );
    console.log(
      chalk.dim("  • Search symbols:       ") +
        chalk.cyan('repo-memory query "payment"'),
    );
    console.log(
      chalk.dim("  • Show symbol details:  ") +
        chalk.cyan("repo-memory show PaymentService"),
    );
    console.log();
  });

// ─── UPDATE Command ──────────────────────────────────────────────────

program
  .command("update")
  .description("Incrementally update the index (only re-indexes changed files)")
  .option("-d, --dir <path>", "Repository directory", ".")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (options) => {
    if (options.verbose) setLogLevel(LogLevel.DEBUG);

    const rootDir = resolve(options.dir);
    const config = loadConfig(rootDir);
    const dbPath = join(rootDir, ".repo-memory", "index.db");

    if (!existsSync(dbPath)) {
      console.log(
        chalk.red(
          "\n  ✖ No existing index found. Run `repo-memory init` first.\n",
        ),
      );
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold.magenta("  🧠 repo-memory") + chalk.dim(` update`));
    console.log();

    const startTime = Date.now();
    const db = new MemoryDatabase(dbPath);

    // Get existing file hashes
    const existingHashes = db.getAllFileHashes();

    // Scan current files
    const scanSpinner = ora({
      text: chalk.cyan("Scanning for changes..."),
      color: "cyan",
    }).start();

    const files = await scanRepository(rootDir, config);
    const currentPaths = new Set(files.map((f) => f.path));

    // Find changed, added, and deleted files
    const changed: typeof files = [];
    const added: typeof files = [];
    const deleted: string[] = [];

    for (const file of files) {
      const existingHash = existingHashes.get(file.path);
      if (!existingHash) {
        added.push(file);
      } else if (existingHash !== file.hash) {
        changed.push(file);
      }
    }

    for (const [path] of existingHashes) {
      if (!currentPaths.has(path)) {
        deleted.push(path);
      }
    }

    const totalChanges = changed.length + added.length + deleted.length;

    if (totalChanges === 0) {
      scanSpinner.succeed(chalk.green("No changes detected"));
      db.close();
      console.log(chalk.dim("\n  Index is up to date.\n"));
      return;
    }

    scanSpinner.succeed(chalk.green(`Found ${totalChanges} changes`));
    if (changed.length > 0)
      logger.tree(`${changed.length} files modified`, false);
    if (added.length > 0) logger.tree(`${added.length} files added`, false);
    if (deleted.length > 0)
      logger.tree(`${deleted.length} files deleted`, true);

    // Re-index changed and new files
    const reindexSpinner = ora({
      text: chalk.cyan(`Re-indexing ${changed.length + added.length} files...`),
      color: "cyan",
    }).start();

    const filesToReparse = [...changed, ...added].filter(
      (f) =>
        f.language !== "unknown" &&
        f.language !== "json" &&
        f.language !== "yaml" &&
        f.language !== "markdown",
    );

    const parsedFiles = filesToReparse
      .map((f) => {
        try {
          return parseFile(f);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof parseFile>>[];

    db.transaction(() => {
      // Remove deleted files
      db.removeDeletedFiles(currentPaths);

      // Update changed and new files
      for (const file of [...changed, ...added]) {
        const fileId = db.upsertFile(
          file.path,
          file.language,
          file.hash,
          file.size,
          file.lineCount,
        );
        db.clearFileSymbols(fileId);
        db.clearFileDependencies(fileId);

        const parsed = parsedFiles.find((p) => p.path === file.path);
        if (parsed) {
          for (const symbol of parsed.symbols) {
            db.insertSymbol(fileId, symbol);
          }
        }
      }

      // Rebuild dependencies for changed files
      const allFilePaths = files.map((f) => f.path);
      const depGraph = buildDependencyGraph(parsedFiles, allFilePaths, rootDir);

      for (const edge of depGraph.edges) {
        const sourceId = db.getFileId(edge.source);
        const targetId = edge.target ? db.getFileId(edge.target) : null;
        if (sourceId) {
          db.insertDependency(
            sourceId,
            targetId || null,
            edge.specifier,
            edge.isExternal,
          );
        }
      }

      db.setMetadata("last_indexed", new Date().toISOString());
      db.setMetadata("commit", getCurrentCommitHash(rootDir) || "unknown");
    });

    reindexSpinner.succeed(chalk.green("Index updated"));

    // Regenerate MEMORY.md
    const genSpinner = ora({
      text: chalk.cyan("Regenerating MEMORY.md..."),
      color: "cyan",
    }).start();

    const conventions = detectConventions(files, rootDir);
    const depGraph = buildDependencyGraph(
      parsedFiles,
      files.map((f) => f.path),
      rootDir,
    );

    const memoryContent = generateMemoryFile({
      db,
      config,
      conventions,
      depGraph,
      files,
      rootDir,
    });

    writeFileSync(join(rootDir, "MEMORY.md"), memoryContent, "utf-8");
    const tokens = getMemoryTokenCount(memoryContent);
    genSpinner.succeed(
      chalk.green(`MEMORY.md regenerated (${tokens.toLocaleString()} tokens)`),
    );

    db.close();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log();
    console.log(chalk.bold.green(`  ✅ Memory updated in ${elapsed}s`));
    console.log();
  });

// ─── QUERY Command ───────────────────────────────────────────────────

program
  .command("query <text>")
  .description("Search the repository memory for symbols and files")
  .option("-d, --dir <path>", "Repository directory", ".")
  .option("-n, --limit <number>", "Max results", "20")
  .option("--json", "Output as JSON")
  .action(async (text, options) => {
    const rootDir = resolve(options.dir);
    const dbPath = join(rootDir, ".repo-memory", "index.db");

    if (!existsSync(dbPath)) {
      console.log(
        chalk.red("\n  ✖ No index found. Run `repo-memory init` first.\n"),
      );
      process.exit(1);
    }

    const db = new MemoryDatabase(dbPath);
    const results = db.searchSymbols(
      text,
      parseInt(options.limit, 10),
    ) as Array<{
      name: string;
      qualified_name: string;
      kind: string;
      signature: string;
      start_line: number;
      end_line: number;
      docstring: string;
      file_path: string;
    }>;

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log();
      console.log(
        chalk.bold(
          `  🔍 Search results for "${text}" (${results.length} matches)`,
        ),
      );
      console.log();

      for (const result of results) {
        const icon = getSymbolEmoji(result.kind);
        console.log(
          `  ${icon} ${chalk.bold(result.qualified_name)} ${chalk.dim(`(${result.kind})`)}`,
        );
        console.log(
          `     ${chalk.dim(result.file_path)}:${chalk.yellow(String(result.start_line))}-${chalk.yellow(String(result.end_line))}`,
        );
        if (result.signature) {
          console.log(`     ${chalk.dim(result.signature.slice(0, 100))}`);
        }
        if (result.docstring) {
          console.log(
            `     ${chalk.italic.dim(result.docstring.slice(0, 80))}`,
          );
        }
        console.log();
      }
    }

    db.close();
  });

// ─── SHOW Command ────────────────────────────────────────────────────

program
  .command("show <symbol>")
  .description("Show detailed info about a specific symbol")
  .option("-d, --dir <path>", "Repository directory", ".")
  .action(async (symbol, options) => {
    const rootDir = resolve(options.dir);
    const dbPath = join(rootDir, ".repo-memory", "index.db");

    if (!existsSync(dbPath)) {
      console.log(
        chalk.red("\n  ✖ No index found. Run `repo-memory init` first.\n"),
      );
      process.exit(1);
    }

    const db = new MemoryDatabase(dbPath);
    const results = db.searchSymbols(symbol, 5) as Array<{
      name: string;
      qualified_name: string;
      kind: string;
      signature: string;
      start_line: number;
      end_line: number;
      docstring: string;
      file_path: string;
      exported: number;
    }>;

    if (results.length === 0) {
      console.log(chalk.yellow(`\n  No symbol found matching "${symbol}"\n`));
      db.close();
      return;
    }

    for (const result of results) {
      console.log();
      console.log(chalk.bold.white(`  ${result.qualified_name}`));
      console.log(chalk.dim("  ─".repeat(30)));
      console.log(`  ${chalk.dim("Kind:")}       ${result.kind}`);
      console.log(`  ${chalk.dim("File:")}       ${result.file_path}`);
      console.log(
        `  ${chalk.dim("Lines:")}      ${result.start_line}-${result.end_line}`,
      );
      console.log(
        `  ${chalk.dim("Exported:")}   ${result.exported ? "Yes" : "No"}`,
      );

      if (result.signature) {
        console.log(`  ${chalk.dim("Signature:")}  ${result.signature}`);
      }

      if (result.docstring) {
        console.log(`  ${chalk.dim("Docs:")}       ${result.docstring}`);
      }

      // Show source code snippet
      try {
        const filePath = join(rootDir, result.file_path);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");
          const start = Math.max(0, result.start_line - 1);
          const end = Math.min(lines.length, result.end_line);
          const snippet = lines.slice(start, Math.min(end, start + 15));

          console.log();
          console.log(chalk.dim("  Source:"));
          for (let i = 0; i < snippet.length; i++) {
            const lineNum = String(start + i + 1).padStart(4);
            console.log(chalk.dim(`  ${lineNum} │ `) + snippet[i]);
          }
          if (end - start > 15) {
            console.log(chalk.dim(`  ... ${end - start - 15} more lines`));
          }
        }
      } catch {
        // Can't read source
      }

      console.log();
    }

    db.close();
  });

// ─── DOCTOR Command ──────────────────────────────────────────────────

program
  .command("doctor")
  .description("Check health of the repository memory")
  .option("-d, --dir <path>", "Repository directory", ".")
  .action(async (options) => {
    const rootDir = resolve(options.dir);
    const dbPath = join(rootDir, ".repo-memory", "index.db");

    console.log();
    console.log(chalk.bold.magenta("  🧠 repo-memory") + chalk.dim(" doctor"));
    console.log();

    // Check index exists
    if (!existsSync(dbPath)) {
      console.log(chalk.red("  ✖ No index found"));
      console.log(chalk.dim("    Run `repo-memory init` to create one.\n"));
      return;
    }

    console.log(chalk.green("  ✔ Index found"));

    const db = new MemoryDatabase(dbPath);
    const stats = db.getStats();
    const lastIndexed = db.getMetadata("last_indexed");
    const indexedCommit = db.getMetadata("commit");
    const currentCommit = getCurrentCommitHash(rootDir);

    console.log(chalk.green(`  ✔ ${stats.files} files indexed`));
    console.log(chalk.green(`  ✔ ${stats.symbols} symbols tracked`));
    console.log(chalk.green(`  ✔ ${stats.deps} dependency edges`));

    if (lastIndexed) {
      console.log(chalk.dim(`  ℹ Last indexed: ${lastIndexed}`));
    }

    // Check if index is stale
    if (indexedCommit && currentCommit && indexedCommit !== currentCommit) {
      console.log(
        chalk.yellow(
          `  ⚠ Index may be stale (indexed at ${indexedCommit}, current: ${currentCommit})`,
        ),
      );
      console.log(chalk.dim("    Run `repo-memory update` to refresh.\n"));
    } else if (indexedCommit === currentCommit) {
      console.log(chalk.green("  ✔ Index is up to date"));
    }

    // Check MEMORY.md
    const memoryPath = join(rootDir, "MEMORY.md");
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, "utf-8");
      const tokens = Math.ceil(content.length / 4);
      console.log(
        chalk.green(`  ✔ MEMORY.md exists (${tokens.toLocaleString()} tokens)`),
      );
    } else {
      console.log(chalk.yellow("  ⚠ MEMORY.md not found"));
    }

    db.close();
    console.log();
  });

// ─── Helper ──────────────────────────────────────────────────────────

function getSymbolEmoji(kind: string): string {
  const icons: Record<string, string> = {
    function: "⚡",
    class: "🏛️",
    method: "🔧",
    interface: "📐",
    type: "📝",
    constant: "📌",
    enum: "📊",
  };
  return icons[kind] || "•";
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Run ─────────────────────────────────────────────────────────────

program.parse();
