# 🧠 repo-memory

[![npm version](https://img.shields.io/npm/v/@aakashpawar/repo-memory.svg)](https://www.npmjs.com/package/@aakashpawar/repo-memory)
[![CI](https://github.com/aakashpawar1999/repo-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashpawar1999/repo-memory/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@aakashpawar/repo-memory.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@aakashpawar/repo-memory.svg)](https://nodejs.org)

> Create a persistent brain for any code repository — instant context for AI agents.

**One command. Zero LLM dependency. Works offline.**

```bash
npx @aakashpawar/repo-memory init
```

repo-memory scans your codebase, parses every function/class/module, maps dependencies, detects conventions, and generates a structured `MEMORY.md` that any AI agent can instantly consume — like giving it the institutional knowledge of a super-senior developer.

## Contents

- [Why?](#why)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [What It Generates](#what-it-generates)
- [Using It With AI Agents](#using-it-with-ai-agents)
- [Supported Languages](#supported-languages)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Performance](#performance)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Why?

Every time an AI agent starts a new session, it:

- 🔄 Wastes tokens re-scanning the repo structure
- 🔍 Doesn't know where key logic lives (file + line numbers)
- 🧩 Loses context about patterns, conventions, and relationships
- 💸 Increases overhead by rebuilding context from scratch

**repo-memory** solves this with a single `MEMORY.md` file that persists between sessions.

Everything runs locally: no API key, no model call, nothing leaves your machine.

## Installation

```bash
# Install globally
npm install -g @aakashpawar/repo-memory

# Or run directly with npx (no install needed)
npx @aakashpawar/repo-memory init
```

Requires **Node 22.12 or newer**.

## Quick Start

```bash
# Initialize & index your project
cd your-project
repo-memory init

# Update after changes (fast — only re-indexes modified files)
repo-memory update

# Search for symbols
repo-memory query "payment processing"

# Get details about a specific symbol
repo-memory show PaymentService

# Health check
repo-memory doctor
```

Commit the generated `MEMORY.md`; keep the index out of version control:

```gitignore
.repo-memory/
```

## CLI Reference

| Command | What it does | Options |
| --- | --- | --- |
| `repo-memory init` | Full index + generate `MEMORY.md` | `-d, --dir <path>`, `-v, --verbose`, `--no-memory-file`, `--max-tokens <n>` |
| `repo-memory update` | Re-index only changed files, regenerate `MEMORY.md` | `-d, --dir <path>`, `-v, --verbose` |
| `repo-memory query <text>` | Full-text search over symbols | `-d, --dir <path>`, `-n, --limit <n>`, `--json` |
| `repo-memory show <symbol>` | Symbol details plus a source snippet | `-d, --dir <path>` |
| `repo-memory doctor` | Index health, staleness against the current commit | `-d, --dir <path>` |

## What It Generates

### `MEMORY.md` — Your Codebase Brain

```markdown
# 🧠 Repository Memory

> my-app | 247 files | 1,832 symbols | Primary: TypeScript

## 📋 Project Overview

- Type: Next.js application
- Package Manager: pnpm
- Build: `pnpm build` | Test: `pnpm test`

## 🏗️ Architecture Map

src/ (203 files)
├── app/ (15 files)
├── components/ (42 files)
│ ├── ui/
│ └── features/
├── lib/ (8 files)
├── server/ (31 files)
│ ├── routes/
│ ├── middleware/
│ └── services/
└── types/ (5 files)

## 🗂️ Key Files & Symbols

### `src/server/services/payment.service.ts` (L1-L187) — 12 dependents

- 🏛️ **PaymentService** (L12-L187) `exported`
  - `class PaymentService`
- 🔧 **PaymentService.processPayment** (L34-L89)
  - `processPayment(order: Order): Promise<PaymentResult>`
- 🔧 **PaymentService.refund** (L91-L132)
  - `refund(paymentId: string, reason: string): Promise<void>`

## 🔗 Dependency Graph

| File                 | Dependents | Impact      |
| -------------------- | ---------- | ----------- |
| `src/lib/api.ts`     | 28         | 🔴 Critical |
| `src/types/index.ts` | 45         | 🔴 Critical |

## 📐 Conventions & Patterns

- File Naming: kebab-case
- Function Naming: camelCase
- Testing: Vitest, Colocated (\*.test.ts files)

## 🚨 Critical Paths

1. **`src/lib/api.ts`** — 28 dependents (exports: `createApiClient`, `handleApiError`)
```

The `MEMORY.md` at the root of this repository is repo-memory's own output — it dogfoods itself.

### `.repo-memory/index.db` — Queryable SQLite Index

A fast, local SQLite database with full-text search for programmatic access:

```bash
# Search symbols
repo-memory query "authentication" --json

# Get structured results for AI agents
repo-memory query "error handling" --json --limit 10
```

Each JSON result carries `file_path`, `start_line`, and `end_line`, so an agent reads exactly the range it needs instead of the whole file.

## Using It With AI Agents

Point your agent's instruction file at `MEMORY.md` — for Claude Code that is `CLAUDE.md`, for Cursor `.cursor/rules`, for Copilot `.github/copilot-instructions.md`:

```markdown
Read `MEMORY.md` first — it maps the codebase: key files with line numbers,
dependency fan-in, conventions, and the build/test commands.

To find a symbol instead of grepping:

    repo-memory query "<term>" --json --limit 10
```

Full integration guide, including keeping the index fresh with a git hook: [`docs/AGENTS.md`](docs/AGENTS.md).

## Supported Languages

| Language              | Parsing  | Imports | Symbols                                                             |
| --------------------- | -------- | ------- | ------------------------------------------------------------------- |
| TypeScript/JavaScript | ✅ Full  | ✅ Full | ✅ Functions, classes, methods, interfaces, types, enums, constants |
| Python                | ✅ Full  | ✅ Full | ✅ Functions, classes, methods, decorators, constants               |
| Go                    | ✅ Full  | ✅ Full | ✅ Functions, methods, structs, interfaces                          |
| Rust                  | ✅ Full  | ✅ Full | ✅ Functions, structs, enums, traits, impls                         |
| Java/Kotlin           | ✅ Full  | ✅ Full | ✅ Classes, methods, interfaces                                     |
| Other                 | ✅ Basic | ❌      | ✅ Functions, classes (generic regex)                               |

## Configuration

Create `.repo-memory.json` in your project root:

```json
{
  "ignore": ["generated/", "*.auto.ts"],
  "maxTokens": 32000,
  "includeLineNumbers": true,
  "includeSignatures": true,
  "includeDependencies": true,
  "includeConventions": true,
  "maxKeySymbols": 100,
  "maxTreeDepth": 4
}
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ignore` | `string[]` | `[]` | Extra glob patterns to skip. **Appended** to the built-in defaults, never replacing them. |
| `maxTokens` | `number` | `32000` | Token budget for `MEMORY.md`. Output is trimmed to fit. |
| `includeLineNumbers` | `boolean` | `true` | Emit `L12-L187` ranges for symbols. |
| `includeSignatures` | `boolean` | `true` | Emit function and method signatures. |
| `includeDependencies` | `boolean` | `true` | Emit the dependency graph section. |
| `includeConventions` | `boolean` | `true` | Emit the conventions section. |
| `minFanIn` | `number` | `0` | Minimum dependents before a file is listed as a key file. |
| `maxKeySymbols` | `number` | `100` | Cap on symbols listed in the key files section. |
| `maxTreeDepth` | `number` | `4` | Depth cap for the architecture map. |

`.gitignore` is always honoured on top of these.

## How It Works

```
repo-memory init
     │
     ▼
 ┌─ Scan ─────────┐   Walks repo, respects .gitignore,
 │  fast-glob      │   computes file hashes, detects languages
 └────────┬────────┘
          ▼
 ┌─ Parse ─────────┐   Regex-based AST extraction for
 │  Multi-language  │   functions, classes, methods, imports
 └────────┬────────┘
          ▼
 ┌─ Resolve ───────┐   Maps imports → files, computes
 │  Dependencies   │   fan-in/fan-out, detects cycles
 └────────┬────────┘
          ▼
 ┌─ Detect ────────┐   Project type, test framework,
 │  Conventions    │   naming patterns, build system
 └────────┬────────┘
          ▼
 ┌─ Store ─────────┐   SQLite + FTS5 full-text search
 │  .repo-memory/  │   for fast queries
 └────────┬────────┘
          ▼
 ┌─ Generate ──────┐   Token-aware MEMORY.md with
 │  MEMORY.md      │   ranked symbols, architecture map
 └─────────────────┘
```

Stage-by-stage detail, including the SQLite schema: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Performance

| Repo Size           | Files       | Time |
| ------------------- | ----------- | ---- |
| Small (repo-memory) | 25 files    | 0.1s |
| Medium              | ~200 files  | ~1s  |
| Large               | ~1000 files | ~5s  |

Incremental updates (`repo-memory update`) only re-index changed files, making them near-instant.

## Limitations

Worth knowing before you rely on it:

- **Parsing is regex-based, not a real AST.** That is what keeps installation free of a native grammar toolchain, but unusual formatting can be missed. Found a case? [File it with the snippet](https://github.com/aakashpawar1999/repo-memory/issues) — it becomes a test.
- **Search is keyword, not semantic.** FTS5 over names, signatures, and docstrings. There are no embeddings, because embeddings would mean a model.
- **Dependencies are file-level.** Resolved from imports; there is no call graph.
- **`MEMORY.md` is a map, not the territory.** When it disagrees with the source, the source wins — run `repo-memory update`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the pipeline, module by module, and the index schema
- [`docs/AGENTS.md`](docs/AGENTS.md) — wiring `MEMORY.md` into Claude Code, Cursor, Copilot, and friends
- [`CHANGELOG.md`](./CHANGELOG.md) — every release and what changed
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — local development and the pull request workflow
- [`SECURITY.md`](./SECURITY.md) — what repo-memory does with your data, and how to report a vulnerability

## Contributing

Contributions are welcome — especially parser fixes, which are the cheapest kind of improvement here: send the snippet that parses wrong and it becomes a test case.

```bash
git clone https://github.com/aakashpawar1999/repo-memory.git
cd repo-memory
npm install
npm run lint && npm test && npm run build
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request, and note that pull requests go to `develop`. By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Please do not report vulnerabilities in public issues. Use [GitHub private vulnerability reporting](https://github.com/aakashpawar1999/repo-memory/security/advisories/new) — the process and the data-handling details are in [SECURITY.md](./SECURITY.md).

## License

MIT © [Aakash Pawar](https://github.com/aakashpawar1999) — see [LICENSE](./LICENSE).
