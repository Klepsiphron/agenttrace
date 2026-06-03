# AgentTrace NPM/PyPI Competitor Research: @agenttrace/sdk and tensorstax/agenttrace

**Date of research:** 2026-06 (current session)  
**Sources:**

- GitHub: https://github.com/tensorstax/agenttrace (primary source code per request; 63 stars, main branch)
- PyPI: `agenttrace` (v0.1.2)
- npm: `@agenttrace/sdk` (v0.1.0, published ~4 months prior by ripple0129; repo links in metadata point to non-existent github.com/agenttrace/agenttrace)
- Direct package inspection via npm pack + tarball extraction + raw GitHub file reads (README, agenttrace.py ~1028 LOC, cli.py, pyproject.toml, frontend server/routes/repositories)
- Name checks via the exact curls specified

**Note:** This document is research-only. Do not commit. It covers the local Python tracing library (the bulk of the public GitHub) and the published `@agenttrace/sdk` npm client (a server-oriented event pusher). Our project is the monorepo at the workspace root providing `@agenttrace-io/*` packages and `agenttrace-io` PyPI.

---

## 1. What the Competitor's Packages Do

### 1.1 Core: tensorstax/agenttrace (PyPI `agenttrace`, Python SDK)

**Primary artifact:** A lightweight, hackable, local-first tracing + evaluation framework for AI agents/LLMs. MIT licensed (copyright PigeonsAI/TensorStax).

**Key architecture (from src/agenttrace/agenttrace.py):**

- **TraceManager** (singleton):
  - Decorator-based tracing: `@tracer.trace(tags=["foo"], session_id="bar")` on sync or async functions.
  - Internals use START/END (merged to COMPLETE) trace_type entries.
  - Captures: function name, args/kwargs (deep sanitized for JSON, handles OpenAI objects + Pydantic), result, duration_ms, optional `tool_eval` (JSON schema validation for tool outputs when `tools` kwarg present with `input_schema`).
  - Persists to SQLite (`traces.db` default, or custom `db_path`): flat `traces` table (id, session_id, timestamp, trace_type, function_name, tags JSON, data JSON blob).
  - In-memory buffer + periodic save (5s), atexit save.
  - Terminal UX: colored spinners (⠋ etc.) for active traces while running (background thread), ✓/✗ completion lines with duration. Configurable `colored_logging`.
- **Tool schema evaluation:** Built-in `evaluate_tool_output(output, schema)` for strict tool calling validation (required fields, type checks for str/num/int/bool/array/object). Logs PASS/FAIL.
- **TracerEval** (first-class evaluation framework):
  - `TracerEval(name, data=callable->list[{"input":...}], task=fn, scores=[scorer_fns], trial_count=1, track_tools=False, tools=..., session_id=...)`
  - Runs task over test cases (sync or async), applies scorers (which return dicts like `{"score": 0.0-1.0}` or error), optional tool schema tracking + summary stats.
  - Stores in additional tables: `eval_results` (id, name, trial_count, session_id, data JSON with results+scores+metadata), `eval_events` (per-step logging).
  - `get_eval_results`, `get_eval_events`, `__str__` summary.
  - Scorers can be simple fns; name attached via `.name` attr. Source code of scorers is snapshotted via `inspect.getsource`.
- **Querying:** `get_traces(limit, trace_type, tag, function_name, session_id)`, session grouping via `session_id`.
- **Other:** `add_trace(...)` manual, `save_traces()`, basic cleanup not present (no maxTraces).
- **CLI** (`agenttrace` entrypoint): Only `agenttrace start [--no-browser] [--install] [--quiet]`. Launches the separate frontend (see below). Not a query/stats/export tool.
- **No built-in:** Cost tracking/calculation, token normalization (counts may be inside `data` JSON if user captures), model/provider fields at top level, runs vs sessions, OTEL, alerts, middleware auto-instrumentation, TypeScript core SDK.

**Dependencies (pyproject.toml):** Only `numpy` (odd for a tracer; possibly for future eval math). Python >=3.7.

**Usage style (from README):** Heavy decorator + explicit session_id/tags for grouping/categorization. Designed for "wrap your agent functions/LLM calls".

**Web Dashboard:** Not embedded. Requires separate:

- `cd frontend && npm run install:all && npm run start`
- Starts Express backend (port 3033, uses `sqlite` + `sqlite3` driver via `open()`) + React client (Vite 5173).
- API: `/api/traces*` (list/filter by type/tag/function/session, sessions, types, functions, tags, DELETE single/session), `/api/evals*`, `/api/db*`.
- Repository layer reconstructs flexible JSON data + tags into response objects.
- DB path configurable via services.
- Serves traces, eval results, supports session delete (cascades evals/events).
- UI screenshots in README show trace lists, eval interfaces with scores.

**Version:** 0.1.2 on PyPI (README shows 0.1.0 examples).

### 1.2 The @agenttrace/sdk npm Package (v0.1.0, by ripple0129)

**Description (from npm README + extracted dist/):** "TypeScript SDK for recording AI agent activity to an AgentTrace server." Apache-2.0. Weekly downloads ~3. 1 dependency: `@agenttrace/shared`.

**Core API (from dist/agent-trace.js + types):**

- `AgentTrace.init({ apiKey: required, agentId: required, endpoint?, flushInterval=5000, maxBufferSize=50 })`
- Event types: llm_call, heartbeat, error, custom (via zod in shared).
- `track({ provider?, model?, tokens: {input,output,total}?, latency_ms?, status?, error_message?, tags?, trace_id?, span_id?, parent_span_id? })` — enqueues "llm_call" event.
- `startTrace()` → {traceId, startSpan(name)} for manual distributed tracing (spans are "custom" events with span_event/start + names/ids).
- `heartbeat()`, `error(err)`, `custom(data)`, `flush()`, `shutdown()`.
- Buffering: in-memory, timer flush, auto-flush on size, hard cap 5000 (drops oldest + warns on overflow, does not requeue failed).
- Posts batch `{events: [...]}` to endpoint with `x-api-key` header. Uses fetch + AbortSignal timeout.
- There's also `AgentWatch` (similar but different default endpoint to supabase functions/v1/ingest; no distributed tracing spans).

**Shared package extras (from @agenttrace/shared dist/):** Zod schemas (AgentEventSchema, BatchEventsSchema), EventType/Source enums, pricing utils (`calculateCost`, `getModelPricing`, `listSupportedModels`), provider detection/parsers (OpenAI etc. base URLs, auth headers), response parsers, logger.

**Design:** Client for a (remote or self-hosted) ingestion server. Not local storage. No SQLite, no local dashboard/CLI, no decorators/wrappers for user functions, no evals, no costs computed client-side (pricing in shared but usage appears server-oriented). Focused on event streaming + liveness (heartbeats) + basic distributed tracing.

**Repo metadata:** Points to github.com/agenttrace/agenttrace (packages/sdk) which 404s on GitHub. Appears to be a separate or companion artifact to the tensorstax Python library (same publisher ripple0129).

**Key difference in licensing/purpose:** npm SDK is Apache-2.0 + server/client model; GitHub Python lib is MIT + fully local.

---

## 2. Name Availability Research (@agenttrace-io and related)

Performed exactly as specified (plus supporting checks):

```bash
curl -s https://registry.npmjs.org/@agenttrace-io/sdk
# => {"error":"Not found"}
```

```bash
curl -s https://pypi.org/pypi/agenttrace-io/json
# => {"message": "Not Found"}
```

**Interpretation:**

- **npm `@agenttrace-io/sdk`**: "Not found" means the scoped package name is **available** for publishing (no existing package at that path).
- **PyPI `agenttrace-io`**: "Not Found" means the distribution name is **available**.
- Additional: Direct GET on npm scope `@agenttrace-io` returns MethodNotAllowed (normal for scopes; you query specific packages). No evidence of existing `@agenttrace-io` org/packages in search results or metadata.
- For contrast (not requested but relevant): `agenttrace` is **taken on both** (PyPI v0.1.2 by TensorStax; npm `@agenttrace/sdk` exists and is the one analyzed). Our project publishes under `agenttrace-io` (PyPI) and `@agenttrace-io/*` (npm), to avoid collision with existing `agenttrace` on PyPI and competitor's `@agenttrace/sdk`.

**Recommendation in doc context:** `@agenttrace-io` (and variants like `@agenttrace-io/sdk`, `agenttrace-io`) appears clear for a scoped "io" org/brand if we want to differentiate (e.g., for a hosted sibling or to avoid collision). However, "agenttrace" namespace is already contested on PyPI.

---

## 3. How Our Approach Differs

**High-level philosophy:**

- **Theirs (tensorstax + @agenttrace/sdk):** Python-centric local decorator tracing + powerful built-in eval runner. Terminal live feedback. Evaluation is "during experiment" with test cases + scorers at definition. Dashboard is a full separate full-stack Node/React app (you run a server to view). The npm SDK is orthogonal: thin client for pushing to _a server_ (ingest + presumably hosted UI/alerts). Emphasis on hackability, tags/sessions, tool schema validation, and eval-as-first-class during development.
- **Ours (this monorepo):** Full cross-language (TS + Python parity), local-only zero-cloud by design, structured relational SQLite (runs/traces/tool_calls/scores/alerts with aggregates), explicit cost tracking + model rates, framework-native auto-instrumentation via middlewares, integrated CLI (rich queries + export + dashboard), embedded dashboard (Express + static assets, npx-launched, no separate frontend repo install), post-hoc evaluation (scorers on existing traces), built-in OTEL export, alerting/webhooks on stats, run lifecycle (start/complete). Data model is normalized (not JSON blobs), supports token/cost/latency as first-class columns.

**Detailed feature contrast (selected):**

| Aspect                     | tensorstax/agenttrace (Py) + npm SDK                                                                                                  | Our AgentTrace (monorepo)                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| **Primary languages**      | Python SDK core; TS only for frontend + thin client SDK                                                                               | First-class TS SDK + Python SDK (near API parity)                                                                                       |
| **Tracing model**          | Decorator `@trace(...)` on fns; START/END/COMPLETE; session_id + tags; JSON data blob                                                 | `trace(name, fn, {input,tokens,model,...})` + Py context/decorator; explicit runs; normalized rows + separate tool_calls                |
| **Auto cost**              | No (pricing utils in shared but not wired to traces)                                                                                  | Yes, default calculator + 15+ models, `registerModelRate`, per-trace + breakdowns                                                       |
| **Token handling**         | User captures in result/kwargs; not normalized top-level                                                                              | Explicit `TokenUsage` (prompt/completion/total + model/provider)                                                                        |
| **Framework integrations** | Manual decorators (examples use raw OpenAI)                                                                                           | LangGraph middleware (before/afterNode, heuristic token extract from langchain usage_metadata etc.); CrewAI event hooks (tasks + tools) |
| **Evaluations**            | First-class `TracerEval` (data+task+scores at run time, trials, tool schema tracking, stores eval\_\* tables, scorer source snapshot) | Post-hoc `evaluate({scorers, runId/traceIds})` + `score(name, fn)`; stores in `scores` table; concurrency control                       |
| **Tool calls**             | Optional schema validation during trace (if tools+input_schema); captured in data                                                     | `ToolCall[]` structured (name, input, output, latency, success, error, ts); recorded at trace time (middleware support)                 |
| **Storage**                | SQLite (flat traces + eval tables); in-mem buffer                                                                                     | SQLite (WAL + FKs); normalized runs + traces + tool_calls + scores + alerts + history; run stat rollups; auto cleanup maxTraces         |
| **Dashboard/UI**           | Separate `frontend/` (Express 3033 + React/Vite 5173); must `npm run` + install; reads same DB                                        | Integrated `@agenttrace-io/dashboard` (npx agenttrace-io dashboard or via cli); static + API in one; also full CLI tables                     |
| **CLI**                    | Minimal: only "start" for frontend                                                                                                    | Full: runs, stats, export (json/csv/otel), dashboard, init, version; colored tables                                                     |
| **Export**                 | Via UI or direct DB query                                                                                                             | `export('json'                                                                                                                          | 'csv' | 'otel')`; full OTLP JSON spans generated client-side (no deps) |
| **Alerting / webhooks**    | Heartbeats in npm SDK (for server-side agent-down detection)                                                                          | Built-in `registerAlert({name, condition(stats)=>bool, webhook, cooldown})`; auto-check on traces; delivery history; persisted          |
| **Distributed tracing**    | Manual startTrace/startSpan in npm SDK (emits custom events)                                                                          | runId + metadata; traces linked to runs (no explicit spans yet)                                                                         |
| **Liveness**               | heartbeats (npm client)                                                                                                               | Via runs (status running/success) + stats; no explicit heartbeats                                                                       |
| **Costs / pricing**        | Shared lib has calculateCost + model list                                                                                             | Deeply integrated (per trace, breakdowns by model/day, getCostBreakdown)                                                                |
| **OTEL**                   | None                                                                                                                                  | Native `export('otel')` + resource/span attrs with agenttrace.\* namespace                                                              |
| **Local-only guarantee**   | Yes for Python lib; npm SDK is client-to-server                                                                                       | Yes, everywhere (SQLite file, never leaves machine unless user exports or configures webhook)                                           |
| **Zero-config UI**         | Requires Node + npm install in frontend/                                                                                              | `npx agenttrace-io dashboard` (pulls @agenttrace-io/\*); or programmatic                                                                      |
| **Version (core)**         | 0.1.2 (Py), 0.1.0 (npm)                                                                                                               | 0.1.0 (all packages)                                                                                                                    |
| **License**                | MIT (GitHub), Apache-2.0 (npm SDK)                                                                                                    | MIT (all)                                                                                                                               |

**Data model differences (key):**

- Their traces are semi-structured (fixed columns + arbitrary JSON "data"). Good for flexibility/hackability.
- Ours: strongly typed columns for tokens/cost/latency/status/error + JSON only for input/output/metadata. Separate normalized tool_calls table. Enables efficient SQL aggregates (our getStats, costByModel, topTools, costByDay etc.).
- Runs vs sessions: ours has explicit Run with rollup counters/totals; theirs relies on session_id + post-query grouping.

**Middleware vs pure decorator:** Ours invests in framework-specific auto-capture (LangGraph node timing + token scrape from usage_metadata/response_metadata/kwargs; CrewAI task/tool events via crewai_event_bus). Their examples show manual @decorator around OpenAI calls.

**Evals timing/philosophy:** Theirs encourages defining evals + test data + scorers upfront and running experiments (great for benchmarking). Ours supports that via custom scorers but stores raw traces first, then score later (or during via middleware). We snapshot scores per-trace; they snapshot full eval runs + scorer source.

---

## 4. What We Can Learn From Theirs

**Positive / Adoptable ideas:**

- **Decorator ergonomics + dual usage:** Their `@tracer.trace` (no parens for simple, or with options) + support for both sync/async via inspect.iscoroutinefunction is clean. Our Python already has context + decorator + lambda forms (via \_TraceContext); TS could benefit from better decorator sugar or a `trace` decorator helper.
- **Live terminal feedback:** Spinners during active traces + immediate ✓ completion + duration is delightful for CLI/agent dev loops. Easy win: add optional progress logging/spinner to our trace() (behind config.silent or a `verbose` flag). Our CLI already has color, we can extend.
- **First-class evals with experiment tracking:** `TracerEval` + dedicated eval\_\* tables + "run an eval" as a primitive (with trials, tool tracking, score code capture) is more "eval harness" than our current scorer application. Their approach shines for regression testing agents over time. We have plans/ docs for evaluation framework (see docs/plans/2026-06-03-evaluation-framework.md); we can learn from their data model (eval_results as blobs with full outputs + per-scorer) and UI concepts.
- **Tool output schema validation as scoring primitive:** Built into tracing path for tool-calling agents. We can add optional `outputSchema` or validator to trace options, or a built-in scorer type.
- **Session + tags for flexible grouping:** Simple, powerful for filtering in UI without rigid "run" concept. We have runId + metadata + name filter; adding lightweight tags (array on Trace) would be compatible and useful for their-style workflows.
- **Source capture for reproducibility:** Snapshotting scorer source code via inspect is clever for audit. We could do similar for registered scorers/alert conditions.
- **Separate frontend server + rich delete/cascade:** Their React UI + session delete (cascades traces+evals+events) shows investment in explorer UX. Our dashboard is simpler (HTML/JS in public/); we can study their client for viz ideas (though not fetching full React code here).
- **npm SDK patterns (for future hosted):** If we ever offer a cloud/ingest option, their buffering, apiKey + header, batch POST, span primitives, heartbeat-for-liveness, overflow handling, and use of zod for validation + shared pricing/providers are solid. Heartbeats specifically enable "agent down" alerts on the server side.
- **Pricing in shared:** Having a central model list + cost calc (even if not auto-applied in their Python core) is good. We already do this well and more comprehensively (many 2026 models, runtime registration).

**Areas where their design shows tradeoffs (avoid or improve):**

- Flat JSON data + START/END merging makes some queries (aggregates, cost sums) harder without app-layer code. Our normalized + trigger-like run stat updates + SQL aggregates are stronger for stats/CLI/costs.
- No cost or token columns at storage level limits observability value out of the box (users must parse data).
- Dashboard requires running a full Node dev server + installs (friction vs our npx single-command).
- CLI is an afterthought (only launcher); ours is a primary interface.
- Numpy dep for a tracer feels unnecessary.
- The npm @agenttrace/sdk being server-only + the Py lib being local creates two different "AgentTrace" experiences under similar names (confusion risk, which we can avoid by clear positioning).
- Eval is powerful but couples tracing to experiment running; our separation (traces always, evals optional on top) supports production tracing + offline analysis better.
- No multi-language or framework middleware investment.

---

## 5. What Unique Value We Provide

- **True local-first, integrated toolchain (no extra servers/runtimes for basics):** `npm install @agenttrace-io/sdk && npx agenttrace-io dashboard` (or pip + npx) gives traces + queryable DB + UI + CLI immediately. Their dashboard requires `cd frontend; npm install; npm run start`. Our storage, queries, costs, and UI are in the published packages.
- **Cross-ecosystem symmetry:** Drop-in for TS/JS (LangGraph etc.) and Python (CrewAI etc.) teams with consistent mental model, types, and storage. Theirs is Python-primary.
- **Production + cost observability built-in:** Automatic USD costs for 15+ models (with easy extension), per-run/per-day breakdowns, token tracking, latency. Critical for agent spend monitoring; absent from their core.
- **Framework auto-instrumentation:** Real middlewares that hook into LangGraph execution model and CrewAI event bus, extracting tokens heuristically from common LLM response shapes. Reduces boilerplate vs manual decorators around every call.
- **Structured data + powerful local analytics:** Runs with automatic aggregates, dedicated tool_calls, query filters on cost/latency/status, SQL-friendly. Enables our rich CLI (`stats`, cost breakdowns) and dashboard APIs without post-processing everything in JS/Python.
- **Observability standards + extensibility:** Native OTEL JSON export (ready for Grafana, Jaeger, etc.). Custom `costCalculator`, `hallucinationDetector`, scorers, alerts. Theirs is more closed to custom via the data blob.
- **Alerting & webhooks at the edge:** Register conditions on live stats (successRate, totalCost, etc.) with cooldown + webhook delivery + history, all local. Their heartbeats are client signals for a central server to act on.
- **Evaluation that works on real traces:** Post-capture scoring + concurrency means you can score production or past runs, not just during synthetic `TracerEval` harnesses. Complements (rather than replaces) their experiment style.
- **Zero-dependency OTEL + pure local export:** No need for OpenTelemetry SDKs.
- **CLI as first-class citizen:** Not just a launcher — full-featured query, filter, export, colored output, dashboard spawn. Complements terminal spinners (which we can add).
- **Monorepo + multi-package coherence:** SDK, CLI, dashboard, middlewares all versioned together, depend on each other cleanly, tested in one place. Easier for users to get the full experience.
- **Privacy + simplicity positioning:** Matches their "local" but delivers more out-of-box (costs, CLI, middlewares, OTEL, alerts) without requiring a separate UI server process for viewing. Our comparison.md already positions vs Langfuse/LangSmith on these axes; the tensorstax project is another local-ish peer that we differentiate from via integration depth and cost/standards support.
- **Avoiding name collision pitfalls:** By documenting this, we can choose clear branding (e.g., lean into @agenttrace-io if expanding).

**Market/context:** Both projects are small/new (theirs ~63 GitHub stars, low npm downloads for the SDK). Direct PyPI name collision on "agenttrace" already exists — users installing "agenttrace" get theirs. Our TS packages under @agenttrace-io/\* are distinct. The npm @agenttrace/sdk (server client) + our @agenttrace-io/sdk (local) would also collide if a user encounters both.

---

## 6. Summary Recommendations / Takeaways

1. **Positioning:** We are the "integrated local observability platform" (SDK + storage + CLI + dashboard + costs + middlewares + standards + alerts) for TS + Python. They are "hackable Python tracing + eval harness + separate viz server" + "client for a (future?) server product".
2. **Learn & differentiate:** Borrow live spinners/terminal polish, consider enhancing decorator API and eval harness (inspired by TracerEval), add optional tags + schema validators. Double down on our strengths (costs, structure, integrations, no-extra-process UI, OTEL, cross-lang, alerting).
3. **Risks:** PyPI name collision (`pip install agenttrace` ambiguity). The similar "AgentTrace" branding across the npm client (server) and their local lib could cause user confusion in searches/docs. Using `@agenttrace-io` namespace (confirmed available) for future expansions or a hosted offering would cleanly separate.
4. **Opportunities:** If we implement stronger eval (per existing plan docs), study their eval_events + result storage + UI. Their React frontend (client/) could provide inspiration for richer visualizations even if we keep our lightweight dashboard.
5. **Next steps (internal):** Update our comparison.md or ROADMAP with this peer; consider scoped packages or README clarifiers ("not to be confused with the TensorStax agenttrace PyPI package"); explore adding tags + live trace UX polish.

**Appendix: Key file references (from research)**

- Tensorstax core: https://github.com/tensorstax/agenttrace/blob/main/src/agenttrace/agenttrace.py
- Their frontend server repo layer + DB: frontend/server/repositories/traceRepository.ts + services/dbService.ts
- npm SDK source (extracted): dist/agent-trace.js (buffering, init, track, startTrace, flush logic)
- Our mirrors: packages/sdk/src/index.ts, storage.ts, types.ts; packages/sdk-python/src/agenttrace/core.py; middlewares.

This research was performed using web fetches, raw GitHub content, npm tarball inspection, and direct curl checks. All code facts cross-verified against multiple files.

(End of document. Do not commit per instructions.)
