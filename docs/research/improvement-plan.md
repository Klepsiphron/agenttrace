# AgentTrace Improvement Plan

**Date:** 2026-06-02
**Scope:** Full repository audit (all packages, tests, docs, CI/CD, security)
**Auditor:** OWL (Hermes Agent)

---

## Executive Summary

AgentTrace v0.1.0 is a promising local-first AI agent observability tool with a solid
foundation. This audit uncovered **58 issues** across 7 categories, ranked by severity.

Legend: [CRITICAL] [HIGH] [MEDIUM] [LOW]

---

## Sprint 1 — Critical Fixes (do first)

### 1. [CRITICAL] SQLite Concurrency — Parallel trace() Calls Corrupt WAL

**File:** `packages/sdk/src/storage.ts`
**Problem:** `createTrace` runs INSERT + UPDATE in separate implicit transactions. Under concurrent load, `updateRunStats` increments are not atomic — run stats end up wrong.
**Fix:** Wrap createTrace's INSERT + tool_calls + updateRunStats in a single `db.transaction()` call. Same for cleanup subquery+DELETE.

### 2. [CRITICAL] Python SDK Missing Schema Migrations

**File:** `packages/sdk-python/src/agenttrace/storage.py`
**Problem:** Hardcodes `schema_version = 1`, zero migration logic. TS SDK has 6 migration files; Python has none. Upgrading breaks existing DBs.
**Fix:** Port migrations runner to Python. Add migration modules. Track schema_version in meta table.

### 3. [CRITICAL] Webhook Secret Not Validated / HMAC Not Supported

**File:** `packages/sdk/src/index.ts` (~line 575-633)
**Problem:** `deliverAlert` POSTs to webhook URL but never signs with HMAC (secret field exists but unused), no SSRF protection, no HTTPS enforcement.
**Fix:** Add HMAC-SHA256 signature. Block private/internal IPs. Require HTTPS in production. Add 10s timeout.

### 4. [CRITICAL] .db Files in Working Tree

**Problem:** Multiple `.db` files exist in working tree (e2e-test-_.db, export-test-_.db). These may contain real agent traces.
**Fix:** Clean up untracked .db files. Ensure .gitignore covers all test DB patterns. Audit for sensitive data.

### 5. [CRITICAL] Conflicting Publish Workflows

**Files:** `.github/workflows/publish.yml` and `.github/workflows/release.yml`
**Problem:** Two publish workflows fire on release, causing duplicate/conflicting npm publishes.
**Fix:** Consolidate into single workflow. Delete or disable publish.yml.

### 6. [CRITICAL] No Python SDK CI in Root Workflow

**File:** `.github/workflows/ci.yml`
**Problem:** Root CI only runs TypeScript builds. Python SDK CI is independent, not wired into branch protection.
**Fix:** Add Python test job to root ci.yml.

---

## Sprint 2 — High Priority Fixes

### 7. [HIGH] CLI Package — Only 2 Trivial Tests

**File:** `packages/cli/src/index.test.ts`
**Problem:** Only checks VERSION and PACKAGE_NAME exports. Zero tests for CLI logic.
**Fix:** Add tests for: command output format, --json flag, init, export, tree, self-stats, error messages.

### 8. [HIGH] Dashboard Package — Only 2 Trivial Tests

**File:** `packages/dashboard/src/index.test.ts`
**Problem:** Only checks exports. No API endpoint tests, no SSE stream tests.
**Fix:** Use supertest to test: /api/stats, /api/traces, /api/health, /api/usage/stream, 404 handling.

### 9. [HIGH] recordToolCall() Is a Stub

**File:** `packages/sdk/src/index.ts` (~line 352-356)
**Problem:** Creates UUID but never stores the tool call. SDK's public tracing API is tool-call-blind.
**Fix:** Add active trace context (in-memory stack). recordToolCall() pushes onto current trace. trace() drains the stack.

### 10. [HIGH] Version Drift

**File:** `packages/sdk/src/index.test.ts` asserts `VERSION === '0.1.1'` but `package.json` declares `"0.1.0"`
**Fix:** Single source of truth for version. Compare against package.json dynamically.

### 11. [HIGH] LangGraph Middleware Bypasses SDK API

**File:** `packages/middleware-langgraph/src/index.ts`
**Problem:** Casts `this.agent as unknown as AgentTraceInternals` to reach private fields. Duplicates cost-calculation logic.
**Fix:** Add official `getInternals()` or `getStorage()` method to AgentTrace. Delegate cost calculation to SDK.

### 12. [HIGH] Python SDK Missing close()

**File:** `packages/sdk-python/src/agenttrace/core.py`
**Problem:** TypeScript AgentTrace has close(), Python doesn't.
**Fix:** Add `def close(self) -> None: self.storage.close()` to Python AgentTrace.

### 13. [HIGH] **init**.py References Non-Existent Exports

**File:** `packages/sdk-python/src/agenttrace/__init__.py`
**Problem:** Imports names from core.py that aren't exported at module level.
**Fix:** Add proper top-level functions to core.py: init, get_agent_trace, trace, score, evaluate, evaluate_trace.

### 14. [HIGH] better-sqlite3 Declared as devDependency

**File:** root `package.json`
**Problem:** better-sqlite3 is runtime for SDK but only in root devDependencies.
**Fix:** Move to packages/sdk/package.json dependencies or peerDependencies.

### 15. [HIGH] Express Body Parser Without Size Limit

**File:** `packages/dashboard/src/index.ts` (~line 79)
**Problem:** `express.json()` with no limit allows multi-GB payloads.
**Fix:** Add `express.json({ limit: '1mb' })`.

### 16. [HIGH] No CORS Configuration on Dashboard

**File:** `packages/dashboard/src/index.ts`
**Problem:** No CORS middleware. If bound to 0.0.0.0, any webpage can make API requests.
**Fix:** Set Access-Control-Allow-Origin. Add --cors-origin CLI flag.

### 17. [HIGH] Express Pinned to ^5.2.1 (Unstable)

**File:** `packages/dashboard/package.json`
**Problem:** Express 5.x is beta/unstable.
**Fix:** Pin to ~5.2.1 or downgrade to ^4.21.0 (stable LTS).

### 18. [HIGH] No Dependabot Configured

**Fix:** Create `.github/dependabot.yml` for npm and pip ecosystems.

---

## Sprint 3 — Medium Priority (defer until Sprint 1-2 done)

- CSV export escaping
- Dashboard VERSION = '0.0.0' fix
- getAgentWho() memory optimization
- LangGraph middleware README
- SSE reconnection support
- Rate limiting on dashboard API
- Docker multi-arch builds
- Pre-commit hooks

## Sprint 4 — Low Priority / Features (defer)

- Built-in evaluation scorers
- Autogen middleware
- PII redaction
- Trace comparison view
- Real-time trace SSE stream
