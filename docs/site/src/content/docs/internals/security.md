---
title: Security
description: AgentTrace security model — privacy-first, local-only, zero telemetry
---

AgentTrace is built on a fundamental principle: **your agent data never leaves your machine**.

## Privacy Model

- **No cloud dependencies** — everything runs locally, using SQLite on your filesystem
- **No telemetry** — AgentTrace does not phone home, collect usage data, or track anything
- **No accounts required** — no signup, no API keys for the core product, no identity verification
- **No network requests** — the SDK makes zero outbound network calls during tracing

## Data Storage

All trace data is stored in a local SQLite database:
- Default location: `~/.agenttrace/traces.db`
- You control where data lives
- Delete the file, delete all data — nothing persists elsewhere
- File permissions follow your OS defaults

## Webhook Security

When using webhooks for external integrations:

1. **HMAC-SHA256 signing** — all webhook payloads are signed with a shared secret
2. **SSRF protection** — webhook URLs are validated to prevent internal network scanning
3. **Fetch timeout** — all webhook calls timeout after 5 seconds
4. **No retry** — failed webhooks are logged but not retried (prevents amplification)

## Multi-Tenancy

When running multiple projects or teams:
- Tenant isolation at the database level
- API keys are scoped to tenants
- No cross-tenant data leakage possible
- Tenant IDs are enforced on all queries

## Dashboard Security

The local dashboard:
- **CORS configured** — only allows local origins by default
- **Body size limited** — 1MB max request body (prevents abuse)
- **No authentication by default** — designed for local use only
- **Set API keys** if exposing the dashboard beyond localhost

## Supply Chain

- **Minimal dependencies** — the SDK has zero runtime dependencies
- **All dependencies audited** — Dependabot enabled for automated vulnerability scanning
- **No install scripts** — the npm packages don't run arbitrary code on install
- **Lockfile committed** — pnpm-lock.yaml ensures reproducible installs

## Reporting Vulnerabilities

See [SECURITY.md](https://github.com/Klepsiphron/agenttrace/blob/main/docs/SECURITY.md) for our vulnerability disclosure policy.
