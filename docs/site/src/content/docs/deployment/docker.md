---
title: Docker
description: Deploy AgentTrace with Docker and Docker Compose.
---

## Single Container

The project includes a multi-stage Alpine Dockerfile. The builder stage installs Node.js 20, Python 3, and native build tools to compile `better-sqlite3` for musl/Alpine. The runner stage copies only built artifacts and production dependencies, producing a ~200 MB image.

### Build and Run

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

The dashboard is available at `http://localhost:4317`.

### View Logs

```bash
docker logs -f agenttrace
```

### Stop and Remove

```bash
docker stop agenttrace
docker rm agenttrace
# Data persists in the agenttrace-data volume
```

## Docker Compose

```bash
docker compose up -d
# Dashboard: http://localhost:4317
```

### Override Port and DB Path

```yaml
services:
  agenttrace:
    ports:
      - '8080:4317'
    environment:
      - AGENTTRACE_DB_PATH=/app/data/agenttrace.db
```

### Tear Down

```bash
# Preserve data
docker compose down

# Delete all data
docker compose down -v
```

## Hardened Configuration

```yaml
services:
  agenttrace:
    ports:
      - '127.0.0.1:4317:4317'  # loopback only
    volumes:
      - agenttrace-data:/app/data
    read-only: true
    user: '1000:1000'
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:size=64M
    environment:
      - AGENTTRACE_DB_PATH=/app/data/agenttrace.db
      - NODE_ENV=production
```

## Railway

1. Connect your GitHub repo at [railway.app](https://railway.app)
2. Set the Dockerfile path to `Dockerfile`
3. Add a persistent volume mount at `/app/data`
4. Set `AGENTTRACE_DB_PATH=/app/data/agenttrace.db` and `NODE_ENV=production`
5. Railway auto-detects port 4317

## Render

1. Create a **Background Worker** service (not Web Service)
2. Set the Dockerfile path to `Dockerfile`
3. Add a persistent disk mount at `/app/data` (minimum 1 GB)
4. Set environment variables for `AGENTTRACE_DB_PATH` and `NODE_ENV`

## Fly.io

```bash
fly launch --dockerfile Dockerfile --name agenttrace
fly volumes create agenttrace_data --size 5 --region ord
fly deploy
fly secrets set AGENTTRACE_DB_PATH=/app/data/agenttrace.db
fly secrets set NODE_ENV=production
fly scale count 1
```
