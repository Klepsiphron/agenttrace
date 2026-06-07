---
title: Self-Hosting
description: Deploy AgentTrace as a self-hosted observability dashboard.
---

All storage is local SQLite — no external database, no cloud dependency, no sign-up required.

## Quick Start: Docker Compose

The fastest path to a running instance:

```bash
docker compose up -d
# Dashboard: http://localhost:4317
```

The compose file defines:
- Named volume (`agenttrace-data`) for the SQLite database
- Health check polling `/api/health` every 30 seconds
- `restart: unless-stopped` for automatic recovery

## Quick Start: Docker

```bash
docker build -t agenttrace:latest .
docker run -d \
  --name agenttrace \
  -p 4317:4317 \
  -v agenttrace-data:/app/data \
  -e AGENTTRACE_DB_PATH=/app/data/agenttrace.db \
  -e NODE_ENV=production \
  agenttrace:latest
```

Always mount a named volume or host bind-mount at `/app/data` to persist traces across container restarts.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTTRACE_DB_PATH` | `./agenttrace.db` | Absolute path to SQLite database file |
| `NODE_ENV` | (unset) | Set to `production` for production deploys |
| `AGENTTRACE_USAGE_LOG` | (unset) | Optional path for self-tracker usage log |

The `--port` and `--host` flags are set via CLI (`--host 0.0.0.0` for container deployments). Default port: 4317, default host: `127.0.0.1`.

## Health Checks

Unauthenticated health endpoint at `/api/health`:

```
GET /api/health
```

Response (200 — healthy):

```json
{
  "status": "healthy",
  "timestamp": "2026-01-15T00:00:00.000Z",
  "uptime": 3600,
  "checks": {
    "database": { "status": "ok", "responseTime": 2 },
    "diskSpace": { "status": "ok", "freeBytes": 123456, "totalBytes": 987654 },
    "memory": { "status": "ok", "usedBytes": 50000000, "totalBytes": 200000000 },
    "activeAgents": 3,
    "totalTraces": 42
  }
}
```

Use this for Docker `HEALTHCHECK`, Kubernetes liveness/readiness probes, or load balancer health monitors.

## Database Backup

### Manual backup

```bash
# Docker
docker exec agenttrace sqlite3 /app/data/agenttrace.db ".backup /app/data/backup.db"
docker cp agenttrace:/app/data/backup.db ./agenttrace-backup-$(date +%F).db

# Local
sqlite3 ./agenttrace.db ".backup './agenttrace-backup-$(date +%F).db'"
```

### Automated backup (cron)

```bash
0 2 * * * sqlite3 /app/data/agenttrace.db ".backup '/app/data/backups/agenttrace-$(date +\%F).db'"
```

### S3 backup

```bash
docker exec agenttrace sqlite3 /app/data/agenttrace.db \
  ".backup '/tmp/agenttrace-backup.db'"
docker cp agenttrace:/tmp/agenttrace-backup.db ./backup.db
aws s3 cp ./backup.db s3://my-bucket/agenttrace/backups/agenttrace-$(date +%F).db
```

### Restore

```bash
cp agenttrace-backup.db /app/data/agenttrace.db
docker restart agenttrace
```

## Cloud Platforms

See dedicated guides:
- [Docker](/deployment/docker) — detailed Docker setup
- [Kubernetes](/deployment/kubernetes) — K8s deployment with PVCs
- [Railway](#) — one-click deploy
- [Render](#) — background worker deploy
- [Fly.io](#) — fly.io deploy with volumes

## Database Isolation

SQLite is a single-writer database. Key rules:
- **One instance only** — do not scale horizontally
- **Use persistent volumes** — never store the DB in an ephemeral container filesystem
- **Backup regularly** — SQLite `.backup` is safe to run on a live database
