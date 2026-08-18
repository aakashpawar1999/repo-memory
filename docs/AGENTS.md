# Using repo-memory with AI agents

`MEMORY.md` is written to be read by a coding agent at the start of a session:
where the code lives, what depends on what, and how to build and test the
project — without the agent spending tokens rediscovering it. This document
covers wiring it into the common tools and querying the index programmatically.

## The two access paths

| Path | Use it for |
| --- | --- |
| `MEMORY.md` | Session priming. One file, token-budgeted, always in context. |
| `.repo-memory/index.db` via `query` / `show` | Lookups mid-task. Precise, on demand, cheap. |

Prime with the file, look up with the CLI. Loading the whole index into context
defeats the point.

## Setup

```bash
cd your-project
npx @aakashpawar/repo-memory init
```

Commit `MEMORY.md`; keep the index local:

```gitignore
.repo-memory/
```

Read [SECURITY.md](../SECURITY.md) before committing `MEMORY.md` to a public
repository — it is a structural map of your codebase, and it copies signatures
and docstrings verbatim.

## Claude Code

Point `CLAUDE.md` at the memory file and tell the agent when to query it:

```markdown
# Project context

Read `MEMORY.md` first — it maps the codebase: key files with line numbers,
dependency fan-in, conventions, and the build/test commands.

To find a symbol instead of grepping:

    repo-memory query "<term>" --json --limit 10
    repo-memory show <SymbolName>

If `MEMORY.md` disagrees with the source, the source wins — run
`repo-memory update` to refresh it.
```

## Cursor, Windsurf, Copilot, and friends

Any tool with a rules or instructions file works the same way — the rule is one
line pointing at `MEMORY.md`:

- **Cursor** — `.cursor/rules/*.mdc` or `.cursorrules`
- **Windsurf** — `.windsurfrules`
- **GitHub Copilot** — `.github/copilot-instructions.md`
- **Aider** — `CONVENTIONS.md`, or `/read MEMORY.md` in-session
- **Generic agent frameworks** — `AGENTS.md`

## Querying the index

`query` searches symbol names, qualified names, signatures, and docstrings
through FTS5. `--json` gives a stable array for programmatic use:

```bash
repo-memory query "authentication" --json --limit 10
```

```json
[
  {
    "id": 412,
    "file_id": 27,
    "name": "verifyToken",
    "qualified_name": "AuthService.verifyToken",
    "kind": "method",
    "signature": "verifyToken(token: string): Promise<Claims>",
    "start_line": 84,
    "end_line": 121,
    "docstring": "Verify a bearer token and return its claims.",
    "exported": 1,
    "parent": "AuthService",
    "file_path": "src/server/auth.service.ts"
  }
]
```

`id` and `file_id` are the index's own row identifiers; `exported` is `0` or `1`.

`file_path` plus `start_line`/`end_line` is the point of the whole thing: the
agent reads exactly that range instead of the whole file.

`show <symbol>` is the human-facing version — it prints the same metadata plus the
first 15 source lines.

## Keeping it fresh

`MEMORY.md` is only useful while it matches the code. Cheapest options, in order:

```bash
repo-memory update        # after a batch of changes; only re-indexes what changed
repo-memory doctor        # says whether the index is stale against the current commit
```

A post-checkout / post-merge git hook keeps it current without thinking about it:

```bash
cat > .git/hooks/post-merge <<'HOOK'
#!/bin/sh
repo-memory update >/dev/null 2>&1 || true
HOOK
chmod +x .git/hooks/post-merge
```

In CI, `repo-memory init` on a clean checkout and a `git diff --exit-code
MEMORY.md` will tell you whether a contributor forgot to regenerate it — but note
the file records an index timestamp, so compare deliberately rather than blindly.

## Tuning the output

If `MEMORY.md` is too large for your agent's budget, or too thin to be useful,
adjust `.repo-memory.json` (see the README for every field):

```json
{
  "maxTokens": 16000,
  "maxKeySymbols": 60,
  "maxTreeDepth": 3,
  "includeSignatures": true,
  "ignore": ["generated/", "*.pb.ts"]
}
```

Sensible starting points: **8k–16k tokens** when the memory file shares a small
context window with other instructions, **32k** (the default) for a large-context
agent that gets the file once per session.
