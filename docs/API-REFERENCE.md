# AgentTrace API Reference

Version 0.1.0 -- TypeScript SDK (`@agenttrace-io/sdk`) and Python SDK (`agenttrace-io`).

Both SDKs share the same SQLite schema and are functionally equivalent. Where they differ in naming or API shape, both are documented.

---

## Table of Contents

1. [Installation](#installation)
2. [AgentTrace (TypeScript)](#agenttracetypescript)
3. [AgentTrace (Python)](#agenttracepython)
4. [TraceStorage](#tracestorage)
5. [SelfTracker (TypeScript) / AgentUsageTracker (Python)](#selftracker)
6. [TokenBucketRateLimiter](#tokenbucketratelimiter)
7. [TraceContext](#tracecontext)
8. [Types (TypeScript)](#typestypescript)
9. [Types (Python)](#typespython)
10. [Singleton Helpers](#singleton-helpers)
11. [Migration Utilities](#migration-utilities)

---

## Installation

```bash
# TypeScript / Node
npm install @agenttrace-io/sdk

# Python
pip install agenttrace-io
```

---

## AgentTrace (TypeScript)

**Module:** `@agenttrace-io/sdk`

The main entry point. Wraps `TraceStorage` and provides the tracing API.

### Constructor

```typescript
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace(config?: TraceConfig);
```

`TraceConfig` fields (all optional):

| Field | Type | Default | Description |
|---|---|---|---|
| `dbPath` | `string` | `'./agenttrace.db'` | SQLite database file path |
| `maxTraces` | `number` | `10000` | Max traces retained; oldest deleted when exceeded |
| `autoCleanup` | `boolean` | `true` | Auto-cleanup after each `trace()` call |
| `costCalculator` | `(tokens: TokenUsage, model?: string) => number` | built-in | Custom USD cost function |
| `hallucinationDetector` | `(output: unknown, expected?: unknown) => boolean` | `() => false` | Custom hallucination check |
| `silent` | `boolean` | `false` | Suppress console output |
| `retentionDays` | `number` | `30` | Data retention in days (0 = forever) |
| `cleanupIntervalHours` | `number` | `24` | How often to run retention cleanup |
| `tenantId` | `string` | `''` | Multi-tenant scoping |
| `maxTracesPerSecond` | `number` | `0` | Rate limit per second (0 = disabled) |
| `maxTracesPerMinute` | `number` | `0` | Rate limit per minute (0 = disabled) |
| `burstAllowance` | `number` | `10` | Extra burst tokens above sustained rate |

### Methods

#### startRun

```typescript
startRun(name: string, metadata?: Record<string, unknown>): string
```

Starts a new agent run. Returns a UUID `runId`. All subsequent `trace()` calls are associated with this run until `completeRun()`.

```typescript
const runId = agent.startRun('data-pipeline', { version: '1.0' });
```

#### completeRun

```typescript
completeRun(status?: 'success' | 'failure' | 'error'): void
```

Marks the current run as completed. Defaults to `'success'`.

```typescript
agent.completeRun('success');
```

#### trace

```typescript
async trace<T>(
  name: string,
  fn: () => Promise<T>,
  options?: {
    input?: unknown;
    tokens?: TokenUsage;
    model?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
    parentId?: string;
    context?: TraceContext;
  }
): Promise<T>
```

Wraps an async function, recording a trace on completion or error. Returns the function's return value. Re-throws any error after recording.

```typescript
const result = await agent.trace('llm-call', async () => {
  return await openai.chat.completions.create({ model: 'gpt-4o', messages });
}, {
  input: { messages },
  tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-4o', provider: 'openai' },
  model: 'gpt-4o',
  provider: 'openai',
});
```

#### recordToolCall

```typescript
recordToolCall(call: Omit<ToolCall, 'id' | 'timestamp'>): string
```

Records a tool call. Returns a UUID. (Tool calls are also stored when passed via `trace()` options.)

#### getTraces

```typescript
getTraces(filter?: TraceFilter): Trace[]
```

Query traces with optional filtering. See [TraceFilter](#tracefilter) for filter fields.

```typescript
const errors = agent.getTraces({ status: ['error'], limit: 10 });
const recent = agent.getTraces({ fromDate: Date.now() - 3600000, limit: 100 });
```

#### getTrace

```typescript
getTrace(id: string): Trace | null
```

Get a single trace by ID.

#### getRuns

```typescript
getRuns(limit?: number): Run[]
```

Get recent runs, most recent first. Default limit: 100.

#### getRun

```typescript
getRun(id: string): Run | null
```

Get a single run by ID.

#### getStats

```typescript
getStats(): TraceStats
```

Returns aggregate statistics across all traces and runs.

#### getCostBreakdown

```typescript
getCostBreakdown(filter?: { runId?: string }): CostBreakdown
```

Returns cost breakdown by model and by day, optionally filtered to a specific run.

#### recordAgentUsage

```typescript
recordAgentUsage(record: Omit<AgentUsageRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): void
```

Records an agent action/usage event for self-tracking. Emits a `'usage'` event.

```typescript
agent.recordAgentUsage({
  agentName: 'my-agent',
  agentType: 'orchestrator',
  action: 'file-edit',
  target: 'src/index.ts',
  tokensUsed: 500,
  costUsd: 0.01,
  durationMs: 2500,
  status: 'success',
});
```

#### getAgentUsage

```typescript
getAgentUsage(filter?: AgentUsageFilter): AgentUsageRecord[]
```

Query agent usage records with filters.

#### getUsageStats

```typescript
getUsageStats(agentName?: string, fromDate?: number, toDate?: number): UsageStats
```

Aggregated statistics across agent actions.

#### getActiveAgents

```typescript
getActiveAgents(): { agentName: string; lastActive: string; totalActions: number }[]
```

List agents with their last active time (ISO string) and total action count.

#### getAgentWho

```typescript
getAgentWho(filter?: { activeOnly?: boolean; agentType?: string; limit?: number }): AgentWho[]
```

Active agents overview. `activeOnly` filters to agents active in the last 30 minutes.

#### getAgentSessions

```typescript
getAgentSessions(filter?: { agentName?: string; activeOnly?: boolean; limit?: number }): AgentSession[]
```

Session-level summaries grouped by agent + session ID.

#### createApiKey

```typescript
createApiKey(name: string): CreatedApiKey
```

Creates a new API key for dashboard authentication. Returns the full secret key (shown only once) plus metadata. The secret is never stored -- only its SHA-256 hash is persisted.

```typescript
const key = agent.createApiKey('dashboard');
console.log(key.key);    // at_abc123... (show once)
console.log(key.preview); // at_abc123****
```

#### listApiKeys

```typescript
listApiKeys(): ApiKey[]
```

List all API keys (masked previews only, no secrets).

#### revokeApiKey

```typescript
revokeApiKey(id: string): boolean
```

Delete an API key by ID. Returns `true` if it existed.

#### validateApiKey

```typescript
validateApiKey(key: string): ApiKey | null
```

Validate a raw API key string. Returns the key metadata (and updates `lastUsedAt`) or `null`.

#### onUsage / offUsage

```typescript
onUsage(listener: (record: AgentUsageRecord) => void): void
offUsage(listener: (record: AgentUsageRecord) => void): void
```

Subscribe/unsubscribe to agent usage events (for live dashboards / SSE).

#### createChild

```typescript
createChild(context: TraceContext): TraceContext
```

Creates a child `TraceContext` linked to the parent. Use the returned context in `trace()` options for multi-agent hierarchical tracing.

```typescript
const parentCtx = new TraceContext(parentTraceId);
const childCtx = agent.createChild(parentCtx);

await agent.trace('child-op', async () => { ... }, { context: childCtx });
```

#### linkTraces

```typescript
linkTraces(traceIds: string[]): void
```

Manually link a set of trace IDs as related (cross-agent collaboration without strict parent/child).

#### getTraceTree

```typescript
getTraceTree(traceId: string): TraceTreeNode
```

Returns the full trace tree rooted at the ultimate ancestor of the given trace, including children and linked traces.

#### registerAlert

```typescript
registerAlert(alert: AlertCondition): void
```

Register an alert condition. Persists config and enables auto-checks after each `trace()` call.

```typescript
agent.registerAlert({
  name: 'high-error-rate',
  condition: (stats) => stats.successRate < 0.9 && stats.totalTraces > 10,
  webhook: 'https://hooks.slack.com/...',
  cooldown: 300, // seconds
});
```

#### checkAlerts

```typescript
async checkAlerts(): Promise<AlertHistory[]>
```

Manually check all registered alerts against current stats. Returns triggered alert history entries. (Also called automatically after each `trace()` call.)

#### getAlerts

```typescript
getAlerts(): AlertCondition[]
```

Get currently registered alerts (in-memory + persisted).

#### getAlertHistory

```typescript
getAlertHistory(): AlertHistory[]
```

Get alert firing history from storage.

#### getHealth

```typescript
getHealth(): HealthReport
```

Returns a health report including version, uptime, DB path, trace count, DB size, and integrity check.

#### export

```typescript
export(format?: 'json' | 'csv' | 'otel', filter?: TraceFilter): string
```

Export traces in JSON, CSV, or OpenTelemetry OTLP JSON format.

```typescript
const json = agent.export('json', { limit: 100 });
const csv = agent.export('csv', { status: ['error'] });
const otel = agent.export('otel');
```

#### evaluate

```typescript
async evaluate(options: EvaluateOptions): Promise<ScorerResult[]>
```

Run scorers against traces. If `traceIds` provided, scores only those; if `runId`, scores traces in that run; otherwise all traces.

```typescript
const results = await agent.evaluate({
  scorers: [
    { name: 'output-length', fn: (trace) => String(trace.output).length },
    { name: 'success', fn: (trace) => trace.status === 'success' ? 1 : 0 },
  ],
  runId: 'some-run-id',
  concurrency: 5,
});
```

#### evaluateTrace

```typescript
async evaluateTrace(traceId: string, scorers: Scorer[]): Promise<ScorerResult>
```

Score a single trace by ID.

#### cleanupOldTraces / cleanupOldRuns / cleanupOldAgentUsage

```typescript
cleanupOldTraces(before: number): number
cleanupOldRuns(before: number): number
cleanupOldAgentUsage(before: number): number
```

Delete records older than the given timestamp (ms). Returns the count of deleted records.

#### getStorageStats

```typescript
getStorageStats(): { totalSize: number; traceCount: number; oldestTrace: number; newestTrace: number }
```

#### getRetentionPolicy / setRetentionPolicy

```typescript
getRetentionPolicy(): { retentionDays: number; cleanupIntervalHours: number }
setRetentionPolicy(retentionDays: number, cleanupIntervalHours?: number): void
```

Get/set the data retention policy. Persisted to the database.

#### close

```typescript
close(): void
```

Close the database connection and stop any scheduled cleanup timers.

---

## AgentTrace (Python)

**Module:** `agenttrace`

Python port of the TypeScript SDK. Uses snake_case naming. All methods mirror the TypeScript API unless noted.

### Constructor

```python
from agenttrace import AgentTrace

agent = AgentTrace(config=None)
```

`config` can be a `TraceConfig` dataclass or a dict. Supported keys: `db_path`, `max_traces`, `auto_cleanup`, `cost_calculator`, `hallucination_detector`, `silent`.

### Methods

#### start_run

```python
start_run(name: str, metadata: Optional[dict] = None) -> str
```

Starts a new run. Returns UUID.

#### complete_run

```python
complete_run(status: RunStatus = "success") -> None
```

Completes the current run.

#### trace

```python
def trace(name: str, fn: Optional[Callable] = None, **options) -> Any
```

Three usage patterns:

```python
# 1. Direct call
result = agent.trace("my-op", lambda: do_work(), input=data, tokens=token_usage)

# 2. Decorator
@agent.trace("my-op")
def my_work():
    return "hello"

# 3. Context manager
with agent.trace("my-op") as t:
    val = do_work()
    t.set_output(val)
    t.set_tokens(token_usage)
    t.set_metadata({"key": "val"})
```

Options: `input`, `tokens`, `model`, `provider`, `metadata`.

#### record_tool_call

```python
record_tool_call(call: Union[dict, ToolCall]) -> str
```

Returns a UUID. Stub -- tool calls are stored at trace creation time.

#### get_traces / get_trace / get_runs / get_run / get_stats

```python
get_traces(filter: Union[TraceFilter, dict] = {}) -> list[Trace]
get_trace(id: str) -> Optional[Trace]
get_runs(limit: int = 100) -> list[Run]
get_run(id: str) -> Optional[Run]
get_stats() -> TraceStats
```

#### record_agent_usage / get_agent_usage / get_usage_stats / get_cost_breakdown

```python
record_agent_usage(record: Union[AgentUsageRecord, dict]) -> None
get_agent_usage(filter: Union[AgentUsageFilter, dict] = {}) -> list[AgentUsageRecord]
get_usage_stats(agent_name=None, from_date=None, to_date=None) -> UsageStats
get_cost_breakdown(run_id: Optional[str] = None) -> CostBreakdown
```

#### export

```python
def format: ExportFormat = "json", filter: Union[TraceFilter, dict] = {}) -> str
```

Supports `"json"` and `"csv"` formats. (OTel export is TypeScript-only.)

#### evaluate

```python
evaluate(
    scorers: list[Scorer] | list[Callable],
    run_id: Optional[str] = None,
    trace_ids: Optional[list[str]] = None,
    concurrency: Optional[int] = None,
) -> list[ScorerResult]
```

Accepts `Scorer` dataclasses or bare callables (named via `__name__`).

#### evaluate_trace

```python
evaluate_trace(trace_id: str, scorers: list[Scorer] | list[Callable]) -> ScorerResult
```

#### get_scores

```python
get_scores(trace_id: Optional[str] = None) -> list[dict]
```

Retrieve stored evaluation scores.

#### close

```python
close() -> None
```

Close the underlying database connection.

---

## TraceStorage

**TypeScript:** `packages/sdk/src/storage.ts`
**Python:** `packages/sdk-python/src/agenttrace/storage.py`

Low-level SQLite storage. Normally accessed through `AgentTrace`, but can be used directly.

### Constructor

```typescript
// TypeScript
import { TraceStorage } from '@agenttrace-io/sdk';
const storage = new TraceStorage('./agenttrace.db');
```

```python
# Python
from agenttrace.storage import TraceStorage
storage = TraceStorage('./agenttrace.db')
```

### Schema

Tables: `races`, `traces`, `tool_calls`, `scores`, `alerts`, `alert_history`, `trace_links`, `agent_usage`, `webhooks`, `api_keys`, `settings`, `version`.

All tables use WAL journal mode and foreign keys with CASCADE deletes where applicable.

### Key Methods

| Method | Description |
|---|---|
| `createRun(run)` | Insert a new run |
| `getRun(id)` / `getRuns(limit)` | Query runs |
| `completeRun(id, status)` | Mark run complete |
| `updateRunStats(runId, tokens, toolCalls, latencyMs, costUsd)` | Increment run aggregates |
| `createTrace(trace)` | Insert trace + tool calls, update run stats |
| `getTrace(id)` / `getTraces(filter)` | Query traces |
| `createScore(id, traceId, name, value)` | Store evaluation score |
| `getScores(traceId?)` | Query scores |
| `getStats()` | Aggregate stats |
| `getCostBreakdown(runId?)` | Cost by model and day |
| `cleanup(maxTraces)` | Delete oldest traces exceeding limit |
| `cleanupOldTraces(before)` | Delete traces older than timestamp |
| `cleanupOldRuns(before)` | Delete runs older than timestamp |
| `cleanupOldAgentUsage(before)` | Delete old agent usage records |
| `recordAgentUsage(record)` | Insert agent usage record |
| `getAgentUsage(filter)` | Query agent usage |
| `getUsageStats(agentName?, fromDate?, toDate?)` | Aggregated usage stats |
| `getActiveAgents()` | List agents with last active time |
| `getAgentWho(filter)` | Active agents overview |
| `getAgentSessions(filter)` | Session summaries |
| `getAgentCostSummary(filter)` | Cost summary by agent/model |
| `saveAlert(name, config)` / `getStoredAlerts()` | Alert persistence |
| `insertAlertHistory(entry)` / `getAlertHistory()` | Alert history |
| `setTraceParent(traceId, parentId)` | Set parent for hierarchical tracing |
| `getTraceParentId(traceId)` / `getChildTraceIds(parentId)` | Parent/child queries |
| `linkTraces(traceIds)` / `getLinkedTraceIds(traceId)` | Cross-agent links |
| `getTraceTree(traceId)` | Full trace tree |
| `createApiKey(name, key, preview)` | Create API key (stores SHA-256 hash) |
| `listApiKeys()` / `revokeApiKey(id)` / `validateApiKey(key)` | API key management |
| `getHealthInfo()` | Health + integrity check |
| `getStorageStats()` | DB size, trace count, oldest/newest |
| `getRetentionPolicy()` / `setRetentionPolicy(days, hours?)` | Retention config |
| `close()` | Close DB connection |

---

## SelfTracker

### TypeScript: SelfTracker

**Module:** `@agenttrace-io/sdk`

Thin wrapper for an agent to track its own operations. Writes to both `TraceStorage` and a JSONL log file.

```typescript
import { SelfTracker } from '@agenttrace-io/sdk';

const tracker = new SelfTracker({
  agentName: 'my-agent',
  agentType: 'orchestrator',
  dbPath: './agenttrace.db',
});
```

| Method | Description |
|---|---|
| `startSession(): string` | Start a new session, returns UUID |
| `trackAction(action, target, metadata?)` | Record a generic action |
| `trackDelegation(targetAgent, task)` | Record delegation to another agent |
| `trackResearch(query, results)` | Record a research step |
| `trackImplementation(files, linesOfCode)` | Record code implementation |
| `trackReview(prNumber, status)` | Record a review action |
| `endSession()` | End the current session |
| `getSessionStats()` | Returns `{ sessionId, actions, duration, tokens, cost }` |
| `close()` | Close underlying storage |

JSONL log path: `~/.hermes/agenttrace-usage.jsonl` (override via `AGENTTRACE_USAGE_LOG` env var).

### Python: AgentUsageTracker

**Module:** `agenttrace.core.AgentUsageTracker`

Same concept as `SelfTracker` but records only to the `agent_usage` table (no JSONL side-log).

```python
from agenttrace.core import AgentUsageTracker

tracker = AgentUsageTracker(agent_name="my-agent", agent_type="orchestrator")
```

| Method | Description |
|---|---|
| `start_session() -> str` | Start session, returns UUID |
| `track_action(action, target, metadata=None)` | Record generic action |
| `track_delegation(target_agent, task)` | Record delegation |
| `track_research(query, results)` | Record research step |
| `track_implementation(files, lines_of_code)` | Record implementation |
| `end_session()` | End current session |
| `get_session_stats() -> dict` | Session stats |
| `close()` | Close storage |

---

## TokenBucketRateLimiter

**TypeScript only.** Enforces per-second and per-minute rate limits using a token bucket algorithm.

```typescript
import { TokenBucketRateLimiter } from '@agenttrace-io/sdk';

const limiter = new TokenBucketRateLimiter({
  maxTracesPerSecond: 10,
  maxTracesPerMinute: 100,
  burstAllowance: 20,
});

if (limiter.tryConsume()) {
  // proceed
} else {
  // rate limited
}

limiter.getDroppedTraces(); // total dropped
limiter.resetDroppedTraces();
```

Set `maxTracesPerSecond` or `maxTracesPerMinute` to `0` to disable that dimension.

---

## TraceContext

**TypeScript only.** Pass between collaborating agents to link traces into a parent/child hierarchy.

```typescript
import { TraceContext } from '@agenttrace-io/sdk';

const ctx = new TraceContext(parentTraceId, parentSpanId?, metadata?);
// Pass ctx via agent.trace('child', fn, { context: ctx })
```

| Field | Type | Description |
|---|---|---|
| `traceId` | `string` | The trace ID to use |
| `parentSpanId` | `string \| undefined` | Parent's trace ID |
| `metadata` | `Record<string, unknown>` | Carried metadata |

---

## Types (TypeScript)

### ToolCall

```typescript
interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latencyMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}
```

### TokenUsage

```typescript
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}
```

### Trace

```typescript
interface Trace {
  id: string;
  runId: string;
  name: string;
  status: 'success' | 'failure' | 'error' | 'timeout';
  input: unknown;
  output: unknown;
  tokens: TokenUsage;
  toolCalls: ToolCall[];
  latencyMs: number;
  costUsd: number;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  tenantId?: string;
}
```

### Run

```typescript
interface Run {
  id: string;
  tenantId?: string;
  name: string;
  status: 'running' | 'success' | 'failure' | 'error';
  traceCount: number;
  totalTokens: TokenUsage;
  totalToolCalls: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  errorCount: number;
  startedAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;
}
```

### TraceFilter

```typescript
interface TraceFilter {
  runId?: string;
  status?: Trace['status'][];
  name?: string;
  fromDate?: number;
  toDate?: number;
  minCost?: number;
  maxCost?: number;
  minLatency?: number;
  maxLatency?: number;
  limit?: number;
  offset?: number;
}
```

### TraceStats

```typescript
interface TraceStats {
  totalRuns: number;
  totalTraces: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  costByModel?: Record<string, number>;
  totalTokens: number;
  avgTokensPerTrace: number;
  topTools: { name: string; count: number; avgLatencyMs: number }[];
  topErrors: { error: string; count: number }[];
  droppedTraces: number;
}
```

### CostBreakdown

```typescript
interface CostBreakdown {
  totalCostUsd: number;
  costByModel: Record<string, number>;
  costByDay: Record<string, number>;
}
```

### Scorer / ScorerResult / EvaluateOptions

```typescript
interface Scorer {
  name: string;
  fn: (trace: Trace) => number | Promise<number>;
}

interface ScorerResult {
  traceId: string;
  scores: Record<string, number>;
  errors: Record<string, string>;
}

interface EvaluateOptions {
  scorers: Scorer[];
  runId?: string;
  traceIds?: string[];
  concurrency?: number;
}
```

### AlertCondition / AlertHistory

```typescript
interface AlertCondition {
  name: string;
  condition: (stats: TraceStats) => boolean;
  webhook?: string;
  email?: string;
  cooldown: number; // seconds
  lastTriggered?: number;
}

interface AlertHistory {
  id: string;
  alertName: string;
  triggeredAt: number;
  stats: Record<string, number>;
  delivered: boolean;
  error?: string;
}
```

### TraceTreeNode

```typescript
interface TraceTreeNode {
  trace: Trace;
  children: TraceTreeNode[];
}
```

### HealthReport

```typescript
interface HealthReport {
  status: 'ok';
  version: string;
  uptime: number;
  dbPath: string;
  traceCount: number;
  dbSize: number;
  integrity: {
    tablesExist: boolean;
    noOrphans: boolean;
    details?: string;
  };
}
```

### AgentUsageRecord / AgentUsageFilter / UsageStats

```typescript
interface AgentUsageRecord {
  id: string;
  tenantId?: string;
  agentName: string;
  agentType?: string;
  sessionId?: string;
  action: string;
  target?: string;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  status: 'success' | 'failure' | 'timeout';
  metadata: Record<string, unknown>;
  createdAt: number;
}

interface AgentUsageFilter {
  agentName?: string;
  agentType?: string;
  action?: string;
  status?: AgentUsageRecord['status'] | AgentUsageRecord['status'][];
  fromDate?: number;
  toDate?: number;
  limit?: number;
  offset?: number;
}

interface UsageStats {
  totalAgents: number;
  totalActions: number;
  totalTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
  actionsByType: Record<string, number>;
  topAgents: Array<{ agentName: string; actions: number; tokens: number; costUsd: number }>;
}
```

### AgentWho / AgentSession

```typescript
interface AgentWho {
  agentName: string;
  agentType?: string;
  sessionId?: string;
  lastAction: string;
  actions: number;
  tokens: number;
  costUsd: number;
}

interface AgentSession {
  sessionId: string;
  agentName: string;
  startedAt: number;
  durationMs: number;
  actions: number;
  tokens: number;
  costUsd: number;
  status: 'success' | 'failure' | 'timeout';
}
```

### ApiKey / CreatedApiKey

```typescript
interface ApiKey {
  id: string;
  name: string;
  preview: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface CreatedApiKey extends ApiKey {
  key: string; // full secret, shown only once
}
```

### WebhookConfig / WebhookDelivery / WebhookEvent

```typescript
type WebhookEvent = 'trace.complete' | 'trace.error' | 'run.complete' | 'run.error' | 'cost.threshold' | 'agent.inactive';

interface WebhookConfig {
  id: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
  failureCount: number;
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: string;
  status: 'success' | 'failure';
  httpStatus?: number;
  error?: string;
  createdAt: number;
}
```

### Other Types

```typescript
type AgentFramework = 'langgraph' | 'crewai' | 'autogen' | 'custom';
type ExportFormat = 'json' | 'csv' | 'otel';

interface FrameworkIntegration {
  framework: AgentFramework;
  version?: string;
  autoTrace?: boolean;
  traceTools?: boolean;
  traceTokens?: boolean;
}

interface DashboardConfig {
  port?: number;
  host?: string;
  openBrowser?: boolean;
  dbPath?: string;
}
```

---

## Types (Python)

All types are `@dataclass` instances in `agenttrace.types`.

| Python Type | TypeScript Equivalent | Notes |
|---|---|---|
| `ToolCall` | `ToolCall` | snake_case fields |
| `TokenUsage` | `TokenUsage` | snake_case fields |
| `Trace` | `Trace` | snake_case fields |
| `Run` | `Run` | snake_case fields |
| `TraceConfig` | `TraceConfig` | snake_case fields |
| `TraceFilter` | `TraceFilter` | snake_case fields |
| `TraceStats` | `TraceStats` | snake_case fields |
| `CostBreakdown` | `CostBreakdown` | snake_case fields |
| `Scorer` | `Scorer` | `fn: Callable[[Trace], Any]` |
| `ScorerResult` | `ScorerResult` | snake_case fields |
| `EvaluateOptions` | `EvaluateOptions` | snake_case fields |
| `AgentUsageRecord` | `AgentUsageRecord` | snake_case fields |
| `AgentUsageFilter` | `AgentUsageFilter` | snake_case fields, adds `session_id` |
| `UsageStats` | `UsageStats` | snake_case fields |

Type aliases:

```python
Status = Literal["success", "failure", "error", "timeout"]
RunStatus = Literal["running", "success", "failure", "error"]
ExportFormat = Literal["json", "csv"]
UsageStatus = Literal["success", "failure", "timeout"]
CostCalculator = Callable[[TokenUsage, Optional[str]], float]
HallucinationDetector = Callable[[Any, Optional[Any]], bool]
```

---

## Singleton Helpers

Both SDKs provide module-level singleton functions:

```typescript
// TypeScript
import { init, getAgentTrace, score, alert } from '@agenttrace-io/sdk';

const agent = init({ dbPath: './traces.db' });
const same = getAgentTrace(); // returns existing or creates default

const myScorer = score('accuracy', (trace) => trace.status === 'success' ? 1 : 0);
const myAlert = alert({ name: 'errors', condition: (s) => s.successRate < 0.95, cooldown: 60 });
```

```python
# Python
from agenttrace import init, get_agent_trace, trace, score, evaluate, evaluate_trace

agent = init(db_path="./traces.db")
same = get_agent_trace()

# Module-level trace/evaluate use the global instance
result = trace("op", lambda: work())
results = evaluate([scorer1, scorer2])
```

---

## Migration Utilities

**TypeScript only.**

```typescript
import { runPendingMigrations, getSchemaVersion } from '@agenttrace/sdk';

const { applied, version } = runPendingMigrations('./agenttrace.db');
console.log(`Applied ${applied} migrations, now at version ${version}`);

const current = getSchemaVersion('./agenttrace.db');
```

Migrations are numbered sequentially (001 through 006) and tracked in the `meta` / `version` tables. The Python SDK handles schema initialization in `TraceStorage.__init__` without a separate migration runner.

---

## Model Rate Registration

**TypeScript only.**

```typescript
import { registerModelRate } from '@agenttrace-io/sdk';

// Rates are USD per 1,000 tokens
registerModelRate('my-custom-model', 0.001, 0.002);
```

This updates the default cost calculator's rate table at runtime.
