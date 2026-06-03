# Alerting & Webhooks Spec -- AgentTrace v0.2.0

## Concept

Add configurable alerts that trigger when certain conditions are met (high error rate, cost threshold, latency spike). Deliver via webhook (HTTP POST) or email.

## API Design

### TypeScript

```typescript
import { init, trace, alert } from '@agenttrace-io/sdk';

const agent = init();

// Define an alert
const highErrorRate = alert({
  name: 'high-error-rate',
  condition: (stats) => stats.errorCount > 10,
  webhook: 'https://hooks.slack.com/...',
  cooldown: 300, // seconds
});

// Register with agent
agent.registerAlert(highErrorRate);

// Alerts are checked automatically after each trace
// Or manually: agent.checkAlerts()
```

### CLI

- `agenttrace alerts list` -- list configured alerts
- `agenttrace alerts test <name>` -- test an alert
- `agenttrace alerts history` -- show alert history

## Implementation

### 1. Types (types.ts)

```typescript
export interface AlertCondition {
  name: string;
  condition: (stats: TraceStats) => boolean;
  webhook?: string;
  email?: string;
  cooldown: number; // seconds
  lastTriggered?: number;
}

export interface AlertHistory {
  id: string;
  alertName: string;
  triggeredAt: number;
  stats: Record<string, number>;
  delivered: boolean;
  error?: string;
}
```

### 2. Storage

New table: `alerts` and `alert_history`

### 3. AgentTrace methods

- registerAlert(alert: AlertCondition)
- checkAlerts(): Promise<AlertHistory[]>
- getAlerts(): AlertCondition[]
- getAlertHistory(): AlertHistory[]

### 4. Triggering

- After each trace insert, check if any alerts should fire
- Respect cooldown period
- Deliver via HTTP POST to webhook URL
- Log delivery attempt in alert_history
