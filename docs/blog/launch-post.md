# Introducing AgentTrace: Local-First Observability for AI Agents

**No cloud. No accounts. No Docker. Just traces in a SQLite file you control.**

AI agents have become remarkably capable, but when they go wrong — or cost too much, or take too long — they remain frustratingly opaque. You ship a research agent, a customer support multi-agent system, or a code-generation workflow, and all you have are high-level logs or scattered `print` statements. Which tool call hallucinated? Why did this run cost $4.20 when the last one was $0.30? Where did the 12-second latency spike come from?

We built AgentTrace because the existing options forced an uncomfortable choice: send your prompts, outputs, and agent traces to a third-party cloud, or accept significant operational overhead to self-host something production-grade.

AgentTrace is open-source (MIT), local-first observability for AI agents. Drop in the SDK (TypeScript or Python), wrap your agent logic or use framework middleware, and every token, tool call, latency, and cost is captured in a local SQLite database. Query it from the terminal with a full-featured CLI, view it in a dark-themed local web dashboard, or export it as JSON, CSV, or OpenTelemetry spans. Your data never leaves your machine unless *you* explicitly send it.

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

**Common limitations.** Most tools target *production teams* or *full LLM platforms* (prompt registries, heavy experiment harnesses, annotation queues). This brings either mandatory cloud data movement or non-trivial self-host infra (Docker/K8s, multiple services, ongoing maintenance). Pricing (seats, traces, scores, GB, requests) is reasonable at scale but painful during rapid iteration. Very few make the CLI a first-class, zero-config interface.

## Our Approach: Local-First, CLI-First, Privacy-First

AgentTrace makes a deliberate bet: the 80% use case for many developers and small teams is "I want to understand what just happened in this agent run on my machine, right now, without leaving my terminal or sending anything anywhere."

We optimize ruthlessly for that:

- **Storage is a single SQLite file** (`agenttrace.db` by default, configurable). WAL mode, foreign keys, normalized schema (runs, traces, tool_calls, scores, alerts, links). You own the file. You can `ls -l`, `sqlite3 agenttrace.db`, `rsync` it, add it to a tarball with your eval datasets, or `.gitignore` it. No server, no volumes, no migrations to manage for the common case.
- **CLI is not a second-class citizen.** The `@agenttrace/cli` package (invoked via `npx agenttrace` or global install) is the primary way many users interact with their traces: list runs, filter traces, view stats and cost breakdowns, render trace trees for multi-agent flows, test alerts, and export. If your workflow is "run agent, immediately check what happened," the CLI keeps you in flow.
- **Dashboard is local and optional.** `npx agenttrace dashboard` (or `agenttrace dashboard --port 4000`) starts a tiny Express server serving a dark-themed static UI + REST API against the same local DB. No separate frontend repo, no `npm run dev` in another directory. Close it when you're done.
- **Zero cloud by default, explicit escape hatches.** Nothing phones home. The only ways data leaves are: (1) you call `export('otel' | 'json' | 'csv')`, (2) you register a webhook alert that fires on your conditions, or (3) you point an external OTEL collector at the exported spans. We provide the primitives; you stay in control.
- **Framework agnostic with optional auto-instrumentation.** Works with raw OpenAI/Anthropic calls, custom agent loops, LangGraph, CrewAI, or anything else. We ship middleware that hooks into LangGraph's node lifecycle (TS) and CrewAI's event bus (Python) to capture node/task/tool timing and tokens with minimal boilerplate.
- **Cost tracking is table stakes, not a premium feature.** We ship approximate 2026 rates for 15+ models (GPT-4o family, Claude 4 family, Gemini 2.x, Llama 3.1/4 variants, etc.) and a `registerModelRate()` escape hatch. Cost is computed per trace and rolled up in stats and cost breakdowns by model and day.
- **Cross-language parity.** The TypeScript and Python SDKs produce compatible DB schemas. A mixed TS/Python team (or a single dev using both) can share one `agenttrace.db`.

We are *not* trying to be the one platform that does prompt management, large-scale experiment tracking, human annotation queues, SOC2-certified multi-tenant hosting, and everything else. Those are valuable; other tools do them well. We solve the "show me the traces and costs for what I just ran, locally, instantly" problem extremely well and get out of the way.

Honest limitations (as of the current release): evaluation is post-hoc scorer application rather than a full experiment harness with datasets and trials (stronger support is on the roadmap); there is no built-in prompt versioning or playground; no team collaboration or hosted dashboard (yet); the project is young with a small community; visualizations in the local dashboard are functional but not as polished as mature platforms; and our auto token extraction in middlewares relies on common response shapes (you can always pass `tokens` explicitly).

## Key Features with Code Examples

### Drop-in tracing (TypeScript)

```typescript
import { init, trace } from '@agenttrace/sdk';

const agent = init({ dbPath: './agenttrace.db' });

async function researchAgent(query: string) {
  return await trace('research-agent', async () => {
    const searchResults = await trace('web-search', async () => {
      // ... tool call ...
      return results;
    }, { model: 'gpt-4o-mini', tokens: { promptTokens: 120, completionTokens: 80, totalTokens: 200 } });

    const summary = await trace('summarize', async () => {
      const res = await callLLM({ model: 'claude-sonnet-4', messages: [...] });
      return res;
    });

    return { summary, sources: searchResults.length };
  });
}
```

The outer `trace` creates (or joins) a run. Nested calls automatically capture latency, status, input/output (truncated for storage), and any manually supplied tokens/cost metadata. Errors are caught, status set to 'error', and rethrown.

### Context manager + decorator (Python)

```python
from agenttrace import init, trace

agent = init(db_path="./traces.db")

# Context manager (recommended for explicit output setting)
async with agent.trace("research-node") as t:
    response = await llm.ainvoke(...)
    t.set_output(response.content)
    t.set_tokens({"prompt_tokens": 340, "completion_tokens": 120, "total_tokens": 460})
    t.set_model("gpt-4o-mini")

# Decorator form
@agent.trace("summarize")
def summarize(state):
    ...
    return result

# Or direct callable wrapper
result = agent.trace("postprocess", lambda: do_work(input))
```

The Python SDK supports sync/async, and the same DB can be read by the TS CLI/dashboard.

### Framework middleware (auto-instrumentation)

For LangGraph (TypeScript):

```typescript
import { AgentTraceMiddleware } from '@agenttrace/middleware-langgraph';

const mw = new AgentTraceMiddleware({ dbPath: './agenttrace.db' });
const agent = mw.getAgentTrace();
agent.startRun('langgraph-research');

// Later when compiling your graph, register the middleware
// (exact registration depends on your LangGraph version; beforeNode/afterNode/onError are invoked around nodes)
```

For CrewAI (Python):

```python
from agenttrace_middleware.crewai_hook import AgentTraceCrewAI

mw = AgentTraceCrewAI(db_path="./traces.db")
# ... define your crew with tasks/tools ...
result = crew.kickoff()
mw.close()  # or let it go out of scope
```

The middleware extracts timing, attempts to pull token usage from common `usage_metadata`, `response_metadata`, LiteLLM-style dicts, etc., and records per-node or per-task/tool traces with `framework: 'langgraph'` / `'crewai'` metadata.

### Runs, stats, cost breakdowns, and trees (CLI)

```bash
npx agenttrace init                 # ensures agenttrace.db exists with schema
npx agenttrace runs --limit 20
npx agenttrace traces --run-id abc123 --status success
npx agenttrace stats
npx agenttrace costs --daily
npx agenttrace tree --trace-id def456   # shows parent/child/linked traces
npx agenttrace export --format otel --output spans.json
```

The `stats` command shows total runs/traces, success rate, avg latency, total cost, top tools, top errors. `costs` breaks it down by model or day. `tree` visualizes multi-agent or hierarchical flows using `parentId` + manual `linkTraces()` relationships.

### Evaluations (post-hoc scoring)

```typescript
const results = await agent.evaluate({
  runId: 'my-run',
  scorers: [
    { name: 'relevance', fn: (trace) => llmJudgeRelevance(trace.output) },
    { name: 'tool_success_rate', fn: (trace) => {
      const tools = trace.toolCalls || [];
      return tools.length ? tools.filter(t => t.success).length / tools.length : 0;
    }},
  ],
  concurrency: 3,
});
```

Scores are stored in the `scores` table and surface in stats/exports. You can also call `evaluateTrace` for a single trace or register scorers that run automatically in some flows. This is intentionally simple; richer experiment orchestration is planned.

### Alerts (local webhooks on conditions)

```typescript
agent.registerAlert({
  name: 'high-cost',
  condition: (stats) => (stats.totalCostUsd || 0) > 5.0,
  webhook: 'https://hooks.slack.com/...',
  cooldown: 3600, // seconds
});
```

After traces, `checkAlerts()` (called automatically inside `trace()`) evaluates persisted conditions against current aggregate stats and fires webhooks (with delivery history stored locally). Useful for "stop the agent" or "notify me" during long runs or overnight evals.

### OpenTelemetry export (no extra SDKs)

```typescript
const otelJson = agent.export('otel', { runId: '...' });
// POST to your collector, or save for jaeger/grafana/tempo import
```

Spans include `agenttrace.*` attributes for status, cost, tokens, model, latency, input/output (truncated), metadata, etc. Resource is `service.name: agenttrace`.

## Comparison Table

Here is an honest, 2026-era snapshot focused on the dimensions that matter for local/privacy-focused agent development. (Numbers and plans change; verify on vendor sites.)

| Dimension                        | AgentTrace                          | Langfuse                                      | LangSmith                                      | Braintrust                               | Helicone                                 | Arize Phoenix (OSS)                     |
|----------------------------------|-------------------------------------|-----------------------------------------------|------------------------------------------------|------------------------------------------|------------------------------------------|-----------------------------------------|
| **Core model**                   | Local SQLite file, zero infra       | OSS (self-host) + Cloud                       | Cloud (self-host Enterprise)                   | Cloud (self-host Enterprise)             | OSS self-host + Cloud                    | Local-first OSS server + Cloud AX       |
| **Setup for local use**          | `npm install` or `pip install` + file | Docker Compose (multiple services)            | Sign up (or Enterprise k8s)                    | Sign up (Enterprise for self-host)       | Docker Compose                           | `pip install arize-phoenix` or single container |
| **CLI / terminal UX**            | Full featured (runs, stats, tree, costs, export, alerts) | Web UI primary                                | Web UI primary                                 | Web + strong experiment UX               | Web + gateway focus                      | Web UI + notebook + some CLI client     |
| **Data leaves machine by default**| Never (unless you export/webhook)  | Only on cloud tier                            | Always on standard plans                       | Always on standard plans                 | On cloud; self-host keeps it             | Local Phoenix keeps it; cloud sends     |
| **Built-in cost tracking**       | Yes (15+ models, runtime registration) | Yes                                           | Yes                                            | Yes (estimated)                          | Yes (via gateway)                        | Limited / via attributes                |
| **Evals / scoring**              | Post-hoc scorers + storage          | Full (online/offline, LLM judges, datasets)   | Full (online/offline, datasets)                | Excellent (Loop, experiments, human review) | Scores + experiments                     | Strong (phoenix-evals, experiments)     |
| **Prompt management / playground**| No                                 | Yes                                           | Yes (Prompt Hub)                               | Yes + strong iteration                   | Limited                                  | Yes (Prompt IDE, management)            |
| **Framework integrations**       | Agnostic + LangGraph/CrewAI middleware | Broad + OTel + LiteLLM proxy                  | Excellent for LangGraph, others via OTEL       | Broad via instrumentation                | Strong via proxy/gateway                 | Excellent (OpenInference, many)         |
| **OTEL export**                  | Native, zero-dep OTLP JSON          | Native                                        | Supported                                      | Supported                                | Supported                                | Native (core strength)                  |
| **Local dashboard**              | Yes (npx, embedded, single process) | Yes (after Docker)                            | N/A (cloud)                                    | N/A (cloud/Enterprise)                   | Yes (self-host)                          | Yes (local server)                      |
| **Pricing for local / solo dev** | Free forever (MIT)                  | Free self-host (infra cost only); cloud free tier then paid | Free tier (5k traces, 14d); paid $39/seat + usage | Free tier (limited GB/scores); Pro $249/mo | Free tier 10k req; usage after; self-host free | Free OSS; AX cloud/enterprise paid      |
| **Self-host complexity**         | None (file + optional tiny server)  | Medium-High (Docker + 5+ services)            | High (Enterprise k8s/hybrid)                   | Enterprise only (hybrid data plane)      | Medium (Docker)                          | Low (pip or single container)           |
| **Maturity / community (approx)**| New (small)                         | High (~28k GitHub stars)                      | High (LangChain ecosystem)                     | High (focused AI teams)                  | Growing                                  | High (~9k+ GitHub stars)                |
| **Best for**                     | Privacy, terminal workflows, zero-config local tracing, mixed TS/Py | Full-featured OSS platform, teams okay with Docker or cloud | LangGraph production apps, teams wanting managed platform | Evals-heavy quality workflows, experiment iteration | Gateway + obs in one, usage-based scale | Local dev/debug + rich evals in notebook or Docker, OTEL fans |

**When to choose AgentTrace:**

- You want observability *right now* without installing Docker, creating accounts, or provisioning infra.
- Your prompts and traces are sensitive (or you just prefer to keep them local until you decide otherwise).
- You (or your team) live in the terminal and want first-class `agenttrace stats` / `tree` / `export` workflows.
- You build agents across languages or frameworks and don't want to bet on one ecosystem's observability.
- You want automatic cost attribution without extra work, and the ability to query everything with SQLite or export to your existing OTEL stack.

**When another tool is a better fit:**

- You need production-grade prompt management, large-scale experiment tracking, and human-in-the-loop annotation today → Langfuse or Braintrust or LangSmith.
- You're all-in on LangGraph and want the deepest integration + deployment story → LangSmith.
- You love the notebook + rich local UI + strong evals experience of Phoenix and are happy running a local server process → Arize Phoenix.
- You want an AI gateway with caching/fallbacks + observability in the same layer → Helicone.

We compete on *simplicity and guarantees*, not on breadth of lifecycle features.

## Getting Started

### TypeScript (Node)

```bash
npm install @agenttrace/sdk
# Optional but recommended for CLI + dashboard
npm install -D @agenttrace/cli @agenttrace/dashboard
```

```typescript
import { init, trace } from '@agenttrace/sdk';

const agent = init();
// ... wrap your agent entrypoint or individual steps as shown earlier ...
const result = await myAgent(userInput);

// Later, or in another process:
console.log(agent.getStats());
```

Run `npx agenttrace dashboard` in the same directory (it looks for `./agenttrace.db` or uses `AGENTTRACE_DB_PATH`).

### Python

```bash
pip install agenttrace
# For CrewAI middleware: pip install agenttrace-middleware-crewai
```

```python
from agenttrace import init, trace

agent = init(db_path="./agenttrace.db")
# use context, decorator, or direct call as shown earlier
```

The CLI and dashboard are still invoked via `npx agenttrace ...` (they are Node packages that read the shared SQLite format).

### With examples in the repo

See `examples/langgraph/`, `examples/crewai/`, and `examples/custom/` for runnable end-to-end agents.

### Basic workflow

1. `npx agenttrace init`
2. Run your instrumented agent (multiple times, with different inputs).
3. `npx agenttrace runs --limit 5`
4. `npx agenttrace stats`
5. `npx agenttrace dashboard` (open http://localhost:3000)
6. When ready to analyze elsewhere: `npx agenttrace export --format json --output traces.json` or OTEL.

### Custom cost rates or hallucination detection

```typescript
import { init, registerModelRate } from '@agenttrace/sdk';

registerModelRate('my-fine-tuned-llama', 0.0005, 0.0015);

const agent = init({
  costCalculator: (tokens, model) => { /* your fn */ },
  hallucinationDetector: (output, expected) => /* return boolean */,
});
```

### Export + external tools

The OTEL export is pure JSON with no runtime dependency on the OpenTelemetry SDKs. Point your collector at the file or pipe it into existing pipelines.

## What's Next (Roadmap)

We are early. Current focus (v0.2 / v0.3 timeframe) is on making the local experience even more delightful and filling the most common gaps reported by early users:

- Stronger evaluation harness (datasets, trials, built-in LLM judges, experiment tracking and comparison views) — see plans in the repo.
- More framework middlewares and better automatic token extraction (additional providers, streaming support).
- Richer local dashboard visualizations (cost/latency histograms, flame graphs for traces, score distributions).
- Alerting and budgets with more delivery channels and better UX in CLI.
- Improved live terminal feedback (optional spinners/progress during long traces).
- Documentation, tutorials, and a library of reusable scorers.

Longer term (v1.0 and beyond), we expect to offer an optional hosted tier for teams that want shared traces, SSO, audit logs, and collaboration while still having the local tool as the excellent free/offline/on-prem foundation. The local product will always remain free, MIT, and fully functional.

We are honest about scope: we will not try to match every feature of the larger platforms in the near term. We will double down on zero-friction local tracing, cost visibility, CLI ergonomics, and privacy guarantees. If those are the constraints that matter most to you, AgentTrace should feel like it was built for your workflow.

## Try It

```bash
# TypeScript
npm install @agenttrace/sdk
npx agenttrace init

# Python
pip install agenttrace
```

Repo: https://github.com/Klepsiphron/agenttrace

Docs and examples are in the repo. Issues and discussions are welcome — especially around "here's the exact gap I'm hitting with current tools" or "I tried the middleware with X framework and tokens weren't captured."

We built the tool we wanted for our own agent work. If it resonates, star the repo, try it on your next agent, and tell us what to improve. The best observability tools are the ones that disappear into the background so you can focus on making the agents themselves reliable and cheap.

Happy tracing.

---

**Sources / Further Reading** (approximate as of research in 2026):

- Langfuse self-hosting and pricing pages
- LangSmith pricing and LangChain observability docs
- Braintrust pricing and self-hosting notes
- Helicone self-hosting announcement and pricing
- Arize Phoenix GitHub and site (pip install, OTEL focus, ~9k stars)
- Project comparison.md and ROADMAP.md in the AgentTrace repo

Data and plans evolve; the point of this post is not to declare a permanent ranking but to explain why a deliberately simple, local, file-based tool still has a place in a crowded category.

(Word count target: ~2600. Written for AI/ML engineers and developer-tooling enthusiasts who value pragmatism and control.)