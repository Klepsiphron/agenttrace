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
