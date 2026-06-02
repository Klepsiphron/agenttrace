# Launch Materials -- AgentTrace v0.1.0

## Tagline
"Datadog for AI agents. Runs locally. Zero cloud dependency."

## One-liner
Open source AI agent observability -- trace every token, tool call, and LLM invocation with a local dashboard. No accounts, no cloud, no telemetry.

## Short description (Product Hunt)
AgentTrace gives you full visibility into your AI agent runs -- token spend, tool calls, latency, success rates, cost. Drop-in SDK for TypeScript and Python. Local SQLite storage. Dark-themed web dashboard. Zero cloud dependency, fully open source (MIT).

## Long description / story
### The Problem
AI agents are black boxes. When an agent fails, you don't know which tool call broke, how much it cost, or where the latency spiked. Existing tools (LangSmith, LangFuse, Braintrust) are cloud-hosted SaaS platforms that require accounts, send your data to their servers, and charge monthly per-seat fees.

### What AgentTrace Does
- Drop-in SDK: wrap any async function with `trace()` in one line
- Automatic cost tracking for 6 major LLM models
- Local SQLite storage -- your data never leaves your machine
- CLI for querying traces, stats, exports
- Local web dashboard on localhost for visual debugging
- Framework agnostic: works with LangGraph, CrewAI, AutoGen, or custom agents

### Why We Built It
We needed observability for our AI agents but didn't want to send prompts and outputs to a third-party cloud. So we built the tool we wanted: local-first, open source, zero-config.

### What's Next
- Python SDK (in progress)
- Team features (shared traces, hosted option)
- OpenTelemetry export
- Framework-specific middleware (LangGraph, CrewAI)

## Hacker News Title
"Show HN: AgentTrace -- open source AI agent observability, fully local"

## HN Post Text
```
I built AgentTrace because I was tired of sending my agent's prompts and outputs 
to third-party clouds just to debug them.

AgentTrace traces every token, tool call, and LLM invocation in your AI agents. 
Everything stores locally in SQLite. No accounts, no cloud, no telemetry.

Features:
- TypeScript SDK (@agenttrace/sdk) -- npm install and go
- Python SDK (coming in v0.2)
- CLI: agenttrace runs, agenttrace stats, agenttrace export
- Local web dashboard on localhost
- Automatic cost calculation for GPT-4o, Claude 4, Gemini, Llama

github.com/Klepsiphron/agenttrace

I'd love feedback from anyone building AI agents. What observability gaps are 
you hitting?
```

## Reddit Posts
- r/LocalLLaMa: "AgentTrace -- local-first AI agent observability, no cloud"
- r/MachineLearning: "Open source alternative to LangSmith/LangFuse, fully local"
- r/typescript: "AgentTrace -- TypeScript SDK for tracing AI agent runs locally"
- r/Python: "AgentTrace -- Python SDK for AI agent observability (local-first)"

## Twitter/X Post
```
Just open-sourced AgentTrace 🔍

AI agent observability that runs entirely locally.
No cloud. No accounts. No telemetry.

npm install @agenttrace/sdk
→ trace any async function
→ see tokens, cost, latency, tool calls
→ dashboard at localhost

github.com/Klepsiphron/agenttrace
```
