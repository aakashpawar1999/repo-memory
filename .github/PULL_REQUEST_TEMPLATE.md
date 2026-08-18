<!--
Thanks for contributing to repo-memory! Please read CONTRIBUTING.md first.
Open pull requests against `develop`, not `main`. Keep them single-purpose.
-->

## What changed

<!-- One or two sentences. What does this PR do and why? -->

## SemVer classification

<!-- See CONTRIBUTING.md. -->

- [ ] **Patch** — a fix, no change to the public surface.
- [ ] **Minor** — additive (new command, config field, language, richer output).
- [ ] **Major** — removes or changes a command, an option, the `--json` shape, or
      the SQLite schema.
- [ ] **None of the above** — docs, tests, or internal-only change.

If this changes the **SQLite schema**, say whether an existing index migrates or
must be rebuilt with `repo-memory init`: <!-- migrates / rebuild required / n-a -->

## Test evidence

<!-- Paste the relevant output. All three must pass before review. -->

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes

```
<!-- paste output here -->
```

## Checklist

- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] New or changed behaviour in `src/` has tests under `test/`.
- [ ] A parsing fix ships with the snippet that used to break, as a test.
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`.
- [ ] If generator output changed, the committed `MEMORY.md` was regenerated.
- [ ] The change is single-purpose.
