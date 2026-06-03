# Evaluation Framework Spec -- AgentTrace v0.2.0

## Concept

Add basic trace evaluation/scoring to AgentTrace. Users can define scorers (functions that evaluate a trace and return a score), then run them against their traces.

## API Design

### TypeScript

```typescript
import { init, trace, score } from '@agenttrace/sdk';

const agent = init();

// Define a scorer
const lengthScorer = score('output-length', (trace) => {
  if (!trace.output) return 0;
  const len = JSON.stringify(trace.output).length;
  return Math.min(len / 1000, 1); // 0-1 score
});

// Run scorers against all traces
const results = await agent.evaluate({ scorers: [lengthScorer] });
// results: [{ traceId, scores: { 'output-length': 0.5 } }]

// Or score a single trace
const singleResult = await agent.evaluateTrace('trace-uuid', [lengthScorer]);
```

### Python

```python
from agenttrace import init, score

agent = init()

@score(name="output-length")
def length_scorer(trace):
    if not trace.output:
        return 0
    length = len(str(trace.output))
    return min(length / 1000, 1)

results = agent.evaluate(scorers=[length_scorer])
```

## Implementation Plan

### 1. SDK Types (types.ts)

```typescript
export interface Scorer {
  name: string;
  fn: (trace: Trace) => number | Promise<number>;
}

export interface ScorerResult {
  traceId: string;
  scores: Record<string, number>;
  errors: Record<string, string>;
}

export interface EvaluateOptions {
  scorers: Scorer[];
  runId?: string;
  traceIds?: string[];
  concurrency?: number;
}
```

### 2. SDK Method (AgentTrace class)

- `evaluate(options: EvaluateOptions): Promise<ScorerResult[]>`
- `evaluateTrace(traceId: string, scorers: Scorer[]): Promise<ScorerResult>`
- Store scores in SQLite table `scores(id, trace_id, name, value, created_at)`

### 3. CLI

- `agenttrace evaluate --scorer <file.ts>` -- run scorers against traces
- `agenttrace evaluate --trace-id <id>` -- score specific trace
- `agenttrace scores --trace-id <id>` -- view scores for a trace

### 4. Built-in Scorers

- `output-length` -- score based on output length
- `latency` -- score based on latency (lower = higher score)
- `error-rate` -- score based on error status (1 = success, 0 = error)
- `cost-efficiency` -- score based on tokens vs output quality

### 5. Storage

New table: `scores`

```sql
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES traces(id),
  name TEXT NOT NULL,
  value REAL NOT NULL,
  created_at INTEGER NOT NULL
);
```
