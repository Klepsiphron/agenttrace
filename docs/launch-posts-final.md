# AgentTrace Launch Campaign

## Prepared: 2026-06-02

---

## Hacker News (Show HN)

**Title:** Show HN: AgentTrace – open source AI agent observability, fully local

**Text:**

```
I built AgentTrace because I was tired of sending my agent's prompts and
outputs to third-party clouds just to debug them.

AgentTrace traces every token, tool call, and LLM invocation in your AI
agents. Everything stores locally in SQLite. No accounts, no cloud, no
telemetry.

Features:
- TypeScript SDK (npm install @agenttrace-io/sdk)
- Python SDK (pip install agenttrace-io)
- CLI: agenttrace runs, agenttrace stats, agenttrace export
- Local web dashboard on localhost
- Automatic cost calculation for GPT-4o, Claude 4, Gemini, Llama
- 50 tests passing across TS + Python

Long term, I'm thinking about a hosted version with team features, but
for now the focus is on making the local tool as good as possible.

Would love feedback from anyone building AI agents. What observability
gaps are you hitting?

github.com/Klepsiphron/agenttrace
```

**Post to:** Show HN
**Timing:** Weekday 9am EST for maximum visibility

---

## Product Hunt

**Tagline:** Datadog for AI agents. Runs locally. Zero cloud.

**Description:**
AgentTrace gives you full visibility into your AI agent runs -- token
spend, tool calls, latency, success rates, cost. Drop-in SDK for
TypeScript and Python. Local SQLite storage. Dark-themed web dashboard.
Zero cloud dependency, fully open source (MIT).

**Topics:** Developer Tools, Open Source, Artificial Intelligence

**Launch day prep:**

- Get 10+ people to upvote on launch day
- Prepare a short demo GIF
- Engage with every comment

---

## Reddit Posts

### r/LocalLLaMa

**Title:** AgentTrace – local-first AI agent observability, no cloud

**Body:**

```
Built an open source tool for tracing AI agent runs that keeps
everything local. No cloud accounts, no telemetry, no prompts
leaving your machine.

Traces tokens, tool calls, latency, and cost. Works with any
framework (LangGraph, CrewAI, custom). Has a CLI and a local
web dashboard.

pip install agenttrace
github.com/Klepsiphron/agenttrace
```

### r/MachineLearning

**Title:** Open source alternative to LangSmith/LangFuse, fully local

**Body:**

```
I needed agent observability but didn't want to send prompts to a
third-party cloud, so I built AgentTrace.

Key differentiator: everything is local. SQLite storage, no
accounts, no cloud. TypeScript + Python SDKs, CLI, and a local
dashboard.

Comparison:
- LangSmith: LangGraph-native, cloud-only, $39/seat/mo
- LangFuse: 28K stars, self-hostable but needs Docker/K8s
- AgentTrace: zero-dependency, CLI-first, privacy-first

github.com/Klepsiphron/agenttrace
```

### r/typescript

**Title:** AgentTrace – TypeScript SDK for tracing AI agent runs locally

**Body:**

```
npm install @agenttrace-io/sdk - trace any async function, see tokens,
cost, latency, tool calls. Everything stores in SQLite locally.
No cloud dependency. 50 tests, fully typed.

github.com/Klepsiphron/agenttrace
```

### r/Python

**Title:** AgentTrace – Python SDK for AI agent observability

**Body:**

```
pip install agenttrace - drop-in tracing for Python AI agents.
Context manager, decorator, or direct call. Local SQLite, no cloud.
Same DB schema as the TypeScript SDK so you can share traces between
languages.

github.com/Klepsiphron/agenttrace
```

## Twitter/X

**Tweet 1 (Launch):**

```
Just open-sourced AgentTrace 🔍

AI agent observability that runs entirely locally.
No cloud. No accounts. No telemetry.

npm install @agenttrace/sdk
pip install agenttrace
→ trace any async function
→ see tokens, cost, latency, tool calls
→ dashboard at localhost

github.com/Klepsiphron/agenttrace
```

**Tweet 2 (Technical):**

```
AgentTrace cost tracking knows 6+ LLM models:
gpt-4o, gpt-4o-mini, claude-sonnet-4, claude-haiku-4,
gemini-2.0-flash, llama-3.1-70b

Traces token usage → calculates cost automatically.
All stored in local SQLite. Your prompts never leave
your machine.

github.com/Klepsiphron/agenttrace
```

**Tweet 3 (Comparison):**

```
Why AgentTrace vs LangSmith/LangFuse?

- No cloud dependency (everything's local)
- No accounts or signups needed
- CLI-first (not just a dashboard)
- Privacy-first (prompts never leave your machine)
- Works with ANY framework, not just LangChain

Open source MIT. Free forever for local use.

github.com/Klepsiphron/agenttrace
```
