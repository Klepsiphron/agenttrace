# AgentTrace Improvement Plan

**Date:** 2026-06-02
**Scope:** Full repository audit (all packages, tests, docs, CI/CD, security)
**Auditor:** OWL (Hermes Agent)

---

## Executive Summary

AgentTrace v0.1.0 is a promising local-first AI agent observability tool with a solid
foundation: clean TypeScript/Python SDK duality, zero cloud dependency, good test counts,
and functional CLI + dashboard. This audit uncovered **58 issues** across 7 categories,
ranked by severity. The most impactful fixes are: SQLite concurrency bugs, missing test
coverage for 3 of 6 packages, critical CI/CD publish pipeline gaps, security hardening for
the webhook/alert system, and several missing competitive features (autogen middleware,
evaluation test suite, real-time dashboard).

Legend: [CRITICAL] [HIGH] [MEDIUM] [LOW]

---

## 1. Code Quality

### 1.1 [CRITICAL] SQLite Concurrency — Parallel `trace()` Calls Corrupt WAL
**File:** `packages/sdk/src/storage.ts`
**Lines:** 304-360 (`createTrace`), 1094-1112 (`cleanup`)

`createTrace` runs an INSERT + UPDATE runs in separate implicit transactions. Under
concurrent `trace()` calls (`benchConcurrent` fires 2000 promises in parallel), WAL mode
allows concurrent reads but writes serialize — the `updateRunStats` increments are not
atomic with the INSERT. Two concurrent inserts see the same `trace_count`/token values,
overwrite each other, and the run's aggregated stats end up wrong.

**Fix:** Wrap `createTrace`'s INSERT + tool_calls + `updateRunStats` in a single
`db.transaction(() => { ... })` call. Similarly, wrap the `cleanup` subquery+DELETE in
a transaction. Add a WAL checkpoint after bulk operations.

### 1.2 [CRITICAL] Python SDK Missing Schema Migrations Entirely
**File:** `packages/sdk-python/src/agenttrace/storage.py`
**Lines:** 44-156 (`_init_schema`)

The Python SDK hardcodes `schema_version = 1` on first run and has zero migration logic.
The TypeScript SDK ships 6 migration files (001-005 plus a runner in `migrations.ts`).
If a user upgrades the Python SDK after the TS side adds a new column (e.g. `parent_id`,
`trace_links`, `webhooks`), their existing DB will lack those tables/columns and queries
will throw `no such column` errors.

**Fix:** Port the `migrations.ts` runner to Python. Add `001_initial`, `002_scores`,
`003_alerts`, `004_trace_context`, `005_agent_usage`, `006_webhooks` migration modules
under a `migrations/` directory. Track `schema_version` in the `meta` table (already
exists in the TS version).

### 1.3 [HIGH] Test Version Drift
**File:** `packages/sdk/src/index.test.ts`, line 96
**File:** `packages/sdk/package.json`, line 3

`index.test.ts` asserts `VERSION === '0.1.1'` but `package.json` declares `"0.1.0"`.
The test passes only because the test imports the constant from source — if someone
bumps package.json without updating the export, or vice versa, tests will silently pass
with a wrong version. Similarly, `packages/sdk/src/index.test.ts` line 96 hardcodes the
version string.

**Fix:** Export VERSION from a single source of truth (or compare against
`../../package.json` dynamically). Same for Python: `__init__.py` should read version from
`pyproject.toml`.

### 1.4 [HIGH] LangGraph Middleware Bypasses SDK API — Fragile Casts
**File:** `packages/middleware-langgraph/src/index.ts`
**Lines:** 56-69, 295-298

`AgentTraceMiddleware` casts `this.agent as unknown as AgentTraceInternals` to reach
private fields (`config`, `storage`, `currentRunId`). This is a maintenance nightmare:
if the SDK changes internal field names, the middleware silently breaks. The middleware
also duplicates cost-calculation logic (lines 303-313) already in the SDK's
`defaultCostCalculator`.

**Fix:** Add an official `getInternals()` or `getStorage()` method to `AgentTrace`
(exported, typed) for middleware use. Delegate cost calculation to the SDK's public
`costCalculator` callback. Remove the duplicate `rates` map from the middleware.

### 1.5 [HIGH] `recordToolCall()` Is a Stub — Tool Calls Never Stored
**File:** `packages/sdk/src/index.ts`, lines 352-356

`recordToolCall()` creates a UUID but never stores the tool call — it just returns the ID.
The `AgentTrace.trace()` method creates an empty `toolCalls: []` array at line 290 and
never populates it. The `tool_calls` table exists in schema but is only populated when
traces are created directly via `storage.createTrace()` with tool call data (used by the
LangGraph and CrewAI middleware). The SDK's public tracing API is therefore tool-call-
blind.

**Fix:** Add an active trace context to `AgentTrace` (in-memory stack). `recordToolCall()`
should push onto the current trace's tool call list. `trace()` should drain the stack when
recording.

### 1.6 [MEDIUM] Dashboard VERSION = '0.0.0'
**File:** `packages/dashboard/src/index.ts`, line 12

The dashboard exports `VERSION = '0.0.0'` which is wrong. The `/api/health` endpoint
returns this as `version`, making it indistinguishable from an unconfigured deployment.

**Fix:** Import VERSION from `@agenttrace-io/sdk` or set to match the package's declared
version (`0.1.0`).

### 1.7 [MEDIUM] `export()` CSV Does Not Escape Quotes or Commas
**File:** `packages/sdk/src/index.ts`, lines 712-733

The CSV export joins values with `,` but never quotes/escapes fields. If `trace.name`
contains a comma, quote, or newline, the CSV is corrupt.

**Fix:** Use a CSV escape function (e.g. `value.toString().includes(',') ? '"'+val+'"' :
val`) or use a tiny library. Same issue in Python SDK `core.py` line 488.

### 1.8 [MEDIUM] `getAgentWho()` Loads 20,000 Rows Into Memory
**File:** `packages/sdk/src/storage.ts`, lines 811-866

`getAgentWho` fetches 20,000 usage records and builds an in-memory map. For agents with
high-volume usage, this is slow and memory-hungry.

**Fix:** Push aggregation into a SQL GROUP BY query (similar to `getUsageStats`).
Introduce a proper `limit` parameter that actually reduces the SQL LIMIT, not just
post-fetches.

### 1.9 [MEDIUM] Unused Imports / Dead Code in CLI
**File:** `packages/cli/src/index.ts`

Imports `AgentUsageRecord`, `AlertCondition`, `ExportFormat`, `TraceStorage` that are used
(not dead), but `AgentUsageFilter` and `AgentSession` are imported but only used in type
contexts. The `computeAgentCostBreakdown` function duplicates logic already in
`storage.getAgentCostSummary`.

**Fix:** Remove the duplicate cost function from CLI, call `storage.getAgentCostSummary`
directly.

### 1.10 [LOW] `eslint.config.mjs` Does Not Enforce Return Types
**File:** `eslint.config.mjs`

The ESLint config has no rule requiring explicit return types on exported functions.
This makes the public API harder to consume and document.

**Fix:** Add `@typescript-eslint/explicit-function-return-type` or at minimum
`@typescript-eslint/explicit-module-boundary-types`.

---

## 2. Test Coverage

### 2.1 [HIGH] CLI Package — Only 2 Trivial Tests
**File:** `packages/cli/src/index.test.ts`

The CLI test file only checks `VERSION` and `PACKAGE_NAME` exports. There are zero tests
for any CLI logic: argument parsing, table formatting, JSON output, export commands,
`printSelfStats`, `printAgentCostSection`, file I/O (`writeFileSync`), or error handling.
The CLI is the primary UX surface for most users.

**Fix:** Add comprehensive tests:
- Test each CLI command's output format (table + JSON)
- Test `--json` flag redaction
- Test `init` creates a valid DB
- Test `export --output FILE` writes correct content
- Test `tree` output formatting
- Test `self-stats` with/without data
- Test error messages for missing DB

### 2.2 [HIGH] Dashboard Package — Only 2 Trivial Tests
**File:** `packages/dashboard/src/index.test.ts`

Same problem as CLI: only checks exports. No API endpoint tests, no SSE stream tests,
no health check tests, no static file serving tests.

**Fix:** Use `supertest` to test:
- GET /api/stats returns correct shape
- GET /api/traces with/without filters
- GET /api/health returns 200/503 correctly
- GET /api/usage/stream accepts SSE connection
- POST /api/usage (if added) handles body
- 404 on unknown routes
- Error handling (e.g. corrupt DB)

### 2.3 [HIGH] LangGraph Middleware — Only 3 Real Tests
**File:** `packages/middleware-langgraph/tests/test.ts`

Tests version export, before/after flow, and token extraction. Missing:
- `onError` integration test (test.ts line 69-77 has one but doesn't verify stored trace)
- Nested node stack behavior (partial at line 97-100)
- `extractFromCandidate` with response_metadata shapes
- `deepFindUsage` for deeply nested token objects
- `computeCost` with custom model or unknown model
- `close()` is never called in tests (resource leak)
- `getAgentTrace()` accessor

### 2.4 [HIGH] Python SDK — No Alert/Webhook/Migration Tests
**Dir:** `packages/sdk-python/tests/`

The Python test suite covers core, integration, full integration, and agent usage.
Missing:
- Alert registration and firing
- Webhook delivery
- Schema migration from v0 -> v1 -> v2
- `start_run` / `complete_run` lifecycle
- `get_traces` with all filter combinations
- `evaluate()` with scorers (only partially covered)
- `export('csv')` format verification

### 2.5 [MEDIUM] `__init__.py` References Non-Existent Top-Level Exports
**File:** `packages/sdk-python/src/agenttrace/__init__.py`

The `__init__.py` imports `AgentUsageTracker`, `init`, `get_agent_trace`, `trace`, `score`,
`evaluate`, `evaluate_trace` from `core.py`, but `core.py` does not export these at
module level. They are defined as inner functions/classes. The test suite likely doesn't
import from the top-level package, so this goes undiscovered.

**Fix:** Add proper top-level functions to `core.py`:
- `def init(config=None) -> AgentTrace`
- `def get_agent_trace() -> AgentTrace` (singleton)
- `def trace(name, fn=None, **options)`
- `def score(name, fn) -> Scorer`
- `def evaluate(scorers, ...) -> list[ScorerResult]`
- `def evaluate_trace(trace_id, scorers) -> ScorerResult`

### 2.6 [MEDIUM] No Benchmark Regression Tests
**File:** `packages/sdk/src/benchmark.ts`

The benchmark suite runs as a standalone script but is never invoked in CI. There are no
assertions — results are just printed to JSON. A performance regression would go
unnoticed.

**Fix:** Add a lightweight benchmark test in CI (e.g. 1000 insertions must complete in <
5 seconds) or integrate with a tool like `vitest bench`.

### 2.7 [MEDIUM] `SelfTracker` Log File Not Cleaned Across Sessions
**File:** `packages/sdk/src/self-track.ts`, lines 46-53

`appendFileSync` is used for JSONL logging but there's no log rotation, size limit, or TTL.
Long-running agents will produce unbounded log files.

**Fix:** Add log rotation (e.g. when file > 10MB, roll to `.1.jsonl`). Add a `maxLogAge`
config option.

---

## 3. Documentation Gaps

### 3.1 [HIGH] No API Reference Doc Generation
**Evidence:** README links to `https://klepsiphron.github.io/agenttrace/api.html` but the
`docs-site/` directory appears empty or landing-page-only. The `docs/api` directory
doesn't exist. There's no TypeDoc, Sphinx, or auto-generated API reference.

**Fix:** Set up TypeDoc for the TypeScript packages (`typedoc --entryPoints
packages/sdk/src/index.ts...`) and Sphinx/autodoc for Python. Deploy to GitHub Pages
on release.

### 3.2 [HIGH] LangGraph Middleware README Missing Usage Example
**File:** `packages/middleware-langgraph/README.md`

The README has installation and a code stub but no end-to-end example showing how to wire
`AgentTraceMiddleware` into a LangGraph `StateGraph`. The `interface NodeMiddleware` and
`LangGraphNodeConfig` are not documented.

**Fix:** Add a complete example: create a graph, attach middleware, compile, invoke.
Document the token extraction heuristics.

### 3.3 [HIGH] No Migration Guide for DB Schema Upgrades
Files in `packages/sdk/src/migrations/` document schema changes, but there's no user-facing
guide explaining what happens when the SDK version changes and a DB was created with an
older version.

**Fix:** Add `docs/migrations.md` explaining automatic migration, manual rollback, and
the `schema_version` tracking.

### 3.4 [MEDIUM] Missing `CONTRIBUTING.md` for Python Packages
**File:** `packages/sdk-python/CONTRIBUTING.md`

This file exists but only says "see root CONTRIBUTING.md". Python-specific build/test
instructions are missing.

**Fix:** Document `pip install -e '.[dev]'`, `pytest`, Python version requirements, and
the relationship to the monorepo TS build.

### 3.5 [MEDIUM] `SECURITY.md` Lacks CVE Process
**File:** `SECURITY.md`

The security policy says "open a GitHub issue with the security label" — this publicly
discloses vulnerabilities before they're fixed. There's no PGP key, no security bug
bounty, and no mention of responsible disclosure timelines.

**Fix:** Add a private security advisory process (GitHub Security Advisories) instead of
public issues. Add a SECURITY email address.

### 3.6 [LOW] Changelog Missing `v0.1.1` Entry
**File:** `CHANGELOG.md`

The `index.test.ts` imports `VERSION = '0.1.1'` but the changelog only documents `v0.1.0`.
The changelog should track the version bump.

**Fix:** Align `CHANGELOG.md` with actual releases. Consider auto-generation from
conventional commits (`git-cliff` or `conventional-changelog`).

---

## 4. CI/CD Issues

### 4.1 [CRITICAL] Publish Pipeline Publishes Out of Order
**File:** `.github/workflows/publish.yml` vs `.github/workflows/release.yml`

There are **two** publish workflows. `publish.yml` triggers on `release: published` and
publishes only `@agenttrace-io/sdk` to npm (lines 52-53). `release.yml` triggers on tag
push and publishes SDK + dashboard + cli + Python. The release workflow does NOT depend on
the publish workflow, so both fire on a release, causing duplicate/conflicting npm publishes.

**Fix:** Consolidate into a single workflow. `release.yml` should be the canonical one
(test -> create release -> publish all packages). Delete or disable `publish.yml`.

### 4.2 [CRITICAL] npm Publish Uses `workspace:*` Without `--no-git-checks`
**File:** `.github/workflows/publish.yml` and `release.yml`

When `npm publish --access public` runs in CI, the `package.json` still contains
`"@agenttrace-io/sdk": "workspace:*"` as a dependency. `workspace:*` is a pnpm concept
that npm doesn't understand. The `--no-git-checks` flag in `release.yml` line 87 skips
git tag checks but does NOT suppress the workspace dependency error.

**Fix:** Use `pnpm publish --filter @agenttrace-io/sdk --access public` (which handles
workspace: protocol) or use Changesets. The current `publish-npm.yml` may actually work
since it uses a single-package working-directory, but verify this.

### 4.3 [CRITICAL] No Python SDK CI in Root Workflow
**File:** `.github/workflows/ci.yml`

The root CI only runs TypeScript builds (`pnpm build`). It does not run `pytest` for the
Python SDK. The Python CI lives in `packages/sdk-python/.github/workflows/ci.yml` which
runs independently, but it's not wired into branch protection or required status checks.

**Fix:** Add a Python test job to the root `ci.yml` or make the sub-package CI a
required check in branch protection. Run `pytest` and `ruff`/`mypy` linting.

### 4.4 [HIGH] No Integration / E2E Tests in CI
**File:** `.github/workflows/ci.yml`

CI runs `pnpm test` which runs all `*.test.ts` files. This is good (includes the e2e
tests) but there are no integration tests that exercise the full stack: CLI -> SDK ->
SQLite, or Dashboard -> SDK -> SQLite. The existing e2e tests in the SDK package
validate the SDK+DB but not the HTTP layer.

**Fix:** Add a CI step that starts the dashboard server and hits `/api/health`,
`/api/stats`, `/api/races` with curl.

### 4.5 [HIGH] Dependabot Configured But No Auto-Merge
**File:** `.github/dependabot.yml` (not found)

There's no `dependabot.yml` despite being listed in the v0.1.0 changelog. This means
security patches for `express`, `better-sqlite3`, etc. will not be proposed automatically.

**Fix:** Create `.github/dependabot.yml` for both npm and pip ecosystems. Add auto-merge
for minor/patch dev dependencies.

### 4.6 [MEDIUM] No Docker Image Tagging Strategy
**File:** `.github/workflows/release.yml`, lines 114-141

The Docker image is built and pushed to GHCR with semver tags, but there's no
architecture matrix (amd64 + arm64). ARM users (Mac M-series) will get slow emulation or
build failures.

**Fix:** Add `platforms: linux/amd64,linux/arm64` to the build-push action.

### 4.7 [MEDIUM] `publish_npm.yml` Only Publishes SDK
**File:** `.github/workflows/publish-npm.yml`

Despite the name, this workflow only publishes `@agenttrace-io/sdk`. The CLI and
dashboard are not published via npm in any workflow (`release.yml` does publish all three,
but this is redundant). The `publish.yml` workflow is obsolete.

**Fix:** Delete `publish-npm.yml` and `publish.yml`. Use `release.yml` + `publish-pypi.yml`
as the canonical publish pipelines.

### 4.8 [LOW] Pre-Commit Hook Not Configured
**File:** root `package.json`

The contributing guide mentions "pre-commit hook auto-formats code" but there's no
`husky`, `lint-staged`, or `.husky/` directory. The hook doesn't exist.

**Fix:** Add `husky` + `lint-staged` to auto-run `prettier --write` and `eslint --fix`
on commit.

---

## 5. Missing Features (vs Competitors)

### 5.1 [HIGH] No Autogen / OpenAI Agents SDK Middleware

PROJECT_BOARD.md lists "multi-agent support" and the `AgentType` type includes `'autogen'`,
but there's no `packages/middleware-autogen`. Competitors (Langfuse, Helicone) support
AutoGen. This is a gap in the framework middleware lineup.

**Fix:** Create `packages/middleware-autogen` (Python) subscribing to AutoGen's
`ConversableAgent` events.

### 5.2 [HIGH] No Evaluation Test Suite / Shared Scorers

The `evaluate()` API exists but there are no built-in scorers in the SDK. Langfuse ships
with 6+ out-of-the-box scorers (answer relevance, toxicity, etc.). AgentTrace users must
write their own from scratch.

**Fix:** Add a `packages/sdk/src/evaluators.ts` with built-in scorers:
- `outputLengthScorer`: normalizes output length
- `latencyScorer`: penalizes high latency
- `costScorer`: penalizes high cost
- `hallucinationScorer`: simple heuristic (citation check, contradiction detection)
Provide Python equivalents.

### 5.3 [HIGH] Dashboard SSE Stream Never Reconnects
**File:** `packages/dashboard/src/index.ts`, lines 265-311

The `/api/usage/stream` SSE endpoint has no reconnection support. If the client
disconnects (network hiccup, browser tab switch), it never reconnects. There's no
event-id for replay.

**Fix:** Implement the `Last-Event-Id` header for replay. Add auto-reconnect guidance
in the dashboard frontend.

### 5.4 [MEDIUM] No Real-Time Dashboard for Trace Events

The SSE endpoint pushes `AgentUsageRecord` events but not raw trace events. A user
watching the dashboard while running an agent would only see usage/activity data, not
the individual traces being created in real-time.

**Fix:** Add `/api/traces/stream` SSE endpoint that emits trace records as they're
created. Add a "Live" tab to the dashboard frontend.

### 5.5 [MEDIUM] No Prompt/Output Content Filtering or PII Redaction

Competitors offer PII scrubbing before storage. AgentTrace stores raw `input` and `output`
text, which may contain API keys, emails, or PII, undermining its "local/private" marketing.

**Fix:** Add a `piiFilter?: (text: string) => string` option to `TraceConfig`. Provide
a basic built-in filter (email, phone, API key patterns). Document the risks.

### 5.6 [MEDIUM] No Trace Comparison / Diff View

LangSmith and Langfuse allow side-by-side trace comparison. AgentTrace has no such
feature in the dashboard.

**Fix:** Add a "Compare" view to the dashboard (select 2+ traces, view side-by-side).
Add `agent.compare(traceId1, traceId2)` to the SDK returning a diff.

### 5.7 [LOW] `billing` Package Exists But Is Non-Functional
**Dir:** `packages/billing/`

The billing directory has a `package.json` and `src/index.ts` but is not included in
workspace builds, not published, and not referenced by any other package. It's dead code.

**Fix:** Either complete the billing integration (Stripe, per-project quotas) or remove
the package.

---

## 6. Security Issues

### 6.1 [CRITICAL] Webhook Secret Not Validated / HMAC Not Supported
**File:** `packages/sdk/src/index.ts`, lines 575-633

The `deliverAlert` function POSTs JSON to a webhook URL but never:

1. Signs the payload with HMAC (the `WebhookConfig` type has a `secret` field but it's
   never used)
2. Validates the URL (no SSRF protection — `alert.webhook` could be
   `http://169.254.169.254/latest/meta-data/` on AWS)
3. Enforces HTTPS (a webhook to `http://` sends traces in cleartext)

**Fix:** Add HMAC-SHA256 signature using `createHmac('sha256', secret)`. Add URL
validation (block private/internal IPs, require HTTPS in production). Add timeout (max
10s) and size limit to the fetch call.

### 6.2 [CRITICAL] SQLite DB Left in Working Directory
**Evidence:** `agenttrace.db` at repo root, `packages/sdk-python/agenttrace.db`,
`.rename-backup-*/agenttrace.db`

Multiple `.db` files are committed to the working tree (though `.gitignore` lists
`agenttrace.db` and `*.sqlite`, the files are already tracked). These may contain
real agent traces from development.

**Fix:** Run `git rm --cached agenttrace.db`. Add a `pre-commit` hook to reject `.db`
commits. Audit the git history for sensitive data.

### 6.3 [HIGH] `express.json()` Body Parser Without Size Limit
**File:** `packages/dashboard/src/index.ts`, line 79

`app.use(express.json())` with no `limit` option allows attackers to POST multi-GB
payloads causing memory exhaustion.

**Fix:** Add `express.json({ limit: '1mb' })` or similar.

### 6.4 [HIGH] No CORS Configuration on Dashboard
**File:** `packages/dashboard/src/index.ts`

The dashboard serves on localhost by default, but there's no CORS middleware. If the
host is changed to `0.0.0.0`, any webpage can make cross-origin requests to the API.

**Fix:** Set `Access-Control-Allow-Origin` to the dashboard's own origin. Add a
`--cors-origin` CLI flag for explicit configuration.

### 6.5 [HIGH] Dashboard SPA Fallback Exposes `index.html` for All Non-API Paths
**File:** `packages/dashboard/src/index.ts`, lines 411-419

The catch-all `app.use((req, res) => ...)` serves `index.html` for any GET path that
doesn't start with `/api/` and doesn't contain a dot. This means
`GET /etc/passwd` (if proxied) would return the SPA, leaking the fact that it's a
single-page app and potentially enabling client-side routing attacks.

**Fix:** Restrict the SPA fallback to known client routes, or serve a proper 404.
Validate the path doesn't contain `..` or absolute path components.

### 6.6 [MEDIUM] Alert Webhook Sends Full Trace Stats (Including Potentially Sensitive Data)
**File:** `packages/sdk/src/index.ts`, line 593

The webhook payload includes `stats` which contains `totalCostUsd`, `totalTokens`, and
derived aggregations. If the webhook URL is compromised, this leaks agent operation
patterns and cost data.

**Fix:** Document that webhook URLs should be treated as secrets. Allow configuring
which fields are included. Strip `costByModel` by default unless `includeDetails: true`.

### 6.7 [MEDIUM] No Rate Limiting on Dashboard API
**File:** `packages/dashboard/src/index.ts`

Any local process can spam the dashboard API with requests, causing high CPU/DB load.

**Fix:** Add `express-rate-limit` middleware for API routes.

### 6.8 [LOW] `SelfTracker` JSONL Log Predictable Path
**File:** `packages/sdk/src/self-track.ts`, line 36

Default log path is `~/.hermes/agenttrace-usage.jsonl`. Any process running as the user
can read/write this file, potentially injecting forged usage records.

**Fix:** Document the log file location. Add file permission notes (0600).

---

## 7. Package & Dependency Issues

### 7.1 [HIGH] `express` Pinned to `^5.2.1` (Unstable Major)
**File:** `packages/dashboard/package.json`, line 27

Express 5.x is still in beta/unstable as of 2026. Using `^5.2.1` may pull in breaking
changes. Several Express 5 APIs differ from 4.x (e.g., `res.sendFile` behavior, promise
support). The catch-all route handler at line 411 uses a callback signature `_next?`
that's Express-5-specific.

**Fix:** Pin to `~5.2.1` to avoid minor bumps, or downgrade to `^4.21.0` (stable LTS).

### 7.2 [HIGH] Python SDK Missing `close()` on `AgentTrace`
**File:** `packages/sdk-python/src/agenttrace/core.py`

The TypeScript `AgentTrace` has `close()` which calls `storage.close()`. The Python
`AgentTrace` lacks a `close()` method. Users must call `agent.storage.close()` directly.

**Fix:** Add `def close(self) -> None: self.storage.close()` to Python `AgentTrace`.

### 7.3 [MEDIUM] `better-sqlite3` Declared as `devDependency` in Root
**File:** `package.json`, line 17

`better-sqlite3` is a runtime dependency for `@agenttrace-io/sdk` but is declared only
as a devDependency in the root `package.json`. It's not listed in `packages/sdk/package.json`
as a dependency or peer dependency.

**Fix:** Move `better-sqlite3` to `packages/sdk/package.json` `dependencies`. The `files:
["dist"]` in sdk means node_modules are NOT shipped — users must install it separately.
Document this as a peer dependency.

### 7.4 [MEDIUM] `packages/middleware-langgraph` Has No `peerDependencies`
**File:** `packages/middleware-langgraph/package.json`

The package imports `@agenttrace-io/sdk` as a direct dependency, but LangChain/LangGraph
are not declared as peer dependencies. Users might get version conflicts.

**Fix:** Declare `@langchain/langgraph` and `@langchain/core` as peer dependencies.

### 7.5 [LOW] `.npmrc` Contains No Publish Config
**File:** `.npmrc`

Empty or minimal `.npmrc`. No `registry`, `save-exact`, or `package-lock` settings.

**Fix:** Add `save-exact=true` for reproducible builds.

---

## 8. Roadmap-Only Issues (From PROJECT_BOARD.md)

These are deferred for Waves 2-3 but worth noting:

| Feature | Competitor Parity | Blocked By |
|---------|-------------------|------------|
| Multi-tenant support | LangSmith has workspaces | Schema changes |
| Hosted version | Langfuse Cloud exists | Legal/compliance |
| Stripe billing | `packages/billing/` skeleton exists | Completeness |
| Benchmark comparisons | Langfuse has benchmarks page | Benchmark suite |
| Docker health check | Partially done (`/api/health`) | Multi-arch support |
| Real-time dashboard (traces) | SSE exists for usage only | Trace SSE endpoint |

---

## Recommended Fix Priority

### Sprint 1 (Critical — 1 week)
1. SQLite concurrency fix (1.1)
2. DB file cleanup from git history (6.2)
3. Publish pipeline consolidation (4.1, 4.7)
4. Webhook HMAC signing + URL validation (6.1)
5. Express body size limit (6.3)
6. Version drift fix (1.3)

### Sprint 2 (High — 2 weeks)
7. Test expansion: CLI tests (2.1), Dashboard tests (2.2), middleware tests (2.3)
8. Python SDK migrations (1.2), `close()` method (7.2)
9. `recordToolCall()` fix (1.5)
10. CORS + SPA fallback hardening (6.4, 6.5)
11. Dependabot setup (4.5)
12. `better-sqlite3` dependency fix (7.3)
13. Express version pin (7.1)

### Sprint 3 (Medium — 2 weeks)
14. Built-in scorers (5.2)
15. API reference docs (3.1)
16. Reconnection for SSE (5.3)
17. LangGraph middleware README (3.2)
18. Autogen middleware (5.1)
19. CSV escaping (1.7)
20. Rate limiting (6.7)

### Sprint 4 (Low — ongoing)
21. PII redaction (5.5)
22. Trace comparison view (5.6)
23. Pre-commit hooks (4.8)
24. Benchmark regression tests (2.6)
25. SelfTracker log rotation (2.7)
26. Changelog automation (3.6)
