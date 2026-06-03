# AgentTrace Security Audit

**Date:** 2026-06 (current)  
**Auditor:** Internal review (code inspection)  
**Scope:** Local-first tracing library (`@agenttrace/sdk`, `agenttrace` PyPI package, `@agenttrace/dashboard`, `@agenttrace/cli`), storage layer, dashboard server, Docker deployment. No cloud components or telemetry.

**Note:** This document is research / internal only. Do not commit. It identifies real risks for users handling sensitive AI agent data.

---

## Executive Summary

AgentTrace is explicitly designed as a **local-only, zero-telemetry** observability tool. All data stays on the user's machine in a SQLite database. This is a major security advantage over cloud tracing platforms (LangSmith, Langfuse, etc.).

However, the local nature introduces specific risks:

- **High sensitivity of stored data**: Full prompts, LLM outputs, tool I/O, and alert webhook URLs (potentially containing tokens) are persisted verbatim.
- **No authentication** on the local dashboard.
- **Default localhost binding is good**, but easily bypassed and offers no protection on multi-user machines.
- **Limited built-in data lifecycle controls**.

The project already documents basic considerations in `SECURITY.md`. This audit expands on that with concrete findings and actionable recommendations.

---

## 1. Data Stored in SQLite (Sensitive Content)

### 1.1 What gets persisted

Primary storage is a single SQLite file (default `./agenttrace.db`, configurable via `AGENTTRACE_DB_PATH` or `dbPath`).

Key tables (from `packages/sdk/src/storage.ts` and `packages/sdk-python/src/agenttrace/storage.py`):

- **`traces`**:
  - `input TEXT`, `output TEXT` — full prompt payloads and model responses (often the most sensitive).
  - `error TEXT`, `metadata TEXT` (JSON, user-supplied).
  - `name`, model, provider, tokens, cost, latency, etc.
- **`tool_calls`**:
  - `input TEXT`, `output TEXT` — tool arguments and results (can contain PII, file contents, DB queries, etc.).
- **`runs`**:
  - Metadata, rollup stats, user `metadata`.
- **`scores`**, **`alerts`**, **`alert_history`**, **`trace_links`**:
  - Alert configurations store `config TEXT` which includes `webhook` URLs (these can embed secrets, e.g. `https://hooks.example.com/...?token=SECRET123` or basic auth in the URL).
- Other: version tracking, indexes on timestamps/costs.

Both TypeScript and Python implementations use identical schema patterns for core tables. Traces are stored as plain TEXT (JSON-serialized for complex values) with no redaction, encryption, or tokenization of content.

### 1.2 Sensitivity implications

- LLM agent traces routinely contain:
  - User prompts (which may include private documents, PII, credentials accidentally pasted, internal company data).
  - Model outputs (which can hallucinate or echo sensitive context).
  - Tool side-effects (filesystem reads, DB results, API responses that carry auth material).
- Webhook URLs in alerts are stored in the clear inside the `alerts` table. A compromised DB file immediately leaks notification endpoints and any embedded credentials.
- No field-level encryption or "secret scrubbing" hooks exist today.
- The DB uses WAL mode (`journal_mode = WAL`) for performance; this creates `-wal` and `-shm` companion files that must be protected together.

### 1.3 Access model and retention

- **File-based**: Any process/user that can read the `.db` (and companions) has full access. Default file creation permissions are inherited from the process umask (commonly 0644 or 0666 on shared systems).
- **Retention**: `autoCleanup` + `maxTraces` (default 10,000) exists in `AgentTrace` config and storage.cleanup(). It deletes the oldest traces by `created_at` when the count is exceeded. This is count-based only — no time-based retention (e.g., "drop traces older than 30 days"), no policy APIs, and it is opt-in per SDK instance (not enforced at the DB level or by the dashboard).
- Exports (`/api/export`, CLI `export`) can dump everything as JSON/CSV with no filtering of sensitive fields.
- Python side mirrors the same cleanup logic.

**Finding**: SQLite storage of raw prompts/outputs is by design and correctly highlighted in existing `SECURITY.md`, but the volume and nature of sensitive data, combined with webhook secret storage and weak retention controls, elevates the risk.

---

## 2. Dashboard Serves on Localhost Only (Positive Default)

### 2.1 Binding behavior

From `packages/dashboard/src/index.ts`:

```ts
export function startDashboard(config: DashboardConfig = {}) {
  const { port = 4317, host = '127.0.0.1', dbPath } = config;
  ...
  const server = app.listen(port, host, () => { ... });
}
```

- CLI (`packages/cli/src/index.ts`): `agenttrace dashboard [--port N] [--host H]` passes through; host defaults to the dashboard package default.
- In normal local usage (`npx agenttrace dashboard`), the server binds exclusively to `127.0.0.1`.
- This prevents accidental network exposure on a developer's laptop.

### 2.2 Docker / container exception (intentional)

`Dockerfile`:

```dockerfile
# Use --host 0.0.0.0 so it is reachable from outside the container (default is 127.0.0.1)
CMD ["node", "packages/cli/dist/index.js", "dashboard", "--host", "0.0.0.0"]
```

`docker-compose.yml` publishes `4317:4317`.

- Inside a container this is correct (container networking isolation).
- Once the port is published to the host or a public network, the "localhost only" protection disappears.
- Healthcheck inside compose also uses localhost (container-local).

### 2.3 Other exposure vectors

- Users can (and will) pass `--host 0.0.0.0` or `0.0.0.0` for remote access or in VMs/CI.
- No warning is emitted when a non-localhost bind is used.
- The dashboard uses plain HTTP (no TLS termination, no HSTS, etc.).
- Static frontend + all `/api/*` routes are served identically.

**Finding**: The localhost default is a strong, correct choice for the primary use case (solo developer local debugging). The Docker override is documented and reasonable. However, the lack of any runtime warning or "are you sure?" when binding to all interfaces is a minor gap.

---

## 3. No Authentication on Dashboard (Risk for Shared Machines)

### 3.1 Current state

`createDashboardApp` (and thus the started server) registers routes with zero middleware for auth:

- `/api/stats`, `/api/runs`, `/api/traces`, `/api/traces/:id`, `/api/traces/:id/tree`, `/api/costs`, `/api/export`, `/api/health`, static assets, SPA fallback.
- `express.json()` body parser only.
- No `Authorization`, basic auth, bearer token, API key, session, or origin checks.
- The frontend (`public/app.js`) performs unauthenticated `fetch` calls.

Any HTTP client that can reach the bound address can:
- List all runs and traces.
- Read full `input`/`output` content (the sensitive payloads).
- Trigger exports.
- (Future) interact with any new POST/PUT routes.

### 3.2 Threat scenarios

1. **Shared workstation / multi-user host**: Multiple engineers on one machine (common in some labs, pair programming setups, or university machines). Process A runs `agenttrace dashboard` as user `alice`; user `bob` (same UID group or via localhost) opens `http://127.0.0.1:4317` and reads Alice's agent prompts/outputs containing customer data.
2. **Docker published port on a multi-tenant host or CI runner**: The published port becomes reachable from other containers or the host network namespace.
3. **Remote desktop / VNC / SSH forwarding accidents**: Port forward or X11 forwarding can expose the loopback listener to the remote user.
4. **Malware / compromised user account on the same host**: Local attacker process binds or connects to 127.0.0.1 easily.
5. **Future cloud / shared dev container environments**: Codespaces, GitHub devcontainers, Gitpod, etc., often have multiple users or exposed ports.

### 3.3 Related gaps

- No rate limiting or request logging beyond console.
- No read-only vs. mutating distinction (currently mostly GETs; alerts registration happens via SDK, not dashboard).
- The underlying `TraceStorage` / `AgentTrace` instance is created inside the dashboard with full read access.

**Finding**: Absence of auth is the most significant runtime risk for the dashboard component. The "localhost only" default mitigates for pure single-user laptops but is insufficient on shared or containerized systems. Existing `SECURITY.md` already notes "No authentication on dashboard (risk for shared machines)" in spirit; this audit confirms it is accurate and unmitigated.

---

## 4. Other Observations

- **No telemetry / external calls from core SDK**: Confirmed (good). Dashboard and CLI make no outbound calls except when user-configured alert webhooks fire.
- **Python SDK**: Storage identical in sensitivity. No dashboard server (uses the Node one or direct DB access).
- **Dependencies**: Relies on `better-sqlite3`, `express`, `node-fetch` (in alerts). No known vulnerable patterns in the tracing path, but users should keep the packages updated.
- **OTEL export path**: Generates spans from stored data; same sensitivity.
- **Test / temp DBs**: Many `*.db` files appear in the tree during development; `.gitignore` and CONTRIBUTING.md correctly warn against committing them.
- **Metadata / scores**: User can attach arbitrary data; nothing prevents putting secrets here.

---

## Recommendations

### R1. Optional Authentication for Dashboard

- Add support for simple optional auth in `DashboardConfig` and CLI flags:
  - `--auth-token <token>` (bearer-style header `Authorization: Bearer <token>` or query param for ease).
  - Or lightweight basic auth (`--basic-auth user:pass`).
  - When not supplied, continue with current open behavior (backwards compatible for local dev).
- Enforce in a small middleware applied to all non-health routes (or all routes).
- Document the flag prominently; emit a startup warning: "Dashboard running with NO authentication. Use --auth-token for shared environments."
- Consider a simple cookie/session variant later if a "login" flow is desired, but token is sufficient for local tools.
- Python parity not required immediately (no server), but note the risk for any future server components.

### R2. Data Retention Policies

- Expose time-based retention in addition to the existing count-based `maxTraces`:
  - `AgentTrace` config: `retentionDays?: number` or `maxAgeMs`.
  - Storage layer: `pruneOlderThan(timestamp)` or integrated into cleanup.
  - CLI: `agenttrace prune --older-than 30d` (or similar).
  - Dashboard: optional UI trigger or config to run prune on start.
- Make retention enforceable at the `AgentTrace` constructor level (auto-prune on init + on write, or background).
- Document trade-offs (lost history for long-running evals vs. reduced sensitive data surface).
- Consider per-run retention or "pin" flags for important runs (future).

### R3. Encryption at Rest Option

- Provide an opt-in encryption path for the SQLite file:
  - Short term: Document strong OS-level recommendations (FileVault, BitLocker, LUKS, VeraCrypt volumes for the data dir, or `chmod 600` + umask 077).
  - Medium term: Support `sqlcipher` (better-sqlite3 has community builds / `better-sqlite3-multiple-ciphers`) when user supplies a key. Expose `encryptionKey` (or derive from passphrase) in `TraceConfig`.
  - Alternative: Transparent page-level encryption via extensions or wrapper library.
- Mark encrypted DBs with a schema flag so the loader can require the key.
- For alerts: never log webhook URLs at startup; consider a small obfuscation or separate "secrets" table (low priority).
- Clearly document that encryption is **not** a substitute for proper access control and retention.

### R4. Document Security Best Practices

- Expand `SECURITY.md` (see companion update) and add a "Security" section to README.md / getting-started tutorial.
- Recommended practices to document:
  - Run with strict umask / `chmod 600 agenttrace.db*` on multi-user machines.
  - Prefer Docker with volume permissions and non-published ports unless isolated.
  - Use `maxTraces` + new retention policies aggressively when handling PII.
  - Avoid putting raw secrets in prompts; use redaction middleware or post-processing before calling traced LLM functions.
  - Do not run the dashboard with `--host 0.0.0.0` on untrusted networks without auth + TLS (e.g., put behind nginx/caddy with mTLS or auth).
  - Periodically `agenttrace export` + delete the DB, or use separate DBs per project/sensitivity level.
  - Treat the DB file like a log file containing application secrets.
  - When using alerts, prefer webhooks that use short-lived tokens or mTLS rather than embedding long-lived secrets in the URL.
- Add a startup banner in the dashboard and CLI when sensitive features are active (e.g., "This database may contain prompts and outputs — protect the file").
- Add a `SECURITY.md` link from the root README and docs-site.

### Additional / Nice-to-have

- Runtime warning when binding to non-localhost addresses.
- Optional trace redaction hooks (e.g., `beforeStore: (trace) => sanitize(trace)` in config).
- Audit log for dashboard access (even unauthenticated) — at least a startup + request count.
- Consider making the health endpoint the only unauthenticated route by default.
- For enterprise roadmap items (already in ROADMAP.md): SSO/SAML would address the shared / server use case.

---

## Conclusion

AgentTrace's local-first, no-cloud architecture is a deliberate and strong security posture for many AI agent developers. The primary risks are **not** network exfiltration or supply-chain telemetry, but rather **local data exposure** on the developer's own machine or container environment due to the sensitivity of captured prompts/outputs and the lack of auth on the convenience dashboard.

Implementing the four recommendations (optional auth, richer retention, at-rest encryption option, and explicit best-practice docs) would bring the tool to a mature security baseline suitable for teams handling regulated or customer data while preserving the excellent zero-friction local experience.

---

**References (code locations)**

- Dashboard server: `packages/dashboard/src/index.ts:200` (host default), `packages/dashboard/src/index.ts:29` (app creation, no auth)
- Storage schema & sensitive columns: `packages/sdk/src/storage.ts:50` (traces), `72` (tool_calls), `104` (alerts)
- Cleanup: `packages/sdk/src/storage.ts:706`, `packages/sdk/src/index.ts:215`
- CLI dashboard: `packages/cli/src/index.ts:303`
- Docker exposure: `Dockerfile:79`, `docker-compose.yml:9`
- Python storage: `packages/sdk-python/src/agenttrace/storage.py:62` (identical fields)
- Existing policy: `SECURITY.md`, `CONTRIBUTING.md:74`
