# AgentTrace

**Open source AI agent observability.** Trace every token, tool call, and LLM invocation with a local dashboard. Zero cloud dependency.

## Quick Start

### Install from source

```bash
git clone https://github.com/Klepsiphron/agenttrace.git
cd agenttrace
pnpm install && pnpm build
```

### TypeScript

```typescript
import { init, trace } from '@agenttrace/sdk';

const agent = init();
const result = await trace('my-agent', async () => {
  return await callLLM(input);
});

// View traces
console.log(agent.getStats());
agent.close();

// Or use the CLI
// npx agenttrace dashboard
```

### Python

```bash
cd packages/sdk-python
pip install -e ".[dev]"
```

```python
from agenttrace import init, trace

agent = init(db_path="./traces.db")
result = agent.trace("my-op", lambda: "hello")
print(agent.get_stats())
agent.close()
```

### CLI

```bash
npx agenttrace init           # Create database
npx agenttrace runs           # List recent runs
npx agenttrace stats          # Show statistics
npx agenttrace dashboard      # Start local dashboard at localhost:4317
```

### Docker

```bash
docker compose up -d
# Dashboard: http://localhost:4317
```

## Features

- **Drop-in SDK** -- Wrap any async function with `trace()` in one line
- **Cost tracking** -- Automatic cost calculation for 10+ LLM models
- **SQLite storage** -- All traces local, no cloud, no telemetry
- **CLI** -- Query traces, stats, exports, evaluate from the terminal
- **Local dashboard** -- Dark-themed web UI for debugging runs
- **Evaluation** -- Score traces with custom scorers
- **Alerting** -- Webhook notifications on failures
- **Multi-agent** -- Trace trees across collaborating agents
- **TypeScript + Python** -- SDKs for both ecosystems
- **Framework middleware** -- LangGraph and CrewAI integrations
- **OpenTelemetry export** -- OTLP JSON for integration with existing tools

## Why AgentTrace?

|                            |    AgentTrace    |    Langfuse     |    LangSmith    |
| -------------------------- | :--------------: | :-------------: | :-------------: |
| **Local-first (no cloud)** |        ✅        | ❌ (Docker/K8s) | ❌ (cloud only) |
| **Open source**            |       MIT        |       MIT       |     Closed      |
| **CLI**                    |        ✅        |       ❌        |       ❌        |
| **Framework lock-in**      |       None       |      None       | LangGraph only  |
| **Setup**                  | git clone + pnpm | Docker compose  |     Sign up     |
| **Data leaves machine**    |      Never       |  Cloud option   |     Always      |

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
