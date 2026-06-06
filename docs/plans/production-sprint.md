# AgentTrace Production Sprint -- Combined Spec

## Goal

Get AgentTrace to a production-ready state where:

1. All tests pass (already done -- confirmed 361 pass, 15 skip, 0 fail)
2. Hermes session data bridges into AgentTrace (zero Hermes modifications)
3. Test coverage expanded for CLI, dashboard, middleware
4. Python SDK improvements (close(), **init**.py, schema migrations)
5. CI green on GitHub

## Task 1: Hermes Bridge Script (PRIORITY 1)

Create `scripts/hermes-bridge.py` -- a Python script that reads Hermes state.db and populates an AgentTrace DB.

### Source DB (Hermes): `~/.hermes/state.db`

Schema:

```
sessions: id, title, model, source, started_at, ended_at, input_tokens, output_tokens,
          estimated_cost_usd, actual_cost_usd, tool_call_count, api_call_count, end_reason,
          cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count

messages: id, session_id, role, content, tool_call_id, tool_calls (JSON), tool_name,
          timestamp, token_count, finish_reason
```

### Target DB (AgentTrace): `~/.hermes/agenttrace.db`

Create tables: runs, traces, tool_calls (same as AgentTrace Python SDK schema at `packages/sdk-python/src/agenttrace/storage.py`)

### Mapping:

- Each Hermes session → one `run` in AgentTrace
- Each message with tool_calls → one `trace` in AgentTrace
- Use `actual_cost_usd` or `estimated_cost_usd` for run cost
- Sum input_tokens + output_tokens + cache + reasoning for total_tokens

### Commands:

```bash
python3 scripts/hermes-bridge.py --full        # Sync all historical data
python3 scripts/hermes-bridge.py --incremental # Only new sessions since last sync
python3 scripts/hermes-bridge.py --watch       # Continuous sync every 30s
```

### Write the script yourself

- Pure Python 3, stdlib only (sqlite3, json, argparse, pathlib)
- Handle errors gracefully
- Print summary after each sync (imported X sessions, Y tool calls, $Z cost)
- Idempotent: running twice doesn't duplicate data (check if run.id already exists)

### After creating the script:

1. Run `python3 scripts/hermes-bridge.py --full`
2. Verify DB: `sqlite3 ~/.hermes/agenttrace.db "SELECT COUNT(*) FROM runs;"`
3. Verify AgentTrace CLI can read it:
   ```bash
   cd /home/ryano/projects/agenttrace
   npx tsc -b  # build if needed
   node packages/cli/dist/index.js --db-path ~/.hermes/agenttrace.db runs
   ```
4. Commit: `feat: add Hermes bridge script to import session data into AgentTrace`

## Task 2: Test Coverage Expansion (PRIORITY 2)

After Task 1 is working, expand tests for areas that have low coverage.

### 2a: CLI tests (`packages/cli/src/cli.test.ts`)

The CLI already has some tests but they're thin. Add:

- Test `init` command creates DB
- Test `runs --limit N` returns correct number
- Test `traces --run-id X` filters correctly
- Test `stats` output format
- Test `costs --daily` vs `costs` (by model)
- Test `self-stats` with and without data
- Test `export --format json` and `--format csv`
- Test `tree --trace-id X` with parent/child traces
- Test `cleanup --dry-run`

### 2b: Dashboard tests (`packages/dashboard/`)

Add basic tests:

- Test dashboard server starts and serves the frontend
- Test GET /api/runs returns runs
- Test GET /api/traces returns traces
- Test GET /api/stats returns stats

### 2c: Middleware tests (`packages/middleware-langgraph/`, `packages/middleware-crewai/`)

Add integration tests:

- Test middleware captures a traced call
- Test middleware works with parent/child context propagation

Run `pnpm test` after adding tests. All must still pass.

Commit: `test: expand coverage for CLI, dashboard, and middleware`

## Task 3: Python SDK Improvements (PRIORITY 3)

### 3a: Add close() method to Python SDK's AgentTrace

File: `packages/sdk-python/src/agenttrace/core.py`
The Python SDK's AgentTrace class is missing a `close()` method. Add:

```python
def close(self):
    self.storage.close()
```

Also add `close()` to TraceStorage class if not present.

### 3b: Fix **init**.py exports

File: `packages/sdk-python/src/agenttrace/__init__.py`
Ensure all public classes/types are exported: AgentTrace, TraceStorage, Run, Trace, TokenUsage, ToolCall, TraceConfig, TraceFilter, TraceStats, ExportFormat, Scorer, ScorerResult, CostBreakdown, AgentUsageRecord, AgentUsageFilter, UsageStats, RunStatus

### 3c: Schema migrations for Python SDK

File: `packages/sdk-python/src/agenttrace/storage.py`
The Python SDK schema is missing some columns compared to the TS SDK:

- Add `parent_id` column to traces table
- Add `tenant_id` column to runs, traces, agent_usage tables
- Add migration tracking (version table)

### 3d: Run Python tests

```bash
cd packages/sdk-python && pip install -e '.[dev]' && python -m pytest tests/ -v
```

All 35 existing tests must pass. Add new tests for new functionality.

Commit: `feat(python-sdk): add close(), fix exports, schema migrations`

## Task 4: Push Everything

After all tasks are complete and all tests pass:

1. Review all changes with `git diff`
2. Make sure nothing is committed that shouldn't be (secrets, temp files)
3. Push to origin/main
4. CI should pass automatically

## Constraints

- Do NOT modify the TypeScript SDK source code (only tests, scripts, and new files)
- Do NOT break existing tests -- all 361 TS tests + 35 Python tests must pass
- Keep changes minimal and focused
- Write clean, readable code with comments
- Handle errors gracefully (try/except where appropriate)

## Verification Checklist

- [ ] All 361 TS tests pass
- [ ] All 35 Python tests pass
- [ ] Bridge script imports Hermes data successfully
- [ ] AgentTrace CLI reads bridged data
- [ ] CLI tests expanded
- [ ] Dashboard tests added
- [ ] Middleware tests added
- [ ] Python SDK has close() and proper exports
- [ ] CI passes on GitHub
- [ ] Code committed and pushed
