: Production Readiness Sprint

## Goal
Make AgentTrace ready for real-world use. Focus on:
1. `agenttrace-io wrap` command (zero-config tracing for ANY agent)
2. Budget alerts (per-agent token limits)
3. Production docs (README, install guide, quickstart)
4. CI pipeline improvements

## Task 1: Add `wrap` Command to CLI

Add a new command to the AgentTrace CLI that wraps any agent CLI command and auto-traces it.

### File: packages/cli/src/index.ts (add new command)

```bash
# Usage:
agenttrace-io wrap <command> [args...]

# Examples:
agenttrace-io wrap claude "Write a hello world function"
agenttrace-io wrap codex exec "Fix the auth bug"  
agenttrace-io wrap python my_agent.py
```

### Implementation:

In the CLI's command handling (in `index.ts`), add a `wrap` command:

1. Creates a new run with name `wrap:<command-name>`
2. Uses `child_process.spawn` to execute the command
3. Captures: start time, end time, exit code, stdout/stderr (first 500 chars)
4. On completion, creates a trace with:
   - name: `wrap:<command>`
   - input: the command + args string
   - output: stdout truncated to 2000 chars
   - status: 'success' if exit code 0, 'error' otherwise
   - latency_ms: end - start
   - metadata: { exit_code, stderr_preview }
5. Updates run stats
6. Exits with the same exit code as the wrapped command

### Code to add (in index.ts, in the command handler switch/if-else):

```typescript
case 'wrap': {
  const command = args[0];
  if (!command) {
    console.error('Usage: agenttrace-io wrap <command> [args...]');
    process.exit(1);
  }
  const cmdArgs = args.slice(1);
  const agenttrace = new AgentTrace({ dbPath: getDbPath(), silent: true });
  const runId = agenttrace.startRun(`wrap:${command}`);
  const startTime = Date.now();
  const { spawn } = require('node:child_process');
  const child = spawn(command, cmdArgs, { stdio: 'pipe', shell: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  child.on('close', (code: number) => {
    const latencyMs = Date.now() - startTime;
    agenttrace.trace(`wrap:${command}`, async () => '', {
      input: `${command} ${cmdArgs.join(' ')}`.trim(),
      output: stdout.slice(0, 2000),
    }).catch(() => {});
    agenttrace.completeRun(code === 0 ? 'success' : 'error');
    const status = code === 0 ? 'success' : 'error';
    const duration = latencyMs;
    agenttrace.close();
    if (code !== 0) {
      process.stderr.write(stderr.slice(0, 500));
    }
    process.exit(code ?? 0);
  });
  break;
}
```

### After adding:
1. Run `pnpm build` to compile
2. Test manually:
   ```bash
   cd /home/ryano/projects/agenttrace
   node packages/cli/dist/index.js wrap echo "hello world"
   node packages/cli/dist/index.js wrap ls -la
   ```
3. Verify traces appear: `node packages/cli/dist/index.js traces --limit 5`
4. Add a basic test in `packages/cli/src/cli.test.ts`:
   - Test `wrap echo "hello"` succeeds and creates a trace
   - Test `wrap false` (exit code 1) creates error trace
5. Run `pnpm test` -- all must pass
6. Commit: `feat(cli): add wrap command for zero-config agent tracing`

## Task 2: Budget Alerts

Add per-agent budget tracking and alerting.

### File: packages/cli/src/index.ts (add new commands)

```bash
# Set a daily token budget for an agent
agenttrace-io budget set <agent-name> --tokens <max-per-day> --cost <max-cost-per-day>

# Check current budget status  
agenttrace-io budget status <agent-name>

# List all budgets
agenttrace-io budget list
```

### Simpler approach: add `budget` command that stores limits in the AgentTrace DB

1. Add a `budgets` table to the DB (agent_name, max_tokens_per_day, max_cost_per_day, created_at)
2. Add `budget set/list/status` commands
3. `budget status` shows: used today vs budget, projected daily spend, alerts if over budget
4. Add a `budget-check` command that exits with code 1 if over budget (usable in CI/scripts)

### After adding:
1. Run `pnpm build`
2. Test:
   ```bash
   node packages/cli/dist/index.js budget set hermes --tokens 1000000 --cost 50
   node packages/cli/dist/index.js budget status hermes
   node packages/cli/dist/index.js budget list
   ```
3. Add tests in cli.test.ts
4. Commit: `feat(cli): add budget tracking and alerting commands`

## Task 3: Production README

### File: README.md (update root README)

Make the root README.md professional and comprehensive:

```markdown
# AgentTrace

AI agent observability for teams that care about token costs.

## Install

npm install -g @agenttrace-io/cli

## Quick Start

# Trace any agent (zero config)
agenttrace-io wrap claude "Write a hello world function"

# View your traces
agenttrace-io runs --limit 10
agenttrace-io traces --run-id <id>

# See token usage stats
agenttrace-io self-stats

# Set budget alerts
agenttrace-io budget set my-agent --tokens 1000000 --cost 50

# Launch dashboard
agenttrace-io dashboard

## SDK Usage

### TypeScript
import { AgentTrace } from '@agenttrace-io/sdk';
const agent = new AgentTrace({ dbPath: './traces.db' });
const runId = agent.startRun('my-session');
const result = await agent.trace('my-tool', async () => {
  return await doWork();
});
agent.completeRun();

### Python
from agenttrace import AgentTrace
agent = AgentTrace(db_path='./traces.db')
run_id = agent.start_run('my-session')
result = agent.trace('my-tool', lambda: do_work())
agent.complete_run()

## License: MIT
```

Commit: `docs: update README with quickstart, install, and usage examples`

## Task 4: CI Improvements

### File: .github/workflows/ci.yml (verify/improve)

Ensure CI:
1. Runs `pnpm build` first
2. Runs `pnpm test` after build
3. Tests both TS SDK and Python SDK
4. Reports coverage

If CI doesn't already test Python SDK, add a step:
```yaml
- name: Test Python SDK
  run: |
    cd packages/sdk-python
    pip install -e '.[dev]'
    python -m pytest tests/ -v
```

Commit: `ci: add Python SDK test step to CI`

## Final Steps

1. Run full test suite: `pnpm test` (all must pass)
2. Run Python tests: `cd packages/sdk-python && python -m pytest tests/ -v`
3. Review all changes: `git diff`
4. Push everything: `git push origin main`
