---
title: Quick Start
description: Trace your first agent operation in under a minute.
---

Trace your first agent operation in under a minute. AgentTrace stores everything in a local SQLite file (`agenttrace.db`) with zero cloud calls.

## 1. Install

```bash
# TypeScript / Node
npm install @agenttrace-io/sdk

# Python
pip install agenttrace-io

# CLI (for dashboard + export commands)
npm install -g @agenttrace-io/cli
```

## 2. Init

```typescript
import { init } from '@agenttrace-io/sdk';

const agent = init(); // uses ./agenttrace.db
```

```python
from agenttrace import init

agent = init()  # uses ./agenttrace.db
```

## 3. Trace

### TypeScript

```typescript
import { init, trace } from '@agenttrace-io/sdk';

const agent = init();

const result = await agent.trace(
  'llm-call',
  async () => {
    return await callYourLLM({ model: 'gpt-4o', messages });
  },
  {
    input: { messages },
    tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    model: 'gpt-4o',
    provider: 'openai',
  },
);
```

### Python

```python
from agenttrace import init

agent = init()

# Context manager
with agent.trace("llm-call") as t:
    result = call_your_llm(model="gpt-4o", messages=messages)
    t.set_output(result)
    t.set_tokens({"prompt_tokens": 100, "completion_tokens": 50, "model": "gpt-4o"})

# Decorator
@agent.trace("my-step")
def my_step():
    return "result"
```

## 4. View

```bash
# Launch the dashboard
npx agenttrace-io dashboard

# Or use the CLI
npx agenttrace-io runs --limit 5
npx agenttrace-io traces --limit 20
npx agenttrace-io stats
```

Open `http://localhost:4317` — you'll see runs, traces, latency, costs, tool calls, and errors.

## Next Steps

- [Installation details](/getting-started/installation)
- [Dashboard guide](/getting-started/dashboard)
- [TypeScript SDK reference](/sdk-reference/typescript)
- [Python SDK reference](/sdk-reference/python)
- [Debugging agents](/guides/debugging)
