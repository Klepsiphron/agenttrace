# agenttrace (Python SDK)

Drop-in tracing for any AI agent. Local SQLite storage, zero dependencies, zero cloud.

## Installation

```bash
pip install -e .
# or after publish: pip install agenttrace
```

Requires Python 3.10+.

## Quickstart

```python
from agenttrace import init, trace

# Initialize (creates ./agenttrace.db by default)
agent = init(db_path="./traces.db")

# 1. Trace a lambda / callable
result = agent.trace("my-op", lambda: 42 * 2)
print(result)  # 84

# 2. Use as decorator
@trace("greet")
def greet(name: str) -> str:
    return f"Hello, {name}"

print(greet("world"))

# 3. Use as context manager (with optional set_output)
with agent.trace("context-op") as t:
    value = "computed"
    t.set_output(value)
    # on exit, trace is recorded automatically

# 4. Start/complete explicit runs
run_id = agent.start_run("my-agent-run", metadata={"version": "1"})
try:
    agent.trace("step-1", lambda: "ok")
    agent.trace("step-2", lambda: "done")
finally:
    agent.complete_run("success")

# 5. Query data
traces = agent.get_traces()
stats = agent.get_stats()
print(stats.total_traces, stats.success_rate)

# 6. Export
json_str = agent.export("json")
csv_str = agent.export("csv", {"status": ["success"]})

agent.close()
```

## Top-level trace (singleton)

```python
from agenttrace import trace, init

init(db_path=":memory:")  # optional, lazy default used otherwise

@trace("top-level")
def work():
    return 1
```

## Features

- `init()`, `AgentTrace` class
- `trace()` works as: direct call, decorator, sync context manager, async context manager (for async def bodies)
- `startRun` / `completeRun`
- `getTraces`, `getStats`, `export('json'|'csv')`
- Automatic cost estimation for common LLM models
- Same DB schema as the TypeScript SDK (interoperable SQLite file)
- Pure stdlib: `sqlite3`, `dataclasses`, `pathlib`, `json`, `uuid`

## Development

```bash
cd packages/sdk-python
python -m pip install -e ".[dev]"
pytest -v
```

## License

MIT
