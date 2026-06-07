---
title: TypeScript SDK
description: Complete reference for the @agenttrace-io/sdk TypeScript package.
---

**Module:** `@agenttrace-io/sdk`
**Version:** 0.1.x

The main entry point. Wraps `TraceStorage` and provides the high-level tracing, querying, alerting, and export API.

## AgentTrace Class

```typescript
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace(config?: TraceConfig);
```

### Constructor & TraceConfig

**`TraceConfig` fields (all optional):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dbPath` | `string` | `'./agenttrace.db'` | SQLite database file path |
| `maxTraces` | `number` | `10000` | Max traces retained; oldest deleted when exceeded |
| `autoCleanup` | `boolean` | `true` | Auto-cleanup after each `trace()` call |
| `costCalculator` | `(tokens, model?) => number` | built-in | Custom USD cost function |
| `hallucinationDetector` | `(output, expected?) => boolean` | `() => false` | Custom hallucination check |
| `silent` | `boolean` | `false` | Suppress console output |
| `retentionDays` | `number` | `30` | Data retention in days (0 = forever) |
| `cleanupIntervalHours` | `number` | `24` | How often to run retention cleanup |
| `tenantId` | `string` | `''` | Multi-tenant scoping |
| `maxTracesPerSecond` | `number` | `0` | Rate limit per second (0 = disabled) |
| `maxTracesPerMinute` | `number` | `0` | Rate limit per minute (0 = disabled) |
| `burstAllowance` | `number` | `10` | Extra burst tokens above sustained rate |

### Singleton Helpers

```typescript
import { init, trace } from '@agenttrace-io/sdk';

// init() creates or returns a singleton AgentTrace instance
const agent = init({ dbPath: './my.db' });

// trace() is a shortcut for init().trace()
const result = await trace('my-op', async () => { /* ... */ });
```

## Run Management

### `startRun`

```typescript
startRun(name: string, metadata?: Record<string, unknown>): string
```

Starts a new agent run. Returns a UUID `runId`. All subsequent `trace()` calls are associated with this run until `completeRun()`.

```typescript
const runId = agent.startRun('data-pipeline', { version: '1.0' });
```

### `completeRun`

```typescript
completeRun(status?: 'success' | 'failure' | 'error'): void
```

Marks the current run as completed. Defaults to `'success'`.

## Tracing: `trace()`

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
const result = await agent.trace(
  'llm-call',
  async () => {
    return await openai.chat.completions.create({ model: 'gpt-4o', messages });
  },
  {
    input: { messages },
    tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    model: 'gpt-4o',
    provider: 'openai',
  },
);
```

## Tool Calls: `recordToolCall`

```typescript
recordToolCall(call: Omit<ToolCall, 'id' | 'timestamp'>): string
```

Records a tool call. Returns a UUID.

## Querying

### `getTraces`

```typescript
getTraces(filter?: TraceFilter): Trace[]
```

Query traces with optional filtering.

```typescript
const errors = agent.getTraces({ status: ['error'], limit: 10 });
const recent = agent.getTraces({ fromDate: Date.now() - 3600000, limit: 100 });
```

### `getTrace`

```typescript
getTrace(id: string): Trace | null
```

### `getRuns` / `getRun`

```typescript
getRuns(limit?: number): Run[]
getRun(id: string): Run | null
```

## Statistics

### `getStats`

```typescript
getStats(): TraceStats
```

Returns aggregate statistics across all traces and runs.

### `getCostBreakdown`

```typescript
getCostBreakdown(filter?: { runId?: string }): CostBreakdown
```

### `getHealth`

```typescript
getHealth(): HealthReport
```

Returns health report including version, uptime, DB path, trace count, DB size, and integrity check.

### `getStorageStats` / `getDroppedTraces`

```typescript
getStorageStats(): { totalSizeBytes: number; traceCount: number; runCount: number; oldestTrace: number | null; newestTrace: number | null }
getDroppedTraces(): number
```

## Multi-Agent Tracing

### `createChild`

```typescript
createChild(context: TraceContext): TraceContext
```

Creates a child `TraceContext` linked to the parent for hierarchical tracing.

```typescript
const parentCtx = new TraceContext(parentTraceId);
const childCtx = agent.createChild(parentCtx);
await agent.trace('child-op', async () => { /* ... */ }, { context: childCtx });
```

### `linkTraces`

```typescript
linkTraces(traceIds: string[]): void
```

### `getTraceTree`

```typescript
getTraceTree(traceId: string): TraceTreeNode
```

## Agent Usage Tracking

### `recordAgentUsage`

```typescript
recordAgentUsage(record: Omit<AgentUsageRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): void
```

```typescript
agent.recordAgentUsage({
  agentName: 'my-agent',
  agentType: 'ai-agent',
  action: 'file-edit',
  target: 'src/index.ts',
  tokensUsed: 500,
  costUsd: 0.01,
  durationMs: 2500,
  status: 'success',
});
```

### `getAgentUsage` / `getUsageStats` / `getActiveAgents` / `getAgentWho` / `getAgentSessions`

```typescript
getAgentUsage(filter?: AgentUsageFilter): AgentUsageRecord[]
getUsageStats(agentName?: string, fromDate?: number, toDate?: number): UsageStats
getActiveAgents(): { agentName: string; lastActive: string; totalActions: number }[]
getAgentWho(filter?: { activeOnly?: boolean; agentType?: string; limit?: number }): AgentWho[]
getAgentSessions(filter?: { agentName?: string; activeOnly?: boolean; limit?: number }): AgentSession[]
```

## API Key Management

### `createApiKey`

```typescript
createApiKey(name: string): CreatedApiKey
```

Creates a new API key. The secret key is shown only once — only its SHA-256 hash is stored.

```typescript
const key = agent.createApiKey('dashboard');
console.log(key.key);    // at_abc123... (show once)
console.log(key.preview); // at_abc123****
```

### `listApiKeys` / `revokeApiKey` / `validateApiKey`

```typescript
listApiKeys(): { id: string; name: string; createdAt: number; lastUsedAt: number | null; enabled: boolean }[]
revokeApiKey(id: string): void
validateApiKey(key: string): { valid: boolean; permissions: string[] }
```

## Webhook Management

### `addWebhook` / `registerWebhook`

```typescript
addWebhook(url: string, events: WebhookEvent[], secret?: string): string
```

### `getWebhooks` / `removeWebhook` / `triggerWebhook` / `testWebhook`

```typescript
getWebhooks(): WebhookConfig[]
removeWebhook(id: string): void
async triggerWebhook(event: WebhookEvent, payload: Record<string, unknown>): Promise<WebhookDelivery[]>
async testWebhook(id: string): Promise<{ ok: boolean; status?: number; error?: string }>
```

## Alerting

### `registerAlert`

```typescript
registerAlert(alert: AlertCondition): void
```

```typescript
agent.registerAlert({
  name: 'high-error-rate',
  condition: 'errorRate > 0.3',
  webhookId: 'webhook-uuid',
});
```

### `checkAlerts` / `getAlerts` / `getAlertHistory`

## Evaluation: `evaluate` / `evaluateTrace`

```typescript
async evaluate(options: { scorers: Scorer[]; runId?: string; concurrency?: number }): Promise<ScorerResult[]>
async evaluateTrace(traceId: string, scorers: Scorer[]): Promise<ScorerResult>
```

## Export

```typescript
export(format: 'json' | 'csv' | 'otel', options?: { runId?: string }): string
```

## Lifecycle

```typescript
onUsage(listener: (record: AgentUsageRecord) => void): void
offUsage(listener: (record: AgentUsageRecord) => void): void
close(): void
```

## Other Classes

### `TraceStorage`

Low-level SQLite access layer. `AgentTrace` wraps this; use directly for advanced queries.

### `TraceContext`

Holds trace ID + parent chain for multi-agent hierarchical tracing.

```typescript
const ctx = new TraceContext('trace-uuid');
const childCtx = agent.createChild(ctx);
```

### `SelfTracker`

Tracks the agent's own resource usage (actions, tokens, cost) to a JSONL log.

### `TokenBucketRateLimiter`

Two-bucket rate limiter (per-second + per-minute) for trace flooding protection.

## Types

Key interfaces: `Trace`, `Run`, `TokenUsage`, `ToolCall`, `TraceConfig`, `TraceFilter`, `TraceStats`, `CostBreakdown`, `HealthReport`, `AgentUsageRecord`, `Scorer`, `ScorerResult`, `AlertCondition`, `AlertHistory`, `WebhookConfig`, `WebhookEvent`, `WebhookDelivery`, `ApiKey`, `CreatedApiKey`, `TraceContext`, `TraceTreeNode`.

See the [auto-generated API reference](/sdk-reference/api/) for complete type definitions.
