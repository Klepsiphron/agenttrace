# AgentTrace

**Open source AI agent observability.** Trace every token, tool call, and LLM invocation with a local dashboard. Zero cloud dependency.

## Why

AI agents are black boxes. When one fails, you don't know which tool call broke, how much it cost, or where the latency spiked. AgentTrace opens the box.

## Features

- **Drop-in SDK** -- Wrap any async function with `trace()` in one line
- **Cost tracking** -- Automatic cost calculation for 6+ LLM models
- **SQLite storage** -- All traces local, no cloud, no telemetry
- **Local dashboard** -- Dark-themed web UI for debugging runs
- **CLI tool** -- Query, export, and analyze traces from the terminal
- **Framework agnostic** -- Works with LangGraph, CrewAI, AutoGen, or custom agents

## Quickstart

```bash
npm install @agenttrace/sdk
npx agenttrace init
```

```typescript
import { init, trace } from '@agenttrace/sdk';

const agent = init();

async function myAgent(input: string) {
  return await trace('my-agent', async () => {
    const result = await callLLM(input);
    return result;
  });
}
```

```bash
npx agenttrace dashboard  # Open http://localhost:3000
```

## Packages

| Package | Description |
|---------|-------------|
| `@agenttrace/sdk` | Core tracing SDK |
| `@agenttrace/dashboard` | Local web dashboard |
| `@agenttrace/cli` | CLI for querying traces |

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
│              @agenttrace/sdk                     │
│  - Collects traces, tool calls, token usage      │
│  - Calculates cost                                │
│  - Stores in SQLite                               │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│           SQLite Database (local)                │
│  - runs, traces, tool_calls tables               │
│  - Full query support                             │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│           Dashboard (localhost:3000)              │
│  - Recent runs list                               │
│  - Trace detail view                              │
│  - Cost/success/latency stats                     │
│  - Export to JSON/CSV                             │
└─────────────────────────────────────────────────┘
```

## Examples

- [LangGraph](examples/langgraph/README.md) -- 2-node graph with research + summarize
- [CrewAI](examples/crewai/README.md) -- Multi-agent workflow
- [Custom](examples/custom/README.md) -- Basic SDK usage with manual token tracking

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Klepsiphron
