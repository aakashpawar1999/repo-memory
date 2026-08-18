# Architecture

repo-memory turns a directory of source files into two artefacts: a Markdown
brief an AI agent reads (`MEMORY.md`) and a SQLite index it can query
(`.repo-memory/index.db`). This document describes how, and why the parts are
shaped the way they are.

## Design constraints

Three constraints explain most of the design:

1. **No LLM, no network.** Indexing is deterministic and offline. There is no
   API key and no embedding step. The same repository always produces the same
   `MEMORY.md`, which is what makes the file safe to commit and diff.
2. **No native parser toolchain.** Parsing is regex-based per language rather
   than tree-sitter, so `npm install -g` never needs a compiler or a grammar
   build. The cost is accuracy at the edges; the benefit is that installation
   never fails. `better-sqlite3` is the one native dependency and it ships
   prebuilt binaries.
3. **Output has a token budget.** `MEMORY.md` exists to be pasted into a context
   window, so the generator ranks and truncates rather than dumping everything.

## The pipeline

`repo-memory init` runs six stages in order. `update` runs the same stages over
the changed subset.

```
              ┌──────────────────────────────────────────────┐
              │ src/indexer/scanner.ts                       │
   Scan       │ fast-glob walk, .gitignore + config ignore,  │
              │ extension -> language, sha hash per file     │
              └───────────────────┬──────────────────────────┘
                                  │ ScannedFile[]
              ┌───────────────────▼──────────────────────────┐
              │ src/indexer/parser.ts                        │
   Parse      │ per-language regex extraction of symbols,    │
              │ imports, exports, docstrings                 │
              └───────────────────┬──────────────────────────┘
                                  │ ParsedFile[]
              ┌───────────────────▼──────────────────────────┐
              │ src/indexer/dependency-resolver.ts           │
   Resolve    │ specifier -> file path, fan-in / fan-out,    │
              │ external package tally, cycle detection      │
              └───────────────────┬──────────────────────────┘
                                  │ DependencyGraph
              ┌───────────────────▼──────────────────────────┐
              │ src/indexer/conventions.ts                   │
   Detect     │ project type, package manager, build/test    │
              │ commands, naming style, entry points         │
              └───────────────────┬──────────────────────────┘
                                  │ DetectedConventions
              ┌───────────────────▼──────────────────────────┐
              │ src/store/database.ts                        │
   Store      │ SQLite + FTS5, WAL mode, one transaction     │
              │ for the whole run                            │
              └───────────────────┬──────────────────────────┘
                                  │
              ┌───────────────────▼──────────────────────────┐
              │ src/generator/memory-generator.ts            │
   Generate   │ rank by fan-in, render sections, stop at     │
              │ the token budget                             │
              └──────────────────────────────────────────────┘
```

### Scan — `src/indexer/scanner.ts`

Walks the root with `fast-glob`, filtering through the `ignore` package with two
rule sets stacked: the default ignore list in `src/config/config.ts` plus the
project's `.gitignore`, then any `ignore` patterns from `.repo-memory.json`.
Language comes from the file extension (`EXTENSION_MAP`). Each file is read once
and carried through the pipeline as a `ScannedFile` with its content, line count,
and a content hash.

The hash is what makes `update` cheap: a file whose hash matches the stored one
is never re-parsed.

### Parse — `src/indexer/parser.ts`

One function per language family — TypeScript/JavaScript, Python, Go, Rust,
Java/Kotlin — and a generic regex fallback for everything else. Each returns a
`ParsedFile` of symbols (name, qualified name, kind, signature, line range,
docstring, exported flag, parent) plus imports and exports.

The parsers are line-oriented state machines: they track brace or indentation
depth to know which class a method belongs to, and they attach the preceding
comment block as a docstring. They are deliberately forgiving — a construct they
do not recognise is skipped, never fatal. A file that throws is dropped from the
run with a debug log rather than aborting the index.

### Resolve — `src/indexer/dependency-resolver.ts`

Turns each import specifier into either an internal file path or an external
package name. Internal resolution tries the exact path, then language-appropriate
extensions, then index files. TypeScript's ESM convention of importing `./foo.js`
for a file that is actually `foo.ts` is handled explicitly — without that, an ESM
TypeScript project resolves to zero internal edges.

Fan-in (how many files import this one) is the ranking signal the generator uses
to decide what matters. Cycles are detected pairwise and surfaced as a warning.

### Detect — `src/indexer/conventions.ts`

Reads `package.json`, lockfiles, and config files to infer project type, package
manager, build tool, test framework, and the actual build/test/dev commands, then
infers file and function naming style from the observed names. This is the part of
`MEMORY.md` that saves an agent from guessing how to run the project.

### Store — `src/store/database.ts`

SQLite via `better-sqlite3`, WAL journal, four tables:

| Table | Holds |
| --- | --- |
| `files` | path, language, hash, size, line count, last indexed |
| `symbols` | name, qualified name, kind, signature, line range, docstring, exported, parent |
| `dependencies` | source file, target file (null if external), specifier, external flag |
| `metadata` | index version, last indexed timestamp, indexed commit, primary language |

`symbols_fts` is an FTS5 virtual table over `name`, `qualified_name`,
`signature`, and `docstring`; it backs `query` and `show`. The whole of `init`
runs inside one transaction, so an interrupted run leaves no half-written index.

`metadata.commit` is what `doctor` compares against `git rev-parse HEAD` to tell
you the index is stale.

### Generate — `src/generator/memory-generator.ts`

Renders the sections you see in `MEMORY.md`: header stats, project overview,
architecture map (directory tree, capped at `maxTreeDepth`), key files and their
symbols (ranked by fan-in, capped at `maxKeySymbols`), dependency table,
conventions, and critical paths. Sections respect the `include*` config flags, and
the whole document is trimmed to `maxTokens` using the estimator in
`src/utils/tokens.ts` (characters ÷ 4 — cheap, and close enough for budgeting).

## Incremental update

`repo-memory update` re-scans, compares hashes against the `files` table, and
classifies every path as added, changed, deleted, or unchanged. Only added and
changed files are re-parsed; deleted files are removed with their symbols and
dependency edges cascading. `MEMORY.md` is regenerated in full afterwards, since
rendering is cheap compared with parsing.

## What is not here

- **No semantic search.** Retrieval is FTS5 keyword matching over symbol names,
  signatures, and docstrings. Embeddings would mean a model, which breaks the
  offline constraint.
- **No call graph.** Dependencies are file-level, resolved from imports. Which
  function calls which is not tracked.
- **No cross-repository index.** One index per repository root.
