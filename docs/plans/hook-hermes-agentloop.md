# Wire AgentTrace Python SDK into Hermes Agent Loop

## Goal

Auto-trace all Hermes sessions using the existing AgentTrace Python SDK. After this, `npx agenttrace-io self-stats` shows what Hermes did.

## Approach

AgentTrace Python SDK already exists at `packages/sdk-python/`. It has `AgentTrace`, `TraceStorage`, types -- all working (35/35 tests pass). We just need to hook it into `run_agent.py`.

## Changes

### 1. Install AgentTrace Python SDK in Hermes venv

```bash
cd ~/.hermes/hermes-agent
source .venv/bin/activate
pip install -e /home/ryano/projects/agenttrace/packages/sdk-python
```

### 2. Create a small hook module

**File**: `~/.hermes/agenttrace_hook.py` (new file, NOT in the hermes-agent repo)

This module:

- Imports `AgentTrace` from the Python SDK
- Creates a single `AgentTrace` instance with `db_path=~/.hermes/agenttrace.db`
- Provides simple functions:
  - `init_session(agent_name="hermes")` -- start a run
  - `track_tool(tool_name, args_summary, result_summary, latency_ms)` -- record a tool call
  - `track_tokens(prompt_tokens, completion_tokens, model)` -- record token usage
  - `get_stats()` -- return session stats dict

### 3. Hook into run_agent.py

In `run_agent.py`, find `handle_function_call()` (in model_tools.py) or the tool dispatch loop in `run_conversation()`. Add:

```python
try:
    from agenttrace_hook import track_tool as _at_track
except ImportError:
    _at_track = None

# In the tool call loop, after executing a tool:
if _at_track:
    _at_track(tool_name, str(args)[:100], str(result)[:200], elapsed_ms)
```

For token tracking, in the API response handling:

```python
try:
    from agenttrace_hook import track_tokens as _at_tokens
except ImportError:
    _at_tokens = None

if _at_tokens and hasattr(response, 'usage') and response.usage:
    _at_tokens(response.usage.prompt_tokens, response.usage.completion_tokens, model)
```

### 4. Verification

After having a Hermes conversation:

```bash
# Show today's activity
cd /home/ryano/projects/agenttrace && npx agenttrace-io --db-path ~/.hermes/agenttrace.db self-stats

# List sessions
npx agenttrace-io --db-path ~/.hermes/agenttrace.db runs

# Start dashboard
npx agenttrace-io --db-path ~/.hermes/agenttrace.db dashboard
```

## Constraints

- Do NOT modify AgentTrace SDK code
- Do NOT add heavy dependencies (use existing Python SDK)
- Hook should be optional (try/except ImportError)
- DB path: `~/.hermes/agenttrace.db`
- Minimal performance impact

## Out of Scope

- Real-time streaming UI
- Cloud export
- Multi-agent correlation
- Modifying the AgentTrace CLI (it already works)
