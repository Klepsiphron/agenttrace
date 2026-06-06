# README Overhaul + Fix All Issues

## Part 1: Fix CLI Issues

### Issue 1: `wrap` command missing

The `wrap` command was removed during the UI redesign. It needs to be re-added.

In `packages/cli/src/index.ts`:

1. Add a `wrap` case in the command switch (around line 720, before the `dashboard` case):

```typescript
    case 'wrap': {
      const cmd = args[1];
      if (!cmd) {
        console.error('Usage: agenttrace-io wrap <command> [args...]');
        process.exit(1);
      }
      const cmdArgs = args.slice(2);
      const agenttrace = new AgentTrace({ dbPath: getDbPath(), silent: true });
      const runId = agenttrace.startRun(`wrap:${cmd}`);
      const inputStr = `${cmd} ${cmdArgs.join(' ')}`.trim();
      let stdout = '';
      let stderr = '';
      let exitCode: number;
      try {
        const { spawn } = await import('node:child_process');
        const result = await new Promise<string>((resolve, reject) => {
          const child = spawn(cmd, cmdArgs, { stdio: 'pipe', shell: true });
          child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
          child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          child.on('close', (code: number | null) => {
            exitCode = code ?? 0;
            if (exitCode !== 0) {
              const e = new Error(stderr.slice(0, 500) || `exited with code ${exitCode}`) as Error & { exitCode?: number };
              e.exitCode = exitCode;
              reject(e);
            } else {
              resolve(stdout.slice(0, 2000));
            }
          });
          child.on('error', (err: unknown) => {
            exitCode = 1;
            reject(err);
          });
        });
        await agenttrace.trace(`wrap:${cmd}`, async () => result, { input: inputStr });
        agenttrace.completeRun('success');
      } catch (e: unknown) {
        agenttrace.completeRun('error');
        const err = e as Error & { exitCode?: number };
        exitCode = err?.exitCode ?? 1;
        if (stderr) process.stderr.write(stderr.slice(0, 500));
        agenttrace.close();
        process.exit(exitCode);
      }
      agenttrace.close();
      process.exit(0);
      break;
    }
```

2. Update the `printUsage()` function to include `wrap` in the Commands list:

```
  wrap                 Trace any CLI command (zero-config)
```

And add to examples:

```
  agenttrace-io wrap claude "Write a hello world function"
```

### Issue 2: `budget` command not in help

Add `budget` and `budget-check` to the Commands list in `printUsage()`:

```
  budget               Manage per-agent token budgets: set | list | status | check
```

### Issue 3: Internal references in help text

In `printUsage()`, change:

```
  self-stats           Show OWL/Hermes self-tracked usage (today, week, top actions, costs, sessions)
```

to:

```
  self-stats           Show self-tracked usage (today, week, top actions, costs, sessions)
```

## Part 2: Professional README

Replace the entire `README.md` with a professional, comprehensive README.

Structure (based on best practices from Langfuse, Vercel AI SDK, and other popular OSS repos):

````markdown
# AgentTrace

<p align="center">
  <img src="docs/assets/logo.svg" width="80" height="80" alt="AgentTrace logo" />
</p>

<h3 align="center">Open-source AI agent observability. Local-first. Zero cloud.</h3>

<p align="center">
  <a href="https://github.com/Klepsiphron/agenttrace/actions"><img src="https://img.shields.io/github/actions/workflow/status/Klepsiphron/agenttrace/ci.yml?branch=main&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@agenttrace-io/cli"><img src="https://img.shields.io/npm/v/@agenttrace-io/cli" /></a>
  <a href="https://pypi.org/project/agenttrace-io/"><img src="https://img.shields.io/pypi/v/agenttrace-io" /></a>
  <a href="https://github.com/Klepsiphron/agenttrace/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Klepsiphron/agenttrace" /></a>
</p>

---

**AgentTrace** gives you full visibility into your AI agents -- every token, tool call, and cost. It stores everything locally in SQLite. No cloud. No accounts. No lock-in.

```bash
# Trace any agent in one line
agenttrace-io wrap claude "Write a hello world function"

# See what happened
agenttrace-io runs
agenttrace-io stats
```
````

[Features](#features) · [Quick Start](#quick-start) · [SDK Usage](#sdk-usage) · [Dashboard](#dashboard) · [CLI Reference](#cli-reference) · [Self-Hosting](#self-hosting) · [License](#license)

---

## Features

- **Zero-config tracing** -- `agenttrace-io wrap <command>` traces any CLI agent with zero code changes
- **Token & cost tracking** -- Every LLM call tracked with per-model pricing
- **Multi-agent correlation** -- Trace across subagent trees with parent/child linking
- **Budget alerts** -- Set per-agent token limits, get alerts before overspend
- **Local dashboard** -- Dark-themed web UI, runs on localhost, no cloud dependency
- **SQLite storage** -- All data stays on your machine. No external database needed.
- **CLI-first** -- Full-featured terminal interface for CI/CD and scripting
- **TypeScript & Python SDKs** -- Drop-in tracing for any agent code
- **LangGraph & CrewAI middleware** -- Auto-tracing for popular agent frameworks
- **Webhooks** -- HMAC-signed delivery to Slack, Discord, custom endpoints
- **OpenTelemetry export** -- OTLP JSON format for integration with existing tools
- **MIT Licensed** -- Free for personal and commercial use

## Quick Start

### Install the CLI

\`\`\`bash
npm install -g @agenttrace-io/cli

# or use npx without installing:

npx agenttrace-io <command>
\`\`\`

### Trace Your First Agent

\`\`\`bash

# Wrap any CLI command -- zero config, zero code changes

agenttrace-io wrap claude "Write a hello world function"
agenttrace-io wrap python my_agent.py

# View your traces

agenttrace-io runs --limit 10
agenttrace-io traces --run-id <id>

# See aggregate stats

agenttrace-io stats
\`\`\`

### Set Budget Alerts

\`\`\`bash

# Set a daily token budget for an agent

agenttrace-io budget set my-agent --tokens 1000000 --cost 50

# Check budget status

agenttrace-io budget status my-agent

# List all budgets

agenttrace-io budget list
\`\`\`

### Launch the Dashboard

\`\`\`bash
agenttrace-io dashboard

# → Opens at http://127.0.0.1:4317

\`\`\`

## SDK Usage

### TypeScript / Node.js

\`\`\`bash
npm install @agenttrace-io/sdk
\`\`\`

\`\`\`typescript
import { AgentTrace } from '@agenttrace-io/sdk';

const agent = new AgentTrace({ dbPath: './agenttrace.db' });

const runId = agent.startRun('my-session');

const result = await agent.trace('research', async () => {
// Your agent logic here
return await searchAndSummarize(query);
}, {
input: query,
tokens: { promptTokens: 150, completionTokens: 50, totalTokens: 200 },
model: 'gpt-4o',
});

agent.completeRun();
agent.close();
\`\`\`

### Python

\`\`\`bash
pip install agenttrace-io
\`\`\`

\`\`\`python
from agenttrace import AgentTrace

agent = AgentTrace(dbPath='./agenttrace.db')
run_id = agent.start_run('my-session')

result = agent.trace('research', lambda: search_and_summarize(query))

agent.complete_run()
agent.close()
\`\`\`

### Context Manager & Decorator (Python)

\`\`\`python
with agent.trace('my-operation') as t:
result = do_work()
t.set_output(result)

@agent.trace('my-function')
def my_function():
return compute()
\`\`\`

## Dashboard

The local dashboard provides a dark-themed web UI for exploring traces.

\`\`\`bash
agenttrace-io dashboard
\`\`\`

Features:

- **Stats overview** -- Total runs, success rate, avg latency, total cost
- **Run list** -- Filterable by status, searchable by name
- **Trace drill-down** -- Expand any run to see individual traces
- **Token details** -- Per-trace token usage, model, cost
- **Tool calls** -- Input/output for every tool invocation
- **Export** -- JSON or CSV export of all traces
- **Auto-refresh** -- Live updates every 5 seconds

## CLI Reference

| Command      | Description                                     |
| ------------ | ----------------------------------------------- |
| `init`       | Create empty agenttrace.db in current directory |
| `wrap <cmd>` | Trace any CLI command (zero-config)             |
| `runs`       | List recent runs (most recent first)            |
| `traces`     | List traces, filter by run ID                   |
| `stats`      | Show summary statistics                         |
| `costs`      | Cost breakdown by model or by day               |
| `export`     | Export traces to JSON or CSV                    |
| `dashboard`  | Start the local web dashboard                   |
| `budget`     | Manage per-agent token budgets                  |
| `self-stats` | Show self-tracked usage stats                   |
| `who`        | Show active agents                              |
| `sessions`   | List agent sessions                             |
| `activity`   | Show recent agent activity timeline             |
| `alerts`     | Manage alert conditions                         |
| `webhooks`   | Manage webhook subscriptions                    |
| `cleanup`    | Run data retention cleanup                      |
| `retention`  | Manage retention policy                         |
| `health`     | Check database health                           |
| `version`    | Show CLI version                                |
| `benchmark`  | Run performance benchmarks                      |
| `tree`       | Show parent/child trace tree                    |

### Global Options

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |
| `--help` | Show help for any command    |

## Self-Hosting

### Docker

\`\`\`bash
docker run -p 4317:4317 -v agenttrace-data:/app/data ghcr.io/klepsiphron/agenttrace
\`\`\`

### Docker Compose

\`\`\`bash
docker compose up -d
\`\`\`

### From Source

\`\`\`bash
git clone https://github.com/Klepsiphron/agenttrace.git
cd agenttrace
pnpm install
pnpm build
pnpm test
\`\`\`

## Architecture

\`\`\`
Agent Code
│
▼
AgentTrace SDK ──→ SQLite (agenttrace.db)
│
┌────┴────┐
│ │
CLI Dashboard
(localhost:4317)
\`\`\`

All data stays local. No external services required.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

```

## Part 3: Fix Dependabot PRs

Review and merge these open Dependabot PRs:
- PR #11: bump eslint-related group (eslint + @typescript-eslint/*)
- PR #10: bump docker/build-push-action 6→7
- PR #9: bump eslint 8.57.1→10.4.1
- PR #8: bump typescript 5.9.3→6.0.3
- PR #6: bump better-sqlite3 11.7.0→12.10.0
- PR #5: bump vitest 3.2.4→4.1.8
- PR #4: bump actions/setup-python 5→6
- PR #3: bump actions/setup-node 4→6
- PR #2: bump pnpm/action-setup 4→6
- PR #1: bump actions/checkout 4→6

For each PR:
1. Check if the upgrade is safe (read the PR description)
2. If safe, merge it
3. After merging, run `pnpm install && pnpm build && pnpm test` to verify
4. If tests fail, revert and close the PR with a comment explaining why

Be cautious with major version bumps (eslint 8→10, typescript 5→6, vitest 3→4, better-sqlite3 11→12) -- these may require code changes. Only merge if tests pass.

## Verification Checklist

After ALL changes:
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (all 20 test files, 0 failures)
- [ ] `node packages/cli/dist/index.js wrap echo "hello"` works
- [ ] `node packages/cli/dist/index.js budget set test --tokens 1000 --cost 5` works
- [ ] `node packages/cli/dist/index.js budget list` works
- [ ] `node packages/cli/dist/index.js budget status test` works
- [ ] README.md has badges, features, quick start, SDK usage, CLI reference
- [ ] No internal references in help text
- [ ] All Dependabot PRs reviewed and merged or closed
```
