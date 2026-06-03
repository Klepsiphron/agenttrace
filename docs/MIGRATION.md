# Migration Guide

This guide covers upgrading AgentTrace between versions, including schema
migrations, data migrations, and breaking changes.

## Table of Contents

- [Overview](#overview)
- [How Migrations Work](#how-migrations-work)
- [Upgrading Between Versions](#upgrading-between-versions)
  - [v0.1.0 to v0.2.0](#v010-to-v020)
- [Schema Reference](#schema-reference)
  - [Migration History](#migration-history)
  - [Current Schema (v6)](#current-schema-v6)
- [Data Migration](#data-migration)
  - [Backup Before Migrating](#backup-before-migrating)
  - [Migrating Data from Older Databases](#migrating-data-from-older-databases)
  - [Exporting and Re-importing](#exporting-and-re-importing)
- [Breaking Changes](#breaking-changes)
  - [v0.2.0](#v020)
- [Troubleshooting](#troubleshooting)

---

## Overview

AgentTrace uses an incremental migration system for its SQLite database
(`agenttrace.db`). Migrations are applied automatically when the SDK or CLI
opens a database file. Each migration is numbered sequentially and tracked in
the `meta` table via a `schema_version` key.

**Key principles:**

- Migrations are **automatic** -- no manual step required in most cases.
- Migrations are **idempotent** -- running them multiple times is safe.
- Migrations are **additive** -- they only add tables, columns, and indexes.
  No columns or tables are removed.
- The migration runner stores the current version in `meta.schema_version`
  and keeps the legacy `version` table in sync for backward compatibility.

---

## How Migrations Work

When AgentTrace opens a database (via `init()`, `new AgentTrace()`, or the CLI
`init` command), the following happens:

1. The `meta` and `version` tables are created if they do not exist.
2. The current `schema_version` is read from `meta` (falling back to the
   legacy `version` table for databases created before the migration runner
   existed).
3. All migration files in `packages/sdk/src/migrations/` with a version higher
   than the current version are applied in order, each inside a transaction.
4. After each migration, `meta.schema_version` and `version.schema_version` are
   updated.

### Migration Files

All migration files live in `packages/sdk/src/migrations/`:

```
packages/sdk/src/migrations/
  001-initial.ts        -- Schema v1: runs, traces, tool_calls, trace_links, version
  002-scores.ts         -- Schema v2: scores table
  003-alerts.ts         -- Schema v3: alerts, alert_history tables
  004-trace-context.ts  -- Schema v4: trace_context table
  005-agent-usage.ts    -- Schema v5: agent_usage table
  005-webhooks.ts       -- Schema v5: webhooks, webhook_deliveries tables
  006-api-keys.ts       -- Schema v6: api_keys, rate_limit_log tables
```

Each migration exports `version`, `name`, and `up(db)`:

```typescript
import type Database from 'better-sqlite3';

export const version = 2;
export const name = 'adding scores table';

export const up = (db: Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES traces(id),
      name TEXT NOT NULL,
      value REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_trace_id ON scores(trace_id);
    CREATE INDEX IF NOT EXISTS idx_scores_name ON scores(name);
  `);
};
```

### Version Tracking

The migration runner (`packages/sdk/src/migrations.ts`) uses two tables:

| Table     | Key              | Purpose                             |
| --------- | ---------------- | ----------------------------------- |
| `meta`    | `schema_version` | Primary version tracker (preferred) |
| `version` | `schema_version` | Legacy compatibility (kept in sync) |

For databases created before the migration system existed (pre-v0.1.0, or
created by the Python SDK which uses `CREATE TABLE IF NOT EXISTS` without a
migration runner), the version defaults to `0` and all migrations are applied
on first open by the TypeScript SDK or CLI.

---

## Upgrading Between Versions

### v0.1.0 to v0.2.0

**No manual migration required.** The migration system handles everything
automatically.

When you upgrade the npm package or Python package and open an existing
database, pending migrations are applied transparently.

#### What changed in v0.2.0

- Package naming reverted to `@agenttrace-io/*` (npm) and `agenttrace-io`
  (PyPI). If you installed under a previous name, reinstall under the
  correct name.
- New features added: OpenTelemetry export, Docker support, LangGraph and
  CrewAI middleware packages, evaluation framework, alerting webhooks.
- No schema-breaking changes. All existing tables and columns are preserved.

#### Upgrade steps

**TypeScript / Node:**

```bash
npm install @agenttrace-io/sdk@latest
```

**Python:**

```bash
pip install --upgrade agenttrace-io
```

**CLI:**

```bash
npm install -g @agenttrace-io/cli@latest
```

After upgrading, run any command to trigger automatic migration:

```bash
npx agenttrace-io stats
```

---

## Schema Reference

### Migration History

| Version | Migration File         | What it adds                                                              |
| ------- | ---------------------- | ------------------------------------------------------------------------- |
| 1       | `001-initial.ts`       | `runs`, `traces`, `tool_calls`, `trace_links`, `version` tables + indexes |
| 2       | `002-scores.ts`        | `scores` table + indexes                                                  |
| 3       | `003-alerts.ts`        | `alerts`, `alert_history` tables + indexes                                |
| 4       | `004-trace-context.ts` | `trace_context` table + index                                             |
| 5       | `005-agent-usage.ts`   | `agent_usage` table + indexes                                             |
| 5       | `005-webhooks.ts`      | `webhooks`, `webhook_deliveries` tables + indexes                         |
| 6       | `006-api-keys.ts`      | `api_keys`, `rate_limit_log` tables + indexes                             |

Note: Migrations 005-agent-usage and 005-webhooks both target version 5.
They are applied in the order they appear in the migration registry. The
migration runner sorts by version number, so both run at "version 5" before
the version counter advances to 6.

### Current Schema (v6)

The full database schema at version 6:

**Core tables:**

- `runs` -- Agent run groups (id, tenant_id, name, status, token/cost/latency
  totals, timestamps)
- `traces` -- Individual LLM/agent traces (id, tenant_id, run_id, name, status,
  input/output, tokens, model, provider, latency, cost, error, metadata,
  parent_id, timestamps)
- `tool_calls` -- Tool invocations within a trace (id, trace_id, name,
  input/output, latency, success, error, timestamp)
- `trace_links` -- Links between traces for multi-agent workflows

**Evaluation tables:**

- `scores` -- Named scores attached to traces

**Alerting tables:**

- `alerts` -- Alert configurations (name, config JSON)
- `alert_history` -- Record of alert firings (alert_name, stats, delivery
  status)

**Context tables:**

- `trace_context` -- Extended trace context (trace_id, parent_span_id, metadata)

**Usage tables:**

- `agent_usage` -- Self-tracked agent action records (agent_name, session_id,
  action, tokens, cost, duration, status)

**Webhook tables:**

- `webhooks` -- Webhook endpoint configurations (url, secret, events, enabled)
- `webhook_deliveries` -- Webhook delivery log (webhook_id, event, payload,
  status, http_status, error)

**Auth tables:**

- `api_keys` -- API key records (name, key_hash, permissions, timestamps)
- `rate_limit_log` -- Rate limit events (tenant_id, trace_id, dropped_at)

**Meta tables:**

- `meta` -- Key-value metadata (primary: `schema_version`)
- `version` -- Legacy key-value metadata (kept in sync with `meta`)

---

## Data Migration

### Backup Before Migrating

Before upgrading, back up your database:

```bash
cp agenttrace.db agenttrace.db.backup.$(date +%Y%m%d)
```

Since migrations are additive (only CREATE TABLE / ADD COLUMN), the risk of
data loss is minimal. The backup is a safety net.

### Migrating Data from Older Databases

If you have a database created with an older version of AgentTrace (or with the
Python SDK which does not use the migration runner), simply open it with the
latest SDK or CLI:

```typescript
import { init } from '@agenttrace-io/sdk';
const agent = init({ dbPath: './old-agenttrace.db' });
// Migrations run automatically
console.log(agent.getStats());
agent.close();
```

```bash
npx agenttrace-io stats
```

The migration runner detects the current version (0 for databases without a
`meta` table) and applies all pending migrations.

### Exporting and Re-importing

If you need to move data between databases or platforms, use the export
feature:

```bash
# Export to JSON
npx agenttrace-io export --format json > traces.json

# Export to CSV
npx agenttrace-io export --format csv > traces.csv

# Export to OpenTelemetry OTLP JSON
npx agenttrace-io export --format otel > traces-otel.json
```

To import into a new database, initialize it and use the SDK to replay traces:

```bash
npx agenttrace-io init --db-path ./new-agenttrace.db
```

```typescript
import { init } from '@agenttrace-io/sdk';
import traces from './traces.json' with { type: 'json' };

const agent = init({ dbPath: './new-agenttrace.db' });
for (const trace of traces) {
  // Re-create traces using the SDK API
}
agent.close();
```

---

## Breaking Changes

### v0.2.0

**Package naming.** The npm packages were renamed back to `@agenttrace-io/*`
after a naming collision was discovered. If you installed under a different
name during the brief window between v0.1.0 and v0.2.0, update your
`package.json`:

```diff
- "agenttrace-sdk": "^0.1.0"
+ "@agenttrace-io/sdk": "^0.2.0"
```

**No schema breaking changes.** All database schemas are backward compatible.
Existing databases from v0.1.0 work with v0.2.0 without modification.

---

## Troubleshooting

### "No agenttrace.db found"

Run `agenttrace-io init` to create a new database, or specify a path:

```bash
export AGENTTRACE_DB_PATH=/path/to/your/agenttrace.db
npx agenttrace-io stats
```

### Checking current schema version

Use the SDK to inspect the version:

```typescript
import { getSchemaVersion } from '@agenttrace-io/sdk/migrations';
console.log(getSchemaVersion('./agenttrace.db'));
```

Or query SQLite directly:

```bash
sqlite3 agenttrace.db "SELECT * FROM meta WHERE key='schema_version';"
sqlite3 agenttrace.db "SELECT * FROM version WHERE key='schema_version';"
```

### Migration fails mid-way

Each migration runs inside a SQLite transaction. If a migration fails, the
transaction is rolled back and the version is not updated. Fix the underlying
issue (e.g., disk permissions, corrupt database) and retry.

To inspect the database integrity:

```bash
sqlite3 agenttrace.db "PRAGMA integrity_check;"
```

### Python SDK vs TypeScript SDK schema differences

The Python SDK (`agenttrace-io`) uses `CREATE TABLE IF NOT EXISTS` without a
migration runner. It creates the schema at the version it knows about at
install time. If you open a Python-created database with the TypeScript SDK
or CLI, the migration runner will detect version 0 and apply all migrations,
adding any tables the Python SDK did not create (e.g., `trace_context`,
`webhooks`, `api_keys`).

This is safe -- the operation is additive and idempotent.

### Recovering from a failed migration

1. Restore from backup:
   ```bash
   cp agenttrace.db.backup.20260602 agenttrace.db
   ```
2. Identify the failing migration by checking the version:
   ```bash
   sqlite3 agenttrace.db "SELECT value FROM meta WHERE key='schema_version';"
   ```
3. Report the issue with the migration number and error output.
