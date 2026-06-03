# Tool Call Tracing for Agent Observability - Research 2026

**Date:** 2026-06-03
**Context:** Sprint 2, fixing recordToolCall() stub in AgentTrace TS SDK. Per AGENTS.md research-first rule.
**Sources:** Combined web_search + x_semantic_search + x_keyword_search (triangulated, no single source reliance).

## Key Findings from Web Research

- **Per-step / per-tool-call tracing is essential** for agent observability (not just final output).
  - Capture: tool name, input/arguments, output/result, latency, success/failure status for every invocation.
  - Must link to parent trace/span for full trajectory reconstruction.
  - "Tool call logs capture which tool was called, with what parameters, and what it returned. This is the layer where silent failures hide." (Adaline post, but echoed widely).
  - See: Langfuse, Braintrust, LangSmith, Arize, Sentry, Azure AI Foundry, Maxim, etc. all emphasize tool calls in traces.

- **Industry convergence on structured tracing (OTel GenAI)**
  - OpenTelemetry GenAI semantic conventions (v1.37+): spans for LLM, agent, execute_tool.
  - `execute_tool` span: kind INTERNAL/CLIENT, attributes like `gen_ai.tool.name`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` (privacy permitting), latency, status.
  - Agent runs: one root trace with nested spans for planning, tool calls, LLM calls, sub-agents.
  - Sources: opentelemetry.io/docs/specs/semconv/gen-ai/ , Datadog, Greptime blogs (2025-2026).

- **Common patterns across frameworks (LangGraph, CrewAI, LangChain, PydanticAI, etc.)**
  - Tool calls appear as nested spans or explicit lists attached to parent trace.
  - Full trace includes decision points, tool I/O, token/cost/latency breakdowns per step.
  - Manual instrumentation often provides `record_tool_call` / `tool()` decorator that attaches to current context/span.
  - Multi-agent: propagate trace context; tool calls still linked.
  - Examples: Braintrust "tool() decorator", LangSmith automatic via callbacks, Langfuse explicit step/tool observations.

- **Best practices (2025-2026 sources)**
  - Use 100% sampling for agent traces (complete runs, not sampled steps).
  - Structured over unstructured logs.
  - Monitor tool reliability separately (per-tool error rates, silent fails).
  - Include success/failure, errors, timings, args (redact PII/sensitive).
  - Attach evals/scores to specific traces/steps.
  - From Azure, Sentry, Groundcover, Maxim, LangChain blog: "traces start the agent improvement loop".
  - Privacy: treat tool I/O as sensitive.

- **Specific refs (selected):**
  - Langfuse blog (2026): rich semantic types (tool calls...).
  - Braintrust 2026 guide: tool-call tracing native in wrappers.
  - Sentry: "Monitor tool reliability separately."
  - OTel spec: execute_tool details.
  - Reddit/ practitioner: need input per step + tool logs + decisions + evals.
  - LangChain: "If you cannot see the trajectory, you cannot reliably debug..."

## X (Twitter) Practitioner Discussions (real-time 2025-2026)

Semantic + keyword search results (queries around "tool call" trace/observability in LangGraph/CrewAI/etc., since 2025):

- Emphasis on inspecting tool calls first when agent returns bad answer (Vishnu).
- "My minimum production checklist for AI agents: trace every tool call, bind scoped ephemeral permissions..." (Gursharan).
- Multi-agent pipelines require observability to see "which agent slow, which produced bad output, exact I/O for every step" (Pranjal, Langfuse user).
- Tracing RAG/agent flows includes tool/ANN/LLM steps with metadata (Aurimas Gr, multiple posts).
- "Without observability, debugging a 3-agent pipeline is just guessing."
- Cost variance from # of tool calls/loops (dylan, Lorenzo).
- AI Client internal MCP tool call collection with Trace ID.
- LangSmith/Langfuse integrations for full tool visibility in n8n, etc.

Consensus: tool calls are not optional; without them agents are black boxes. Per-invocation (name+IO+latency+success) + linkage required.

## Synthesis for AgentTrace Implementation

- SDK public API `trace(fn)` + `recordToolCall(completeCallData)` is the manual path (middlewares often bypass via direct storage.createTrace).
- Active (current) trace context needed in-memory to collect calls made during `await agent.trace('name', async () => { ... recordToolCall(...) ... })`.
- recordToolCall must generate id + timestamp, attach {..., id, timestamp} to the active trace's toolCalls list.
- On trace completion (in finally, even on error), drain collected toolCalls[] into the Trace record passed to storage.createTrace() -- which already handles INSERT into tool_calls table + run stats update (see storage.ts:394-411).
- Outside active trace: still generate id (for potential future use?), but WARN (respect silent config).
- Nesting support: use prev-context save/restore (generalizes "stack" idea from improvement-plan) so records after child `trace()` calls still attach to parent (as seen in examples/nodejs-express/app.ts usage pattern).
- Matches research: full name, input, output, latencyMs, success, error?, timestamp.
- No change to storage or types needed (ToolCall and createTrace already support non-empty arrays).
- Later: middlewares can migrate to use SDK APIs instead of bypassing (see sprint item 11).

## Raw Source Links / Citations (for further reading)

- https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse [web:0, web:10]
- https://www.braintrust.dev/articles/agent-observability-complete-guide-2026 [web:11]
- https://opentelemetry.io/docs/specs/semconv/gen-ai/ [web:20]
- https://blog.sentry.io/ai-agent-observability-developers-guide-to-agent-monitoring/ [web:9]
- X posts: ids 1952746418038538702, 2060436046320742753, 1913206671981129773, 2061345136270069803, 1929490625952371199, 2059718767161008336, 2061871853615120685, 2058189948575252793 etc.
- improvement-plan.md item 9; examples usage.

## Relation to Current Fix

This research confirms the user_query spec + improvement-plan: active trace context for collecting during trace(), populate before createTrace, warn on orphan calls.
No deviation; implementation stays minimal (bugfix, not new feature).

(End of research doc. Synthesized before code changes.)
