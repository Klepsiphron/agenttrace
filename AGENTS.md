# AGENTS.md — AgentTrace Project Context

**Auto-loaded by AI coding assistants (Claude Code, Codex, Grok, Cursor, etc.) working in this workspace.**

## Project

AgentTrace v0.1.0 — open-source AI agent observability tool.
Repo: github.com/Klepsiphron/agenttrace

## Packages

- `packages/sdk` — TypeScript SDK (tracing, scoring, alerts, webhooks)
- `packages/sdk-python` — Python SDK (mirrors TS SDK)
- `packages/cli` — CLI tool (init, dashboard, runs, traces, stats, export, costs, alerts, wrap, budget)
- `packages/dashboard` — Express web dashboard + static frontend
- `packages/middleware-langgraph` — LangGraph auto-tracing middleware
- `packages/middleware-crewai` — CrewAI auto-tracing middleware

## Code Standards

- TypeScript: strict mode, ES modules, avoid `any` types
- Python: type hints, `snake_case`, docstrings on all public APIs
- Tests: vitest (TS), pytest (Python) — run before pushing
- Commits: conventional format (`fix:`, `feat:`, `chore:`, `refactor:`)
- Verify build + tests after every change (`pnpm build && pnpm test`)

## Testing Commands

```bash
pnpm build && pnpm test           # All TypeScript tests
cd packages/sdk-python && pytest  # Python tests
cd packages/sdk && npx vitest run # Specific package
```

## Security

- Never commit API keys, credentials, `.env` files, or database files (`*.db`, `*.sqlite`)
- All data stays local in SQLite by default — no cloud dependency

## License

MIT
