---
title: Evaluation & Scoring
description: Score traces with custom logic to quantify agent quality.
---

Define scorers (pure functions over `Trace`) to automatically grade quality, safety, cost-efficiency, etc. Scores are stored alongside traces.

## Define scorers

A scorer receives a full `Trace` and returns a number (higher is usually better; convention is 0–1 when possible).

### TypeScript

```typescript
import { init, score } from '@agenttrace-io/sdk';

const agent = init();

const outputLength = score('output-length', (t) => {
  if (!t.output) return 0;
  const len = JSON.stringify(t.output).length;
  return Math.min(len / 2000, 1); // 0..1
});

const lowLatency = score('low-latency', (t) => {
  const ms = t.latencyMs || 0;
  return Math.max(0, 1 - ms / 2000);
});

const noError = score('no-error', (t) => (t.status === 'success' ? 1 : 0));

const hasCitations = score('has-citations', (t) => {
  const out = String(t.output || '');
  return /source|cite|ref/i.test(out) ? 1 : 0.2;
});
```

### Python

```python
from agenttrace import init, score

agent = init()

@score("output-length")
def output_length(trace):
    if not trace.output:
        return 0.0
    length = len(str(trace.output))
    return min(length / 2000.0, 1.0)

@score("low-latency")
def low_latency(trace):
    ms = trace.latency_ms or 0
    return max(0.0, 1.0 - ms / 2000.0)

@score("no-error")
def no_error(trace):
    return 1.0 if trace.status == "success" else 0.0
```

## Run evaluation

### TypeScript

```typescript
const results = await agent.evaluate({
  scorers: [outputLength, lowLatency, noError, hasCitations],
  runId: 'your-run-id', // omit to score everything
  concurrency: 4,
});
```

### Python

```python
results = agent.evaluate(
    scorers=[output_length, low_latency, no_error],
    run_id=rid,
    concurrency=4,
)

for r in results:
    print(r.trace_id, r.scores, r.errors)
```

### Score a single trace

```typescript
// TypeScript
const one = await agent.evaluateTrace('trace-uuid-123', [outputLength, noError]);
```

```python
# Python
one = agent.evaluate_trace("trace-uuid-123", [output_length, no_error])
```

## Interpret results

Scores live in the DB. Retrieve them:

```typescript
// TypeScript
import { TraceStorage } from '@agenttrace-io/sdk';
const storage = new TraceStorage('./agenttrace.db');
const all = storage.getScores();
const forTrace = storage.getScores('trace-id');
```

```python
# Python
scores = agent.get_scores()                 # all
t_scores = agent.get_scores(trace_id=some_id)
```

## Built-in scorer ideas

- **Faithfulness** — check output mentions sources present in input
- **Cost efficiency** — `output_quality / (costUsd + 0.0001)`
- **Hallucination proxy** — your own detector function
- **JSON validity** — try `JSON.parse` and return 1 or 0
- **PII leakage** — regex for emails, keys etc. → low score
- **Latency** — penalize slow traces

## Composite scores

```typescript
const withComposite = scored
  .map((r) => {
    const composite = (r.scores['output-length'] || 0) * 0.6 + (r.scores['low-latency'] || 0) * 0.4;
    return { traceId: r.traceId, composite, ...r.scores };
  })
  .sort((a, b) => b.composite - a.composite);
```

## Persisted scores

Scores are written to the `scores` table. Re-running the same scorers on the same traces appends more rows. This means you can:

- Re-evaluate after improving a scorer — old scores stay for historical comparison
- Track score drift over time across runs
- Build dashboards that show score trends

## CI Integration

```bash
# Export and filter
npx agenttrace-io export --format json | jq '.[] | select(.scores["no-error"] < 0.95)'
```

Or call `evaluate()` in a CI script and assert minimum averages.
