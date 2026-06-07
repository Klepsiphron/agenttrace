---
title: Architecture
description: How AgentTrace works internally — storage layer, data flow, and package structure.
---

AgentTrace is a local-first observability platform for AI agents. Every trace, tool call, token usage event, and agent action lives in a single SQLite database on the user's machine.

## System Overview

Three interfaces consume the same storage layer:

- **SDK** — TypeScript and Python libraries that agents import to record traces
- **CLI** — `agenttrace-io` terminal commands for querying, exporting, and launching the dashboard
- **Dashboard** — Express web UI + REST API served locally on port 4317

There is no cloud dependency. Data never leaves the machine unless the user explicitly exports it or configures a webhook.

## Package Architecture

The project is a pnpm monorepo with these packages:

| Package | NPM Name | Description |
|---------|----------|-------------|
| `sdk` | `@agenttrace-io/sdk` | Core TypeScript SDK |
| `sdk-python` | `agenttrace-io` | Python port, same schema |
| `cli` | `@agenttrace-io/cli` | Terminal commands |
| `dashboard` | `@agenttrace-io/dashboard` | Express UI + API |
| `middleware-langgraph` | `@agenttrace-io/middleware-langgraph` | LangGraph node tracing |
| `middleware-crewai` | `@agenttrace-io/middleware-crewai` | CrewAI event tracing |

Key design decisions:

- **SDK is the single source of truth.** All data types, storage logic, cost calculators, and alert conditions live in the TypeScript SDK.
- **Python SDK mirrors the schema.** The Python port uses an identical SQLite schema so both SDKs can read/write the same database.
- **Framework middleware is separate.** LangGraph and CrewAI integrations live in their own packages to avoid forcing framework dependencies on core users.

## Data Flow

### Tracing an Agent Operation

1. Agent calls `agent.trace("llm-call", fn, options)`
2. Rate limiter checks if tracing is allowed
3. If rate limited, execute `fn()` but skip recording
4. Execute `fn()`, capture result or error
5. Calculate latency, cost from token usage
6. Insert trace + tool_calls into SQLite
7. Update run stats (tokens, cost, trace count)
8. Check alert conditions; trigger webhooks if met
9. Return result to agent

### Agent Self-Tracking Flow

1. Agent calls `startSession()` → creates a run with `selfTracked: true`
2. Per action: `trackAction("research", "query")` → creates trace + appends to JSONL log
3. `endSession()` → completes the run

## Storage Layer

### Engine

- **SQLite** via `better-sqlite3` (synchronous, fast, zero-config)
- **WAL journal mode** for concurrent read performance
- **Foreign keys enabled** with CASCADE deletes
- Single file: `./agenttrace.db` (configurable via `dbPath` or `AGENTTRACE_DB_PATH` env var)

### Schema (12 tables)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `runs` | Agent runs | name, status, trace_count, total_tokens, total_cost_usd |
| `traces` | Individual operations | name, status, input, output, model, tokens, latency_ms, cost_usd |
| `tool_calls` | Tool invocations | trace_id, name, input, output, latency_ms, success |
| `scores` | Evaluation scores | trace_id, name, value |
| `trace_links` | Cross-trace links | source_trace_id, target_trace_id, relation |
| `agent_usage` | Self-tracking | agent_name, action, target, tokens_used, cost_usd |
| `alerts` | Alert conditions | name, config |
| `alert_history` | Alert triggers | alert_name, triggered_at, delivered |
| `webhooks` | Webhook configs | url, secret, events, enabled |
| `api_keys` | API keys | key_hash (SHA-256), key_preview |
| `settings` | Key-value settings | key, value |
| `version` | Schema version | key, value |

### Data Retention

Two mechanisms control storage growth:

1. **Max traces cap** (`config.maxTraces`, default 10000) — oldest deleted when exceeded
2. **Retention days** (`config.retentionDays`, default 30) — scheduled cleanup removes old data

Both are configurable at SDK init time or via `agenttrace-io retention set`.

## REST API Architecture

The dashboard exposes a REST API at `http://localhost:4317/api/`:

- All `/api/*` routes (except `/api/health`) require API key auth via `X-API-Key` header
- `/api/health` is unauthenticated for load balancer/health check compatibility
- SSE stream at `/api/usage/stream` for real-time usage events
