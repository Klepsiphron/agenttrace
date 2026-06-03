# CLI Testing Research Synthesis (2026) — Applied to AgentTrace CLI Test Expansion

**Date:** 2026 (per task context)
**Sources:** Combined web_search + x_semantic_search (see raw below)
**Rule followed:** Research-first: X + web before any code changes for test expansion.

## Key Findings from Research

### 1. Layered Evaluation Strategy Applies to CLI Testing
From 2026 sources on AI agent evals (e.g. LangChain Deep Agents patterns via ZenML):
- Multi-level / layered eval strategy: **single-step**, **full-turn**, **multi-turn**.
- Borrowed from SE: unit / integration / e2e.
- **Single-step**: Isolate to one decision point / one command invocation. Validate specific output/args/behavior without full sequence.
- **Full-turn**: Run complete command (or agent turn) end-to-end, check trajectory + final artifacts (e.g. files written, JSON emitted, tables).
- **Multi-turn**: Sequences (e.g. init then stats; or init+export+verify file).
- Recommendation for CLI: "test each command independently" (per user query directive). Structure tests per-command (describe blocks for init, stats, etc.), use isolated runs. Use full-turn for export-to-file verification, multi-turn for init+use flows. Avoid monolithic tests that run many commands in one it().

This directly informs the structure: each of the 10 areas in dedicated it() or small describe, independent where possible. Use tmp dirs per test for isolation (clean slate DB).

### 2. CLI Testing Patterns (Node/TS, Vitest/Jest)
- Expose testable entrypoint: `main()` or `run(args)` instead of top-level execution. (Our index.ts already does: exports `main`, guards with isMain check using import.meta.url vs argv[1]. Perfect.)
- In tests: set `process.argv = ['node', 'bin', ...cmd, ...flags]`, call `main()`, catch mocked `process.exit` (throw special error).
- Capture output: override `console.log` / `console.error` to array of strings (or use mock). Strip ANSI for asserts if needed. Existing cli.test.ts does this well.
- For side-effect CLIs (DB files, output files): **use tmp directories** (fs.mkdtempSync in os.tmpdir()), set env like AGENTTRACE_DB_PATH, clean in afterEach with rmrf. Never use ./agenttrace.db in tests.
- Mocking DB: Prefer seeding real via SDK (AgentTrace / TraceStorage) for fidelity (integration-style for CLI wrapper), or vi.mock the SDK for pure unit of parse/print. For "mock agenttrace.db as needed" — use env + tmp real DBs mostly; mock only if needed for error paths or to avoid heavy SDK.
- Vitest specifics:
  - vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); })
  - For fs: either real tmp (preferred for this CLI since it does real writes), or memfs + vi.mock('node:fs') for pure isolation (see vitest docs on file-system mocking).
  - vi.mock(import('./path')) preferred over string for resilience (from X post).
- Error handling tests: missing DB triggers specific console.error + exit(1). Invalid args (no --trace-id for tree) -> error + exit.
- --json: always assert parseable JSON + correct shape keys (no relying on table strings).
- Table output: assert headers + sample data presence (after stripAnsi if colored).
- Avoid child_process.exec for speed; direct main() call is the pattern used in our existing tests and recommended for debuggability.

From CircleCI commander testing guide (even though we use custom parseArgs not commander):
- Use local Command() instance in tests for isolation.
- exitOverride() to turn exits into throws for catch/assert.
- Test unknown options/commands by catching.
- Our custom parse + runMain doesn't use commander, but equivalent: mock exit + check logs for 'ERR:' or specific messages.

From other sources (StackOverflow, articles):
- For file-writing cmds (export, init): write to tmp out paths, read back + assert content/shape.
- Seed data using the library under test (SDK here) to create realistic DB state.
- For "costs by period": our 'costs' cmd uses getCostBreakdown (model/day), there's also 'cost' cmd for agent periods; task specifies "costs -- returns cost breakdown by period" — note CLI has both; we'll cover getCostBreakdown + --daily/ --json, and note periods in agent cost if fits.

### 3. Triangulation / Best Practices Summary
- **Isolation first**: per-test tmp DB, reset env/argv/console/mocks in afterEach.
- **Independent tests**: one command per it() mostly; use before/seed helpers.
- **Verify shape not just presence**: for stats JSON: {totalRuns, totalTraces, successRate, avgLatencyMs, totalCostUsd, ... , topTools?, topErrors?}
- For export: JSON is array of traces; CSV has header row like 'id,runId,name,...'
- init: creates file only if not exists; 'Created ...' or 'already exists'
- tree: requires --trace-id else error; outputs 'Trace Tree:' + hierarchy or JSON with .trace
- who/sessions/activity: use TraceStorage directly for agent data; assert table cols or JSON array.
- Error: no DB for stats/runs etc -> 'No ...agenttrace.db... Run "agenttrace-io init"'
- --json works for: runs, traces, stats, costs, export, tree, self-stats, who, sessions, activity, etc. (global flag)
- Use real SDK seeding for data (as in cli.test.ts seedData/seedAgentUsage) — this is "full-turn" for data creation, single for CLI cmd.
- Run tests with real FS effects but contained in /tmp.
- Self-check: always pnpm build && pnpm test (CLI) before commit. Scan for secrets/paths in test code.
- No new deps for tests.

### 4. Gaps / How Our Task Maps
- Task focuses on: init, stats, export (file+formats), tree, who, sessions, activity, costs (breakdown), errors (missing DB, invalid), --json on applicable.
- Note: 'costs' in CLI is SDK getCostBreakdown (by model/day, --daily, --run-id, --json). There's separate 'cost' for agent periods. Task says "costs -- returns cost breakdown by period" — we'll test the costs cmd (and can include period-like via daily) + note.
- Dashboard, benchmark, alerts, webhook, etc. covered in existing cli.test.ts but not required here.
- Existing code (cli.test.ts + costs.test.ts) already implements MUCH of this + more (post plan item#7). For this task we create dedicated commands.test.ts per spec, focused, independent tests. Dupe coverage OK (tests are assertions), or could be seen as layered (one file per "layer").

## Raw Sources (saved for audit)
- Web results on layered: [web:0] ministryoftesting layered for AI coding; [web:4] zenml.io "multi-level evaluation strategy (single-step, full-turn, multi-turn)"; LangChain patterns detailed.
- CLI vitest: vitest.dev mocking/file-system; SO/medium on mocking CLI, using tmp, direct invoke not spawn.
- X: vitest mock habits (vi.mock import path), testing pyramid examples (Cory House), etc.

## Recommendations Implemented in commands.test.ts
- Per-command describe/it for single-step independence.
- Helper: makeTempDbPath + rmrf, seed helpers.
- Harness: beforeEach/afterEach for argv/env/console/exit mock.
- runCmd(args) that sets argv + calls main() + catches exit-throw.
- Asserts on logs for table/stdout, JSON.parse for --json, fs.exists + read for files/ init.
- Test missing DB case by not seeding + run stats/export etc (expect error msg + exit).
- Invalid: tree w/o --trace-id.
- Use only public SDK API for seeding (startRun, trace, complete, TraceStorage.recordAgentUsage, etc.).
- After write: will run full verify.

Synthesized before writing any test code. This satisfies AGENTS.md research-first.
