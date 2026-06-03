# Publishing Guide

This document explains how to publish the AgentTrace packages to PyPI and npm using the automated GitHub Actions workflows.

## Overview

Publishing is automated via GitHub Actions:

- `publish-pypi.yml`: Publishes the Python SDK (`agenttrace-io`) to PyPI
- `publish-npm.yml`: Publishes the TypeScript SDK (`@agenttrace-io/sdk`) to npm

Both workflows trigger on GitHub Releases that are published with version tags (`v*`).

## Automated vs Manual Publishing

### Automated (Recommended)

- Triggered automatically when a GitHub Release with a `v*` tag is published.
- Ensures consistent builds, runs `pnpm build` for TS dependencies, and uses the exact package versions from source.
- Includes error handling, logging, and conditional execution only for version tags.

### Manual

Use when you need to publish outside the release flow (e.g., hotfix, testing):

```bash
# Python
cd packages/sdk-python
pip install build twine
python -m build
twine upload dist/*   # requires TWINE_USERNAME=__token__ and TWINE_PASSWORD set

# npm (from repo root)
pnpm install --frozen-lockfile
pnpm build
cd packages/sdk
npm publish --access public   # requires NODE_AUTH_TOKEN or npm login
```

Manual publishing requires local credentials and bypasses CI safeguards.

## Setting Up Credentials

### PyPI API Token

1. Log in to [PyPI](https://pypi.org) (or TestPyPI for testing).
2. Go to **Account settings > API tokens**.
3. Click **Add API token**.
4. Give it a name (e.g., "AgentTrace GitHub Actions").
5. Scope: Recommended to scope to the `agenttrace-io` project (or "Entire account" for simplicity).
6. Copy the token immediately (it starts with `pypi-...` and is only shown once).

For production, prefer [PyPI Trusted Publishing](https://docs.pypi.org/trusted-publishers/) in the future (OIDC), but the current workflow uses a classic API token.

### npm Token

1. Log in to [npmjs.com](https://www.npmjs.com).
2. Go to **Access Tokens** (under your profile).
3. Generate a new **Granular Access Token** (preferred) or Classic token.
4. Permissions: `Read and write` for packages under the `@agenttrace-io` scope (or publish for the specific package).
5. Copy the token (classic tokens start with `npm_...`).

If publishing under an organization, ensure you have appropriate permissions on the `@agenttrace-io` org.

## Configuring GitHub Secrets

1. Go to the repository on GitHub: **Settings > Secrets and variables > Actions**.
2. Under "Repository secrets", click **New repository secret**.
3. Add the following:

   | Secret Name     | Value                          | Used By          |
   |-----------------|--------------------------------|------------------|
   | `PYPI_API_TOKEN` | The PyPI API token (pypi-...) | publish-pypi.yml |
   | `NPM_TOKEN`      | The npm access token          | publish-npm.yml  |

4. (Optional but recommended) Add the same secrets to any protected environments if you configure deployment environments later.

**Never** commit tokens to the repo. The workflows reference them only via `secrets.*`.

## How to Release

Follow these steps for a standard release (this will trigger automated publishing):

1. **Update versions** (before tagging):
   - TypeScript SDK: Edit `packages/sdk/package.json` and set `"version": "X.Y.Z"`
   - Python SDK: Edit `packages/sdk-python/pyproject.toml` and set `version = "X.Y.Z"`
   - Optionally update other packages (`packages/dashboard`, `packages/cli`, `packages/middleware-*`) if you intend to publish them.
   - Update `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` section.
   - Commit the version bumps: `git add -A && git commit -m "chore: release vX.Y.Z"`

2. **Tag the release**:
   ```bash
   git tag -a vX.Y.Z -m "AgentTrace vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. **Create the GitHub Release** (two common paths):
   - **Automated via release.yml**: Pushing the `v*` tag triggers `.github/workflows/release.yml`, which runs full CI, then creates a GitHub Release with auto-generated notes. Publishing of npm/PyPI also happens inside that workflow.
   - **Manual**: Go to GitHub → Releases → "Draft a new release". Select the `vX.Y.Z` tag, add title/notes, and **Publish release**. This triggers the dedicated `publish-pypi.yml` and `publish-npm.yml` workflows (if the tag starts with `v`).

4. **Monitor the run**:
   - Go to the **Actions** tab.
   - Watch the "Publish PyPI" and "Publish NPM" workflow runs (or the "Release" workflow).
   - Check logs for the build and upload steps. Successful runs will log "Successfully published...".

5. **Verify**:
   - PyPI: https://pypi.org/project/agenttrace-io/
   - npm: https://www.npmjs.com/package/@agenttrace-io/sdk
   - Try installing in a fresh environment:
     ```bash
     pip install agenttrace-io==X.Y.Z
     npm install @agenttrace-io/sdk@X.Y.Z
     ```

## Workflow Details

- **Triggers**: `release` event with type `published`, gated by `if: startsWith(github.event.release.tag_name, 'v')`.
- **PyPI workflow** (`publish-pypi.yml`):
  - Python 3.11
  - Runs `pnpm build` first (builds any TS packages that Python SDK or consumers may depend on)
  - `cd packages/sdk-python && python -m build`
  - `twine upload` using `PYPI_API_TOKEN`
- **npm workflow** (`publish-npm.yml`):
  - Builds all TS packages via root `pnpm build`
  - Publishes only `@agenttrace-io/sdk`
  - Uses `NPM_TOKEN`
- Both include `set -euo pipefail`, step logging, and `--verbose` where helpful for debugging.

## Troubleshooting

- **"401 Unauthorized" on PyPI**: Wrong/expired token, or token lacks project scope. Regenerate and update the secret.
- **"403 Forbidden" on npm**: Token scope insufficient for `@agenttrace-io/sdk`, or you are not a maintainer of the package/org.
- **"File already exists"**: You are trying to publish a version that already exists on the registry. Bump the version.
- **Missing build artifacts**: Ensure `pnpm build` succeeded and `python -m build` produced `dist/`.
- **Tag not triggering**: The release must be published (not just drafted) and the tag must start with `v` (e.g., `v0.2.0`).
- **Duplicate publishes**: Note that `release.yml` also performs publishes on tag push. The dedicated publish workflows are additive for cases where releases are created manually.

## Future Improvements

- Adopt PyPI Trusted Publishing (no long-lived tokens).
- Use Changesets or release-please for automated version bumping and changelog.
- Publish the other packages (`@agenttrace-io/cli`, `@agenttrace-io/dashboard`) consistently from the npm workflow.
- Add provenance attestations (`--provenance` for npm, OIDC for PyPI).

For questions, see the contributing guide or open an issue.
