import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ParsedSymbol } from "../indexer/parser.js";

export interface StoredFile {
  id: number;
  path: string;
  language: string;
  hash: string;
  size: number;
  lastIndexed: string;
  lineCount: number;
}

interface DbFile {
  id: number;
  path: string;
  language: string;
  hash: string;
  size: number;
  last_indexed: string;
  line_count: number;
}

interface DbSymbol {
  id: number;
  file_id: number;
  name: string;
  qualified_name: string;
  kind: string;
  signature: string;
  start_line: number;
  end_line: number;
  docstring: string | null;
  exported: number;
  parent: string | null;
  file_path: string;
}

/**
 * SQLite-based storage for repo-memory index.
 */
export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        language TEXT,
        hash TEXT NOT NULL,
        size INTEGER,
        last_indexed DATETIME DEFAULT CURRENT_TIMESTAMP,
        line_count INTEGER
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        qualified_name TEXT,
        kind TEXT NOT NULL,
        signature TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        docstring TEXT,
        exported INTEGER DEFAULT 0,
        parent TEXT
      );

      CREATE TABLE IF NOT EXISTS dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        target_file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        import_specifier TEXT,
        is_external INTEGER DEFAULT 0,
        UNIQUE(source_file_id, target_file_id, import_specifier)
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
      CREATE INDEX IF NOT EXISTS idx_deps_source ON dependencies(source_file_id);
      CREATE INDEX IF NOT EXISTS idx_deps_target ON dependencies(target_file_id);
    `);

    // FTS for symbol search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
          name, qualified_name, signature, docstring,
          content=symbols, content_rowid=id
        );
      `);
    } catch {
      // FTS table might already exist with different schema
    }
  }

  /**
   * Insert or update a file record.
   */
  upsertFile(
    path: string,
    language: string,
    hash: string,
    size: number,
    lineCount: number,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, language, hash, size, last_indexed, line_count)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(path) DO UPDATE SET
        language = excluded.language,
        hash = excluded.hash,
        size = excluded.size,
        last_indexed = excluded.last_indexed,
        line_count = excluded.line_count
    `);
    const result = stmt.run(path, language, hash, size, lineCount);

    // Get the file ID
    const row = this.db
      .prepare("SELECT id FROM files WHERE path = ?")
      .get(path) as { id: number };
    return row.id;
  }

  /**
   * Insert a symbol for a file.
   */
  insertSymbol(fileId: number, symbol: ParsedSymbol) {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_id, name, qualified_name, kind, signature, start_line, end_line, docstring, exported, parent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      fileId,
      symbol.name,
      symbol.qualifiedName,
      symbol.kind,
      symbol.signature,
      symbol.startLine,
      symbol.endLine,
      symbol.docstring,
      symbol.exported ? 1 : 0,
      symbol.parent,
    );

    // Update FTS index
    try {
      this.db
        .prepare(
          `
        INSERT INTO symbols_fts (rowid, name, qualified_name, signature, docstring)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          result.lastInsertRowid,
          symbol.name,
          symbol.qualifiedName,
          symbol.signature,
          symbol.docstring,
        );
    } catch {
      // FTS insert may fail silently
    }
  }

  /**
   * Clear all symbols for a given file (before re-indexing).
   */
  clearFileSymbols(fileId: number) {
    this.db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);
  }

  /**
   * Clear all dependencies for a source file.
   */
  clearFileDependencies(fileId: number) {
    this.db
      .prepare("DELETE FROM dependencies WHERE source_file_id = ?")
      .run(fileId);
  }

  /**
   * Insert a dependency edge.
   */
  insertDependency(
    sourceFileId: number,
    targetFileId: number | null,
    specifier: string,
    isExternal: boolean,
  ) {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO dependencies (source_file_id, target_file_id, import_specifier, is_external)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(sourceFileId, targetFileId, specifier, isExternal ? 1 : 0);
  }

  /**
   * Get a file by path.
   */
  getFile(path: string): StoredFile | null {
    return (
      (this.db
        .prepare("SELECT * FROM files WHERE path = ?")
        .get(path) as StoredFile) || null
    );
  }

  /**
   * Get file hash for change detection.
   */
  getFileHash(path: string): string | null {
    const row = this.db
      .prepare("SELECT hash FROM files WHERE path = ?")
      .get(path) as { hash: string } | undefined;
    return row?.hash || null;
  }

  /**
   * Get all file paths and hashes.
   */
  getAllFileHashes(): Map<string, string> {
    const rows = this.db
      .prepare("SELECT path, hash FROM files")
      .all() as Array<{ path: string; hash: string }>;
    return new Map(rows.map((r) => [r.path, r.hash]));
  }

  /**
   * Remove files that no longer exist.
   */
  removeDeletedFiles(existingPaths: Set<string>) {
    const allPaths = this.db.prepare("SELECT path FROM files").all() as Array<{
      path: string;
    }>;
    for (const { path } of allPaths) {
      if (!existingPaths.has(path)) {
        this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
      }
    }
  }

  /**
   * Get file ID by path.
   */
  getFileId(path: string): number | null {
    const row = this.db
      .prepare("SELECT id FROM files WHERE path = ?")
      .get(path) as { id: number } | undefined;
    return row?.id || null;
  }

  /**
   * Full-text search across symbols.
   */
  searchSymbols(query: string, limit: number = 20) {
    try {
      const rows = this.db
        .prepare(
          `
        SELECT s.*, f.path as file_path
        FROM symbols_fts fts
        JOIN symbols s ON s.id = fts.rowid
        JOIN files f ON f.id = s.file_id
        WHERE symbols_fts MATCH ?
        LIMIT ?
      `,
        )
        .all(query, limit);
      return rows;
    } catch {
      // Fallback to LIKE search if FTS fails
      return this.db
        .prepare(
          `
        SELECT s.*, f.path as file_path
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.name LIKE ? OR s.qualified_name LIKE ? OR s.signature LIKE ?
        LIMIT ?
      `,
        )
        .all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
    }
  }

  /**
   * Get all symbols for a file.
   */
  getFileSymbols(fileId: number) {
    return this.db
      .prepare("SELECT * FROM symbols WHERE file_id = ? ORDER BY start_line")
      .all(fileId);
  }

  /**
   * Get all files.
   */
  getAllFiles(): StoredFile[] {
    const rows = this.db
      .prepare("SELECT * FROM files ORDER BY path")
      .all() as DbFile[];
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      language: r.language,
      hash: r.hash,
      size: r.size,
      lastIndexed: r.last_indexed,
      lineCount: r.line_count,
    }));
  }

  /**
   * Get all symbols.
   */
  getAllSymbols() {
    const rows = this.db
      .prepare(
        `
      SELECT s.*, f.path as file_path
      FROM symbols s
      JOIN files f ON f.id = s.file_id
      ORDER BY f.path, s.start_line
    `,
      )
      .all() as DbSymbol[];

    return rows.map((r) => ({
      id: r.id,
      file_id: r.file_id,
      name: r.name,
      qualifiedName: r.qualified_name,
      kind: r.kind as ParsedSymbol["kind"],
      signature: r.signature,
      startLine: r.start_line,
      endLine: r.end_line,
      docstring: r.docstring,
      exported: !!r.exported,
      parent: r.parent,
      file_path: r.file_path,
    }));
  }

  /**
   * Get dependency fan-in for each file.
   */
  getFanInCounts(): Map<string, number> {
    const rows = this.db
      .prepare(
        `
      SELECT f.path, COUNT(d.source_file_id) as fan_in
      FROM files f
      LEFT JOIN dependencies d ON d.target_file_id = f.id AND d.is_external = 0
      GROUP BY f.id
      HAVING fan_in > 0
      ORDER BY fan_in DESC
    `,
      )
      .all() as Array<{ path: string; fan_in: number }>;
    return new Map(rows.map((r) => [r.path, r.fan_in]));
  }

  /**
   * Get external packages and their usage count.
   */
  getExternalPackages(): Map<string, number> {
    const rows = this.db
      .prepare(
        `
      SELECT import_specifier, COUNT(*) as count
      FROM dependencies
      WHERE is_external = 1
      GROUP BY import_specifier
      ORDER BY count DESC
    `,
      )
      .all() as Array<{ import_specifier: string; count: number }>;
    return new Map(rows.map((r) => [r.import_specifier, r.count]));
  }

  /**
   * Set metadata.
   */
  setMetadata(key: string, value: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  /**
   * Get metadata.
   */
  getMetadata(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  /**
   * Get total stats.
   */
  getStats() {
    const files = (
      this.db.prepare("SELECT COUNT(*) as count FROM files").get() as {
        count: number;
      }
    ).count;
    const symbols = (
      this.db.prepare("SELECT COUNT(*) as count FROM symbols").get() as {
        count: number;
      }
    ).count;
    const deps = (
      this.db.prepare("SELECT COUNT(*) as count FROM dependencies").get() as {
        count: number;
      }
    ).count;
    return { files, symbols, deps };
  }

  /**
   * Run operations in a transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close the database.
   */
  close() {
    this.db.close();
  }
}
