# Why AI Agents Need Open-Source Observability

**Your agent just hallucinated a tool call, burned $40 in tokens, and you have no idea why. The observability platform you're using knows exactly what happened -- but it won't let you run it on your own infrastructure, it charges per-event at scale, and it has been silently shipping your prompts to a third-party cloud for months.**

This is the reality for most teams building AI agents in 2026. The observability landscape is dominated by SaaS platforms that treat your agent's traces, prompts, and outputs as their data. AgentTrace takes a different position: observability is infrastructure, and infrastructure should be open-source.

## The Problem with SaaS-Only Observability

The current generation of agent observability tools -- LangSmith, AgentOps, Helicone, Braintrust, Arize Phoenix -- are genuinely good products. They offer rich dashboards, session replays, evaluation pipelines, and prompt management. If you're building a prototype and don't care where your data goes, they work fine.

But "don't care where your data goes" is a luxury that disappears fast.

### Your Prompts Are Not Your Prompts

Every SaaS observability platform requires you to send trace data to their servers. That means your prompts, tool inputs, LLM outputs, and agent trajectories are leaving your network. For many teams, this is a compliance violation on day one.

Healthcare, finance, legal, government -- entire categories of agent applications are legally prohibited from shipping user data to third-party clouds. But it's not just regulated industries. If you're building a customer support agent, your traces contain real customer queries. If you're building a research agent, your traces contain proprietary search strategies. If you're building a code-generation agent, your traces contain your codebase.

SaaS platforms will tell you they're "secure" and "SOC 2 compliant." That's not the point. The point is that your data is on someone else's servers, subject to someone else's breach, someone else's subpoena, and someone else's terms of service.

### Cost at Scale Is Punishing

SaaS observability pricing is almost always event-based. LangSmith charges per trace. AgentOps charges per event. Helicone tiers by request volume. At low volumes, the free tiers are generous. At production scale, the math breaks.

Consider a moderately busy multi-agent system: 5 agents, each making 10 tool calls and 3 LLM calls per task, processing 1,000 tasks per day. That's 50,000 tool calls and 15,000 LLM calls daily. On most SaaS platforms, you're looking at hundreds of dollars per month -- just for observability, not for the LLM calls themselves.

And the pricing gets worse as you add features. Want longer data retention? Pay more. Want to run evaluations on your traces? Pay more. Want to export your own data? Sometimes that's a paid feature too.

AgentTrace stores everything in a local SQLite file. The cost of observability is zero. Not "free tier" zero. Actually zero. Your traces live on your disk, and you can keep them forever.

### Vendor Lock-In Is Real

When your traces live in a proprietary cloud, you're locked in. Your evaluation datasets are in their format. Your alert rules are in their DSL. Your team has learned their dashboard. Migrating away means losing history, retraining people, and rebuilding integrations.

This isn't hypothetical. Teams that built on early versions of LangSmith before it was LangSmith (it was called SmolAgent, then LangChain Hub, then LangSmith) went through three rebrands and two pricing model changes. Helicone's free tier has been revised downward. AgentOps changed their event model.

Open-source tools don't rebrand. They don't change their pricing. They don't deprecate features because a new CEO wants to pivot toward enterprise sales. The code is the code. If you don't like it, fork it.

### The Self-Hosting Trap

"But I can self-host LangSmith / Helicone / Arize Phoenix." Technically true. Practically painful.

Self-hosting LangSmith requires Kubernetes, a sales contract, and enterprise pricing. Self-hosting Helicone means running four Docker services (API, ClickHouse, Supabase, web frontend) and keeping them updated. Self-hosting Arize Phoenix means managing a complex Python service with its own dependencies.

AgentTrace's entire stack is a single SQLite file and an optional Express dashboard. You can be tracing in 30 seconds with `pip install agenttrace` and two lines of code. No Docker. No Kubernetes. No accounts. No API keys.

## What Open-Source Observability Looks Like

AgentTrace isn't trying to replicate every feature of LangSmith or Helicone. It's trying to answer a specific question: what's the minimum viable observability stack that gives you full control over your data?

The answer has a few non-negotiable properties:

**Local-first storage.** Traces go into a SQLite database on your machine. WAL mode, normalized tables, proper indexes. You can query it with SQL, back it up with `cp`, and inspect it with any SQLite tool. No network calls required.

**Zero-config instrumentation.** Wrap your agent logic with `trace()`, or drop in a middleware for LangGraph or CrewAI. Every LLM call, tool invocation, latency measurement, and cost calculation is captured automatically. No decorators to remember, no context managers to nest.

**Framework-agnostic core.** AgentTrace doesn't care whether you use LangGraph, CrewAI, raw OpenAI, Anthropic's SDK, or a hand-rolled agent loop. The core tracing API is provider-agnostic. Middleware packages handle framework-specific integration.

**Export without lock-in.** Traces can be exported as JSON, CSV, or OpenTelemetry spans. If you later decide to move to a different platform, your data leaves in a standard format. No proprietary export tools, no API rate limits on your own data.

**Evaluations on your terms.** Post-hoc scoring runs against your local trace data. Define scorers as plain functions. Run them against production traces without sending anything to a third party. Store results in the same SQLite file.

**Alerting without a cloud.** Register alert conditions as functions that evaluate against local stats. When a condition fires, AgentTrace can POST to a webhook -- your Slack, your PagerDuty, your custom endpoint. The alerting logic runs on your machine, evaluating your data, under your control.

## The Honest Trade-Offs

Open-source local observability isn't strictly better. It's better for specific teams with specific needs.

If you need a rich web UI with session replays, waterfall diagrams, and collaborative annotation queues, LangSmith and AgentOps are more mature. If you need an AI gateway with model routing, caching, and rate limiting, Helicone is the right tool. If you need enterprise prompt management with versioning and approval workflows, Braintrust has that.

AgentTrace is for teams who prioritize data sovereignty, want zero ongoing cost, need to run in air-gapped environments, or simply don't want to create another SaaS account. It's for solo developers who want production-grade observability without production-grade complexity. It's for teams building agents that handle sensitive data and can't afford to leak it through an observability side-channel.

## Getting Started

```bash
pip install agenttrace
```

```python
from agenttrace import init, trace

init()

with trace("research-agent") as t:
    result = run_my_agent(query)
    t.add_tool_call("search", {"query": query}, result)
```

```bash
agenttrace stats
agenttrace traces --limit 20
agenttrace costs --daily
agenttrace dashboard
```

That's it. Your traces are in `./agenttrace.db`. They're yours. They always will be.

## The Bigger Picture

AI agents are becoming critical infrastructure. They handle customer interactions, make financial decisions, write and deploy code, and manage workflows that affect real people. The systems that observe these agents -- that tell us when they fail, why they fail, and how much they cost -- are equally critical.

Critical infrastructure shouldn't depend on a single vendor's availability, pricing decisions, or data handling practices. It should be open, auditable, and controllable by the people who depend on it.

That's why AgentTrace is open-source. Not as a marketing strategy. As a design requirement.

---

*AgentTrace is MIT-licensed and available at [github.com/Klepsiphron/agenttrace](https://github.com/Klepsiphron/agenttrace). No account required.*
