# AgentTrace Integration into Hermes -- Build Spec

## Goal

Auto-trace all Hermes agent sessions using AgentTrace. Zero-setup: works out of the box when Hermes starts. Captures every tool call, delegation, and session for token/cost monitoring in corporate environments.

## Architecture

```
Hermes Agent (this session)
  → SelfTracker (packages/sdk/src/self-track.ts)
    → TraceStorage (SQLite at ~/.hermes/agenttrace.db)
    → JSONL log at ~/.hermes/agenttrace-usage.jsonl

AgentTrace CLI (packages/cli/src/index.ts)
  → reads same DB
  → commands: self-stats, runs, traces, stats, dashboard
```

## What to Build

### 1. Hermes Session Tracer Module

Create a new file that Hermes can import:

**File**: `~/.hermes/agenttrace-tracer.js` (Node.js module)

```javascript
const { SelfTracker } = require('@agenttrace-io/sdk');
const path = require('path');
const os = require('os');

let tracker = null;

function init(agentName = 'hermes') {
  if (tracker) return tracker;
  tracker = new SelfTracker({
    agentName,
    agentType: 'ai-agent',
    dbPath: process.env.AGENTTRACE_DB_PATH || path.join(os.homedir(), '.hermes', 'agenttrace.db'),
  });
  tracker.startSession();
  return tracker;
}

function trackTool(toolName, details = {}) {
  if (!tracker) init();
  tracker.trackAction(toolName, details.target || 'unknown', details);
}

function trackDelegation(agentName, task) {
  if (!tracker) init();
  tracker.trackDelegation(agentName, task);
}

function getStats() {
  if (!tracker) init();
  return tracker.getSessionStats();
}

function close() {
  if (tracker) {
    tracker.endSession();
    tracker.close();
    tracker = null;
  }
}

module.exports = { init, trackTool, trackDelegation, getStats, close };
```

### 2. Hook into Hermes Tool Dispatch

Hermes has a tool dispatch mechanism. We need to wrap it:

In the Hermes tool execution path, add:

```javascript
const tracer = require('~/.hermes/agenttrace-tracer.js');

// Before each tool call:
tracer.trackTool(toolName, { target: inputSummary, startTime: Date.now() });

// On delegation:
tracer.trackDelegation(agentName, taskSummary);

// On session start:
tracer.init('hermes');

// On shutdown:
tracer.close();
```

### 3. CLI Commands for Viewing Traces

The AgentTrace CLI already has all needed commands. We just need to verify they work with the Hermes DB path:

```bash
# Show today's self-tracked stats
npx agenttrace-io self-stats

# Show all sessions
npx agenttrace-io runs --limit 50

# Show traces for a session
npx agenttrace-io traces --run-id <id>

# Start dashboard
npx agenttrace-io dashboard
```

### 4. Quick Status in Terminal

Add a function to show a one-line summary after each Hermes response:

```
[AgentTrace] Session: 47 actions | 12.3K tokens | $0.042 | 8 tools called
```

## Implementation Steps

1. Create the tracer module at `~/.hermes/agenttrace-tracer.js`
2. Install `@agenttrace-io/sdk` locally so `require()` works
3. Modify Hermes startup to init the tracer
4. Modify Hermes tool dispatch to track each tool call
5. Modify Hermes shutdown to close the tracer
6. Test: have a conversation, then run `npx agenttrace-io self-stats`

## Verification Criteria

- [ ] After a Hermes conversation, `npx agenttrace-io self-stats` shows activity
- [ ] `npx agenttrace-io runs` lists the session
- [ ] `npx agenttrace-io traces --run-id <id>` shows individual tool calls
- [ ] Dashboard starts with `npx agenttrace-io dashboard`
- [ ] No errors in Hermes logs
- [ ] DB file created at `~/.hermes/agenttrace.db`

## Constraints

- Do NOT modify AgentTrace SDK code
- Do NOT break existing Hermes functionality
- DB path must be `~/.hermes/agenttrace.db` by default
- Must work with `npx agenttrace-io` commands
- This is for LOCAL/WSL use (not cloud yet)

## Out of Scope

- Web dashboard UI (already exists, just needs to be launched)
- Python SDK changes (separate task)
- Multi-tenant features (already fixed)
- Cloud export (future)
