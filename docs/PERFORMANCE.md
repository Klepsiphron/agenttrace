# AgentTrace Performance Guide

Benchmark data, optimization strategies, and cost-control patterns for production
agent workloads.

All numbers in this document come from `benchmarks/RESULTS.md` and were measured
on Node v22.22.3, linux x64. Real workloads vary -- always profile in your own
environment.

---

## Benchmark Summary

### Write Throughput

| Operation                              | Rate      | Time for N |
| -------------------------------------- | --------- | ---------- |
| `trace()` API (5,000 traces)           | 7,032/s   | 711 ms     |
| `storage.createTrace()` direct (5,000) | 6,910/s   | 724 ms     |
| `recordAgentUsage()` (10,000 records)  | 25,002/s  | 400 ms     |
| `console.log` + JSON (10,000)          | 370,686/s | 27 ms      |
| JSONL `appendFileSync` (10,000)        | 173,687/s | 58 ms      |

Takeaway: raw logging (JSONL/console) is ~25x faster than structured SQLite
writes. AgentTrace trades write speed for queryability, durability, and
built-in analytics. For almost all agent workloads, 7k traces/s is more than
enough -- a single agent rarely fires thousands of LLM calls per second.

### Query Performance (10,000 trace dataset)

| Filter                       | Matches | Time (ms) |
| ---------------------------- | ------- | --------- |
| noFilter (full scan)         | 10,000  | 262       |
| status: ['success']          | 9,500   | 232       |
| status: ['error']            | 500     | 15        |
| name LIKE '%op-1%'           | 3,928   | 115       |
| cost 0.0002-0.0006           | 9,224   | 234       |
| latency 100-300 ms           | 4,221   | 116       |
| limit 100 offset 3000        | 100     | 2         |
| by runId (single run)        | 10,000  | 242       |
| combined (success + latency) | 500     | 56        |

Key observations:

- **Low-cardinality filters (status=error) are fast** -- single-digit ms with
  only 500 matching rows.
- **Full scans and range queries materialize full Trace objects** including
  correlated subqueries for `tool_calls`. This dominates at 10k scale.
- **Pagination is cheap** -- LIMIT/OFFSET with small pages is sub-3ms even when
  the engine scans the full dataset first.
- **Object hydration cost is significant.** SQL itself is fast; the overhead is
  in deserializing JSON blobs and assembling JS objects (or Python dataclasses).

### Stats Aggregation

`getStats()` on 10,000 traces: **6 ms**. Stats use `COUNT`/`SUM`/`AVG` without
materializing rows. Extremely fast regardless of dataset size (these are
single-row aggregate queries).

### Memory

| Metric                       | Value     |
| ---------------------------- | --------- |
| Heap delta for 10k traces    | +14.48 MB |
| Approx heap per loaded trace | 0.9 KB    |
| RSS delta                    | +0.13 MB  |

10k traces adds less than 15 MB of heap. RSS barely moves because SQLite
manages its own page cache in the WAL.

### Disk Usage

| Dataset                           | Size     | Per record |
| --------------------------------- | -------- | ---------- |
| 10k traces + ~3,333 usage records | 4,916 KB | 0.492 KB   |

~500 bytes per trace on disk, including indexes and WAL. JSONL is ~25% smaller
at 10k scale because it carries no index overhead.

---

## Optimization Tips

### 1. Use Filtered Queries, Not Full Scans

Bad: load everything, filter in JS:

```
const all = agent.getTraces(); // 10k traces into memory
const errors = all.filter(t => t.status === 'error');
```

Good: push filters to the SQLite layer:

```
const errors = agent.getTraces({ status: ['error'] });
```

The filter happens at the storage level. Only matching rows are hydrated into
objects. For the 10k benchmark dataset, this drops query time from 262 ms
(full scan) to 15 ms (status=error with index).

### 2. Always Paginate Large Result Sets

Use `limit` and `offset` for any query that might return more than a few
hundred rows:

```
const page = agent.getTraces({ status: ['error'], limit: 50, offset: 0 });
```

Pagination is the cheapest query pattern in the benchmark -- 2.23 ms for
`LIMIT 100 OFFSET 3000` even on a 10k dataset.

### 3. Use `recordAgentUsage()` for High-Volume Action Logging

If you need to log agent actions at high frequency (tool calls, delegations,
research steps, etc.), use `recordAgentUsage()` instead of `trace()`. It writes
to a flat table with no sub-objects and achieves ~25k records/s -- about 3.5x
faster than `trace()`.

```
agent.recordAgentUsage({
  agentName: 'researcher',
  action: 'web_search',
  tokensUsed: 0,
  durationMs: 120,
});
```

### 4. Avoid `LIKE '%...%'` When Possible

The `name` filter uses `LIKE '%pattern%'` which cannot use a B-tree index
(prefix wildcards prevent index seeks). If you frequently filter by trace name,
consider:

- Using exact match or prefix match if your naming convention allows it.
- Filtering by `status` or `runId` first to reduce the candidate set.
- Using `getTraces({ runId: '...' })` to scope to a single run, then
  filtering by name on the smaller result set.

### 5. Use `getStats()` Instead of Computing Aggregates Manually

`getStats()` runs `COUNT`/`SUM`/`AVG` in SQL and returns a single row. It
completes in ~6 ms on 10k traces. Computing the same stats by loading all
traces into JS and reducing would take 260+ ms and 15+ MB of heap.

---

## Database Indexing

AgentTrace creates the following indexes automatically on schema init:

### traces table

| Index                   | Column(s)    | Use case                             |
| ----------------------- | ------------ | ------------------------------------ |
| `idx_traces_run_id`     | `run_id`     | Filter traces by run                 |
| `idx_traces_status`     | `status`     | Filter by success/error/failure      |
| `idx_traces_created_at` | `created_at` | Time-range queries, ORDER BY         |
| `idx_traces_cost`       | `cost_usd`   | Cost threshold alerts, range filters |
| `idx_traces_parent_id`  | `parent_id`  | Multi-agent child trace lookups      |

### tool_calls table

| Index                     | Column(s)  | Use case                     |
| ------------------------- | ---------- | ---------------------------- |
| `idx_tool_calls_trace_id` | `trace_id` | Join tool calls to traces    |
| `idx_tool_calls_name`     | `name`     | Aggregate stats by tool name |

### agent_usage table

| Index                        | Column(s)    | Use case              |
| ---------------------------- | ------------ | --------------------- |
| `idx_agent_usage_agent_name` | `agent_name` | Filter by agent       |
| `idx_agent_usage_session_id` | `session_id` | Filter by session     |
| `idx_agent_usage_action`     | `action`     | Filter by action type |
| `idx_agent_usage_status`     | `status`     | Filter by status      |
| `idx_agent_usage_created_at` | `created_at` | Time-range queries    |

### scores table

| Index                 | Column(s)  | Use case              |
| --------------------- | ---------- | --------------------- |
| `idx_scores_trace_id` | `trace_id` | Join scores to traces |
| `idx_scores_name`     | `name`     | Filter by scorer name |

### Other tables

- `idx_trace_links_source` / `idx_trace_links_target` -- graph traversal for
  linked traces.
- `idx_alerts_name` / `idx_alert_history_*` -- alert lookup and history
  queries.
- `idx_webhooks_enabled` / `idx_api_keys_created_at` -- dashboard API auth.

### When to Add Custom Indexes

If you frequently query on columns not covered above (e.g., `model`,
`provider`, or a custom metadata field), you can add indexes directly to the
SQLite file:

```sql
CREATE INDEX IF NOT EXISTS idx_traces_model ON traces(model);
```

Do this sparingly. Each index adds write overhead and disk usage. For most
workloads the default indexes are sufficient.

---

## Connection Pooling

AgentTrace uses a **single persistent SQLite connection** per `TraceStorage`
instance. There is no connection pool.

This is intentional:

- SQLite is an embedded database. There is no network round-trip.
- `better-sqlite3` (Node) and `sqlite3` (Python) both use a single file
  descriptor with WAL mode for concurrent reads.
- WAL mode allows one writer and multiple readers concurrently without
  connection multiplexing.

If you need multiple `AgentTrace` instances (e.g., per-tenant databases),
each gets its own connection and DB file. There is no shared pool.

For the Python SDK, `check_same_thread=False` is set on the connection to allow
cross-thread usage, but writes are still serialized by SQLite's WAL locking.

---

## Trace Sampling (Rate Limiting)

AgentTrace includes a **token bucket rate limiter** to prevent trace flooding in
high-volume or runaway agent scenarios. This is the primary sampling mechanism.

### Configuration

```
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace({
  maxTracesPerSecond: 100,   // sustained rate (0 = disabled)
  maxTracesPerMinute: 1000,  // burst cap (0 = disabled)
  burstAllowance: 20,        // extra tokens above sustained rate
});
```

### How It Works

- Two token buckets: per-second and per-minute.
- Each `trace()` call consumes one token from each bucket.
- If either bucket is empty, the trace is **silently dropped** -- the wrapped
  function still executes, but no trace is recorded.
- Dropped trace count is available via `agent.getDroppedTraces()`.

### When to Enable Rate Limiting

- **Multi-agent systems** where dozens of agents may trace simultaneously.
- **Agents with tight loops** (e.g., polling, retry logic) that could generate
  thousands of traces per second.
- **Cost control** -- fewer traces means less disk usage and faster queries.

### Recommended Settings

| Workload                    | perSecond | perMinute | burst |
| --------------------------- | --------- | --------- | ----- |
| Single agent, dev/debug     | 0 (off)   | 0 (off)   | --    |
| Production, moderate volume | 100       | 1,000     | 20    |
| High-volume multi-agent     | 500       | 5,000     | 50    |
| Aggressive cost control     | 10        | 500       | 5     |

Start with rate limiting disabled. Enable it only if you observe runaway trace
volume or excessive disk growth.

---

## Cost Optimization

### 1. Use Retention Policies

AgentTrace supports automatic data retention. Traces older than `retentionDays`
are purged on a scheduled interval:

```
const agent = new AgentTrace({
  retentionDays: 30,           // keep 30 days (0 = keep forever)
  cleanupIntervalHours: 24,     // run cleanup daily
});
```

This prevents unbounded disk growth. At ~0.5 KB per trace, 100k traces is ~50
MB -- manageable, but over months it adds up.

### 2. Use `recordAgentUsage()` for Non-LLM Actions

`trace()` stores input/output JSON blobs, tool calls, metadata, and token usage.
If you only need to record that an action happened (not the full I/O),
`recordAgentUsage()` writes a smaller row and skips the overhead of trace
object construction.

### 3. Register Custom Model Rates

AgentTrace ships with built-in rates for 15+ models. If you use a custom or
fine-tuned model, register its rate to get accurate cost tracking:

```
import { registerModelRate } from '@agenttrace-io/sdk';

registerModelRate('my-custom-model', 0.0005, 0.0015);
// $0.50/M prompt tokens, $1.50/M completion tokens
```

Without a registered rate, the default fallback is $1/M prompt + $2/M
completion, which may overestimate your actual cost.

### 4. Use `getCostBreakdown()` for Budget Tracking

```
const costs = agent.getCostBreakdown();
console.log(costs.totalCostUsd);       // total spend
console.log(costs.costByModel);        // { 'gpt-4o': 1.23, 'claude-sonnet-4': 0.45 }
console.log(costs.costByDay);          // { '2026-06-03': 0.89 }
```

This runs a single `SUM GROUP BY` query -- very fast. Use it for periodic
budget checks or to feed into alert conditions.

### 5. Set Up Cost Alerts

```
agent.registerAlert({
  name: 'daily-cost-limit',
  condition: (stats) => stats.totalCostUsd > 10.0,
  webhook: 'https://hooks.slack.com/...',
  cooldown: 3600, // max once per hour
});
```

Alerts are evaluated after each trace. The cooldown prevents alert storms.

### 6. Export and Archive

For long-term cost analysis without keeping all traces locally:

```
npx agenttrace export --format csv > traces-2026-06.csv
```

Then purge old data with retention or manual cleanup. CSV export is a streaming
operation that doesn't load all traces into memory.

---

## Scaling Guidelines

| Scale                    | Traces   | DB Size   | Recommendation                                                     |
| ------------------------ | -------- | --------- | ------------------------------------------------------------------ |
| Dev / debugging          | < 1k     | < 1 MB    | Default config, no rate limiting                                   |
| Single agent, production | 1k-50k   | 1-25 MB   | Enable retention (30 days)                                         |
| Multi-agent, moderate    | 50k-200k | 25-100 MB | Rate limiting + retention                                          |
| High-volume / long-lived | 200k+    | 100+ MB   | Aggressive retention (7-14 days), consider periodic export + reset |

SQLite handles millions of rows, but query performance degrades as the dataset
grows. For workloads exceeding 200k traces, use retention policies to keep the
active dataset manageable, or export and reset periodically.

For reference: at 10k traces, a full scan takes ~260 ms. At 100k traces, expect
~2-3 seconds for unfiltered queries. Filtered queries on indexed columns will
scale much better.

---

## See Also

- `benchmarks/RESULTS.md` -- raw benchmark data and methodology
- `docs/API-REFERENCE.md` -- full API documentation
- `docs/comparison.md` -- AgentTrace vs Langfuse vs LangSmith
