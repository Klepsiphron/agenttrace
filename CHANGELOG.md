# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-02

### Added

- OpenTelemetry export (OTLP JSON format) for integration with external tools
- Dockerfile and docker-compose.yml for easy self-hosting
- Evaluation framework specification and alerting webhooks spec
- Documentation site (GitHub Pages) with landing page
- Social preview HTML, logo SVG, and demo GIF description guide
- Comparison page (vs Langfuse/LangSmith) and docs-site scaffolding
- LangGraph middleware package (`@agenttrace-io/middleware-langgraph`)
- CrewAI middleware package (`agenttrace-io-middleware-crewai`)
- Branch protection rules, CODEOWNERS, and repo metadata
- GitHub Actions CI matrix for Node 20/22 (carried from 0.1)

### Changed

- Package naming reverted to `@agenttrace-io/*` / `agenttrace-io` (from collision with existing packages)
- README updated with v0.2.0 features and full comparison table
- Contributing guide rewritten with project structure and development workflow
- Roadmap updated with completed v0.1/v0.2 items
- Numerous auto-format, lint fixes, and prettier runs across 16+ files
- Pre-commit hook fixes for auto-formatting

### Fixed

- ESLint no-unused-vars issues in catch clauses
- `any` types replaced in OpenTelemetry tests
- Removed broken screenshot script

### Documentation

- Added launch posts, market analysis, launch materials, social preview brief
- Added Code of Conduct (Contributor Covenant 2.1)
- Added SECURITY.md
- Added LangGraph, CrewAI, and custom agent examples
- Polished README
- Updated changelog for prior release

## [0.1.0] - 2026-06-02

### Added

- TypeScript SDK (`@agenttrace-io/sdk`): trace wrapper, cost tracking, SQLite storage
- Python SDK (`agenttrace-io`): same API, context manager + decorator, expanded to 23 unit tests
- Full CLI (`@agenttrace-io/cli`): init, dashboard, runs, traces, stats, export, version, costs, benchmark, health, self-stats, alerts
- Express dashboard: dark theme, runs list, trace details, stats, export
- GitHub Actions CI with Node 20 + 22 matrix
- Publish pipeline: PyPI + npm triggered on GitHub release tag (v*)
- Issue templates, PR template, CODEOWNERS, branch protection
- Dependabot for npm and GitHub Actions updates
- Pre-commit hook for auto-formatting
- Initial project scaffolding (core tracing, storage, types)

### Changed

- Set initial version 0.1.0 across core packages
- Prepared repository for launch (metadata, etc.)

### Documentation

- Added changelog, SECURITY.md, CONTRIBUTING.md
- Added market analysis, roadmap, launch materials, repo metadata
- Added LangGraph, CrewAI, and custom agent integration examples (docs/examples)

### Package Structure (at 0.1.0)

- `@agenttrace-io/sdk` (npm) -- TypeScript SDK
- `agenttrace-io` (PyPI) -- Python SDK
- `@agenttrace-io/dashboard` (npm) -- Local web dashboard
- `@agenttrace-io/cli` (npm) -- CLI tool
