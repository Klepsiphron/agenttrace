# AgentTrace

**Open source AI agent observability.** Trace every token, tool call, and LLM invocation with a local dashboard. Zero cloud dependency.

## Why

AI agents are black boxes. When one fails, you don't know which tool call broke, how much it cost, or where the latency spiked. AgentTrace opens the box.

## Features

- **Drop-in SDK** -- Wrap any async function with `trace()` in one line
- **Cost tracking** -- Automatic cost calculation for 6+ LLM models
- **SQLite storage** -- All traces local, no cloud, no telemetry
- **CLI** -- Query traces, stats, exports from the terminal
- **Local dashboard** -- Dark-themed web UI for debugging runs
- **TypeScript + Python** -- SDKs for both ecosystems
- **Framework middleware** -- LangGraph and CrewAI integrations
- **OpenTelemetry export** -- OTLP JSON for integration with existing tools
- **Framework agnostic** -- Works with LangGraph, CrewAI, AutoGen, or custom agents

## Quickstart

### TypeScript

```bash
npm install @agenttrace/sdk
```

```typescript
import { init, trace } from '@agenttrace/sdk';

const agent = init();
const result = await trace('my-agent', async () => {
  return await callLLM(input);
});
```

### Python

```bash
pip install agenttrace
```

```python
from agenttrace import init, trace

agent = init()
result = agent.trace("my-op", lambda: call_llm(input))
```

### CLI

```bash
npx agenttrace init                              # Create database
npx agenttrace runs --limit 10 --status success  # List recent runs
npx agenttrace stats                             # Show statistics
npx agenttrace export --format json              # Export traces
npx agenttrace dashboard                         # Start local dashboard
npx agenttrace version                           # Show version
```

### Docker (self-hosting)

Run the full AgentTrace dashboard + API as a containerized service. The dashboard (UI + REST API) listens on port 4317.

```bash
# From repo root (includes Dockerfile + docker-compose.yml)
docker compose up -d
```

- Dashboard: http://localhost:4317
- DB persisted via Docker volume (`agenttrace-data`)
- Stop: `docker compose down`

Build only:

```bash
docker build -t agenttrace .
```

Run ad-hoc with volume:

```bash
docker run -p 4317:4317 -v agenttrace-data:/app/data \
  -e AGENTTRACE_DB_PATH=/app/data/agenttrace.db agenttrace
```

See `docker-compose.yml` and `Dockerfile` for configuration details (multi-stage Alpine build, pnpm + Python for native deps, prod-pruned image).

## Packages

| Package                            | Registry | Description           |
| ---------------------------------- | -------- | --------------------- |
| `@agenttrace/sdk`                  | npm      | TypeScript SDK        |
| `agenttrace`                       | PyPI     | Python SDK            |
| `@agenttrace/dashboard`            | npm      | Local web dashboard   |
| `@agenttrace/cli`                  | npm      | CLI tool              |
| `@agenttrace/middleware-langgraph` | npm      | LangGraph integration |
| `agenttrace-middleware-crewai`     | PyPI     | CrewAI integration    |

## Why AgentTrace?

|                            | AgentTrace  |    Langfuse     |    LangSmith    |
| -------------------------- | :---------: | :-------------: | :-------------: |
| **Local-first (no cloud)** |     ✅      | ❌ (Docker/K8s) | ❌ (cloud only) |
| **Open source**            |     MIT     |       MIT       |     Closed      |
| **CLI**                    |     ✅      |       ❌        |       ❌        |
| **Framework lock-in**      |    None     |      None       | LangGraph only  |
| **Setup**                  | npm install | Docker compose  |     Sign up     |
| **Data leaves machine**    |    Never    |  Cloud option   |     Always      |

**Choose AgentTrace** when you need privacy, simplicity, and zero-config observability. No accounts, no cloud, no telemetry.

## Documentation

- [Full documentation](https://klepsiphron.github.io/agenttrace/)
- [API reference](https://klepsiphron.github.io/agenttrace/api.html)
- [Installation guide](https://klepsiphron.github.io/agenttrace/install.html)

## Examples

- [LangGraph](examples/langgraph/README.md) -- 2-node graph with research + summarize
- [CrewAI](examples/crewai/README.md) -- Multi-agent workflow
- [Custom](examples/custom/README.md) -- Basic SDK usage with manual token tracking

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Klepsiphron
