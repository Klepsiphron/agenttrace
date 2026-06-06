# AgentTrace Hermes Bridge -- ZERO Hermes Modifications

## Goal

Bridge Hermes session data into AgentTrace format WITHOUT modifying any Hermes code. Run as a periodic sync or on-demand.

## Data Sources (Hermes already tracks all of this)

1. **Sessions DB**: `~/.hermes/state.db`
   - `sessions` table: id, title, created_at, updated_at, source, model
   - `messages` table: id, session_id, role, content, tool_calls, created_at

2. **Agent log**: `~/.hermes/logs/agent.log`
   - Contains token usage per API call: prompt_tokens, completion_tokens, model, cost
   - Tool call entries with timing

## What to Build

### File: `/home/ryano/projects/agenttrace/scripts/hermes-bridge.py` (NEW)

A Python script that:

1. **Reads Hermes state.db**:
   - Extract sessions with timestamps
   - Extract per-message tool_calls (JSON)
   - Extract token usage from message metadata

2. **Populates AgentTrace DB** (`~/.hermes/agenttrace.db`):
   - Same schema as AgentTrace Python SDK
   - One `run` per Hermes session
   - One `trace` per tool call within a session
   - Aggregates token usage per session

3. **Supports**:

   ```bash
   # Sync all historical data
   python3 scripts/hermes-bridge.py --full

   # Incremental sync (only new sessions since last run)
   python3 scripts/hermes-bridge.py --incremental

   # Watch mode (continuous sync every 30s)
   python3 scripts/hermes-bridge.py --watch
   ```

## Output

After running the bridge:

```bash
# View in AgentTrace CLI
cd /home/ryano/projects/agenttrace
npx tsc -b  # build if needed
node packages/cli/dist/index.js --db-path ~/.hermes/agenttrace.db self-stats

# Or start dashboard
node packages/cli/dist/index.js --db-path ~/.hermes/agenttrace.db dashboard
```

## Verification

1. Run: `python3 scripts/hermes-bridge.py --full`
2. Check DB: `sqlite3 ~/.hermes/agenttrace.db "SELECT COUNT(*) FROM runs;"`
3. View stats: `npx agenttrace-io --db-path ~/.hermes/agenttrace.db self-stats`
4. Should show sessions and token usage from actual Hermes conversations

## Constraints

- Zero modifications to Hermes code
- Read-only access to Hermes DB
- Use Python stdlib only (sqlite3, json, pathlib)
- Hermes state.db schema: sessions(id, title, created_at, updated_at), messages(id, session_id, role, content, tool_calls, created_at)
