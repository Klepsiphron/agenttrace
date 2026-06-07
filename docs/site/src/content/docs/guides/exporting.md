---
title: Exporting Traces
description: Export traces as JSON, CSV, or OpenTelemetry format.
---

AgentTrace supports three export formats for integration with other tools, bug reports, or migration.

## Via CLI

```bash
# All traces as JSON
npx agenttrace-io export --format json --output traces.json

# Just one run
npx agenttrace-io export --format csv --run-id <run-uuid> --output run.csv

# OpenTelemetry format (OTLP JSON)
npx agenttrace-io export --format otel --output otel.json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `json` | Export format: `json`, `csv`, or `otel` |
| `--output` | stdout | Output file path |
| `--run-id` | all | Export specific run only |

## Via SDK

### TypeScript

```typescript
import { init } from '@agenttrace-io/sdk';
const agent = init();

const json = agent.export('json', { runId: 'optional-run-id' });
const csv = agent.export('csv');
const otel = agent.export('otel'); // OTLP JSON format

// Write to file
import { writeFileSync } from 'node:fs';
writeFileSync('traces.json', json);

agent.close();
```

### Python

```python
from agenttrace import init
agent = init()

json_str = agent.export("json", {"run_id": "optional-run-id"})
csv_str = agent.export("csv")

# Write to file
with open("traces.json", "w") as f:
    f.write(json_str)

agent.close()
```

## Export Formats

### JSON

Standard JSON array of trace objects with all fields:

```json
[
  {
    "id": "uuid",
    "name": "llm-call",
    "status": "success",
    "input": { ... },
    "output": { ... },
    "model": "gpt-4o",
    "provider": "openai",
    "promptTokens": 100,
    "completionTokens": 50,
    "totalTokens": 150,
    "latencyMs": 2300,
    "costUsd": 0.015,
    "createdAt": 1717000000000
  }
]
```

### CSV

Flat CSV with columns: `id,runId,name,status,model,provider,promptTokens,completionTokens,totalTokens,latencyMs,costUsd,createdAt`

### OpenTelemetry (OTLP)

OTLP JSON format compatible with OpenTelemetry collectors:

```bash
# Pipe to an OTLP endpoint
npx agenttrace-io export --format otel | curl -X POST \
  https://otel-collector.example.com/v1/traces \
  -H "Content-Type: application/json" \
  -d @-
```

## Use Cases

- **Bug reports** — export a failing run with `--run-id` and attach to the ticket
- **Migration** — export JSON from one instance, import to another
- **Analytics** — export CSV and load into a spreadsheet or BI tool
- **Integration** — send OpenTelemetry exports to Grafana, Datadog, or any OTLP-compatible backend
- **Compliance** — periodic exports for audit trails
