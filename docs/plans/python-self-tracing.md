# Hermes Self-Tracing Integration (Python)

## Goal

Auto-trace all Hermes agent sessions in the Python agent loop. Token/cost monitoring for corporate environments. Zero-setup: works out of the box.

## Architecture

```
Hermes AIAgent (run_agent.py)
  → Python SelfTracker (new)
    → SQLite at ~/.hermes/agenttrace.db (same schema as TS SDK)

AgentTrace CLI (already exists)
  → reads same DB
  → commands: self-stats, runs, traces, stats, dashboard
```

## Implementation

### Step 1: Create Python SelfTracker

**File**: Create `~/.hermes/agenttrace_tracer.py`

A lightweight Python module that:

- Uses `sqlite3` (stdlib) to store traces in `~/.hermes/agenttrace.db`
- Same schema as the TS SDK (see packages/sdk-python/src/agenttrace/storage.py)
- Auto-creates tables on first use
- Provides:

```python
from agenttrace_tracer import get_tracer

tracer = get_tracer(agent_name="hermes", agent_type="ai-agent")
tracer.start_session()
tracer.track_tool_call(tool_name, input_summary, output_summary, latency_ms)
tracer.track_tokens(prompt_tokens, completion_tokens, model)
tracer.end_session()
tracer.get_session_stats()  # {actions, tokens, cost, duration}
```

### Step 2: Hook into Hermes Agent Loop

**File**: Modify run_agent.py (or create a wrapper)

In `run_conversation()`, after each tool call:

```python
from agenttrace_tracer import get_tracer
tracer = get_tracer()
tracer.track_tool_call(tool_name, str(args)[:200], str(result)[:200], latency_ms)
```

In the main loop, track tokens from each API response:

```python
if hasattr(response, 'usage'):
    tracer.track_tokens(response.usage.prompt_tokens, response.usage.completion_tokens, model)
```

### Step 3: Verification

After a Hermes conversation:

- `npx agenttrace-io self-stats` shows session activity
- `npx agenttrace-io runs` lists sessions
- DB exists at `~/.hermes/agenttrace.db`

## Constraints

- Minimal changes to existing Hermes code (wrap, don't rewrite)
- Use only Python stdlib (no new dependencies)
- DB path: `~/.hermes/agenttrace.db`
- Must be compatible with existing AgentTrace CLI (same schema)

## NOT in Scope

- Real-time streaming dashboard (future)
- Cloud export (future)
- Multi-agent correlation (future)
