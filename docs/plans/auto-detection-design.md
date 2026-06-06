# AgentTrace Zero-Config Auto-Detection Design

## Problem

Developers don't want to manually add tracing to every agent. Companies don't know which agents are burning tokens. The tool should "just work" when installed.

## Solution: Three-Layer Detection

### Layer 1: CLI Post-Hook (Easiest, works today)

When `agenttrace-io` is installed globally, it adds a shell alias or wrapper that:

1. Before each command: starts a session trace
2. After each command: records trace data
3. Works for ANY CLI-based agent (Claude Code, Codex, etc.)

Implementation: `agenttrace-io wrap <command>` wrapper

### Layer 2: Module Auto-Instrumentation (More automatic, requires import)

For Python/Node.js agents, they can `pip install agenttrace-auto` or `npm install agenttrace-auto`:

- Python: patches `openai`, `anthropic`, `langchain` clients automatically
- Node.js: patches `openai`, `@anthropic-ai/sdk`, etc.
- Records every LLM call without code changes

### Layer 3: Hermes Integration (Deepest, for our own agent)

Direct integration into Hermes conversation loop:

- Every tool call → trace
- Every API call → token/cost record
- Every delegation → subagent trace
- Session start/end → run boundaries

## MVP Implementation (what to build NOW)

### agenttrace-io wrap command

Add to CLI: `agenttrace-io wrap <command> [args...]`

```bash
# Wrap any agent CLI command
agenttrace-io wrap claude "Write a hello world function"
agenttrace-io wrap codex exec "Fix the auth bug"
agenttrace-io wrap python my_agent.py
```

This:

1. Creates a new run in the DB
2. Executes the command via child_process
3. Captures stdout/stderr
4. Records trace with duration, exit code, output summary
5. On future iterations: try to parse token usage from output

### Auto-detect Hermes

When `agenttrace-io self-stats` runs, auto-detect if Hermes data exists:

- Check `~/.hermes/state.db` for sessions
- If found and bridge hasn't been run, prompt: "Found 324 Hermes sessions. Run bridge? (y/n)"
- If yes, auto-run the bridge script

## Implementation Plan

### 1. Add `wrap` command to CLI

File: `packages/cli/src/index.ts`

- New command: `agenttrace-io wrap <command>`
- Uses `child_process.spawn` to run the command
- Records a trace with duration and exit code
- Updates run stats

### 2. Add Hermes auto-detect to self-stats

When running `self-stats`, check for Hermes state.db and prompt to bridge.

### 3. Add Python auto-instrumentation package

**New package**: `packages/auto-instrument/`

- Monkey-patches `openai` and `anthropic` clients
- Records all LLM calls to AgentTrace DB
- Zero code changes required

## Competitive Advantage

Langfuse/LangSmith require you to add their SDK code to your project. AgentTrace's `wrap` command works with ANY agent without code changes. This is the "install and it just works" differentiator.
