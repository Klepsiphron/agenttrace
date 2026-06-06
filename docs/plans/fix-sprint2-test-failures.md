# AgentTrace Fix Spec — Sprint 2 Remaining

## Goal
Fix all 12 remaining test failures in the agenttrace project and get CI green.
Build already passes. Only test failures remain.

## Current State
- Build: PASSING
- Tests: 349 passed, 12 failed, 15 skipped (376 total)
- 2 failing test files: `index.test.ts` (3 failures), `multi-tenant.test.ts` (9 failures)

## Already Applied Fixes (in index.ts)
These are ALREADY committed — do NOT re-apply:

1. `getStats()` now passes tenant: `this.storage.getStats(this.config.tenantId || undefined)`
2. `getCostBreakdown()` now passes tenant: `this.storage.getCostBreakdown(filter.runId, this.config.tenantId || undefined)`
3. `getAgentUsage()` now passes tenant: `this.storage.getAgentUsage(filter, this.config.tenantId || undefined)`
4. `getUsageStats()` now passes tenant: `this.storage.getUsageStats(agentName, fromDate, toDate, this.config.tenantId || undefined)`

## Remaining Failures to Fix

### Group A: index.test.ts (3 failures) — Mock signature mismatch

The mock `MockTraceStorage` constructor doesn't accept `tenantId` as second param.
Fix: Update the mock constructor in `packages/sdk/src/index.test.ts` line 39 to accept optional `dbPath` and `tenantId` params:

```typescript
MockTraceStorage: vi.fn(function MockTraceStorage(_dbPath?: string, _tenantId?: string) {
  return mockStorage;
}),
```

### Group B: multi-tenant.test.ts (9 failures) — Two root causes

#### B1: "Too many parameter values were provided" (1 failure)
Test at line 160-162 in multi-tenant.test.ts:
```typescript
(storage as any).db
  .prepare('INSERT INTO projects (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
  .run(id, 'My Project', apiKey, apiKey, now);
```
This passes 5 values to 4 placeholders. The `id` param is duplicated — remove the duplicate `apiKey`:
```typescript
.run(id, 'My Project', apiKey, now);
```

#### B2: DB connection closed when multiple agents share same file (8 failures)
Tests create multiple `AgentTrace` instances on the SAME db file path (e.g., `const db = tmpDb(); const agentA = makeAgent(db, 'tenant-a'); const agentB = makeAgent(db, 'tenant-b')`). Each creates a new `TraceStorage` which opens a new `better-sqlite3` connection. When `agentA.close()` closes the DB, agentB's storage breaks.

The `getTraces()` calls return 0 results because:
- The writes from agentA may not be visible to agentB's connection (WAL mode issue)
- Or agentA.close() kills the DB connection that both were using

**Fix approach**: Make `TraceStorage` use a **reference-counted connection pool** for the same dbPath.

In `packages/sdk/src/storage.ts`, add a static Map that shares Database instances:

```typescript
// At top of class, alongside existing field declarations:
private static _connections = new Map<string, { db: Database; refCount: number }>();
```

Replace the constructor to check the pool first. Add a `close()` that decrements refCount and only closes when it hits 0.

IMPORTANT: The `better-sqlite3` type declaration uses `export = Database` pattern. Use `InstanceType<typeof Database>` for the db instance type in the Map, or simply use `any` for the connections map since the ambient type declaration causes namespace issues. Actually the simplest working approach: use `ReturnType<typeof Database>` or just `any` for the static map.

## Verification Steps (MUST complete all)

1. Run `pnpm build` — must pass
2. Run `pnpm test` — all 376 tests must pass (0 failures)
3. If any test still fails, diagnose and fix — do NOT stop until all pass
4. Run `git diff` and review your changes
5. Commit with message: `fix: resolve multi-tenant test failures (tenantId pass-through, connection pooling, test fixes)`
6. Push to origin/main

## Files to Modify
1. `packages/sdk/src/storage.ts` — Add reference-counted connection pool
2. `packages/sdk/src/index.test.ts` — Fix mock constructor signature
3. `packages/sdk/src/multi-tenant.test.ts` — Fix project creation test (remove duplicate param)

## Constraints
- Do NOT modify the core tracing logic, types, or any code besides the three files above
- Do NOT add new features
- Do NOT change test assertions — only fix the code so existing assertions pass
- Keep changes minimal and surgical
- After ALL tests pass, commit and push
