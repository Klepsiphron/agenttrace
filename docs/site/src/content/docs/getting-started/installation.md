---
title: Installation
description: Install the AgentTrace SDK and CLI.
---

## TypeScript SDK

```bash
npm install @agenttrace-io/sdk
```

Requires `better-sqlite3` as a peer dependency (auto-installed with npm).

```typescript
import { init, trace, AgentTrace, TraceContext } from '@agenttrace-io/sdk';
```

## Python SDK

```bash
pip install agenttrace-io
```

```python
from agenttrace import init, trace, AgentTrace
```

## CLI

The CLI is Node-based and works alongside both SDKs:

```bash
# Use without installing
npx agenttrace-io --help

# Or install globally
npm install -g @agenttrace-io/cli
agenttrace-io --help
```

## Verify

```bash
# Check the CLI works
npx agenttrace-io version

# Initialize a database
npx agenttrace-io init
```

## Requirements

| Package | Runtime | Version |
|---------|---------|---------|
| TypeScript SDK | Node.js | 18+ |
| Python SDK | Python | 3.8+ |
| CLI | Node.js | 18+ |
| Dashboard | Node.js | 18+ |
