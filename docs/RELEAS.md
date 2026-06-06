# Release Process (RELEAS.md)

This document describes how to cut a new release of AgentTrace using the changelog system and automation.

See also:

- [docs/PUBLISHING.md](PUBLISHING.md) for publishing and credential details
- [CHANGELOG.md](../CHANGELOG.md) (Keep a Changelog format)
- [.github/release.yml](../.github/release.yml) (auto release notes config)
- [scripts/bump-version.sh](../scripts/bump-version.sh)

## Versioning

- We use Semantic Versioning (SemVer).
- All published packages are versioned together for a release (core SDKs, CLI, dashboard, middlewares).
- Root `package.json` (private workspace) is also updated for consistency.
- Version constants (`VERSION` exports) live in:
  - `packages/sdk/src/index.ts`
  - `packages/cli/src/index.ts`
  - `packages/dashboard/src/index.ts`
  - `packages/middleware-langgraph/src/index.ts`
  - `packages/sdk-python/src/agenttrace/core.py`
  - `packages/middleware-crewai/src/agenttrace_middleware/__init__.py`
- Test expectations that pin `VERSION` are updated automatically by the bump script.

## Prerequisites

- Clean working tree (`git status` should be clean except for intentional untracked).
- Up-to-date main: `git checkout main && git pull`
- All tests/CI green on main.
- Appropriate access: npm tokens / PyPI tokens configured as GitHub secrets (see PUBLISHING.md).

## Steps to Release (e.g. vX.Y.Z)

1. **Decide bump type**
   - `patch`: bug fixes, small non-breaking
   - `minor`: new features, backwards compatible
   - `major`: breaking changes

2. **Run the bump script** (it does not commit or push)

   ```bash
   ./scripts/bump-version.sh minor   # or patch / major
   ```

   What the script does:
   - Parses current version from `packages/sdk/package.json`
   - Computes the new version
   - Updates **every** `package.json`
   - Updates **every** `pyproject.toml`
   - Updates `VERSION` constants in all SDK source + middlewares
   - Updates `expect(VERSION)` / `assert VERSION` in test files
   - Appends a new `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (after `[Unreleased]`)
   - Creates an annotated git tag `vX.Y.Z` (the tag points at current HEAD; version bumps are uncommitted changes)

3. **Review the changes**

   ```bash
   git status
   git diff --stat
   git diff CHANGELOG.md
   git tag -l 'v*'
   ```

   Inspect:
   - All intended files have the new version (no stray matches).
   - CHANGELOG entry is reasonable (you can edit it manually to add real highlights from `git log` since last tag).
   - Tag was created (or skipped if already present).

4. **Polish the changelog entry (recommended)**

   Edit `CHANGELOG.md` and move / expand content under the new version header:
   - Group real user-facing changes from commits since the previous tag.
   - Use sections: Added, Changed, Deprecated, Removed, Fixed, Security.
   - Keep `[Unreleased]` empty at top for ongoing work.

5. **Commit the release bump (manual)**

   ```bash
   git add -A
   git commit -m "chore: release vX.Y.Z"
   ```

   (We do not commit inside the script.)

6. **Push tag + commit**

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

   Pushing the `v*` tag triggers:
   - `.github/workflows/release.yml` (CI + GitHub Release with `--generate-notes` + publishes to npm/PyPI + Docker)
   - The auto-generated release notes on GitHub are customized by `.github/release.yml` (categories for feat/fix/docs/chore etc. based on PR labels).

7. **Monitor**
   - Watch the "Release" workflow in GitHub Actions.
   - Verify the GitHub Release was created with notes.
   - Confirm packages published:
     - npm: `@agenttrace-io/sdk`, `@agenttrace-io/cli`, `@agenttrace-io/dashboard`, `@agenttrace-io/middleware-langgraph`
     - PyPI: `agenttrace-io`, `agenttrace-io-middleware-crewai`
   - Optional: pull the new tag locally and run `pnpm build && pnpm test`

## GitHub Auto-Generated Release Notes

The file `.github/release.yml` configures how `gh release create --generate-notes` (used in the release workflow) groups changes.

It categorizes by PR labels:

- 🚀 Features (feat, feature, enhancement)
- 🐛 Bug Fixes (fix, bugfix, bug)
- 📚 Documentation
- 🧪 Tests
- 🔧 Maintenance (chore, refactor, ci, deps...)
- 📦 Other Changes

Add labels to PRs for best results. PR titles following conventional commits also help.

## Rollback / Fixing a Bad Release

- Delete the GitHub Release (not the tag).
- `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`
- Fix issues, bump again (new version), or force re-tag after amending commit if necessary (avoid if already published to registries).

## Notes

- Middlewares (LangGraph, CrewAI) may intentionally lag or lead core version during development; the bump script forces them in sync for a coordinated release.
- The script is intentionally simple (bash + sed/awk) and does not parse conventional commits for the changelog body. Manual curation of CHANGELOG.md is expected.
- Do not edit `dist/` files — they are regenerated on build.
- Future improvement ideas (see PUBLISHING.md): adopt changesets or release-please for fully automated changelog + bump PRs.

If in doubt, run `./scripts/bump-version.sh patch` on a throwaway branch first.
