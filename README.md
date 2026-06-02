# AgentTrace

**Open source AI agent observability.** Trace everything: token spend, tool calls, latency, success rates, and hallucination signals. Local dashboard. Zero cloud dependency.

## Why

AI agents are hard to debug. When an agent fails, you don't know:
- Which tool call went wrong
- How much it cost
- Where the bottleneck was
- Whether it hallucinated

AgentTrace gives you full visibility into every agent run. Like Datadog for AI agents, but fully local and open source.

## Features

- **Zero-dependency SDK** -- Drop-in wrapper for any agent function
- **SQLite storage** -- All traces stored locally, no cloud dependency
- **Local dashboard** -- Web UI for debugging agent runs
- **CLI tool** -- Query traces, export data, view stats from the terminal
- **Framework agnostic** -- Works with LangGraph, CrewAI, AutoGen, or custom agents

## Quickstart

```bash
# Install
npm install @agenttrace/sdk

# Initialize
npx agenttrace init

# In your code
import { init, trace } from '@agenttrace/sdk';

const agent = init();

async function myAgent(input: string) {
  return await trace('my-agent', async () => {
    // Your agent logic here
    const result = await callLLM(input);
    return result;
  });
}

// View the dashboard
npx agenttrace dashboard
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Your Agent                     │
│                                                  │
│  const result = await trace('name', async () => { │
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
│  - Zero cloud dependency                          │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│           Dashboard (localhost:3000)              │
│  - Recent runs list                               │
│  - Trace detail view                              │
│  - Cost/success/latency charts                    │
│  - Export to JSON/CSV                             │
└─────────────────────────────────────────────────┘
```

## License

MIT © Klepsiphron
