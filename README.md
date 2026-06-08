# AgentTrace

<p align="center">
  <img src="docs/assets/logo.svg" width="80" height="80" alt="AgentTrace logo" />
</p>

<h3 align="center">Open-source AI agent observability. Local-first. Zero cloud.</h3>

<p align="center">
  <a href="https://github.com/Klepsiphron/agenttrace/actions"><img src="https://img.shields.io/github/actions/workflow/status/Klepsiphron/agenttrace/ci.yml?branch=main&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@agenttrace-io/cli"><img src="https://img.shields.io/npm/v/@agenttrace-io/cli" /></a>
  <a href="https://pypi.org/project/agenttrace-io/"><img src="https://img.shields.io/pypi/v/agenttrace-io" /></a>
  <a href="https://github.com/Klepsiphron/agenttrace/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Klepsiphron/agenttrace" /></a>
</p>

---

**AgentTrace** gives you full visibility into your AI agents — every token, tool call, and cost. It stores everything locally in SQLite. No cloud. No accounts. No lock-in.

A clean, modern, universal tool for tracing any agentic system. One wrapper. Complete insight. Built for developers who value simplicity and ownership.

```bash
# Trace any agent in one line
agenttrace-io wrap claude "Write a hello world function"

# See what happened
agenttrace-io runs
agenttrace-io stats
```

[Features](#features) · [Quick Start](#quick-start) · [SDK Usage](#sdk-usage) · [Dashboard](#dashboard) · [CLI Reference](#cli-reference) · [Self-Hosting](#self-hosting) · [License](#license)

---

## Features

- **Zero-config tracing** -- `agenttrace-io wrap <command>` traces any CLI agent with zero code changes
- **Token & cost tracking** -- Every LLM call tracked with per-model pricing
- **Multi-agent correlation** -- Trace across agent trees with parent/child linking
- **Budget alerts** -- Set per-agent token limits, get alerts before overspend
- **Local dashboard** -- Dark-themed web UI, runs on localhost, no cloud dependency
- **SQLite storage** -- All data stays on your machine. No external database needed.
- **CLI-first** -- Full-featured terminal interface for CI/CD and scripting
- **TypeScript & Python SDKs** -- Drop-in tracing for any agent code
- **LangGraph & CrewAI middleware** -- Auto-tracing for popular agent frameworks
- **Webhooks** -- HMAC-signed delivery to Slack, Discord, custom endpoints
- **OpenTelemetry export** -- OTLP JSON format for integration with existing tools
- **MIT Licensed** -- Free for personal and commercial use

## Quick Start

### Install the CLI

```bash
npm install -g @agenttrace-io/cli
# or use npx without installing:
npx agenttrace-io <command>
```

### Trace Your First Agent

```bash
# Wrap any CLI command -- zero config, zero code changes
agenttrace-io wrap claude "Write a hello world function"
agenttrace-io wrap python my_agent.py

# View your traces
agenttrace-io runs --limit 10
agenttrace-io traces --run-id <id>

# See aggregate stats
agenttrace-io stats
```

### Set Budget Alerts

```bash
# Set a daily token budget for an agent
agenttrace-io budget set my-agent --tokens 1000000 --cost 50

# Check budget status
agenttrace-io budget status my-agent

# List all budgets
agenttrace-io budget list
```

### Launch the Dashboard

```bash
agenttrace-io dashboard
# → Opens at http://127.0.0.1:4317
```

## SDK Usage

### TypeScript / Node.js

```bash
npm install @agenttrace-io/sdk
```

```typescript
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace({ dbPath: './agenttrace.db' });

const runId = agent.startRun('my-session');

const result = await agent.trace(
  'research',
  async () => {
    // Your agent logic here
    return await searchAndSummarize(query);
  },
  {
    input: query,
    tokens: { promptTokens: 150, completionTokens: 50, totalTokens: 200 },
    model: 'gpt-4o',
  },
);

agent.completeRun();
agent.close();
```

### Python

```bash
pip install agenttrace-io
```

```python
from agenttrace import AgentTrace

agent = AgentTrace(dbPath='./agenttrace.db')
run_id = agent.start_run('my-session')

result = agent.trace('research', lambda: search_and_summarize(query))

agent.complete_run()
agent.close()
```

### Context Manager & Decorator (Python)

```python
with agent.trace('my-operation') as t:
    result = do_work()
    t.set_output(result)

@agent.trace('my-function')
def my_function():
    return compute()
```

## Dashboard

The local dashboard provides a dark-themed web UI for exploring traces.

```bash
agenttrace-io dashboard
```

Features:

- **Stats overview** -- Total runs, success rate, avg latency, total cost
- **Run list** -- Filterable by status, searchable by name
- **Trace drill-down** -- Expand any run to see individual traces
- **Token details** -- Per-trace token usage, model, cost
- **Tool calls** -- Input/output for every tool invocation
- **Export** -- JSON or CSV export of all traces
- **Auto-refresh** -- Live updates every 5 seconds

## CLI Reference

| Command      | Description                                     |
| ------------ | ----------------------------------------------- |
| `init`       | Create empty agenttrace.db in current directory |
| `wrap <cmd>` | Trace any CLI command (zero-config)             |
| `runs`       | List recent runs (most recent first)            |
| `traces`     | List traces, filter by run ID                   |
| `stats`      | Show summary statistics                         |
| `costs`      | Cost breakdown by model or by day               |
| `export`     | Export traces to JSON or CSV                    |
| `dashboard`  | Start the local web dashboard                   |
| `budget`     | Manage per-agent token budgets                  |
| `self-stats` | Show self-tracked usage stats                   |
| `who`        | Show active agents                              |
| `sessions`   | List agent sessions                             |
| `activity`   | Show recent agent activity timeline             |
| `alerts`     | Manage alert conditions                         |
| `webhooks`   | Manage webhook subscriptions                    |
| `cleanup`    | Run data retention cleanup                      |
| `retention`  | Manage retention policy                         |
| `health`     | Check database health                           |
| `version`    | Show CLI version                                |
| `benchmark`  | Run performance benchmarks                      |
| `tree`       | Show parent/child trace tree                    |

### Global Options

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |
| `--help` | Show help for any command    |

## Self-Hosting

### Docker

```bash
docker run -p 4317:4317 -v agenttrace-data:/app/data ghcr.io/klepsiphron/agenttrace
```

### Docker Compose

```bash
docker compose up -d
```

### From Source

```bash
git clone https://github.com/Klepsiphron/agenttrace.git
cd agenttrace
pnpm install
pnpm build
pnpm test
```

## Architecture

```
Agent Code
    │
    ▼
AgentTrace SDK ──→ SQLite (agenttrace.db)
                      │
                 ┌────┴────┐
                 │         │
               CLI     Dashboard
              (localhost:4317)
```

All data stays local. No external services required.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
