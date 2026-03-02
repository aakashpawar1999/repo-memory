# 🧠 repo-memory

> Create a persistent brain for any code repository — instant context for AI agents.

**One command. Zero LLM dependency. Works offline.**

```bash
npx repo-memory init
```

repo-memory scans your codebase, parses every function/class/module, maps dependencies, detects conventions, and generates a structured `MEMORY.md` that any AI agent can instantly consume — like giving it the institutional knowledge of a super-senior developer.

## Why?

Every time an AI agent starts a new session, it:

- 🔄 Wastes tokens re-scanning the repo structure
- 🔍 Doesn't know where key logic lives (file + line numbers)
- 🧩 Loses context about patterns, conventions, and relationships
- 💸 Increases overhead by rebuilding context from scratch

**repo-memory** solves this with a single `MEMORY.md` file that persists between sessions.

## Quick Start

```bash
# Install globally
npm install -g repo-memory

# Or run directly with npx
npx repo-memory init

# Index your project
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

### `.repo-memory/index.db` — Queryable SQLite Index

A fast, local SQLite database with full-text search for programmatic access:

```bash
# Search symbols
repo-memory query "authentication" --json

# Get structured results for AI agents
repo-memory query "error handling" --json --limit 10
```

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

## Performance

| Repo Size           | Files       | Time |
| ------------------- | ----------- | ---- |
| Small (repo-memory) | 13 files    | 0.1s |
| Medium              | ~200 files  | ~1s  |
| Large               | ~1000 files | ~5s  |

Incremental updates (`repo-memory update`) only re-index changed files, making them near-instant.

## License

MIT
