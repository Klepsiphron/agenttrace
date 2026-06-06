# Quick Start

Get full visibility into your AI agents in under a minute. Local SQLite database. Zero cloud required.

## Install

### CLI (recommended for exploration)

```bash
npm install -g @agenttrace-io/cli
# or use npx without installing:
# npx agenttrace-io <command>
```

The CLI provides `agenttrace-io` and the shorter `agenttrace` alias.

### TypeScript / Node SDK

```bash
npm install @agenttrace-io/sdk
```

### Python SDK

```bash
pip install agenttrace-io
```

## Trace Your First Agent (TypeScript)

```ts
import { init } from '@agenttrace-io/sdk';

const agent = init({ dbPath: './agenttrace.db' });

// Start a logical run (groups related traces)
agent.startRun('support-session-42');

const result = await agent.trace(
  'web-search',
  async () => {
    // Your LLM or tool call here
    const response = await callYourLLM({ prompt: 'Find pricing for X' });
    return response;
  },
  {
    input: 'Find pricing for X',
    tokens: {
      promptTokens: 142,
      completionTokens: 67,
      totalTokens: 209,
      model: 'gpt-4o-mini',
      provider: 'openai',
    },
    metadata: { userId: 'u_123' },
  },
);

// Always close when you're done (flushes retention timers etc.)
agent.close();
```

### Using the singleton helper

```ts
import { init, getAgentTrace } from '@agenttrace-io/sdk';

init({ dbPath: './my.db' });
const agent = getAgentTrace();
// ... later in your code
```

## Python Example

```python
from agenttrace import init

agent = init(db_path="./agenttrace.db")

@agent.trace("research")
def research(query: str):
    # your agent logic
    return llm_call(query)

result = research("latest model benchmarks")
print(agent.get_stats())
agent.close()
```

Context manager and decorator forms are also supported — see the Python package docs.

## View Data with the CLI

```bash
# Create a fresh DB in current directory
npx agenttrace-io init

# Run your instrumented code (it will write to ./agenttrace.db)

# See high-level stats
npx agenttrace-io stats

# Cost breakdown (by model or --daily)
npx agenttrace-io costs --daily

# Recent traces
npx agenttrace-io traces --limit 30

# Full multi-agent tree for a trace
npx agenttrace-io tree --trace-id <trace-id>

# Self-tracked agent usage (for meta-agents / OWL / Hermes patterns)
npx agenttrace-io self-stats

# Export for audits or downstream tools
npx agenttrace-io export --format csv --output traces.csv
npx agenttrace-io export --format otel   # OTLP JSON (no external deps)
```

## Launch the Local Dashboard

```bash
npx agenttrace-io dashboard
# or with options:
npx agenttrace-io dashboard --port 4500 --host 0.0.0.0
```

Opens a fast, private web UI at http://localhost:4317 (default). All data stays on your machine.

## Common Next Steps

- Add `recordToolCall()` inside a `trace()` for detailed tool observability.
- Use `createChild(context)` + `linkTraces()` for hierarchical / multi-agent tracing.
- Register alerts that fire webhooks on cost thresholds or error rates.
- Add the LangGraph or CrewAI middleware packages for automatic instrumentation.
- Set retention policy: `agent.setRetentionPolicy(90)` (days).

## Environment Variable

Point every command and SDK instance at a specific database:

```bash
export AGENTTRACE_DB_PATH=/path/to/shared/agenttrace.db
```

## Full Documentation

- [API Reference](./api.md)
- [Enterprise & Governance](./enterprise.md)
- GitHub: https://github.com/Klepsiphron/agenttrace
- Main README in the repo for examples and architecture.

That's it — you're tracing. Your agents will never surprise you with a token bill again.
