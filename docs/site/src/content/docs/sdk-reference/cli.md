---
title: CLI Reference
description: Complete reference for the agenttrace-io CLI commands.
---

**Command:** `agenttrace-io` (or `npx agenttrace-io`)
**Package:** `@agenttrace-io/cli`

## Global Options

| Flag | Description |
|------|-------------|
| `--db <path>` | SQLite database path (default: `./agenttrace.db`) |
| `--help` | Show help for any command |
| `--version` | Show CLI version |

## `init`

Create an empty `agenttrace.db` database file.

```bash
npx agenttrace-io init
```

## `dashboard`

Start the local dashboard server.

```bash
npx agenttrace-io dashboard
npx agenttrace-io dashboard --port 3000 --host 0.0.0.0
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `4317` | Port to listen on |
| `--host` | `127.0.0.1` | Host to bind |
| `--db` | `./agenttrace.db` | Database path |

## `runs`

List recent runs.

```bash
npx agenttrace-io runs --limit 10
npx agenttrace-io runs --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | `20` | Number of runs to show |
| `--json` | `false` | Output as JSON |

## `traces`

List traces.

```bash
npx agenttrace-io traces --limit 50
npx agenttrace-io traces --status error
npx agenttrace-io traces --run-id <uuid>
npx agenttrace-io traces --min-latency 2000
```

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | `50` | Number of traces |
| `--status` | all | Filter by status (success, error, failure) |
| `--run-id` | all | Filter by run ID |
| `--min-latency` | `0` | Minimum latency in ms |
| `--json` | `false` | Output as JSON |

## `stats`

Show summary statistics.

```bash
npx agenttrace-io stats
```

Outputs: total traces, total runs, error rate, avg latency, total cost, top models, top tools.

## `costs`

Show cost breakdown.

```bash
npx agenttrace-io costs
npx agenttrace-io costs --daily
```

| Flag | Default | Description |
|------|---------|-------------|
| `--daily` | `false` | Show per-day breakdown |

## `export`

Export traces to file.

```bash
npx agenttrace-io export --format json --output traces.json
npx agenttrace-io export --format csv --run-id <uuid> --output run.csv
npx agenttrace-io export --format otel --output otel.json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `json` | Export format: json, csv, otel |
| `--output` | stdout | Output file path |
| `--run-id` | all | Export specific run |

## `tree`

Show trace tree for multi-agent visualization.

```bash
npx agenttrace-io tree --trace-id <uuid>
```

## `alerts`

Manage alerts.

```bash
npx agenttrace-io alerts list
npx agenttrace-io alerts test --name high-error-rate
npx agenttrace-io alerts history
```

## `health`

Check system health.

```bash
npx agenttrace-io health
```

Outputs: DB status, disk space, memory usage, active agents, total traces.

## `who`

Show active agents (self-tracking).

```bash
npx agenttrace-io who
```

## Self-Tracking Commands

```bash
npx agenttrace-io self-stats     # Agent self-tracking stats
npx agenttrace-io cost           # Self-tracking cost
npx agenttrace-io sessions       # Active sessions
npx agenttrace-io activity       # Recent activity log
```

## Maintenance Commands

```bash
npx agenttrace-io cleanup        # Run manual cleanup (delete old traces)
npx agenttrace-io retention set --days 14   # Set retention to 14 days
npx agenttrace-io retention get             # Show current retention setting
```

## `benchmark`

Run performance benchmarks against the storage layer.

```bash
npx agenttrace-io benchmark
```
