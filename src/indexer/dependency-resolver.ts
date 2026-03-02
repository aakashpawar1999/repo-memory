import { dirname, join, resolve, extname, relative } from "node:path";
import type { ParsedFile, ParsedImport } from "./parser.js";
import type { ScannedFile } from "./scanner.js";

export interface DependencyEdge {
  /** Source file path (relative) */
  source: string;
  /** Target file path (relative), or null if external */
  target: string | null;
  /** Import specifier as written */
  specifier: string;
  /** Whether it's an external/node_modules dependency */
  isExternal: boolean;
}

export interface DependencyGraph {
  /** All dependency edges */
  edges: DependencyEdge[];
  /** Fan-in count per file (how many files depend on it) */
  fanIn: Map<string, number>;
  /** Fan-out count per file (how many files it depends on) */
  fanOut: Map<string, number>;
  /** Files with circular dependencies */
  circularDeps: Array<[string, string]>;
  /** External packages used */
  externalPackages: Map<string, number>;
}

/**
 * Resolve imports and build a dependency graph.
 */
export function buildDependencyGraph(
  parsedFiles: ParsedFile[],
  allFilePaths: string[],
  rootDir: string,
): DependencyGraph {
  const edges: DependencyEdge[] = [];
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const externalPackages = new Map<string, number>();

  // Build a set of known file paths for resolution
  const knownPaths = new Set(allFilePaths);

  // Initialize fan-in/fan-out for all files
  for (const filePath of allFilePaths) {
    fanIn.set(filePath, 0);
    fanOut.set(filePath, 0);
  }

  for (const file of parsedFiles) {
    for (const imp of file.imports) {
      const resolved = resolveImport(
        imp.specifier,
        file.path,
        knownPaths,
        file.language,
      );

      if (resolved) {
        edges.push({
          source: file.path,
          target: resolved,
          specifier: imp.specifier,
          isExternal: false,
        });
        fanIn.set(resolved, (fanIn.get(resolved) || 0) + 1);
        fanOut.set(file.path, (fanOut.get(file.path) || 0) + 1);
      } else if (isExternalImport(imp.specifier, file.language)) {
        const pkgName = getPackageName(imp.specifier);
        externalPackages.set(pkgName, (externalPackages.get(pkgName) || 0) + 1);
        edges.push({
          source: file.path,
          target: null,
          specifier: imp.specifier,
          isExternal: true,
        });
      }
    }
  }

  // Detect circular dependencies
  const circularDeps = detectCircularDeps(edges);

  return { edges, fanIn, fanOut, circularDeps, externalPackages };
}

/**
 * Resolve an import specifier to a file path.
 */
function resolveImport(
  specifier: string,
  fromFile: string,
  knownPaths: Set<string>,
  language: string,
): string | null {
  // Skip node_modules / external imports
  if (isExternalImport(specifier, language)) return null;

  const fromDir = dirname(fromFile);

  // For relative imports
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const basePath = specifier.startsWith("/")
      ? specifier.slice(1)
      : join(fromDir, specifier);

    // Try exact match first
    if (knownPaths.has(basePath)) return basePath;

    // Try with extensions
    const extensions =
      language === "python"
        ? [".py"]
        : language === "go"
          ? [".go"]
          : language === "rust"
            ? [".rs"]
            : [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      if (knownPaths.has(basePath + ext)) return basePath + ext;
    }

    // Try index files
    const indexNames =
      language === "python"
        ? ["__init__.py"]
        : ["index.ts", "index.tsx", "index.js", "index.jsx", "mod.rs"];

    for (const indexName of indexNames) {
      const indexPath = join(basePath, indexName);
      if (knownPaths.has(indexPath)) return indexPath;
    }
  }

  // For Python module-style imports (dots as separators)
  if (language === "python" && !specifier.startsWith(".")) {
    const modulePath = specifier.replace(/\./g, "/");
    if (knownPaths.has(modulePath + ".py")) return modulePath + ".py";
    if (knownPaths.has(join(modulePath, "__init__.py")))
      return join(modulePath, "__init__.py");
  }

  return null;
}

/**
 * Check if an import is external (npm package, stdlib, etc.)
 */
function isExternalImport(specifier: string, language: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;

  if (language === "typescript" || language === "javascript") {
    return !specifier.startsWith(".");
  }

  if (language === "python") {
    return !specifier.startsWith(".");
  }

  if (language === "go") {
    return specifier.includes(".");
  }

  return true;
}

/**
 * Extract package name from import specifier.
 */
function getPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

/**
 * Simple circular dependency detection using DFS.
 */
function detectCircularDeps(edges: DependencyEdge[]): Array<[string, string]> {
  const graph = new Map<string, Set<string>>();
  const circular: Array<[string, string]> = [];

  for (const edge of edges) {
    if (edge.target) {
      if (!graph.has(edge.source)) graph.set(edge.source, new Set());
      graph.get(edge.source)!.add(edge.target);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      // Found a cycle - record the edge that closes it
      const prevNode = path[path.length - 1];
      if (prevNode) circular.push([prevNode, node]);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const neighbors = graph.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path, node]);
      }
    }

    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node, []);
  }

  return circular;
}

/**
 * Get the top N files by fan-in (most depended upon).
 */
export function getTopDependedOn(
  graph: DependencyGraph,
  topN: number = 10,
): Array<{ path: string; fanIn: number }> {
  return Array.from(graph.fanIn.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([path, fanIn]) => ({ path, fanIn }));
}
