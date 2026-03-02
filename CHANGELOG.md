# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
