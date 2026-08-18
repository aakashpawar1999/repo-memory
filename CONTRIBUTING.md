# Contributing to repo-memory

Thanks for wanting to improve repo-memory. This guide gets you from a clone to a
mergeable pull request. It is short on purpose — the design detail lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and this guide points at it rather
than repeating it.

## What repo-memory is

A single CLI that indexes a repository and writes two artefacts into it:

1. **`MEMORY.md`** — a token-budgeted Markdown brief an AI agent reads at the
   start of a session.
2. **`.repo-memory/index.db`** — a SQLite database with an FTS5 index, queried by
   `repo-memory query` and `repo-memory show`.

Two constraints shape every change, and a pull request that breaks either will be
sent back:

- **No LLM, no network.** Indexing is deterministic. There is no API key, no
  model call, and nothing leaves the machine.
- **No native parser toolchain.** Parsing is regex-based per language
  (`src/indexer/parser.ts`) precisely so installing the package never needs a
  compiler for a grammar. `better-sqlite3` is the one native dependency, and it
  ships prebuilt binaries.

## Local development

Requirements: **Node 18 or newer**.

```bash
git clone https://github.com/aakashpawar1999/repo-memory.git
cd repo-memory
npm install

npm run build        # bundle src/cli.ts -> dist/cli.js (tsup, ESM)
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run lint         # tsc --noEmit — type check, no emit
npm run dev          # tsup --watch
```

Run the CLI against a real repository while you work:

```bash
node dist/cli.js init --dir /path/to/some-project --verbose
node dist/cli.js query "payment" --dir /path/to/some-project --json
```

This repo **dogfoods itself**: the committed `MEMORY.md` at the root is
repo-memory's own output. If your change alters generator output, regenerate it
(`node dist/cli.js init`) and include the regenerated file in the pull request so
the diff shows what changed. `.repo-memory/` is gitignored and stays local.

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | Commander wiring for `init`, `update`, `query`, `show`, `doctor` |
| `src/config/config.ts` | `.repo-memory.json` loading and defaults |
| `src/indexer/scanner.ts` | File walk, language detection, content hashing |
| `src/indexer/parser.ts` | Per-language symbol and import extraction |
| `src/indexer/dependency-resolver.ts` | Import → file resolution, fan-in/fan-out, cycles |
| `src/indexer/conventions.ts` | Project type, build/test commands, naming patterns |
| `src/store/database.ts` | SQLite schema, upserts, FTS5 search |
| `src/generator/memory-generator.ts` | `MEMORY.md` rendering under the token budget |
| `test/` | Vitest suites |

Adding a language means one parser function in `src/indexer/parser.ts`, an
extension entry in `EXTENSION_MAP` in `src/indexer/scanner.ts`, a resolver case in
`src/indexer/dependency-resolver.ts` if its imports map to files, and a test with
a representative snippet. Update the language table in the README in the same PR.

## Tests

Any behavioural change to `src/` needs a test under `test/`. Write the failing
test first, watch it fail, then make it pass.

Parser tests are the cheapest kind of insurance in this codebase: feed a snippet
in, assert on the symbols that come out. Please add one for every parsing bug you
fix — a regex fix without a regression test tends to be undone by the next regex
fix.

## Versioning

repo-memory is on `1.x` and follows SemVer:

- **Major** — removing a command or an option, or changing the shape of the
  `--json` output or the SQLite schema in a way that breaks an existing index.
- **Minor** — a new command, a new config field, a new language, or richer
  `MEMORY.md` output.
- **Patch** — fixes only.

Say which bump your change forces in the pull request. If a change alters the
SQLite schema, say so explicitly — existing indexes must either migrate or be
rebuilt by `init`, and that has to be spelled out in the changelog.

## Pull request workflow

1. Fork and branch from `develop` (`feat/...`, `fix/...`, or `docs/...`).
   `main` holds released code; day-to-day work merges into `develop`.
2. Make the change, with tests.
3. Run `npm run lint`, `npm test`, and `npm run build`. All three must pass.
4. Add a `CHANGELOG.md` entry under `## [Unreleased]`.
5. Open a pull request against `develop` and fill in the template. CI runs lint,
   test, and build on Node 18, 20, and 22.
6. Keep pull requests small and single-purpose — one coherent change is far
   easier to review and release.

## Releasing (maintainers)

1. Merge `develop` into `main`.
2. Move the `Unreleased` entries into a new version section in `CHANGELOG.md`.
3. `npm version <patch|minor|major>` — this updates `package.json` and tags.
4. Push the tag. `.github/workflows/release.yml` verifies the tag matches
   `package.json`, runs the suite, publishes to npm with provenance, and creates
   the GitHub release from the changelog section.

## Reporting bugs and requesting features

Use the issue templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE).
A bug report for a parsing problem should include the snippet that parses wrong —
that alone usually turns into a test case and a fix.

For anything security-related, do **not** open a public issue — follow
[`SECURITY.md`](SECURITY.md).

By contributing you agree your work is licensed under the project's
[MIT License](LICENSE), and to uphold the
[Code of Conduct](CODE_OF_CONDUCT.md).
