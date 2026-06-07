---
title: Debugging Agents
description: Use traces to find failing steps, broken tools, and slow operations.
---

When an agent fails or is slow, traces tell you exactly which step, which tool, and the numbers.

## Reproduce a failing run

Run your agent (it will record even on error).

### TypeScript

```typescript
import { init, trace } from '@agenttrace-io/sdk';

const agent = init();
const runId = agent.startRun('debug-demo');

try {
  await trace('planner', async () => { /* ... */ });

  await trace(
    'tool:web_search',
    async () => {
      throw new Error('rate limit from search API');
    },
    { input: { q: 'agent observability' } },
  );

  await trace('writer', async () => 'done');
} catch (e) {
  console.error('agent failed:', e);
} finally {
  agent.completeRun('error');
}
```

### Python

```python
from agenttrace import init

agent = init()
rid = agent.start_run("debug-demo")

try:
    agent.trace("planner", lambda: "plan")
    agent.trace("tool:web_search", lambda: (_ for _ in ()).throw(RuntimeError("rate limit")))
    agent.trace("writer", lambda: "done")
except Exception as e:
    print("agent failed:", e)
finally:
    agent.complete_run("error")
```

## Find the failing step

### CLI (fastest)

```bash
npx agenttrace-io traces --status error --limit 10
# Or for a specific run
npx agenttrace-io traces --run-id <rid> --json
```

### TypeScript

```typescript
const errors = agent.getTraces({ status: ['error'] });
const runErrors = agent.getTraces({ runId: 'run-xxx', status: ['error', 'failure'] });
const toolFails = agent.getTraces({ name: 'tool:' }).filter((t) => t.status !== 'success');
```

### Python

```python
errors = agent.get_traces({"status": ["error"]})
for t in errors:
    print(t.name, t.error, t.latency_ms)

run_traces = agent.get_traces({"run_id": rid, "status": ["error"]})
tool_fails = [t for t in agent.get_traces() if t.name.startswith("tool:") and t.status != "success"]
```

Each failing trace contains `name`, `error`, `input`/`output`, `latencyMs`, and `toolCalls`.

## Inspect broken tool calls

```typescript
const bad = agent.getTrace('the-trace-id');
if (bad?.toolCalls?.length) {
  bad.toolCalls.forEach((tc) => {
    if (!tc.success) console.log('BROKEN TOOL:', tc.name, tc.error, tc.input);
  });
}
```

## Analyze latency

### CLI

```bash
npx agenttrace-io stats
npx agenttrace-io traces --min-latency 2000   # >2s
```

### TypeScript

```typescript
const slow = agent.getTraces({ minLatency: 1500 }).sort((a, b) => b.latencyMs - a.latencyMs);

console.table(
  slow.map((t) => ({
    name: t.name,
    latency: t.latencyMs + 'ms',
    cost: t.costUsd,
    status: t.status,
  })),
);

const stats = agent.getStats();
console.log('Average latency:', stats.avgLatencyMs, 'ms');
```

### Python

```python
slow = sorted(
    [t for t in agent.get_traces() if t.latency_ms > 1500],
    key=lambda t: t.latency_ms,
    reverse=True
)

for t in slow[:5]:
    print(f"{t.name}: {t.latency_ms}ms cost=${t.cost_usd:.4f} status={t.status}")

stats = agent.get_stats()
print("avg latency ms:", stats.avg_latency_ms)
```

## Use trace trees for complex agents

If you link steps with `createChild` (TS) or manual parentId:

```bash
npx agenttrace-io tree --trace-id <root-id>
```

```typescript
const childCtx = agent.createChild(parentCtx);
await trace('child-step', async () => { /* ... */ }, { context: childCtx });
const tree = agent.getTraceTree(rootTraceId);
```

## Tips

- Always pass `input` so you can see what arguments reached the bad tool
- Use `metadata: { userId, session }` for filtering later
- After a bad run, `npx agenttrace-io export --run-id X --format json` to attach to a bug report
