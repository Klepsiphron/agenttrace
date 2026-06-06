# AgentTrace Hermes Integration -- Build Spec

## Goal

Create a standalone Python module that auto-tracks Hermes agent sessions into AgentTrace. After installation, `npx agenttrace-io self-stats` shows all Hermes activity.

## What to Build

### File: `~/.hermes/agenttrace_hermes.py` (NEW)

A self-contained Python module (~200 lines) that:

1. **On import**:
   - Creates/connects to SQLite DB at `~/.hermes/agenttrace.db`
   - Same schema as AgentTrace Python SDK (see `packages/sdk-python/src/agenttrace/storage.py`)
   - Auto-creates tables if not exist

2. **Provides**:

   ```python
   start_session(session_id, agent_name="hermes")  # returns run_id
   track_tool_call(run_id, tool_name, input_summary, output_summary, latency_ms, success=True)
   track_api_call(run_id, prompt_tokens, completion_tokens, model, cost_usd)
   end_session(run_id, status="success")
   get_session_stats(run_id)  # dict with tokens, cost, actions, duration
   ```

3. **Schema** (same as AgentTrace Python SDK):
   - `runs` table: id, name, status, trace_count, total_tokens, total_cost_usd, started_at, completed_at
   - `traces` table: id, run_id, name, status, input, output, prompt_tokens, completion_tokens, total_tokens, model, latency_ms, cost_usd, error, created_at

4. **Cost calculation**: Use the same model pricing as AgentTrace Python SDK (see `_default_cost_calculator` in `packages/sdk-python/src/agenttrace/core.py`)

### File: `~/.hermes/hermes-agent/agent/agenttrace_hook.py` (NEW, in the hermes-agent repo)

A thin hook that imports the module above and wires it into the agent loop:

```python
"""
AgentTrace hook for Hermes agent.
Import this at the top of conversation_loop.py (or run_agent.py).
"""

import time
import uuid
import os

_AT_AVAILABLE = False
_at_run_id = None

def _init():
    global _AT_AVAILABLE
    try:
        # Add ~/.hermes to path so we can import the module
        import sys
        hermes_home = os.path.expanduser('~/.hermes')
        if hermes_home not in sys.path:
            sys.path.insert(0, hermes_home)
        import agenttrace_hermes as _at
        _AT_AVAILABLE = True
    except ImportError:
        pass

def on_session_start(session_id=None):
    global _at_run_id
    if not _AT_AVAILABLE:
        return
    import agenttrace_hermes as _at
    _at_run_id = session_id or str(uuid.uuid4())
    _at.start_session(_at_run_id)

def on_tool_call(tool_name, args_summary, result_summary, latency_ms, success=True):
    if not _AT_AVAILABLE or not _at_run_id:
        return
    import agenttrace_hermes as _at
    _at.track_tool_call(_at_run_id, tool_name, args_summary, result_summary, latency_ms, success)

def on_api_response(prompt_tokens, completion_tokens, model, cost_usd=0):
    if not _AT_AVAILABLE or not _at_run_id:
        return
    import agenttrace_hermes as _at
    _at.track_api_call(_at_run_id, prompt_tokens, completion_tokens, model, cost_usd)

def on_session_end(status="success"):
    global _at_run_id
    if not _AT_AVAILABLE or not _at_run_id:
        return
    import agenttrace_hermes as _at
    _at.end_session(_at_run_id, status)
    _at_run_id = None

_init()
```

### Integration Point

In `agent/conversation_loop.py`, add at the top (after existing imports):

```python
try:
    from agent.agenttrace_hook import on_session_start, on_tool_call, on_api_response, on_session_end
except ImportError:
    on_session_start = on_tool_call = on_api_response = on_session_end = lambda *a, **kw: None
```

Then in `run_conversation()`:

- After line 383 (`agent._ensure_db_session()`): `on_session_start(agent.session_id)`
- In the tool dispatch loop (find where tool results are processed): `on_tool_call(tool_name, str(args)[:200], str(result)[:200], elapsed_ms)`
- After each API response: `on_api_response(usage.prompt_tokens, usage.completion_tokens, model, cost)`
- Before returning: `on_session_end("success")`

## Verification Steps

1. Install the Python SDK in hermes venv:

   ```bash
   cd ~/.hermes/hermes-agent && source .venv/bin/activate
   pip install -e /home/ryano/projects/agenttrace/packages/sdk-python
   ```

2. Create the two new files above

3. Have a Hermes conversation (any chat)

4. Verify:

   ```bash
   # Check DB exists
   ls -la ~/.hermes/agenttrace.db

   # View stats
   cd /home/ryano/projects/agenttrace
   npx agenttrace-io --db-path ~/.hermes/agenttrace.db self-stats

   # View sessions
   npx agenttrace-io --db-path ~/.hermes/agenttrace.db runs
   ```

## Constraints

- Do NOT modify AgentTrace SDK code
- Do NOT add external pip dependencies (use stdlib sqlite3)
- Hook must be completely optional (ImportError caught)
- DB path: `~/.hermes/agenttrace.db`
- Minimal performance impact (< 1ms per operation)

## Out of Scope

- Real-time dashboard (use existing `npx agenttrace-io dashboard`)
- Cloud export
- Multi-agent correlation
- Modifying AgentTrace CLI
