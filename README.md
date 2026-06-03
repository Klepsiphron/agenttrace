# AgentTrace

[![CI](https://github.com/Klepsiphron/agenttrace/actions/workflows/ci.yml/badge.svg)](https://github.com/Klepsiphron/agenttrace/actions/workflows/ci.yml)

**Open source AI agent observability.** Trace every token, tool call, and LLM invocation with a local dashboard. Zero cloud dependency.

## Quick Start

### Install

**TypeScript SDK:**

```bash
npm install @agenttrace-io/sdk
```

**Python SDK:**

```bash
pip install agenttrace-io
```

**From source (monorepo + CLI/dashboard):**

```bash
git clone https://github.com/Klepsiphron/agenttrace.git
cd agenttrace
pnpm install && pnpm build
```

### TypeScript

```typescript
import { init } from '@agenttrace-io/sdk';

const agent = init({ dbPath: './traces.db' });
const result = await agent.trace('my-agent', async () => {
  return await callLLM(input);
});

console.log(agent.getStats());
agent.close();
```

### Python

```python
from agenttrace import init

agent = init(db_path="./traces.db")
result = agent.trace("my-op", lambda: "hello")
print(agent.get_stats())
agent.close()
```

(Also supports `@trace("name")` decorator and `with agent.trace("name") as t: t.set_output(...)` context manager.)

### CLI

```bash
npx agenttrace-io init                    # create ./agenttrace.db
npx agenttrace-io runs                    # list recent runs
npx agenttrace-io traces --limit 20       # list traces
npx agenttrace-io stats                   # summary stats
npx agenttrace-io costs --daily           # cost by model or day
npx agenttrace-io export --format csv     # or json, otel
npx agenttrace-io dashboard               # start UI at http://localhost:4317
npx agenttrace-io tree --trace-id <id>    # multi-agent trace tree
npx agenttrace-io alerts list             # or test --name N, history
npx agenttrace-io self-stats              # self-tracked agent usage (today/week)
npx agenttrace-io --help
```

Alias `npx agenttrace` also works.

### Docker

```bash
docker compose up -d
# Dashboard + API: http://localhost:4317
```

## Packages

- `@agenttrace-io/sdk` — TS/Node core SDK (tracing, costs, evals, alerts, OTEL, SelfTracker)
- `agenttrace-io` — Python SDK (PyPI: `pip install agenttrace-io`)
- `@agenttrace-io/cli` — CLI (`agenttrace-io` and `agenttrace` bins)
- `@agenttrace-io/dashboard` — Embedded local dashboard (Express)
- `@agenttrace-io/middleware-langgraph` — LangGraph node auto-tracing
- `agenttrace-io-middleware-crewai` — CrewAI task/tool auto-tracing (pip)

## CLI Commands

init, dashboard, runs, traces, stats, costs, export, tree, alerts (list|test|history), benchmark, health, self-stats, version.

Flags: `--json`, `--limit`, `--status`, `--run-id`, `--format json|csv|otel`, `--daily`, `--trace-id`, `--port`/`--host` (dashboard), etc.

## Features

- **Drop-in tracing** — `agent.trace(name, fn)` (TS async; Py sync/async + decorator + context manager)
- **Cost tracking** — 15+ models out of box (gpt-4*, claude-*, gemini-_, llama-_); runtime `registerModelRate()`
- **Local SQLite** — Single `agenttrace.db` (runs + traces + tool_calls + scores + alerts + alert_history + agent_usage + links); auto cleanup
- **CLI-first** — Full query/export/eval/alerts/self-stats in terminal; colored tables; machine `--json`
- **Local dashboard** — Zero-config web UI on port 4317
- **Evaluation/scoring** — `score(name, (trace)=>number)`, `evaluate({scorers, runId?, traceIds?})`; scores persisted
- **Alerts** — `registerAlert({name, condition:(stats)=>boolean, webhook?, cooldown?})`; auto-fire after traces + cooldown; webhook delivery + history; `alerts` CLI
- **Multi-agent** — `createChild(context)`, `linkTraces(ids)`, `getTraceTree(id)`; `tree` CLI
- **OTEL export** — `export('otel')` or CLI `--format otel` → OTLP JSON (no external deps)
- **Agent usage tracking** — `agent_usage` table + `SelfTracker` class (actions, delegations, research, implementation, reviews for self-observing agents e.g. OWL/Hermes); `self-stats` shows today/week/top actions/costs/sessions
- **Framework middleware** — LangGraph (TS), CrewAI (Py events for tasks+tools)
- **Docker** — `docker compose`; named volume for persistent db; healthcheck
- **Health & runs** — `startRun`/`completeRun`, `getHealth()`, `health` CLI

## Why AgentTrace?

|                            |     AgentTrace      |    Langfuse     |    LangSmith    |
| -------------------------- | :-----------------: | :-------------: | :-------------: |
| **Local-first (no cloud)** |         ✅          | ❌ (Docker/K8s) | ❌ (cloud only) |
| **Open source**            |         MIT         |       MIT       |     Closed      |
| **CLI**                    |         ✅          |       ❌        |       ❌        |
| **Framework lock-in**      |        None         |      None       | LangGraph only  |
| **Setup**                  | npm/pip or git+pnpm | Docker compose  |     Sign up     |
| **Data leaves machine**    |        Never        |  Cloud option   |     Always      |

**Choose AgentTrace** when you need privacy, simplicity, and zero-config observability.

## Documentation

- [Full docs](https://klepsiphron.github.io/agenttrace/)
- [API reference](https://klepsiphron.github.io/agenttrace/api.html)
- [Installation guide](https://klepsiphron.github.io/agenttrace/install.html)
- [User guide](https://klepsiphron.github.io/agenttrace/guide.html)

## Examples

- [LangGraph](examples/langgraph/README.md)
- [CrewAI](examples/crewai/README.md)
- [Custom](examples/custom/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Klepsiphron
