# Security Policy

## Supported versions

repo-memory follows [Semantic Versioning](https://semver.org/). Only the latest
`1.x` release receives security fixes — older releases are not backported.

| Version | Supported |
| --- | --- |
| Latest `1.x` | ✅ |
| Older `1.x` | ⚠️ Upgrade to the latest `1.x` |
| `0.x` | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/aakashpawar1999/repo-memory/security/advisories/new),
which is the preferred route. If that is unavailable to you, email
**aakashpawar1999@gmail.com** with `[repo-memory security]` in the subject.

Please include:

- What the issue is and roughly how bad you think it is.
- Steps to reproduce, ideally with a minimal file or command.
- The version (`repo-memory --version`), your Node version, and your OS.

What to expect:

- **Acknowledgement within 72 hours.**
- An assessment and a rough timeline within 7 days.
- Credit in the release notes and the advisory, unless you would rather not be
  named.

This is a small project maintained in spare time. Fixes are made as quickly as is
practical, and you will be kept informed either way.

## What repo-memory actually does with your data

Worth being explicit, because it determines what is and is not a vulnerability
here.

**Nothing is sent anywhere, ever.** repo-memory has no network code and no LLM
dependency. It reads files from the directory you point it at and writes two
artefacts back into that same directory: `MEMORY.md` and `.repo-memory/index.db`.

**Both artefacts contain content copied from your source.** Symbol names,
function signatures, and docstrings are stored verbatim in the SQLite index and
rendered into `MEMORY.md`. `repo-memory show` prints source lines directly from
disk. If a signature or a docstring contains a secret, the generated files
contain that secret too.

**`MEMORY.md` is meant to be committed; the index is not.** The index lives under
`.repo-memory/`, which you should keep out of version control. Before you commit
a generated `MEMORY.md` to a public repository, read it — you are publishing a
structural map of the codebase, including private file paths and signatures.

**Scanning honours `.gitignore`, but that is convenience, not a boundary.**
Default ignores (`node_modules`, build output, lockfiles, binaries, `.env`) plus
your `.repo-memory.json` `ignore` list decide what gets read. If something must
never be indexed, add it to `ignore` and verify with `repo-memory query`.

**repo-memory parses whatever you point it at.** Parsing is regex-based over file
contents, so running it on a repository you do not control means running those
regexes over attacker-influenced bytes.

## Known risk areas

If you are looking for somewhere to dig, these are the honest weak points:

- **Regex parsing on hostile input.** A pathological file (very long lines, deep
  nesting, adversarial repetition) driving catastrophic backtracking or memory
  growth is plausible and worth reporting.
- **Path handling.** Scanning follows what `fast-glob` returns from the root you
  give it. Anything that causes a read or a write outside that root — via
  symlinks or otherwise — is a real bug.
- **`better-sqlite3`** is a native dependency. Vulnerabilities in it that affect
  how repo-memory uses it are in scope.

## Out of scope

- The index or `MEMORY.md` being readable by other users on the same machine.
  Set file permissions appropriately; repo-memory does not defend against a local
  attacker who can already read your source.
- Secrets appearing in `MEMORY.md` because they were hardcoded in the source that
  was indexed. Fix the source, and add the path to `ignore`.
- Vulnerabilities in dependencies that do not affect repo-memory's use of them.
  Report those upstream, though a heads-up here is welcome.
- The generator omitting a symbol or ranking files oddly. That is a quality issue
  — please file it as a normal bug.
