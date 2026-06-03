# Deployment Guide

Deploy AgentTrace as a self-hosted observability dashboard. All storage is local
SQLite -- no external database or cloud dependency required.

## Table of Contents

- [Docker (Single Container)](#docker-single-container)
- [Docker Compose](#docker-compose)
- [Kubernetes](#kubernetes)
- [Railway](#railway)
- [Render](#render)
- [Fly.io](#flyio)
- [Environment Variables](#environment-variables)
- [Health Checks](#health-checks)
- [Database Backup](#database-backup)

---

## Docker (Single Container)

The project includes a multi-stage Alpine Dockerfile. Build and run:

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

The dashboard is available at `http://localhost:4317`. The container runs the
CLI `dashboard` command on port 4317 with the health check endpoint at
`/api/health`.

The built image uses `node:20-alpine` and is roughly 200 MB. SQLite data is
stored under `/app/data` -- always mount a named volume or host bind-mount to
this path to persist traces across container restarts.

---

## Docker Compose

The included `docker-compose.yml` is the fastest path to a running instance:

```bash
docker compose up -d
# Dashboard: http://localhost:4317
```

The compose file defines a named volume (`agenttrace-data`) for the SQLite
database, a health check, and `restart: unless-stopped` for automatic recovery.

To override the port or database path:

```yaml
services:
  agenttrace:
    ports:
      - '8080:4317'
    environment:
      - AGENTTRACE_DB_PATH=/app/data/agenttrace.db
```

---

## Kubernetes

Deploy AgentTrace as a simple Deployment + Service. No StatefulSet is needed
since storage is a single SQLite file -- mount a PersistentVolumeClaim.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agenttrace
  labels:
    app: agenttrace
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agenttrace
  template:
    metadata:
      labels:
        app: agenttrace
    spec:
      containers:
        - name: agenttrace
          image: agenttrace:latest
          ports:
            - containerPort: 4317
          env:
            - name: NODE_ENV
              value: production
            - name: AGENTTRACE_DB_PATH
              value: /app/data/agenttrace.db
          volumeMounts:
            - name: data
              mountPath: /app/data
          livenessProbe:
            httpGet:
              path: /api/health
              port: 4317
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: 4317
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: agenttrace-data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agenttrace-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: agenttrace
spec:
  selector:
    app: agenttrace
  ports:
    - port: 80
      targetPort: 4317
```

Set `replicas: 1`. SQLite does not support concurrent writers -- do not scale
this deployment horizontally without migrating to PostgreSQL.

---

## Railway

1. Connect your GitHub repo at [railway.app](https://railway.app).
2. Set the Dockerfile path to `Dockerfile`.
3. Add a persistent volume mount at `/app/data`.
4. Set environment variables in the Railway dashboard:
   - `AGENTTRACE_DB_PATH=/app/data/agenttrace.db`
   - `NODE_ENV=production`
5. Railway will auto-detect the exposed port (4317) and provide a public URL.

Override the start command if needed:

```
node packages/cli/dist/index.js dashboard --host 0.0.0.0
```

---

## Render

Use a **Background Worker** (not a Web Service) since AgentTrace runs as a
long-lived Node.js process:

1. Create a new Background Worker from your GitHub repo.
2. Set the Dockerfile path to `Dockerfile`.
3. Add a persistent disk mount at `/app/data` (minimum 1 GB).
4. Set environment variables:
   - `AGENTTRACE_DB_PATH=/app/data/agenttrace.db`
   - `NODE_ENV=production`
5. Render will build the Dockerfile and manage restarts automatically.

---

## Fly.io

```bash
fly launch --dockerfile Dockerfile --name agenttrace
fly volumes create agenttrace_data --size 5 --region ord
fly deploy
```

Attach the volume and set config:

```bash
fly secrets set AGENTTRACE_DB_PATH=/app/data/agenttrace.db
fly secrets set NODE_ENV=production
```

In the generated `fly.toml`, mount the volume and set the internal port:

```toml
[mounts]
  source = "agenttrace_data"
  destination = "/app/data"

[[services]]
  internal_port = 4317
  protocol = "tcp"
```

Scale to a single VM:

```bash
fly scale count 1
```

---

## Environment Variables

| Variable               | Default              | Description                                   |
|------------------------|----------------------|-----------------------------------------------|
| `AGENTTRACE_DB_PATH`   | `./agenttrace.db`    | Absolute path to the SQLite database file.    |
| `NODE_ENV`             | (unset)              | Set to `production` for production deploys.   |
| `AGENTTRACE_USAGE_LOG` | (unset)              | Optional path for self-tracker usage log.     |

The `--port` and `--host` flags are set via the CLI `dashboard` command (e.g.
`--host 0.0.0.0`). These are not environment variables.

---

## Health Checks

AgentTrace exposes an unauthenticated health endpoint:

```
GET /api/health
```

Response (200):

```json
{
  "status": "healthy",
  "timestamp": "2026-01-15T00:00:00.000Z",
  "uptime": 3600,
  "version": "0.0.0",
  "checks": {
    "database": { "status": "ok", "responseTime": 2 },
    "diskSpace": { "status": "ok", "freeBytes": 123456, "totalBytes": 987654 },
    "memory": { "status": "ok", "usedBytes": 50000000, "totalBytes": 200000000 },
    "activeAgents": 3,
    "totalTraces": 42
  }
}
```

Response (503): returned when the database check fails. The `checks.database`
field will show `"status": "error"`.

Use this endpoint for Docker `HEALTHCHECK`, Kubernetes probes, or any
load-balancer health monitor.

---

## Database Backup

AgentTrace uses a single SQLite file. Back up by copying the database file
while the service is running -- SQLite handles concurrent reads safely.

### Manual backup

```bash
# Docker
docker exec agenttrace sqlite3 /app/data/agenttrace.db ".backup /app/data/backup.db"
docker cp agenttrace:/app/data/backup.db ./agenttrace-backup-$(date +%F).db

# Local
sqlite3 ./agenttrace.db ".backup './agenttrace-backup-$(date +%F).db'"
```

### Automated backup (cron on Linux)

```bash
0 2 * * * sqlite3 /app/data/agenttrace.db ".backup '/app/data/backups/agenttrace-$(date +\%F).db'"
```

Or from a Docker host:

```bash
0 2 * * * docker exec agenttrace sqlite3 /app/data/agenttrace.db ".backup '/app/data/backups/agenttrace-$(date +\%F).db'"
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
# Then restart the container or service
docker restart agenttrace
```

Keep backups on a separate disk or bucket. For disaster recovery, store at
least 7 days of daily backups and verify restoration periodically.
