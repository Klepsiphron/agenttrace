# AgentTrace Self-Tracing Integration for Hermes

## Goal

Integrate AgentTrace into Hermes so Ryan (and you) can view session traces, stats, and a dashboard showing what the agent did. Minimal setup -- works out of the box.

## Current State (research findings)

- AgentTrace has: SDK (TS+Python), CLI (`agenttrace-io self-stats`, `dashboard`, `runs`, `traces`, `stats`), Express dashboard, SelfTracker class
- Hermes gateway runs on localhost
- Hermes has `~/.hermes/` directory for persistent data
- AgentTrace CLI already has a `self-stats` command (line 188 of index.ts)
- AgentTrace CLI already imports `startDashboard` from `@agenttrace-io/dashboard`
- `SelfTracker` class exists at `packages/sdk/src/self-track.ts` -- tracks sessions, actions, delegations, research, implementations, reviews

## What We Need to Build

### 1. AgentTrace CLI Binary Export

The CLI should be installable as a Hermes command. Create a small wrapper script or add AgentTrace CLI as a Hermes package dependency so `npx agenttrace-io` works from anywhere.

### 2. Hermes AgentTrace Plugin (Self-Tracing)

Create a lightweight plugin that auto-tracks Hermes sessions:

**File**: `~/.hermes/agenttrace-plugin.js` (or similar)

On Hermes startup:

- Initialize SelfTracker with `agentName: "hermes"`, `agentType: "ai-agent"`
- Set `dbPath` to `~/.hermes/agenttrace.db`
- Start a session

On each tool call:

- `selfTracker.trackAction(toolName, target, { duration, success })`

On delegation:

- `selfTracker.trackDelegation(agentName, taskSummary)`

On session end:

- `selfTracker.endSession()`

### 3. Dashboard Integration

Add a `hermes agenttrace dashboard` command that:

1. Starts the AgentTrace Express dashboard server
2. Opens browser to `http://localhost:PORT`
3. Shows all self-tracked Hermes sessions

### 4. Quick Stats Command

`hermes agenttrace stats` -- shows today/week summary (reuse CLI's `self-stats` command)

## Implementation Plan

### Step 1: Make AgentTrace CLI work standalone

- Verify `npx agenttrace-io self-stats` works with a test DB
- Ensure `AGENTTRACE_DB_PATH` env var controls DB location

### Step 2: Create Hermes AgentTrace integration

- Write a small Node.js module that Hermes can `require()`
- Export: `initAgentTrace()`, `trackToolCall()`, `trackDelegation()`, `closeAgentTrace()`
- Store DB at `~/.hermes/agenttrace.db` by default
- Auto-start session on init

### Step 3: Wire into Hermes startup

- On Hermes gateway start, call `initAgentTrace()`
- On each tool dispatch, call `trackToolCall()`
- On delegation, call `trackDelegation()`
- On shutdown, call `closeAgentTrace()`

### Step 4: Add CLI commands

- `hermes agenttrace stats` → runs `agenttrace-io self-stats --json`
- `hermes agenttrace dashboard` → starts dashboard server
- `hermes agenttrace sessions` → runs `agenttrace-io runs --limit 20`

## Verification

1. Start Hermes gateway
2. Have a conversation (traces should be recorded)
3. Run `npx agenttrace-io self-stats` -- should show today's activity
4. Run `npx agenttrace-io dashboard` -- should show web UI
5. Run `npx agenttrace-io runs` -- should list sessions

## Constraints

- Do NOT modify AgentTrace SDK code
- Do NOT add external dependencies (use what's already in the monorepo)
- DB must be at `~/.hermes/agenttrace.db` by default
- Must work with zero configuration (env var override optional)
