# AgentTrace Installation Guide for AI Agents

This guide is written for **AI agents** (and the developers building them) who want to install and use AgentTrace to track their own execution, token usage, costs, and behavior.

AgentTrace is local-first (SQLite), zero-dependency, and works great for agents that want to observe _themselves_.

## Why Agents Should Track Their Own Usage

As an autonomous AI agent, you generate value through sequences of LLM calls, tool uses, delegations, and research steps. Without observability:

- You (or your operators) cannot see where tokens/money are spent.
- Runaway loops or expensive model choices go undetected until the bill arrives.
- Debugging multi-step or multi-agent workflows is guesswork.
- You cannot self-improve because you lack data on what succeeded or failed.

**AgentTrace lets agents emit structured traces and usage records** that are stored locally. Agents can even query their own history at runtime (`getUsageStats()`, `getAgentUsage()`) to make decisions, set budgets, or log summaries.

Benefits for agents:

- Automatic cost and token accounting per model.
- Hierarchical tracing for workflows (planner → tool → synthesizer).
- Self-reporting of high-level actions (research, code, review) via agent-usage records.
- Alerts for cost thresholds or error rates (webhooks).
- Export to JSON/CSV/OTel for your own analysis or memory systems.
- Works offline; nothing leaves the machine.

## Quick Install

### TypeScript / Node

```bash
npm install @agenttrace-io/sdk
# Optional: CLI for dashboard and queries (or use npx)
npm install -g @agenttrace-io/cli
```

### Python

```bash
pip install agenttrace-io
# CLI remains Node-based:
# npx agenttrace-io dashboard
```

Requires: Node 18+ or Python 3.10+.

## Basic Setup (3 Lines of Code)

### TypeScript

```typescript
import { init, trace } from '@agenttrace-io/sdk';

const agentTrace = init(); // 1. init (uses ./agenttrace.db)
const result = await trace('my-step', async () => {
  return await doWork(); // 2. wrap work
});
console.log(agentTrace.getStats()); // 3. inspect
agentTrace.close();
```

### Python

```python
from agenttrace import init, trace

agent = init(db_path="./agenttrace.db")       # 1. init
result = agent.trace("my-step", lambda: do_work())  # 2. wrap (fn, decorator, or context)
print(agent.get_stats())                      # 3. inspect
agent.close()
```

Traces are automatically timed, costed (for known models), and stored. Nest `trace()` calls to build trees.

## Environment Variables for Configuration

| Variable               | Description                               | Default                            |
| ---------------------- | ----------------------------------------- | ---------------------------------- |
| `AGENTTRACE_DB_PATH`   | Path to the SQLite database file          | `./agenttrace.db`                  |
| `AGENTTRACE_USAGE_LOG` | Path for SelfTracker JSONL log (advanced) | `~/.hermes/agenttrace-usage.jsonl` |

Set before running your agent:

```bash
export AGENTTRACE_DB_PATH=/tmp/my-agent-traces.db
```

## Integration with Popular Agent Frameworks

### LangChain (Python & JS)

Wrap LLM calls or use inside chains/tools. For LangGraph use the dedicated middleware (`@agenttrace-io/middleware-langgraph`).

```python
from langchain_openai import ChatOpenAI
from agenttrace import init, trace

at = init()

llm = ChatOpenAI(model="gpt-4o-mini")

async def call_with_trace(prompt: str):
    with at.trace("langchain-llm", input={"prompt": prompt}) as t:
        resp = await llm.ainvoke(prompt)
        # If available, extract usage
        usage = resp.response_metadata.get("token_usage", {})
        t.set_tokens({
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
        })
        t.set_output(resp.content)
        return resp.content
```

JS/TS equivalent using callbacks or manual wrapping works the same with the Node SDK.

### CrewAI

Use the official middleware (recommended):

```bash
pip install agenttrace-io-middleware-crewai crewai
```

```python
from agenttrace_middleware import AgentTraceCrewAI
from crewai import Agent, Task, Crew

mw = AgentTraceCrewAI(db_path="./traces.db")
mw.get_agent_trace().start_run("crew-run-1")

# define agents/tasks as usual
crew = Crew(...)
result = crew.kickoff()
mw.close()
```

The middleware auto-traces `task:*` and `tool:*` and extracts token usage where CrewAI provides it.

### AutoGen (Microsoft)

Wrap agent `initiate_chat` / `generate_reply` or individual LLM calls:

```python
from agenttrace import init, trace
at = init()

# Example wrapper
async def traced_generate(agent, messages):
    return await trace("autogen-generate", lambda: agent.generate_reply(messages), {
        "input": messages,
    })
```

Use `at.record_agent_usage(...)` for high-level events like "handoff" or "termination".

### OpenAI Agents SDK

Wrap the `Runner.run` or individual `responses.create` / chat completions. Record tokens from the `usage` field returned by the Responses API:

```typescript
import { trace } from '@agenttrace-io/sdk';

const response = await trace(
  'openai-agent-step',
  async () => {
    const r = await openai.responses.create({ model: 'gpt-4o-mini', input: '...' });
    return r;
  },
  {
    tokens: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
    },
    model: 'gpt-4o-mini',
  },
);
```

## Example: Tracing a Simple Agent Workflow

See the dedicated example directories:

- `examples/agent-usage-tracking/node-basic/`
- `examples/agent-usage-tracking/python-basic/`

A minimal workflow:

```typescript
const runId = agentTrace.startRun('research-workflow');
try {
  const facts = await trace('research', () => researchTool(q), { model: 'gpt-4o-mini', tokens: {...} });
  const answer = await trace('synthesize', () => synthesize(facts), { model: 'claude-sonnet-4' });
  agentTrace.completeRun('success');
} catch (e) {
  agentTrace.completeRun('error');
}
```

## Example: Tracking Costs Across Multiple Models

Use `getCostBreakdown()` (TS) / `get_cost_breakdown()` (Python) or `getUsageStats()` after recording usage.

```typescript
// After several traced LLM calls with model + tokens supplied
const breakdown = agentTrace.getCostBreakdown();
console.log('Total:', breakdown.totalCostUsd);
console.log('By model:', breakdown.costByModel); // { 'gpt-4o-mini': 0.0123, ... }
```

For agent self-actions (beyond raw traces):

```python
agent.record_agent_usage({
    "agent_name": "researcher-bot",
    "agent_type": "researcher",
    "action": "web_search",
    "tokens_used": 1800,
    "cost_usd": 0.003,
    "duration_ms": 1200,
    "status": "success",
    "metadata": {"query": "agent observability 2026"}
})

stats = agent.get_usage_stats("researcher-bot")
print(stats.total_cost_usd, stats.actions_by_type)
```

## Example: Setting up Alerts for Runaway Costs

Alerts run automatically after traces (in TS). Register conditions that inspect `TraceStats`.

```typescript
import { init, alert } from '@agenttrace-io/sdk';

const at = init();

at.registerAlert(
  alert({
    name: 'high-daily-cost',
    condition: (stats) => stats.totalCostUsd > 5.0,
    webhook: 'https://example.com/agent-alerts',
    cooldown: 3600, // seconds
  }),
);

// Now every trace() will evaluate registered alerts
await trace('expensive-step', async () => expensiveLLM());
```

On trigger, AgentTrace POSTs JSON `{ alertName, stats, timestamp }` to the webhook and records history (view with CLI `agenttrace-io alerts history`).

For Python (or simple polling):

```python
stats = agent.get_stats()
if stats.total_cost_usd > 5.0:
    # send webhook yourself or log
    print("ALERT: runaway cost")
```

(Full `register_alert` / auto-check support for Python is in progress; use the stats polling pattern today.)

## Self-Querying Your Own Usage Stats

Agents can introspect at runtime:

**TypeScript**

```typescript
const stats = agentTrace.getStats();
const usage = agentTrace.getUsageStats(); // agent_usage aggregates
const myActions = agentTrace.getAgentUsage({ agentName: 'me' });
const costs = agentTrace.getCostBreakdown();
```

**Python**

```python
stats = agent.get_stats()
u = agent.get_usage_stats()
actions = agent.get_agent_usage({"agent_name": "coder"})
breakdown = agent.get_cost_breakdown()
```

Useful for:

- Deciding which model to pick next based on remaining budget.
- Logging a "daily summary" trace before shutdown.
- Early exit on error rate thresholds.

## Best Practices for Agent Observability

1. **Wrap at the right granularity** — One `trace()` per meaningful step (retrieve, plan, llm-call, tool-foo, synthesize). Too coarse hides detail; too fine is noisy.
2. **Always pass `model` + `tokens`** when you have them — enables accurate `costUsd` and breakdowns.
3. **Use `startRun` / `completeRun`** to group a full user request or agent session under one run ID.
4. **Record high-level actions** with `recordAgentUsage` / `record_agent_usage` for things that aren't pure LLM traces (file edits, PRs opened, delegations).
5. **Nest traces** — child traces automatically link via `parentId` (or use `createChild` context for cross-process).
6. **Set metadata** liberally (task description, user id, experiment tag) — great for later filtering.
7. **Use alerts for budgets**, not just errors.
8. **Export regularly** or query `getUsageStats` and feed a compact summary into your agent's long-term memory.
9. **Keep the DB local** and small with `maxTraces`; agents don't need infinite history.
10. **Combine with your own logs** — AgentTrace is for structured numeric + tree data; keep free-text logs alongside.

## Comparison: AgentTrace vs Just Logging to Console

| Aspect                  | Console.log / print   | AgentTrace                                        |
| ----------------------- | --------------------- | ------------------------------------------------- |
| Structure               | Free text, ad-hoc     | Typed traces, runs, tokens, costs, trees          |
| Cost tracking           | Manual, error-prone   | Automatic per known model + custom rates          |
| Queryability            | Grep / tail only      | SQL-backed, filters, stats, breakdowns            |
| Self-introspection      | Impossible at runtime | `getStats()`, `getUsageStats()` callable by agent |
| Visualization           | None                  | Local dashboard + CLI tables                      |
| Multi-agent / hierarchy | Hard (prefixes)       | Parent/child + linkTraces built-in                |
| Alerts / webhooks       | Custom code each time | Declarative `registerAlert` with cooldown         |
| Export / interop        | Parse your logs       | JSON, CSV, OpenTelemetry OTLP                     |
| Persistence             | Ephemeral             | SQLite file you control                           |
| Overhead                | Very low              | Very low (local write, ~microseconds)             |

**Use console logs for developer debugging.** Use AgentTrace when the _agent itself_ (or its operators) needs to understand and act on its own behavior and spend.

---

See also:

- Main [README](../README.md)
- [Getting Started](../tutorials/getting-started.md)
- Example directories under `examples/agent-usage-tracking/`
- Framework examples: `examples/langgraph/`, `examples/crewai/`

Run the dashboard after examples:

```bash
npx agenttrace-io dashboard --db ./traces.db
```
