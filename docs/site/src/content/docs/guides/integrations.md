---
title: Framework Integrations
description: Integrate AgentTrace with LangGraph, CrewAI, and custom agents.
---

AgentTrace provides middleware packages for popular agent frameworks. These auto-instrument your agents so every step is traced without manual `trace()` calls.

## LangGraph Middleware

**Package:** `@agenttrace-io/middleware-langgraph`

### Installation

```bash
npm install @agenttrace-io/middleware-langgraph
```

### Usage

The LangGraph middleware provides a callback handler that automatically traces each node execution:

```typescript
import { AgentTraceCallbackHandler } from '@agenttrace-io/middleware-langgraph';
import { init } from '@agenttrace-io/sdk';

const agent = init();

const callback = new AgentTraceCallbackHandler({
  agentInstance: agent,
  traceNodes: true,    // trace each graph node
  traceTools: true,    // trace tool calls
  traceLLM: true,      // trace LLM calls
});

// Pass to your LangGraph agent
const result = await graph.invoke(
  { messages: [{ role: 'user', content: 'Hello' }] },
  { callbacks: [callback] },
);
```

### What Gets Traced

- **Graph nodes** — each node execution becomes a trace with input/output
- **Tool calls** — tool invocations with arguments and results
- **LLM calls** — model, tokens, latency automatically captured

### With Runs

```typescript
const runId = agent.startRun('langgraph-agent', { model: 'gpt-4o' });

const result = await graph.invoke(input, { callbacks: [callback] });

agent.completeRun('success');
```

## CrewAI Middleware

**Package:** `@agenttrace-io/middleware-crewai`

### Installation

```bash
pip install agenttrace-io
# CrewAI middleware is included in the Python SDK
```

### Usage

```python
from agenttrace import init, CrewAITracer
from crewai import Crew, Agent, Task

agent = init()

# Wrap your crew with the tracer
tracer = CrewAITracer(agent_instance=agent)

crew = Crew(
    agents=[...],
    tasks=[...],
)

# Trace the entire crew execution
with tracer.trace_crew(crew, name="research-crew"):
    result = crew.kickoff()
```

### What Gets Traced

- **Agent executions** — each agent's work becomes a trace
- **Task steps** — individual task executions
- **Tool usage** — tool calls with inputs/outputs
- **Delegation** — agent-to-agent delegation events

### Decorator Form

```python
from agenttrace import init, crewai_trace

agent = init()

@crewai_trace(agent, name="my-crew")
def run_crew():
    crew = Crew(agents=[...], tasks=[...])
    return crew.kickoff()

result = run_crew()
```

## Custom Agent Integration

For agents not using LangGraph or CrewAI, wrap your logic manually:

### TypeScript

```typescript
import { init, TraceContext } from '@agenttrace-io/sdk';

const at = init();
const runId = at.startRun('custom-agent');

// Trace individual steps
const plan = await at.trace('plan', async () => planStep(input), { input });
const exec = await at.trace('execute', async () => executeStep(plan), { input: plan });
const review = await at.trace('review', async () => reviewStep(exec), { input: exec });

at.completeRun('success');
```

### Multi-agent with parent/child

```typescript
const parentCtx = new TraceContext(parentTraceId);

// Each sub-agent gets a child context
const childCtx1 = at.createChild(parentCtx);
const childCtx2 = at.createChild(parentCtx);

await at.trace('sub-agent-1', fn1, { context: childCtx1 });
await at.trace('sub-agent-2', fn2, { context: childCtx2 });

// View the tree
const tree = at.getTraceTree(parentTraceId);
```

### Python

```python
from agenttrace import init, AgentTrace

agent = init()
rid = agent.start_run("custom-agent")

with agent.trace("plan") as t:
    plan = plan_step(input_data)
    t.set_output(plan)

with agent.trace("execute") as t:
    result = execute_step(plan)
    t.set_output(result)
    t.set_tokens({"prompt_tokens": 100, "completion_tokens": 50, "model": "gpt-4o"})

agent.complete_run("success")
```

## Integration Pattern Summary

| Framework | Package | Auto-traces | Manual `trace()` needed? |
|-----------|---------|-------------|--------------------------|
| LangGraph | `@agenttrace-io/middleware-langgraph` | Nodes, tools, LLM calls | No |
| CrewAI | `agenttrace-io` (Python) | Agents, tasks, tools | No |
| Custom | `@agenttrace-io/sdk` / `agenttrace-io` | Nothing automatic | Yes |
