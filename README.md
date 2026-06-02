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
npx agenttrace init           # Create database
npx agenttrace runs           # List recent runs
npx agenttrace stats          # Show statistics
npx agenttrace export --format json --output traces.json
npx agenttrace dashboard      # Start local dashboard
```

## Packages

| Package | Description |
|---------|-------------|
| `@agenttrace/sdk` | TypeScript SDK |
| `@agenttrace/dashboard` | Local web dashboard |
| `@agenttrace/cli` | CLI tool |
| `agenttrace` (PyPI) | Python SDK |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Your Agent                     │
│  const result = await trace('name', async () => {│
│    // agent logic                                │
│  });                                             │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              AgentTrace SDK                      │
│  - Collects traces, tool calls, token usage      │
│  - Calculates cost                                │
│  - Stores in SQLite                               │
└───────────────────┬─────────────────────────────┘
                    │
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐    ┌──────────────────────┐
│  CLI         │    │  Dashboard (local)    │
│  runs, stats │    │  traces, costs, tests │
└──────────────┘    └──────────────────────┘
```

## Examples

- [LangGraph](examples/langgraph/README.md) -- 2-node graph with research + summarize
- [CrewAI](examples/crewai/README.md) -- Multi-agent workflow
- [Custom](examples/custom/README.md) -- Basic SDK usage with manual token tracking

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Klepsiphron
