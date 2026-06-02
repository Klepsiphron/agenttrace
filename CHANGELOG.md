# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Framework middleware: LangGraph and CrewAI integrations
- Documentation site (GitHub Pages)

## [0.1.0] - 2026-06-02

### Added

- TypeScript SDK (`@agenttrace/sdk`): trace wrapper, cost tracking, SQLite storage
- Python SDK (`agenttrace`): same API, context manager + decorator, 23 tests
- Full CLI (`@agenttrace/cli`): init, dashboard, runs, traces, stats, export, version
- Express dashboard: dark theme, runs list, trace details, stats, export
- OpenTelemetry export: OTLP JSON format for integration with existing tools
- LangGraph, CrewAI, and custom agent integration examples
- GitHub Actions CI with Node 20 + 22 matrix
- Publish pipeline: PyPI + npm on GitHub release tag
- Issue templates, PR template, CODEOWNERS, branch protection
- Dependabot for npm and GitHub Actions updates
- Landing page deployed to GitHub Pages
- Comparison page (vs Langfuse/LangSmith)
- Pre-commit hook for auto-formatting

### Package Structure

- `@agenttrace/sdk` (npm) -- TypeScript SDK
- `agenttrace` (PyPI) -- Python SDK
- `@agenttrace/dashboard` (npm) -- Local web dashboard
- `@agenttrace/cli` (npm) -- CLI tool
- `@agenttrace/middleware-langgraph` (npm) -- LangGraph integration
- `agenttrace-middleware-crewai` (PyPI) -- CrewAI integration
