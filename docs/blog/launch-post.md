# Introducing AgentTrace: Local-First Observability for AI Agents

**No cloud. No accounts. No Docker. Just traces in a SQLite file you control.**

AI agents have become remarkably capable, but when they go wrong — or cost too much, or take too long — they remain frustratingly opaque. You ship a research agent, a customer support multi-agent system, or a code-generation workflow, and all you have are high-level logs or scattered `print` statements. Which tool call hallucinated? Why did this run cost $4.20 when the last one was $0.30? Where did the 12-second latency spike come from?

We built AgentTrace because the existing options forced an uncomfortable choice: send your prompts, outputs, and agent traces to a third-party cloud, or accept significant operational overhead to self-host something production-grade.

AgentTrace is open-source (MIT), local-first observability for AI agents. Drop in the SDK (TypeScript or Python), wrap your agent logic or use framework middleware, and every token, tool call, latency, and cost is captured in a local SQLite database. Query it from the terminal with a full-featured CLI, view it in a dark-themed local web dashboard, or export it as JSON, CSV, or OpenTelemetry spans. Your data never leaves your machine unless _you_ explicitly send it.

This post covers the problem, surveys the current landscape (Langfuse, LangSmith, Braintrust, Helicone, Arize Phoenix), explains our deliberately narrow but deep approach, walks through key features with code, provides an honest comparison, and shows how to get started today.

## The Problem: AI Agents Are Black Boxes

Traditional application observability (metrics, logs, traces via OpenTelemetry) assumes relatively deterministic control flow. AI agents break that assumption. A single "run" of an agent can involve:

- Multiple LLM calls with varying models and providers
- Dynamic tool selection and parallel tool execution
- Retrieval steps, memory reads/writes, conditional branching
- Non-deterministic outputs that make "success" a spectrum rather than a boolean
- Cost and latency that are highly sensitive to prompt length, model choice, and tool behavior

When something fails, you often cannot answer basic questions from logs alone:

- Which exact node or tool produced the bad output?
- How many tokens were actually consumed across the full tree of calls?
- What was the per-step latency and cumulative cost?
- Did a particular tool call timeout or return an error that the agent tried to recover from?

Without structured tracing, teams resort to ad-hoc solutions: wrapping every LLM client, manually recording JSON blobs to files or a local Postgres, building one-off dashboards, or just giving up and hoping production traffic surfaces issues via user complaints.

The cost dimension is increasingly painful. With current 2026 model pricing, a busy agent doing research + tool use + reflection can easily burn through dollars per user interaction. Without per-trace cost attribution, you discover budget overruns only after the invoice arrives.

Privacy and compliance add another constraint. Many organizations (especially in healthcare, legal, finance, or internal tools) cannot or will not send raw prompts, retrieved documents, and agent reasoning traces to external SaaS platforms. Even "self-hosted" options often end up requiring cloud object storage, managed databases, or at least outbound connectivity for license checks or updates.

The result: AI engineers spend too much time on plumbing and too little on the actual agent logic and evaluation that moves the product forward.

## The Current Landscape and Its Limitations

Several strong products address LLM/agent observability. They excel for teams but share patterns that leave a gap for developers wanting simplicity and strong privacy.

**LangSmith** is mature for LangGraph-centric teams, with tracing, evals, datasets, and deployment tools. Free tier: 5k traces/mo (14-day retention, 1 seat). Plus: $39/seat/mo + pay-as-you-go traces (~$2.50–5/1k) and deployment metering. Self-host/hybrid is Enterprise-only. Most users send data to the cloud; best experience assumes the LangChain ecosystem.

**Langfuse** leads in OSS LLM platforms (tracing, evals, prompt management, datasets; ~28k GitHub stars). Cloud: Hobby free (50k units/mo), paid from $29/mo. Self-host is MIT-free but requires Docker Compose (web + worker + Postgres + ClickHouse + Redis + MinIO/S3). Even "local" self-host needs repo clone, secret management, and multiple containers — heavy for solo laptop debugging. Many default to cloud for convenience.

**Braintrust** shines on evaluation depth and iteration (rich traces, LLM judges, "Loop" automation, cross-functional review, GitHub release gating). Free tier limited (1 GB data + 10k scores/mo, 14-day retention); Pro $249/mo. Self-host/hybrid is Enterprise-only.

**Helicone** pairs an AI gateway (caching, fallbacks, rate limits) with observability. Generous free tier (10k requests/mo); usage-based after. Self-host via Docker. Strong when you want proxy features alongside tracing.

**Arize Phoenix** (OSS, 9k+ stars) is the nearest local peer: `pip install arize-phoenix` spins up fast for notebooks or a single Docker container, native OTEL/OpenInference with broad auto-instrumentation (LangGraph, CrewAI, etc.), plus evals, datasets, and prompt playground. Excellent for dev/debug. The full Arize AX is paid enterprise. It runs a local server process even for local use; less emphasis on pure terminal CLI or ad-hoc SQLite queries against a plain `.db` file.

**Common limitations.** Most tools target _production teams_ or _full LLM platforms_ (prompt registries, heavy experiment harnesses, annotation queues). This brings either mandatory cloud data movement or non-trivial self-host infra (Docker/K8s, multiple services, ongoing maintenance). Pricing (seats, traces, scores, GB, requests) is reasonable at scale but painful during rapid iteration. Very few make the CLI a first-class, zero-config interface.

## Our Approach: Local-First, CLI-First, Privacy-First

AgentTrace bets on a common 80% case: "I want to understand what just happened in _this_ agent run on _my_ machine, right now — without accounts, Docker, or data leaving."

- **Storage is one SQLite file** (`agenttrace.db`). WAL + normalized schema (runs, traces, tool_calls, scores, alerts, links). Own it, query it with `sqlite3`, rsync it, or `.gitignore` it. No servers or volumes.
- **CLI is primary.** `npx agenttrace runs`, `stats`, `costs --daily`, `tree`, `export --format otel`, `alerts` etc. stay in your terminal flow.
- **Dashboard is tiny and local.** `npx agenttrace dashboard` starts an embedded Express UI against the same DB. No separate frontend install.
- **Zero cloud by default.** Data leaves only via explicit export or a webhook _you_ configure.
- **Framework-agnostic + middlewares.** Works for raw calls or custom loops. Ships LangGraph (TS) and CrewAI (Py) auto-instrumentation for nodes/tasks/tools.
- **Cost built-in.** ~15 models with 2026 rates + `registerModelRate()`. Per-trace + breakdowns.
- **TS + Py parity.** Same DB schema; mixed teams share one file.

We deliberately skip full prompt registries, heavy experiment platforms, and multi-tenant hosting (other tools do those well). We solve "show me the traces and costs for what I just ran, locally, instantly."

**Honest limitations today:** post-hoc evals (full harness planned); no prompt versioning/playground; no team collab or hosted tier (yet); young project/small community; dashboard UI is functional, not as rich as mature platforms; middleware token extraction is heuristic (pass `tokens` explicitly when needed).

## Key Features with Code Examples

**TypeScript drop-in:**

```typescript
import { init } from '@agenttrace/sdk';
const agent = init();
const result = await agent.trace('research-agent', async () => {
  const search = await agent.trace('web-search', async () => callTool(q), { model: 'gpt-4o-mini', tokens: {promptTokens:120, completionTokens:80, totalTokens:200} });
  const summary = await agent.trace('summarize', async () => callLLM(...));
  return { summary, sources: search.length };
});
```

`agent.trace()` (and nested calls) auto-capture latency/status/input/output/tokens/cost. Errors set status and rethrow. (The published examples/README also show a convenience `trace` import in some snippets.)

**Python (context + decorator):**

```python
from agenttrace import init, trace
agent = init(db_path="./traces.db")
async with agent.trace("node") as t:
    out = await llm.ainvoke(...)
    t.set_output(out); t.set_tokens({...}); t.set_model("gpt-4o-mini")
@agent.trace("summarize")
def fn(state): ...
```

**Middlewares (auto):**

LangGraph (TS): `AgentTraceMiddleware` hooks before/afterNode/onError, extracts common usage_metadata shapes.

CrewAI (Py): `AgentTraceCrewAI` subscribes to task/tool events on the bus and records with framework metadata.

**CLI (primary interface):**

```bash
npx agenttrace init
npx agenttrace runs --limit 20
npx agenttrace stats
npx agenttrace costs --daily
npx agenttrace tree --trace-id <id>
npx agenttrace export --format otel --output spans.json
npx agenttrace dashboard   # localhost UI
```

`stats`/`costs` give aggregates + top tools/errors. `tree` renders parent/child/linked traces.

**Evals (post-hoc):**

```typescript
await agent.evaluate({
  runId: 'r1',
  scorers: [
    { name: 'relevance', fn: (t) => judge(t.output) },
    {
      name: 'tool_ok',
      fn: (t) =>
        (t.toolCalls || []).filter((x) => x.success).length / (t.toolCalls || []).length || 0,
    },
  ],
});
```

Scores persist to the DB.

**Alerts + OTEL:**

Register conditions on stats (e.g. `totalCostUsd > 5`); auto-checked on traces; webhook delivery with local history.

`export('otel')` produces zero-dep OTLP JSON with `agenttrace.*` attrs (cost, tokens, model, etc.).

## Comparison Table

Here is an honest, 2026-era snapshot focused on the dimensions that matter for local/privacy-focused agent development. (Numbers and plans change; verify on vendor sites.)

| Dimension                          | AgentTrace                                                          | Langfuse                                                    | LangSmith                                                 | Braintrust                                          | Helicone                                       | Arize Phoenix (OSS)                                           |
| ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| **Core model**                     | Local SQLite file, zero infra                                       | OSS (self-host) + Cloud                                     | Cloud (self-host Enterprise)                              | Cloud (self-host Enterprise)                        | OSS self-host + Cloud                          | Local-first OSS server + Cloud AX                             |
| **Setup for local use**            | `npm install` or `pip install` + file                               | Docker Compose (multiple services)                          | Sign up (or Enterprise k8s)                               | Sign up (Enterprise for self-host)                  | Docker Compose                                 | `pip install arize-phoenix` or single container               |
| **CLI / terminal UX**              | Full featured (runs, stats, tree, costs, export, alerts)            | Web UI primary                                              | Web UI primary                                            | Web + strong experiment UX                          | Web + gateway focus                            | Web UI + notebook + some CLI client                           |
| **Data leaves machine by default** | Never (unless you export/webhook)                                   | Only on cloud tier                                          | Always on standard plans                                  | Always on standard plans                            | On cloud; self-host keeps it                   | Local Phoenix keeps it; cloud sends                           |
| **Built-in cost tracking**         | Yes (15+ models, runtime registration)                              | Yes                                                         | Yes                                                       | Yes (estimated)                                     | Yes (via gateway)                              | Limited / via attributes                                      |
| **Evals / scoring**                | Post-hoc scorers + storage                                          | Full (online/offline, LLM judges, datasets)                 | Full (online/offline, datasets)                           | Excellent (Loop, experiments, human review)         | Scores + experiments                           | Strong (phoenix-evals, experiments)                           |
| **Prompt management / playground** | No                                                                  | Yes                                                         | Yes (Prompt Hub)                                          | Yes + strong iteration                              | Limited                                        | Yes (Prompt IDE, management)                                  |
| **Framework integrations**         | Agnostic + LangGraph/CrewAI middleware                              | Broad + OTel + LiteLLM proxy                                | Excellent for LangGraph, others via OTEL                  | Broad via instrumentation                           | Strong via proxy/gateway                       | Excellent (OpenInference, many)                               |
| **OTEL export**                    | Native, zero-dep OTLP JSON                                          | Native                                                      | Supported                                                 | Supported                                           | Supported                                      | Native (core strength)                                        |
| **Local dashboard**                | Yes (npx, embedded, single process)                                 | Yes (after Docker)                                          | N/A (cloud)                                               | N/A (cloud/Enterprise)                              | Yes (self-host)                                | Yes (local server)                                            |
| **Pricing for local / solo dev**   | Free forever (MIT)                                                  | Free self-host (infra cost only); cloud free tier then paid | Free tier (5k traces, 14d); paid $39/seat + usage         | Free tier (limited GB/scores); Pro $249/mo          | Free tier 10k req; usage after; self-host free | Free OSS; AX cloud/enterprise paid                            |
| **Self-host complexity**           | None (file + optional tiny server)                                  | Medium-High (Docker + 5+ services)                          | High (Enterprise k8s/hybrid)                              | Enterprise only (hybrid data plane)                 | Medium (Docker)                                | Low (pip or single container)                                 |
| **Maturity / community (approx)**  | New (small)                                                         | High (~28k GitHub stars)                                    | High (LangChain ecosystem)                                | High (focused AI teams)                             | Growing                                        | High (~9k+ GitHub stars)                                      |
| **Best for**                       | Privacy, terminal workflows, zero-config local tracing, mixed TS/Py | Full-featured OSS platform, teams okay with Docker or cloud | LangGraph production apps, teams wanting managed platform | Evals-heavy quality workflows, experiment iteration | Gateway + obs in one, usage-based scale        | Local dev/debug + rich evals in notebook or Docker, OTEL fans |

**When to choose AgentTrace:**

- You want observability _right now_ without installing Docker, creating accounts, or provisioning infra.
- Your prompts and traces are sensitive (or you just prefer to keep them local until you decide otherwise).
- You (or your team) live in the terminal and want first-class `agenttrace stats` / `tree` / `export` workflows.
- You build agents across languages or frameworks and don't want to bet on one ecosystem's observability.
- You want automatic cost attribution without extra work, and the ability to query everything with SQLite or export to your existing OTEL stack.

**When another tool is a better fit:**

- You need production-grade prompt management, large-scale experiment tracking, and human-in-the-loop annotation today → Langfuse or Braintrust or LangSmith.
- You're all-in on LangGraph and want the deepest integration + deployment story → LangSmith.
- You love the notebook + rich local UI + strong evals experience of Phoenix and are happy running a local server process → Arize Phoenix.
- You want an AI gateway with caching/fallbacks + observability in the same layer → Helicone.

We compete on _simplicity and guarantees_, not on breadth of lifecycle features.

## Getting Started

**TypeScript:**

```bash
npm install @agenttrace/sdk
npx agenttrace init
```

```ts
import { init } from '@agenttrace/sdk';
const agent = init();
await agent.trace('my-agent', async () => { ... });
```

**Python:**

```bash
pip install agenttrace
```

```py
from agenttrace import init, trace
agent = init()
with agent.trace("op") as t: ...
```

CLI/dashboard (cross-language): `npx agenttrace runs`, `stats`, `dashboard`, `export --format otel`.

See `examples/langgraph/`, `examples/crewai/`, `examples/custom/` in the repo.

**Workflow:** `npx agenttrace init` → run agent → `npx agenttrace stats` → `npx agenttrace dashboard` (localhost:3000) → `export` when needed.

Register custom rates or pass `tokens` explicitly; OTEL export needs no extra SDKs.

## What's Next

Early focus (v0.2–v0.3): richer evals (datasets, trials, judges, experiment views), more middlewares + streaming token support, better dashboard viz (histograms, flame graphs), improved alerts/budgets + terminal polish, docs and scorer examples.

Longer term: optional hosted tier for teams (shared traces, SSO) while the local MIT tool stays free and complete.

We won't chase every feature of larger platforms. We double down on zero-friction local tracing, CLI ergonomics, cost visibility, and privacy. If those constraints matter most to you, this should feel purpose-built.

## Try It

```bash
npm install @agenttrace/sdk && npx agenttrace init
# or
pip install agenttrace
```

Repo + examples: https://github.com/Klepsiphron/agenttrace

File issues for framework gaps or middleware token misses. We built the tool we wanted; feedback on real gaps drives the next cuts.

Happy tracing.

---

**Sources** (2026 research): Langfuse self-hosting (Docker Compose with multiple services) and pricing; LangSmith pricing ($39/seat + trace usage, self-host Enterprise); Braintrust pricing (Pro $249, self-host Enterprise); Helicone self-host Docker; Arize Phoenix (pip install, ~9k stars, local-first with OTEL). See project docs/comparison.md and ROADMAP.md. Pricing and details evolve.

---

**Sources** (research 2026): Langfuse self-host/pricing, LangSmith pricing docs, Braintrust pricing, Helicone self-host posts, Arize Phoenix GitHub/site (9k+ stars, pip/Docker local), project ROADMAP/comparison.md.

Plans and pricing change; this explains why a deliberately simple local file+CLI tool still fills a real gap. (~2500 words target; for AI/ML engineers and dev-tooling readers.)
