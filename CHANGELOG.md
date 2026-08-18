# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Resolve ESM TypeScript imports: a specifier written `./foo.js` for a source file that is actually `foo.ts` now maps to that file. Previously every internal edge in an ESM TypeScript project was dropped, leaving the dependency graph, fan-in counts, and the "Critical Paths" section of `MEMORY.md` empty
- `repo-memory --version` reported `1.0.0` regardless of the installed version — it now reads `package.json`, which is also what gets recorded in the index metadata
- Import resolution now uses POSIX path joining. On Windows the platform-native join produced `src\shared.js` against an index that stores forward-slash paths, so no internal dependency ever resolved there and the graph was silently empty
- `npm run lint` failed on `ignore.default()` in the scanner; the call is now type-correct

### Added

- Test suite (`test/`, Vitest): config loading, the TypeScript/Python/Go parsers, and an end-to-end scan → parse → resolve → store → generate pass over a fixture repository
- Open-source project files: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.editorconfig`, `.gitattributes`
- GitHub configuration: CI workflow (lint, test, build, self-index smoke test on Node 18/20/22 across Linux, macOS, and Windows), release workflow (tag/version check, npm publish with provenance, GitHub release from the changelog), issue and pull request templates, `CODEOWNERS`, Dependabot
- `docs/ARCHITECTURE.md` — the pipeline stage by stage, plus the SQLite schema
- `docs/AGENTS.md` — wiring `MEMORY.md` into Claude Code, Cursor, Copilot, and other agents

### Changed

- Published package now ships `dist/` only, via an explicit `files` allowlist, and declares `publishConfig` for scoped public publishing with provenance
- README: CLI reference, full configuration table, agent integration, limitations, and links to the new documents

## [1.0.3] - 2026-03-03

### Fixed

- Correct GitHub URL to `aakashpawar1999/repo-memory` missing in some documentation and outputs

## [1.0.2] - 2026-03-03

### Removed

- Removed unused `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-python`, and `tree-sitter-typescript` dependencies
- Fixes peer dependency conflict warnings during `npm install -g`

### Changed

- Lighter install footprint (~80 fewer packages)

## [1.0.1] - 2026-03-03

### Changed

- Scoped package name to `@aakashpawar/repo-memory` for npm publishing
- Updated README with proper install commands, npm badges, and contributing guide
- Added CHANGELOG for version tracking

## [1.0.0] - 2026-03-02

### Added

- Initial release
- AST-aware code analysis with multi-language regex parser
- Support for TypeScript, JavaScript, Python, Go, Rust, Java, and Kotlin
- Incremental updates with file hashing (xxhash)
- `MEMORY.md` generation with token-aware output
- SQLite index with FTS5 full-text search
- CLI commands: `init`, `update`, `query`, `show`, `doctor`
- Dependency resolution with fan-in/fan-out analysis
- Convention detection (naming, testing, build system)
- `.gitignore`-aware file scanning
- Configurable via `.repo-memory.json`
