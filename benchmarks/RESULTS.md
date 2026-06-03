# AgentTrace Benchmark Results

**Generated:** 2026-06-03  
**Environment:** Node v22.22.3, linux x64  
**Purpose:** Compare AgentTrace (SQLite-backed) performance characteristics against raw logging approaches (console.log, JSONL appends) for AI agent observability use cases.

Benchmarks were executed via:
- `node --experimental-strip-types benchmarks/trace-benchmark.ts`
- `node --experimental-strip-types benchmarks/compare-logging.ts`

> **Note:** Do not commit this directory or results. These are local performance snapshots.

## 1. Trace Performance (`trace-benchmark.ts`)

### Insertion Rate (5,000 traces)

| Method              | Time (ms) | Traces/sec |
|---------------------|-----------|------------|
| via `trace()` API   | 711.09    | 7,032      |
| via `storage.createTrace` (direct) | 723.63 | 6,910 |

High-level `trace()` wrapper (which includes timing, cost calculation, metadata merge, storage write, and alert checks) has comparable throughput to direct storage insert for this workload.

### Query Performance (`getTraces` with filters, 10,000 trace dataset)

| Filter                          | Matching | Time (ms) |
|---------------------------------|----------|-----------|
| noFilter (full scan)            | 10,000   | 262.38    |
| status: ['success']             | 9,500    | 232.42    |
| status: ['error']               | 500      | 15.40     |
| name LIKE '%op-1%'              | 3,928    | 114.81    |
| cost 0.0002–0.0006              | 9,224    | 233.71    |
| latency 100–300 ms              | 4,221    | 116.22    |
| limit 100 offset 3000 (paginated) | 100    | 2.23      |
| by runId (all in single run)    | 10,000   | 241.69    |
| combined (success + minLatency + limit) | 500 | 56.30 |

**Observation:** Status=`error` (small cardinality) is fast. Full table scans and range scans on cost/latency/name materialize full Trace objects (including subquery for tool_calls) which dominates time at 10k scale. Pagination is cheap. Indexed columns (status, run_id) show some benefit but object hydration cost is significant.

### Stats Aggregation Performance

| Operation     | Time (ms) | Result |
|---------------|-----------|--------|
| `getStats()` on 10k traces | 6.11 | totalTraces=10000, totalCostUsd≈4.026 |

Very fast; stats are pre-aggregated or use efficient COUNT/SUM queries.

### Agent Usage Recording Rate (10,000 records)

| Records | Time (ms) | Records/sec |
|---------|-----------|-------------|
| 10,000  | 399.97    | 25,002      |

`recordAgentUsage` (simple flat table insert, no sub-objects) is ~3.5–4× faster than trace insertion. Excellent for high-volume action logging (self-tracking, multi-agent delegation etc).

### Memory Usage (10,000 traces)

| Metric          | Value     |
|-----------------|-----------|
| RSS before      | 326.73 MB |
| Heap before     | 27.80 MB  |
| RSS after insert| 326.86 MB |
| Heap after insert | 42.28 MB |
| Heap delta      | +14.48 MB |
| Approx heap per trace (loaded) | 0.0009 MB (~0.9 KB) |

SQLite + JS object hydration for 10k traces adds modest ~14.5 MB heap. RSS barely moves (OS page cache / WAL). Very memory efficient.

### DB Size (10,000 traces + ~3,333 usage records)

| Metric         | Value    |
|----------------|----------|
| Total size (db + WAL) | 4,916 KB |
| Per trace      | 0.492 KB |

~500 bytes per trace on disk (with indexes, JSON blobs for input/output/metadata, plus usage rows). Realistic for production local use.

## 2. Raw Logging Comparison (`compare-logging.ts`)

Compares three approaches for writing structured observability records (same shape: id, name, status, latency, cost, tokens, input/output, metadata):

- **console**: `JSON.stringify` + `writeSync` to `/dev/null` (proxy for real `console.log` cost)
- **jsonl**: `fs.appendFileSync(path, JSON.stringify(record) + '\n')` — classic "just log to file"
- **AgentTrace**: `storage.createTrace(...)` into SQLite (with indexes, FK run, cost already computed)

N = 10,000 records.

### Write Throughput

| Approach    | Time (ms) | Writes/sec | Notes |
|-------------|-----------|------------|-------|
| console (/dev/null) | 26.98 | 370,686 | Pure formatting + write; fastest possible "log" |
| jsonl appendFileSync | 57.57 | 173,687 | ~25× faster than AgentTrace |
| AgentTrace (storage) | 1,454.97 | 6,873 | Full model: validation-ish, JSON serialize for storage, index updates, FK checks |

**Trade-off:** Raw logging wins on pure write speed by 25×. AgentTrace pays for structure, queryability, and durability (WAL, indexes).

### Storage Efficiency (after 10k records)

| Approach    | Size (KB) | KB per record | Relative |
|-------------|-----------|---------------|----------|
| jsonl       | 2,754.45  | 0.275         | baseline |
| AgentTrace (db + WAL) | 3,409.95 | 0.341 | 1.24× jsonl |

In this run, JSONL was actually *smaller* than the SQLite file. Reasons:
- JSONL is pure text (no index bloat)
- AgentTrace stores indexes (status, cost, created_at, name, run, tool_calls join table, etc.)
- WAL journal adds to measured size (typical runtime)
- AgentTrace normalizes some fields but still stores full JSON blobs for complex input/output/metadata

For very small N or append-only "fire and forget", raw JSONL can be more compact. For query-heavy or long-lived use, SQLite overhead pays for itself via indexing + no need to hold everything in RAM.

### Query Capability & Speed (same 10k dataset)

After writing, we run equivalent filters:

| Query scenario          | AgentTrace (ms) | JSONL full scan (ms) | AgentTrace count | JSONL count | "Speedup" (jsonl / at) |
|-------------------------|-----------------|----------------------|------------------|-------------|------------------------|
| errors (status=error)   | 11.28           | 0.77                 | 556              | 556         | 0.1x (scan wins) |
| minCost >= 0.0001       | 1.68            | 0.59                 | 0                | 0           | 0.4x |
| name contains "step-1" + success | 91.90 | 1.11 | 4,744 | 4,744 | 0.0x |
| latency 200–400 ms      | 97.09           | 0.49                 | 3,819            | 3,819       | 0.0x |

**Key observations on queries:**
- For tiny result sets or simple filters, in-memory `Array.filter` after loading the entire JSONL is extremely fast at 10k scale.
- AgentTrace `getTraces({name: '...'})` implements `LIKE '%...%'` (no prefix index help) + always hydrates full `Trace` objects + performs correlated subqueries for `toolCalls`. This explains the 80–100 ms for name/latency filters.
- Status filter benefits from `idx_traces_status` → 11 ms vs 0.77 ms scan.
- **Capability difference (not just speed):** 
  - JSONL requires the *caller* to implement filtering, pagination, sorting, aggregation.
  - AgentTrace gives `getTraces`, `getStats()`, `getCostBreakdown()`, `getAgentUsage(...)`, `getUsageStats()`, export to JSON/CSV/OTel, etc. out of the box.
  - For production agents you also want *concurrent* readers/writers, crash-safe appends, and the ability to query *without* loading 100k+ records into JS heap — SQLite wins at scale.

## 3. Summary Takeaways

- **Write speed:** Raw logging (jsonl/console) is dramatically faster (~25×). Use when you only ever want append-only firehose and post-process later (e.g. with separate ETL).
- **AgentTrace insertion:** ~7k traces/sec (high-level API) and ~25k agent-usage records/sec is more than sufficient for virtually all local agent development and even many production single-node workloads. One agent doing thousands of LLM calls per second is rare.
- **Query & analytics:** AgentTrace provides rich, indexed, zero-boilerplate queries and stats. Raw logs force you to re-implement the wheel (and keep everything in memory or use another tool).
- **Storage:** At 10k traces, overhead is low (~0.3–0.5 KB/record). JSONL can be slightly smaller for pure append; SQLite grows with indexes but enables fast queries without full scans. WAL mode adds temporary file size.
- **Memory:** Excellent — ~0.9 KB heap per loaded trace. 10k traces adds <15 MB heap.
- **When to choose AgentTrace over raw logs:**
  - You need to *query* traces by multiple dimensions at runtime (debugging, dashboards, evals).
  - You want built-in cost/token/latency/stats aggregation.
  - You want multi-agent usage tracking (`recordAgentUsage`, who/sessions).
  - You care about structured export (OTel) or local dashboard.
  - You want crash-consistent, queryable storage without writing a query engine.
- **When raw logging may suffice:**
  - Ultra-high throughput append-only (millions/sec possible with better buffering).
  - You already have a log shipper / ClickHouse / Loki / etc. pipeline.
  - You only ever look at logs in a terminal (`tail -f`) or simple grep.

## Raw JSON Outputs

### trace-benchmark.json (excerpted)
```json
{
  "insertion": {
    "viaTraceAPI": { "count": 5000, "timeMs": 711.09, "tracesPerSecond": 7032 },
    "viaStorage": { "count": 5000, "timeMs": 723.63, "tracesPerSecond": 6910 }
  },
  "queries": [ { "name": "noFilter", "count": 10000, "timeMs": 262.38 }, ... ],
  "stats": { "timeMs": 6.11, "result": { "totalTraces": 10000, "totalCostUsd": 4.0257 } },
  "agentUsage": { "count": 10000, "timeMs": 399.97, "recordsPerSecond": 25002 },
  "memory": { "datasetSize": 10000, "deltaMB": { "heap": 14.48 }, "mbPerTrace": 0.0009 },
  "dbSize": { "datasetSize": 10000, "sizeKB": 4916, "kbPerTrace": 0.492 }
}
```

### compare-logging.json (excerpted)
```json
{
  "n": 10000,
  "write": {
    "agenttrace": { "timeMs": 1454.97, "perSecond": 6873 },
    "jsonl": { "timeMs": 57.57, "perSecond": 173687 },
    "console": { "timeMs": 26.98, "perSecond": 370686 }
  },
  "storage": {
    "agenttrace": { "dbSizeBytes": 3489792, "kbPerRecord": 0.341 },
    "jsonl": { "fileSizeBytes": 2820561, "kbPerRecord": 0.275 },
    "ratio": "0.8x"
  },
  "query": [
    { "name": "errors", "agenttraceMs": 11.28, "jsonlScanMs": 0.77, "speedup": "0.1x" },
    ...
  ]
}
```

---

*Benchmarks are synthetic and micro-benchmark in nature. Real agent workloads mix compute, network (LLM calls), and tracing. Always measure in your environment.*