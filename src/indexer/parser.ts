import type { ScannedFile } from "./scanner.js";
import { logger } from "../utils/logger.js";

export interface ParsedSymbol {
  /** Symbol name */
  name: string;
  /** Fully qualified name (e.g., ClassName.methodName) */
  qualifiedName: string;
  /** Kind of symbol */
  kind:
    | "function"
    | "class"
    | "method"
    | "interface"
    | "type"
    | "constant"
    | "enum"
    | "variable"
    | "decorator"
    | "property";
  /** Full signature line */
  signature: string;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** Docstring or JSDoc if present */
  docstring: string | null;
  /** Whether it's exported */
  exported: boolean;
  /** Parent symbol name (for methods inside classes) */
  parent: string | null;
}

export interface ParsedImport {
  /** The import specifier as written */
  specifier: string;
  /** Named imports */
  names: string[];
  /** Whether it's a default import */
  isDefault: boolean;
  /** Whether it's a type-only import */
  isTypeOnly: boolean;
}

export interface ParsedFile {
  /** File path */
  path: string;
  /** Detected language */
  language: string;
  /** Extracted symbols */
  symbols: ParsedSymbol[];
  /** Import statements */
  imports: ParsedImport[];
  /** Export names */
  exports: string[];
}

/**
 * Parse a scanned file and extract symbols and imports.
 * Uses regex-based extraction (reliable across all platforms, no native dependencies issues).
 */
export function parseFile(file: ScannedFile): ParsedFile {
  const { content, language, path } = file;

  switch (language) {
    case "typescript":
    case "javascript":
      return parseTypeScript(content, path, language);
    case "python":
      return parsePython(content, path, language);
    case "go":
      return parseGo(content, path, language);
    case "rust":
      return parseRust(content, path, language);
    case "java":
    case "kotlin":
      return parseJavaLike(content, path, language);
    default:
      return parseGeneric(content, path, language);
  }
}

// ─── TypeScript / JavaScript Parser ──────────────────────────────────

function parseTypeScript(
  content: string,
  path: string,
  language: string,
): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: string[] = [];

  let currentClass: string | null = null;
  let braceDepth = 0;
  let classStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Skip comments
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    )
      continue;

    // ── Imports ──
    const importMatch = trimmed.match(
      /^import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/,
    );
    if (importMatch) {
      const names = importMatch[1]
        ? importMatch[1]
            .split(",")
            .map((n) => n.trim().split(/\s+as\s+/)[0])
            .filter(Boolean)
        : importMatch[2]
          ? [importMatch[2]]
          : importMatch[3]
            ? [importMatch[3]]
            : [];
      imports.push({
        specifier: importMatch[4],
        names,
        isDefault: !!importMatch[3],
        isTypeOnly: trimmed.includes("import type"),
      });
      continue;
    }

    // Multi-line import (just capture the 'from' specifier)
    if (trimmed.startsWith("import") && !trimmed.includes("from")) {
      // Look ahead for the 'from' line
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const fromMatch = lines[j].match(/from\s+['"]([^'"]+)['"]/);
        if (fromMatch) {
          imports.push({
            specifier: fromMatch[1],
            names: [],
            isDefault: false,
            isTypeOnly: trimmed.includes("import type"),
          });
          break;
        }
      }
    }

    // ── Track brace depth for class scope ──
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") {
        braceDepth--;
        if (currentClass && braceDepth <= classStartDepth) {
          currentClass = null;
        }
      }
    }

    const isExported = trimmed.startsWith("export");
    const stripped = trimmed.replace(/^export\s+(default\s+)?/, "");

    // ── Classes ──
    const classMatch = stripped.match(
      /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{?/,
    );
    if (classMatch) {
      const name = classMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "class",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: null,
      });
      if (isExported) exports.push(name);
      currentClass = name;
      classStartDepth = braceDepth - 1;
      continue;
    }

    // ── Interfaces ──
    const interfaceMatch = stripped.match(
      /^interface\s+(\w+)(?:<[^>]*>)?\s*(?:extends\s+[\w,\s]+)?\s*\{?/,
    );
    if (interfaceMatch) {
      const name = interfaceMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "interface",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: null,
      });
      if (isExported) exports.push(name);
      continue;
    }

    // ── Type Aliases ──
    const typeMatch = stripped.match(/^type\s+(\w+)(?:<[^>]*>)?\s*=/);
    if (typeMatch) {
      const name = typeMatch[1];
      symbols.push({
        name,
        qualifiedName: name,
        kind: "type",
        signature: trimmed.length > 80 ? trimmed.slice(0, 80) + "..." : trimmed,
        startLine: lineNum,
        endLine: lineNum,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: null,
      });
      if (isExported) exports.push(name);
      continue;
    }

    // ── Enums ──
    const enumMatch = stripped.match(/^(?:const\s+)?enum\s+(\w+)\s*\{?/);
    if (enumMatch) {
      const name = enumMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "enum",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: null,
      });
      if (isExported) exports.push(name);
      continue;
    }

    // ── Functions (named function declarations) ──
    const funcMatch = stripped.match(
      /^(?:async\s+)?function\s*\*?\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{?/,
    );
    if (funcMatch) {
      const name = funcMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: currentClass ? `${currentClass}.${name}` : name,
        kind: currentClass ? "method" : "function",
        signature: buildSignature(stripped),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: currentClass,
      });
      if (isExported) exports.push(name);
      continue;
    }

    // ── Arrow functions / const functions ──
    const arrowMatch = stripped.match(
      /^(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
    );
    if (arrowMatch) {
      const name = arrowMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: currentClass ? `${currentClass}.${name}` : name,
        kind: currentClass ? "method" : "function",
        signature: buildSignature(stripped),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: isExported,
        parent: currentClass,
      });
      if (isExported) exports.push(name);
      continue;
    }

    // ── Class methods ──
    if (currentClass) {
      const methodMatch = stripped.match(
        /^(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{?/,
      );
      if (
        methodMatch &&
        !["if", "for", "while", "switch", "catch", "constructor"].includes(
          methodMatch[1],
        )
      ) {
        const name = methodMatch[1];
        const endLine = findBlockEnd(lines, i);
        symbols.push({
          name,
          qualifiedName: `${currentClass}.${name}`,
          kind: "method",
          signature: buildSignature(stripped),
          startLine: lineNum,
          endLine,
          docstring: extractJSDoc(lines, i),
          exported: false,
          parent: currentClass,
        });
        continue;
      }

      // Constructor
      if (
        stripped.startsWith("constructor(") ||
        stripped.startsWith("constructor (")
      ) {
        const endLine = findBlockEnd(lines, i);
        symbols.push({
          name: "constructor",
          qualifiedName: `${currentClass}.constructor`,
          kind: "method",
          signature: buildSignature(stripped),
          startLine: lineNum,
          endLine,
          docstring: extractJSDoc(lines, i),
          exported: false,
          parent: currentClass,
        });
        continue;
      }
    }

    // ── Constants ──
    const constMatch = stripped.match(
      /^(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=\s*(?!.*=>)/,
    );
    if (constMatch && !currentClass) {
      const name = constMatch[1];
      // Only capture "important" constants (UPPER_CASE or typed)
      if (name === name.toUpperCase() || constMatch[2]?.trim()) {
        symbols.push({
          name,
          qualifiedName: name,
          kind: "constant",
          signature:
            trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed,
          startLine: lineNum,
          endLine: lineNum,
          docstring: extractJSDoc(lines, i),
          exported: isExported,
          parent: null,
        });
        if (isExported) exports.push(name);
      }
      continue;
    }

    // ── Re-exports ──
    if (trimmed.startsWith("export {") || trimmed.startsWith("export *")) {
      const reexportMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
      if (reexportMatch) {
        imports.push({
          specifier: reexportMatch[1],
          names: [],
          isDefault: false,
          isTypeOnly: false,
        });
      }
    }
  }

  return { path, language, symbols, imports, exports };
}

// ─── Python Parser ───────────────────────────────────────────────────

function parsePython(
  content: string,
  path: string,
  language: string,
): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: string[] = [];

  let currentClass: string | null = null;
  let classIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;
    const indent = line.length - line.trimStart().length;

    // Reset class context when indent returns to class level
    if (
      currentClass &&
      indent <= classIndent &&
      trimmed &&
      !trimmed.startsWith("#")
    ) {
      if (
        !trimmed.startsWith("def ") &&
        !trimmed.startsWith("class ") &&
        !trimmed.startsWith("@")
      ) {
        currentClass = null;
      }
    }

    // ── Imports ──
    const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
    if (importMatch) {
      const module =
        importMatch[1] || importMatch[2].split(",")[0].trim().split(" as ")[0];
      const names = importMatch[2]
        .split(",")
        .map((n) => n.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
      imports.push({
        specifier: module,
        names,
        isDefault: !importMatch[1],
        isTypeOnly: false,
      });
      continue;
    }

    // ── Classes ──
    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?\s*:/);
    if (classMatch) {
      const name = classMatch[1];
      const endLine = findPythonBlockEnd(lines, i, indent);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "class",
        signature: trimmed,
        startLine: lineNum,
        endLine,
        docstring: extractPythonDocstring(lines, i + 1),
        exported: !name.startsWith("_"),
        parent: null,
      });
      if (!name.startsWith("_")) exports.push(name);
      currentClass = name;
      classIndent = indent;
      continue;
    }

    // ── Functions / Methods ──
    const funcMatch = trimmed.match(
      /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/,
    );
    if (funcMatch) {
      const name = funcMatch[1];
      const isMethod = currentClass !== null && indent > classIndent;
      const endLine = findPythonBlockEnd(lines, i, indent);

      symbols.push({
        name,
        qualifiedName: isMethod ? `${currentClass}.${name}` : name,
        kind: isMethod ? "method" : "function",
        signature: trimmed,
        startLine: lineNum,
        endLine,
        docstring: extractPythonDocstring(lines, i + 1),
        exported: !name.startsWith("_"),
        parent: isMethod ? currentClass : null,
      });
      if (!name.startsWith("_")) exports.push(name);
      continue;
    }

    // ── Module-level constants ──
    if (indent === 0) {
      const constMatch = trimmed.match(/^([A-Z][A-Z_0-9]+)\s*(?::\s*\w+\s*)?=/);
      if (constMatch) {
        const name = constMatch[1];
        symbols.push({
          name,
          qualifiedName: name,
          kind: "constant",
          signature:
            trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed,
          startLine: lineNum,
          endLine: lineNum,
          docstring: null,
          exported: true,
          parent: null,
        });
        exports.push(name);
      }
    }

    // ── Decorators tracking ──
    if (trimmed.startsWith("@") && indent === 0) {
      // Peek next at next actual code line (skip other decorators)
      // Decorators are associated with the next function/class
    }
  }

  return { path, language, symbols, imports, exports };
}

// ─── Go Parser ───────────────────────────────────────────────────────

function parseGo(content: string, path: string, language: string): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // ── Imports ──
    const importMatch = trimmed.match(/^import\s+"([^"]+)"/);
    if (importMatch) {
      imports.push({
        specifier: importMatch[1],
        names: [],
        isDefault: false,
        isTypeOnly: false,
      });
      continue;
    }
    if (trimmed === "import (") {
      for (let j = i + 1; j < lines.length; j++) {
        const impLine = lines[j].trim();
        if (impLine === ")") break;
        const pathMatch = impLine.match(/"([^"]+)"/);
        if (pathMatch) {
          imports.push({
            specifier: pathMatch[1],
            names: [],
            isDefault: false,
            isTypeOnly: false,
          });
        }
      }
      continue;
    }

    // ── Functions ──
    const funcMatch = trimmed.match(
      /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s+(\([^)]*\)|\w+))?\s*\{?/,
    );
    if (funcMatch) {
      const receiver = funcMatch[2];
      const name = funcMatch[3];
      const endLine = findBlockEnd(lines, i);
      const isExported = name[0] === name[0].toUpperCase();
      symbols.push({
        name,
        qualifiedName: receiver ? `${receiver}.${name}` : name,
        kind: receiver ? "method" : "function",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractGoDoc(lines, i),
        exported: isExported,
        parent: receiver || null,
      });
    }

    // ── Structs ──
    const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{?/);
    if (structMatch) {
      const name = structMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "class",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractGoDoc(lines, i),
        exported: name[0] === name[0].toUpperCase(),
        parent: null,
      });
    }

    // ── Interfaces ──
    const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface\s*\{?/);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "interface",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractGoDoc(lines, i),
        exported: name[0] === name[0].toUpperCase(),
        parent: null,
      });
    }
  }

  return {
    path,
    language,
    symbols,
    imports,
    exports: symbols.filter((s) => s.exported).map((s) => s.name),
  };
}

// ─── Rust Parser ─────────────────────────────────────────────────────

function parseRust(
  content: string,
  path: string,
  language: string,
): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNum = i + 1;

    // ── Use statements ──
    const useMatch = trimmed.match(/^(?:pub\s+)?use\s+(.+);/);
    if (useMatch) {
      imports.push({
        specifier: useMatch[1],
        names: [],
        isDefault: false,
        isTypeOnly: false,
      });
      continue;
    }

    // ── Functions ──
    const funcMatch = trimmed.match(
      /^(pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*(?:where\s|{)?/,
    );
    if (funcMatch) {
      const name = funcMatch[2];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "function",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractRustDoc(lines, i),
        exported: !!funcMatch[1],
        parent: null,
      });
    }

    // ── Structs ──
    const structMatch = trimmed.match(
      /^(pub\s+)?struct\s+(\w+)(?:<[^>]*>)?\s*[({]?/,
    );
    if (structMatch) {
      const name = structMatch[2];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "class",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractRustDoc(lines, i),
        exported: !!structMatch[1],
        parent: null,
      });
    }

    // ── Enums ──
    const enumMatch = trimmed.match(/^(pub\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{?/);
    if (enumMatch) {
      const name = enumMatch[2];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "enum",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractRustDoc(lines, i),
        exported: !!enumMatch[1],
        parent: null,
      });
    }

    // ── Traits ──
    const traitMatch = trimmed.match(
      /^(pub\s+)?trait\s+(\w+)(?:<[^>]*>)?\s*(?::\s*\S+\s*)?\{?/,
    );
    if (traitMatch) {
      const name = traitMatch[2];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "interface",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractRustDoc(lines, i),
        exported: !!traitMatch[1],
        parent: null,
      });
    }
  }

  return {
    path,
    language,
    symbols,
    imports,
    exports: symbols.filter((s) => s.exported).map((s) => s.name),
  };
}

// ─── Java/Kotlin Parser ─────────────────────────────────────────────

function parseJavaLike(
  content: string,
  path: string,
  language: string,
): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];

  let currentClass: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNum = i + 1;

    // ── Imports ──
    const importMatch = trimmed.match(/^import\s+(?:static\s+)?([^;]+);/);
    if (importMatch) {
      imports.push({
        specifier: importMatch[1],
        names: [],
        isDefault: false,
        isTypeOnly: false,
      });
      continue;
    }

    // ── Classes ──
    const classMatch = trimmed.match(
      /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?(?:data\s+)?class\s+(\w+)/,
    );
    if (classMatch) {
      const name = classMatch[1];
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "class",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: extractJSDoc(lines, i),
        exported: trimmed.includes("public"),
        parent: null,
      });
      currentClass = name;
    }

    // ── Methods ──
    const methodMatch = trimmed.match(
      /^(?:(?:public|private|protected|static|final|abstract|synchronized|override)\s+)*(?:(?:fun|void|int|long|String|boolean|double|float|char|byte|short)\s+|(\w+(?:<[^>]+>)?)\s+)(\w+)\s*\(/,
    );
    if (methodMatch) {
      const name = methodMatch[2] || methodMatch[1];
      if (
        name &&
        !["if", "for", "while", "switch", "catch", "class"].includes(name)
      ) {
        const endLine = findBlockEnd(lines, i);
        symbols.push({
          name,
          qualifiedName: currentClass ? `${currentClass}.${name}` : name,
          kind: currentClass ? "method" : "function",
          signature: trimmed.replace(/\{.*$/, "").trim(),
          startLine: lineNum,
          endLine,
          docstring: extractJSDoc(lines, i),
          exported: trimmed.includes("public"),
          parent: currentClass,
        });
      }
    }
  }

  return {
    path,
    language,
    symbols,
    imports,
    exports: symbols.filter((s) => s.exported).map((s) => s.name),
  };
}

// ─── Generic Parser (fallback) ────────────────────────────────────────

function parseGeneric(
  content: string,
  path: string,
  language: string,
): ParsedFile {
  const lines = content.split("\n");
  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNum = i + 1;

    // Generic function detection
    const funcMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?(?:function|func|def|fn|sub|proc)\s+(\w+)/,
    );
    if (funcMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: funcMatch[1],
        qualifiedName: funcMatch[1],
        kind: "function",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: null,
        exported: trimmed.startsWith("export") || trimmed.startsWith("pub"),
        parent: null,
      });
    }

    // Generic class detection
    const classMatch = trimmed.match(
      /^(?:export\s+)?(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/,
    );
    if (classMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: classMatch[1],
        qualifiedName: classMatch[1],
        kind: "class",
        signature: trimmed.replace(/\{.*$/, "").trim(),
        startLine: lineNum,
        endLine,
        docstring: null,
        exported: trimmed.startsWith("export") || trimmed.startsWith("pub"),
        parent: null,
      });
    }
  }

  return {
    path,
    language,
    symbols,
    imports,
    exports: symbols.filter((s) => s.exported).map((s) => s.name),
  };
}

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Find the end of a brace-delimited block starting from the given line.
 */
function findBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let foundOpen = false;

  for (let i = startIndex; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      }
      if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) return i + 1;
      }
    }
  }

  // If no braces found, estimate based on next blank line or similar indent
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") return i;
  }

  return startIndex + 1;
}

/**
 * Find the end of a Python indentation-based block.
 */
function findPythonBlockEnd(
  lines: string[],
  startIndex: number,
  startIndent: number,
): number {
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // Skip blank lines
    const indent = line.length - line.trimStart().length;
    if (indent <= startIndent) return i;
  }
  return lines.length;
}

/**
 * Extract JSDoc comment above a line.
 */
function extractJSDoc(lines: string[], lineIndex: number): string | null {
  const docs: string[] = [];
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("/**") ||
      trimmed === "*/"
    ) {
      docs.unshift(
        trimmed
          .replace(/^\/?\*+\s?/, "")
          .replace(/\*\/$/, "")
          .trim(),
      );
    } else if (trimmed.startsWith("//")) {
      docs.unshift(trimmed.replace(/^\/\/\s?/, ""));
    } else {
      break;
    }
  }
  const result = docs.filter(Boolean).join(" ").trim();
  return result || null;
}

/**
 * Extract Python docstring after a def/class line.
 */
function extractPythonDocstring(
  lines: string[],
  startIndex: number,
): string | null {
  if (startIndex >= lines.length) return null;
  const nextLine = lines[startIndex].trim();
  if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
    const quote = nextLine.slice(0, 3);
    if (nextLine.endsWith(quote) && nextLine.length > 6) {
      return nextLine.slice(3, -3).trim();
    }
    const docLines: string[] = [nextLine.slice(3)];
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.endsWith(quote)) {
        docLines.push(line.slice(0, -3));
        break;
      }
      docLines.push(line);
    }
    return docLines.join(" ").trim();
  }
  return null;
}

/**
 * Extract Go doc comment above a line (// comments).
 */
function extractGoDoc(lines: string[], lineIndex: number): string | null {
  const docs: string[] = [];
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//")) {
      docs.unshift(trimmed.replace(/^\/\/\s?/, ""));
    } else {
      break;
    }
  }
  const result = docs.join(" ").trim();
  return result || null;
}

/**
 * Extract Rust doc comment above a line (/// comments).
 */
function extractRustDoc(lines: string[], lineIndex: number): string | null {
  const docs: string[] = [];
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
      docs.unshift(trimmed.replace(/^\/\/[\/!]\s?/, ""));
    } else {
      break;
    }
  }
  const result = docs.join(" ").trim();
  return result || null;
}

/**
 * Build a clean function signature.
 */
function buildSignature(line: string): string {
  return line
    .replace(/\{.*$/, "")
    .replace(/^export\s+(default\s+)?/, "")
    .trim();
}
