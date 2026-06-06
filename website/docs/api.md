# AgentTrace API Reference

This document covers the public API of the TypeScript SDK (`@agenttrace-io/sdk`) v0.1.0. The Python SDK mirrors the same concepts with Pythonic naming.

**Package:** `@agenttrace-io/sdk`  
**Source:** [packages/sdk/src/index.ts](../..) and [packages/sdk/src/types.ts](../..)

---

## Installation

```bash
npm install @agenttrace-io/sdk
# peer dependency (required):
npm install better-sqlite3
```

---

## Initialization

### `init(config?: TraceConfig): AgentTrace`

Convenience singleton creator. Recommended for most apps.

```ts
import { init } from '@agenttrace-io/sdk';

const agent = init({ dbPath: './agenttrace.db' });
```

### `new AgentTrace(config?: TraceConfig)`

Direct constructor (also returned by `init`).

```ts
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace({
  dbPath: './traces.db',
  maxTraces: 50000,
  retentionDays: 90,
  silent: false,
});
```

### `getAgentTrace(): AgentTrace`

Returns the current singleton (creates a default one if none exists).

---

## TraceConfig

```ts
interface TraceConfig {
  dbPath?: string;                    // default: './agenttrace.db'
  maxTraces?: number;                 // default: 10000
  autoCleanup?: boolean;              // default: true
  costCalculator?: (tokens: TokenUsage, model?: string) => number;
  hallucinationDetector?: (output: unknown, expected?: unknown) => boolean;
  silent?: boolean;                   // suppress console warnings
  retentionDays?: number;             // 0 = forever (default 30 in persisted policy)
  cleanupIntervalHours?: number;      // default 24
  tenantId?: string;                  // multi-tenant scoping
  maxTracesPerSecond?: number;        // rate limit (0 = disabled)
  maxTracesPerMinute?: number;
  burstAllowance?: number;            // default 10
}
```

---

## Core Tracing

### `startRun(name: string, metadata?: Record<string, unknown>): string`

Creates a new run (logical session) and sets it as current. Returns the generated `runId`.

### `completeRun(status?: 'success' | 'failure' | 'error' | 'running'): void`

Completes the current run. Fires `run.complete` / `run.error` webhooks automatically.

### `async trace<T>( name: string, fn: () => Promise<T>, options?: TraceOptions ): Promise<T>`

The primary tracing primitive. Wraps an async operation, records latency, cost, tokens, tool calls (collected via `recordToolCall`), input/output, metadata, and parent linkage.

**TraceOptions**
```ts
{
  input?: unknown;
  tokens?: TokenUsage;           // strongly recommended for accurate cost
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  parentId?: string;
  context?: TraceContext;        // from createChild()
}
```

Inside the `fn`, call `agent.recordToolCall(...)` to attach tool invocations to the active trace.

### `recordToolCall(call: Omit<ToolCall, 'id' | 'timestamp'>): string`

Record a tool call that occurred during the current `trace()` callback. Returns the generated call id.

Must be called from inside an active `trace()` — otherwise it warns (unless `silent`).

---

## Query Methods

### `getTraces(filter?: TraceFilter): Trace[]`
### `getTrace(id: string): Trace | null`
### `getRuns(limit?: number): Run[]`
### `getRun(id: string): Run | null`

`TraceFilter` supports: `runId`, `status[]`, `name`, date ranges, cost/latency min/max, `limit`, `offset`.

### `getStats(): TraceStats`

Returns aggregate statistics (totalRuns, totalTraces, successRate, avgLatency, totalCostUsd, costByModel, totalTokens, topTools, topErrors, droppedTraces, ...).

### `getCostBreakdown(filter?: { runId?: string }): CostBreakdown`

`{ totalCostUsd, costByModel: Record<string, number>, costByDay: Record<string, number> }`

### `getDroppedTraces(): number`

Number of traces skipped due to configured rate limits.

---

## Agent Self-Tracking (usage beyond LLM traces)

Useful for meta-agents, research agents, or any process that wants to log high-level actions.

- `recordAgentUsage(record: Omit<AgentUsageRecord, 'id'|'createdAt'> & {id?, createdAt?})`
- `getAgentUsage(filter?: AgentUsageFilter): AgentUsageRecord[]`
- `getUsageStats(agentName?, fromDate?, toDate?): UsageStats`
- `getActiveAgents(): { agentName, lastActive, totalActions }[]`
- `getAgentWho(filter?: { activeOnly?, agentType?, limit? }): AgentWho[]`
- `getAgentSessions(filter?: { agentName?, activeOnly?, limit? }): AgentSession[]`

CLI surfaces many of these via `self-stats`, `who`, `cost`, `sessions`, `activity`.

---

## Multi-Agent / Hierarchical Tracing

### `createChild(context: TraceContext): TraceContext`

Creates a fresh child context (new traceId, parentSpanId set to parent's traceId). Pass via `options.context` to a nested `trace()` call (works across AgentTrace instances).

### `linkTraces(traceIds: string[]): void`

Manually declare a set of traces as related (for collaboration without strict parent/child).

### `getTraceTree(traceId: string): TraceTreeNode`

Returns the full tree (parent → children) following `parentId` links plus any manual `linkTraces` entries. Root is the ultimate ancestor.

```ts
interface TraceTreeNode {
  trace: Trace;
  children: TraceTreeNode[];
}
```

---

## Alerts

### `registerAlert(alert: AlertCondition): void`

```ts
interface AlertCondition {
  name: string;
  condition: (stats: TraceStats) => boolean;
  webhook?: string;   // HTTPS only (except localhost / private for testing)
  email?: string;     // not yet implemented in v0.1
  cooldown?: number;  // seconds
}
```

Alerts are checked automatically after every `trace()`. Conditions that fire are recorded in history and delivered (with HMAC if secret configured on matching webhook).

### `async checkAlerts(): Promise<AlertHistory[]>`

Force an immediate check (rarely needed — called internally).

### `getAlerts(): AlertCondition[]`
### `getAlertHistory(): AlertHistory[]`

`getAlerts()` returns both persisted configs (with no-op conditions for CLI) and runtime-registered alerts with real functions.

---

## Webhooks

- `addWebhook(url: string, events: WebhookEvent[], secret?: string): string`
- `registerWebhook(...)` — alias
- `getWebhooks(): WebhookConfig[]`
- `removeWebhook(id: string): void`
- `deleteWebhook(id)` — alias

**Events:** `'trace.complete' | 'trace.error' | 'run.complete' | 'run.error' | 'cost.threshold' | 'agent.inactive'`

### `async triggerWebhook(event, payload): Promise<WebhookDelivery[]>`
### `async testWebhook(id: string): Promise<{ok, status?, error?}>`

Deliveries are signed with `X-AgentTrace-Signature: sha256=...` when a secret is configured. SSRF protection and 10s timeout are enforced.

### `onWebhook(handler): () => void`

Subscribe to in-process webhook events (both auto-triggered and explicit). Returns unsubscribe function.

### `async emitWebhookEvent(event, payload)` / `triggerAllWebhooks(event, payload)`

Fire webhooks + in-process handlers for custom events.

---

## Export & Evaluation

### `export(format: 'json' | 'csv' | 'otel' = 'json', filter?: TraceFilter): string`

- `json`: full Trace objects
- `csv`: flat columns (id, runId, name, status, latencyMs, costUsd, totalTokens, createdAt, ...)
- `otel`: OTLP JSON resourceSpans (no external OpenTelemetry SDK required)

### `async evaluate(options: EvaluateOptions): Promise<ScorerResult[]>`

```ts
interface EvaluateOptions {
  scorers: Scorer[];
  runId?: string;
  traceIds?: string[];
  concurrency?: number;
}

interface Scorer {
  name: string;
  fn: (trace: Trace) => number | Promise<number>;
}
```

Scores are stored in the DB and attached to future `getTraces` / exports.

Helper: `score(name: string, fn: Scorer['fn']): Scorer`

### `async evaluateTrace(traceId: string, scorers: Scorer[]): Promise<ScorerResult>`

---

## API Keys, Projects, Multi-Tenancy

- `createApiKey(name: string): CreatedApiKey` — returns secret once
- `listApiKeys()`
- `revokeApiKey(id: string)`
- `validateApiKey(key: string): { valid: boolean; permissions: string[] }`

Projects (basic multi-tenant isolation):
- `createProject(name): { id, name, apiKey, createdAt }`
- `getProject(apiKey)`
- `deleteProject(id)`

---

## Health, Retention, Storage

- `getHealth(): HealthReport` — version, uptime, db size, integrity checks
- `close(): void` — important: clears timers and closes the SQLite connection
- `getStorageStats()`
- `getRetentionPolicy()` / `setRetentionPolicy(days: number, intervalHours?)`
- `cleanupOldTraces(before: number)`, `cleanupOldRuns(before)`, `cleanupOldAgentUsage(before)`

---

## Cost Calculator & Model Rates

Built-in rates for gpt-4o, gpt-4o-mini, claude-*, gemini-*, llama-* (and more). Rates are USD per 1 000 tokens.

```ts
import { registerModelRate } from '@agenttrace-io/sdk';

registerModelRate('my-fine-tuned', 0.0015, 0.0045);
```

Custom `costCalculator` can be supplied in `TraceConfig`.

---

## Types (selected)

See `packages/sdk/src/types.ts` for full definitions:

- `Trace`, `Run`, `ToolCall`, `TokenUsage`
- `TraceStats`, `CostBreakdown`, `TraceFilter`
- `AlertCondition`, `AlertHistory`, `WebhookEvent`, `WebhookConfig`
- `TraceContext`, `TraceTreeNode`
- `AgentUsageRecord`, `UsageStats`, `AgentWho`, `AgentSession`
- `Scorer`, `ScorerResult`, `EvaluateOptions`
- `ExportFormat`, `HealthReport`, etc.

All types are re-exported from the package root.

---

## Rate Limiting

When `maxTracesPerSecond` or `maxTracesPerMinute` is set, excess traces execute the user function but are **not recorded**. `getDroppedTraces()` reports the count.

---

## Python SDK Parity

The Python package (`agenttrace-io`) provides:

- `init(db_path=..., ...)`
- `agent.trace(name, fn, ...)` (sync + async)
- `@trace(name)` decorator
- `with agent.trace(...) as t: ...`
- `get_stats()`, `close()`, `export()`, `evaluate()`, alerts, webhooks, etc.
- `SelfTracker` for agent self-usage logging

See the Python package README and tests for exact surface.

---

## CLI Surface (for reference)

`agenttrace-io` (and `agenttrace`) commands: `init`, `dashboard`, `runs`, `traces`, `stats`, `costs`, `export`, `tree`, `alerts`, `self-stats`, `who`, `cost`, `sessions`, `activity`, `webhook`, `health`, `benchmark`, `retention`, `cleanup`, `version`.

All major SDK query methods are exposed via the CLI with `--json` support.

---

For usage examples, see the repository `examples/` directory and the main README.
