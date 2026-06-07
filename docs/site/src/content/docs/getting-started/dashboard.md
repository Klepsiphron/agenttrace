---
title: Dashboard
description: Launch the AgentTrace web dashboard to visualize runs, traces, costs, and errors.
---

The AgentTrace dashboard is an Express-based web UI served locally. It reads directly from your SQLite database — nothing is cached in memory or sent to a server.

## Start the Dashboard

```bash
npx agenttrace-io dashboard
# Open http://localhost:4317
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `4317` | Port to listen on |
| `--host` | `127.0.0.1` | Host to bind (use `0.0.0.0` for Docker) |
| `--db` | `./agenttrace.db` | Path to SQLite database |

```bash
npx agenttrace-io dashboard --port 3000 --host 0.0.0.0
```

## Features

- **Runs list** — all agent runs with status, trace count, cost, and timing
- **Trace details** — input/output, tokens, latency, cost per trace
- **Statistics** — aggregate stats, cost breakdown by model and day
- **Export** — download traces as JSON, CSV, or OpenTelemetry format
- **Dark theme** — matches AgentTrace's aesthetic
- **SSE stream** — live event feed at `/api/usage/stream`

## Authentication

By default, the dashboard API (`/api/*` routes, except `/api/health`) requires an API key via the `X-API-Key` header.

Create your first key via the SDK:

```typescript
import { init } from '@agenttrace-io/sdk';
const agent = init();
const { key } = agent.createApiKey('dashboard');
console.log('Your API key:', key); // shown only once
```

Or via the REST API directly if you have an existing key.

## REST API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/stats` | Yes | Summary statistics |
| GET | `/api/costs` | Yes | Cost breakdown |
| GET | `/api/runs` | Yes | List runs |
| GET | `/api/runs/:id` | Yes | Run detail |
| GET | `/api/traces` | Yes | List traces (filterable) |
| GET | `/api/traces/:id` | Yes | Trace detail |
| GET | `/api/traces/:id/tree` | Yes | Trace tree (multi-agent) |
| GET | `/api/export` | Yes | Download export |
| GET | `/api/usage` | Yes | Agent usage records |
| GET | `/api/usage/stats` | Yes | Usage stats |
| GET | `/api/usage/active` | Yes | Active agents |
| GET | `/api/usage/stream` | Yes | SSE stream |
| GET/POST/DELETE | `/api/v1/keys` | Yes | API key management |

## Running in Production

See the [Self-Hosting guide](/deployment/self-hosting) for Docker, Kubernetes, and cloud platform deployment.
