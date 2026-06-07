---
title: Python SDK
description: Complete reference for the agenttrace-io Python package.
---

**Module:** `agenttrace`
**Package:** `agenttrace-io` on PyPI

The Python SDK mirrors the TypeScript API. Both share the same SQLite schema and are functionally equivalent.

## Installation

```bash
pip install agenttrace-io
```

## AgentTrace Class

```python
from agenttrace import AgentTrace, init

agent = init()  # uses ./agenttrace.db
# or
agent = AgentTrace(db_path="./my.db", max_traces=5000)
```

### Constructor & TraceConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `db_path` | `str` | `'./agenttrace.db'` | SQLite database file path |
| `max_traces` | `int` | `10000` | Max traces retained |
| `auto_cleanup` | `bool` | `True` | Auto-cleanup after each trace |
| `silent` | `bool` | `False` | Suppress console output |
| `retention_days` | `int` | `30` | Data retention in days (0 = forever) |
| `tenant_id` | `str` | `''` | Multi-tenant scoping |

## Run Management

```python
run_id = agent.start_run("data-pipeline", metadata={"version": "1.0"})
# ... trace operations ...
agent.complete_run("success")
```

## Tracing: `trace()`

Three forms available:

### 1. Function form

```python
def my_function():
    return "result"

output = agent.trace("my-op", my_function, input={"key": "value"})
```

### 2. Context manager form

```python
with agent.trace("llm-call") as t:
    result = call_your_llm(...)
    t.set_output(result)
    t.set_tokens({"prompt_tokens": 100, "completion_tokens": 50, "model": "gpt-4o"})
    t.set_metadata({"provider": "openai"})
```

### 3. Decorator form

```python
@agent.trace("my-step")
def my_step(query: str):
    return call_llm(query)

result = my_step("hello")
```

### With tokens and model

```python
output = agent.trace(
    "llm-call",
    lambda: call_llm(messages),
    input={"messages": messages},
    tokens={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    model="gpt-4o",
    provider="openai",
)
```

## Querying

```python
# All traces
traces = agent.get_traces()

# Filtered
errors = agent.get_traces({"status": ["error"], "limit": 10})
recent = agent.get_traces({"from_date": time.time() * 1000 - 3600000, "limit": 100})

# Single trace
trace = agent.get_trace("trace-uuid")

# Runs
runs = agent.get_runs(limit=10)
run = agent.get_run("run-uuid")
```

## Statistics

```python
stats = agent.get_stats()
costs = agent.get_cost_breakdown(run_id="optional-run-id")
health = agent.get_health()
storage = agent.get_storage_stats()
dropped = agent.get_dropped_traces()
```

## Agent Usage Tracking

```python
agent.record_agent_usage({
    "agent_name": "my-agent",
    "agent_type": "ai-agent",
    "action": "file-edit",
    "target": "src/index.ts",
    "tokens_used": 500,
    "cost_usd": 0.01,
    "duration_ms": 2500,
    "status": "success",
})

usage = agent.get_agent_usage()
usage_stats = agent.get_usage_stats()
active = agent.get_active_agents()
agents_who = agent.get_agent_who(active_only=True)
sessions = agent.get_agent_sessions(agent_name="my-agent")
```

## Evaluation

```python
from agenttrace import score

@score("output-length")
def output_length(trace):
    if not trace.output:
        return 0.0
    return min(len(str(trace.output)) / 2000.0, 1.0)

results = agent.evaluate(
    scorers=[output_length],
    run_id="your-run-id",
    concurrency=4,
)

# Single trace
one = agent.evaluate_trace("trace-uuid", [output_length])
```

## Export

```python
json_str = agent.export("json")
csv_str = agent.export("csv")
json_filter = agent.export("json", {"run_id": "specific-run"})
```

## API Keys

```python
key = agent.create_api_key("dashboard")
print(key.key)     # shown only once
print(key.preview) # masked

keys = agent.list_api_keys()
agent.revoke_api_key("key-id")
result = agent.validate_api_key("raw-key-string")
```

## Webhooks

```python
wh_id = agent.add_webhook("https://hooks.slack.com/...", ["trace.error", "run.complete"], secret="my-secret")
webhooks = agent.get_webhooks()
agent.remove_webhook(wh_id)
result = agent.test_webhook(wh_id)
```

## Lifecycle

```python
agent.close()
```

## AgentUsageTracker

Standalone tracker for agent self-monitoring:

```python
from agenttrace import AgentUsageTracker

tracker = AgentUsageTracker(db_path="./agenttrace.db")
tracker.record_action("my-agent", "research", target="query-1")
stats = tracker.get_stats()
tracker.close()
```

## Types (Dataclasses)

Key types: `Trace`, `Run`, `TokenUsage`, `ToolCall`, `TraceConfig`, `TraceStats`, `CostBreakdown`, `AgentUsageRecord`, `Scorer`, `ScorerResult`, `AlertCondition`, `WebhookConfig`, `ApiKey`, `CreatedApiKey`.

All use snake_case fields (e.g., `trace.latency_ms`, `trace.cost_usd`).
