# AGENTS.md — AgentTrace Project Context

**Auto-loaded by any Hermes/Grok agent working in this workspace.**

## Project

AgentTrace v0.1.0 — open-source AI agent observability tool.
Repo: github.com/Klepsiphron/agenttrace
Local: /home/ryano/projects/agenttrace

## Packages

- `packages/sdk` — TypeScript SDK (better-sqlite3, tracing, scoring, alerts, webhooks)
- `packages/sdk-python` — Python SDK (mirrors TS SDK)
- `packages/cli` — CLI tool (init, dashboard, runs, trace, stats, export, costs, alerts, tree, self-stats)
- `packages/dashboard` — Express web dashboard + static frontend
- `packages/middleware-langgraph` — LangGraph middleware
- `packages/middleware-crewai` — CrewAI middleware

## Research-First Rule

**ALWAYS combine X research + web_search before implementing anything.**
- Use x_search for real-time practitioner knowledge, current discussions, what's actually working
- Use web_search for broad reference, documentation, established patterns
- Compare and triangulate — never rely on a single source
- Save raw sources to docs/research/ or wiki/raw/
- Synthesize findings into wiki/concepts/ before building

## Code Standards

- TypeScript: strict mode, ES modules, no `any` types
- Python: type hints, pathlib over os.path
- Tests: vitest (TS), pytest (Python) — run before pushing
- Commits: conventional format (`fix:`, `feat:`, `chore:`, `refactor:`)
- **NEVER add features without confirming existing code works first**
- **Verify AgentTrace itself works after every fix (pnpm build && pnpm test)**

## Delegation Rules (How I Work)

1. All workers are me — trust them to self-check before pushing
2. Workers push directly after verifying their own work
3. No internal orchestration notes in any prompts
4. Max 2-3 concurrent disk-heavy workers (SSD bottleneck)
5. Research before implementing — use web_search + x_search
6. Fix bugs, don't add features (Sprint 1-2 focus)

## Security Rules

- NEVER push without scanning for sensitive data (wallet addresses, usernames, paths, API keys)
- NEVER reveal AI identity in any public-facing content
- GitHub identity: Klepsiphron (NEVER "ryano" on GitHub)
- All publishing requires explicit Ryan approval

## Current Sprint

See `docs/research/improvement-plan.md` for full details.

### Completed
- [x] SQLite concurrency fix (createTrace wrapped in db.transaction)
- [x] Express body size limit (1mb) + CORS on dashboard
- [x] Webhook HMAC signing + SSRF protection + fetch timeout
- [x] Deleted redundant publish.yml workflow
- [x] Added pip ecosystem to dependabot.yml
- [x] Added Python SDK CI job to root ci.yml

### In Progress
- [ ] recordToolCall() stub fix
- [ ] Python SDK schema migrations
- [ ] Test expansion (CLI, Dashboard, middleware)
- [ ] better-sqlite3 dependency fix
- [ ] Python SDK close() method
- [ ] __init__.py export fixes

## Testing Commands

```bash
# Root (TypeScript)
pnpm build && pnpm test

# Python SDK
cd packages/sdk-python && pip install -e '.[dev]' && pytest

# Specific package
cd packages/sdk && npx vitest run
cd packages/dashboard && npx vitest run
```

## File Conventions

- AGENTS.md = this file (workspace context for all agents)
- docs/research/ = research docs, improvement plans
- docs/plans/ = implementation plans
- All temporary/test DBs must be gitignored
