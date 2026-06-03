# Middleware-LangGraph Test Expansion Research (2026)

**Date:** 2026-06 (per task)
**Task:** Comprehensive test expansion for packages/middleware-langgraph per AGENTS.md research-first rule.
**Sources:** Combined web_search + x_semantic_search + x_keyword_search (raw refs below) + existing repo research (improvement-plan, cli-testing-research).
**Rule followed:** ALWAYS X research + web_search before implementing. Synthesize before code. Save raw here.

## Key Findings & Triangulation

### 1. Layered Evaluation for Middleware Lifecycle (Core Directive)

- 2026 best practices (LangChain/Rippling patterns, observability guides): use **layered eval** — offline/unit (mocks/fixtures), integration (full hooks), continuous/production-like.
  - Explicitly: "test each middleware lifecycle phase independently (before/after/error/close)" as stated in query research context.
  - Rippling: layered system = Offline evals (pre-recorded mocks on every commit), Post-merge integration, Deploy-blocking, Continuous evals on prod data. [web:33 from prior, full fetch below]
  - Apply: dedicated it() for beforeNode setup (pending stack), afterNode success path + extract+cost, onError error path + stack cleanup, close() resource release. Plus cross: sequential traces, nested, accessors.
- From error handling in LangGraph: "Test error recovery paths the same way you test happy paths." [web:13]
  - Three evaluators incl for failure conditions. So: onError integration test must assert stored trace has status:'error', error msg, tokens/cost/latency even on failure.

### 2. Nested Node Stack & Parent/Child Relationships

- Middleware uses internal `pending[nodeName]` stack (array) for reentrant/sequential same-name nodes (common in graphs with loops/recursion or parallel).
- LIFO pop ensures correct startInfo (input + startTime) paired with after/onError, even for nested calls to "step".
- In broader observability (LangSmith, Braintrust, OTEL, Galileo): "The GalileoCallback automatically handles nested chains and agents, creating a hierarchical trace..." ; "nested spans showing multi-step reasoning"; parent-child for tool/llm under nodes. [web:12 prior, web:1 new]
- Note: current middleware records flat per-node traces (no parentId set on Trace; uses runId + metadata.framework). Stack behavior tested via input matching + trace order/count. Future can add parentId for true span hierarchy (improvement-plan notes middleware bypasses).
- Test: push multiple before for same name, interleave after, assert traces have correct associated inputs (LIFO), latencies >0, no cross-contam.

### 3. Token Extraction: extractFromCandidate + response_metadata shapes (OpenAI, Anthropic, Google)

- LLM responses in LangChain/LangGraph vary by provider wrapper:
  - **Modern LangChain (usage_metadata on AIMessage-like)**: { usage_metadata: { input_tokens, output_tokens, total_tokens }, response_metadata: { model_name: 'gpt-4o-mini' }, ... }
    - Also via additional_kwargs.usage_metadata or kwargs.
  - **OpenAI legacy via LC**: response_metadata: { tokenUsage: { promptTokens, completionTokens, totalTokens }, model_name? } or token_usage, usage.
  - **Anthropic**: primarily usage_metadata { input_tokens, output_tokens, total_tokens } (or prompt_tokens etc).
  - **Google/Gemini**: usage_metadata { input_tokens, output_tokens, total_tokens } + response_metadata often has 'model_name', sometimes nested 'usage_metadata' with prompt_token_count etc. Token counts may need alias handling. [web:10, web:11, web:18, web:19]
- Middleware's extractFromCandidate handles:
  - usage_metadata branch first (with total_tokens check).
  - Then older tokenUsage in rm or direct on c (tokenUsage, usage, llmOutput.tokenUsage).
  - Direct totalTokens.
- Best practices from token tracking (Langfuse, OTEL, Braintrust): ingest from response if present (priority), support many aliases (prompt_tokens <-> input_tokens), model from metadata, fallback deep/infer. [langfuse fetch]
- Test: craft exact result objects for each provider shape, call before/after, assert inspector traces[ ].tokens match {promptTokens, completionTokens, totalTokens, model}.

### 4. deepFindUsage for Deeply Nested Token Objects

- Fallback when top-level extract misses: deep BFS scan for keys matching /usage|token/i , then extract p/c/t fields with aliases from the value obj.
- Covers cases like: result.llmOutput.tokenUsage , or { intermediate: { usage: {..} } }, or { foo: { bar: { token_counts: { prompt_tokens:.., .. } } } }
- Common in complex agent state or wrapped outputs (multi-agent, tool results containing llm calls). See "deeply nested trace data" in Brainstore/observability for large agent graphs. [web:1]
- Test: objects where extractFromCandidate returns 0s, but deep succeeds; assert correct values (and model if present). Also arrays of such.

### 5. computeCost Paths: custom model, unknown model, missing rates

- Middleware peeks internals (hack noted in improvement-plan #11): gets config.costCalculator from AgentTrace, falls back to hardcoded rates (subset of SDK's).
- SDK defaultCostCalculator: uses modelRates (more models), unknown -> {prompt:0.001, completion:0.002}
- Middleware fallback same default, unknown model or missing -> default rate.
- With custom: if provided to AgentTrace({costCalculator}), middleware uses it (for both success/error).
- From cost tracking research: support custom calculators, per-model rates, handle missing/unknown gracefully (0 or default), test costUsd on traces. [web:35, web:38, sdk costs.test.ts patterns]
- Test:
  - Pass costCalculator to mw ctor -> verify used (e.g. always 42).
  - Results with model:'gpt-4o' (known) -> specific cost.
  - model:'foo-unknown-xyz' -> falls to default rate calc.
  - no model, zero tokens or missing -> 0 or default.
- Use before/after with tokens in result, inspect costUsd on stored trace.

### 6. Lifecycle: close() and getAgentTrace()

- close(): delegates to agent.close() -> storage.db.close() + clears intervals. "verify resources are released" — test no-throw on reclose, post-close behavior (subsequent calls may error on db use, but middleware should be safe or tested).
- getAgentTrace(): returns the AgentTrace for startRun(), getRuns(), custom config etc. Existing test covers; expand to use for multi-trace same run.
- From patterns: always close in afterEach, test idempotent close. SDK tests use inspector separate from mw.

### 7. Multiple Sequential Traces in Same Run

- Use mw.getAgentTrace().startRun('name') -> gets runId, then multiple before/after for nodes, verify all traces share runId, getTraces({runId}) or inspector shows them, run stats updated.
- Tests reuse of middleware instance across "graph execution".
- Ties to "sequential traces" for run aggregation (cost, tokens, status).

### 8. Mocking Strategy

- Current middleware tests: real AgentTrace + temp /tmp/\*.db (fidelity, integration style). Matches SDK test patterns (use real storage for most).
- "Mock AgentTrace storage as needed": for pure unit of extract/compute (avoid db), vi.mock('@agenttrace-io/sdk', () => ({ AgentTrace: vi.fn().mockImplementation(...) })) then spy on methods, or access private fns via (mw as any) but avoid `any` per strict (use integration primarily; for deep private use limited casting in test only if needed, or export test helpers — but don't change src unless).
- Prefer: drive via public before/after/onError (which call privates), use separate inspector AgentTrace({dbPath}) for assert (no mock needed). For cost custom, real config. For close verify, spyOn or post-close query fail expected.
- CLI research doc: "Prefer seeding real via SDK ... for fidelity (integration-style ...); mock only if needed for error paths".
- Vitest: beforeEach temp db + cleanup, afterEach close both + rm hint.

### 9. Other 2026 Observability Testing Consensus

- Always test with errors (production has them): capture status, error field, still compute latency/tokens/cost on error path. [multiple sources]
- Hierarchical/nested visibility critical for agents >1 step. [post:3 prior etc]
- Token/cost must be on every step/span for attribution. Test extraction robustness across providers.
- No new deps; vitest + existing imports.
- Self-healing: tests feed into CI; production traces -> datasets (but here unit+int for middleware).

## Implementation Implications (Synthesized, Pre-Code)

- Structure: describe blocks per phase/layer: 'lifecycle: before/after', 'onError integration', 'token extraction shapes', 'deepFindUsage', 'computeCost variants', 'close and getAgentTrace', 'multi-trace same run', plus exports.
- Use makeTempDb helper (copy/extend from existing test.ts).
- Assert: status, error, tokens exact match incl model, cost closeTo, latency number, metadata.framework, runId consistency, trace count/order for nested.
- For shapes: minimal objects that hit branches (e.g. {content:'..', usage_metadata: {input_tokens:10,...}, response_metadata:{model_name:'claude-...'}} )
- Cover arrays in extractTokens.
- After write: pnpm build (middleware tsc), cd package && pnpm test or root with focus, full pnpm test.
- Scan: grep -rE '(api|key|secret|token|password|wallet|user|path)' on new file — only test dbs /tmp/ which are temp, no real secrets.
- Commit only after all green + scan clean.
- Update supporting: vitest.config include for broader coverage (so root `pnpm test` exercises middleware tests too), package.json test script glob.
- Keep existing test.ts for now (or it can be thin); new middleware.test.ts is the expanded.

## Raw Sources (for audit / triangulation)

**Web searches (ids from tool responses):**

- Layered + evals: web:33 (Rippling full article: "layered eval system, with all results uploaded to LangSmith: Offline evals... Post-merge... Deploy-blocking... Continuous"), web:20 (Braintrust agent obs 2026: online/offline evals loop), web:13 (LangGraph prod error handling: "Test error recovery paths the same way you test happy paths"), web:18 (Weave/agents), web:25 (Arthur best practices: instrument LLM+tools+...).
- Token shapes + providers: web:10 (Google Gemini LC usage_metadata), web:11 (Gemini token forum issues with metadata), web:18/19 (Gemini examples with usage_metadata + response_metadata safety etc), web:35/ (langfuse token tracking: ingested usage_details, OpenAI-style prompt_tokens, aliases, model inference fallback).
- Nested/observability: web:1 (Braintrust: nested spans, tool under llm, deep trace data), web:12 (Galileo nested chains), web:0 (datadog nesting spans).
- General middleware/callback testing + LangGraph: web:10 (troubleshoot LC traces, middleware conflicts), web:15 (custom callback_node with phases incl error), prior searches on LangSmith integrations.
- Costs: web:38 (Braintrust LLM cost tracking 2026: per-span, custom, unknown models), sdk internal costs.test.

**X / semantic / keyword:**

- [post:0-9 from calls]: discussions of traces in prod, error visibility, adding observability to LangGraph, testing via traces, Monocle2AI for tracing+testing langgraph/crewai etc. Limited direct "unit test the callback" but emphasis on "observability in tests/CI", "watch graphs in real-time", "detailed execution tracing + API testing".
- Triang: no single source; X shows practitioner need for per-node traces incl failures; web provides the "how to test" layered + provider shape details.

**Repo internal (read before code):**

- improvement-plan.md: notes on middleware (bypass, test expansion in sprint), sdk cost logic.
- cli-testing-research-2026.md: model for structure (per-phase independence, tmp dbs, real SDK seed for fidelity, self-check build+test+scan).
- Existing middleware tests/test.ts: baseline coverage (success, basic error, one usage_metadata, basic nested stack, get/close).
- SDK: index.ts (costCalculator config, default impl, trace opts), types (TokenUsage), costs.test.ts/index.test.ts (custom calc, unknown model tests), storage close.
- middleware src: full private impl of extractTokens/extractFromCandidate/deepFindUsage/computeCost/recordTrace + stack in pending, onError sets 'error' status.

Synthesized 2026-06: this informs exact 8 test cases + structure. No code written until this doc + prior searches complete. Matches AGENTS "Compare and triangulate — never rely on a single source. Save raw sources... Synthesize findings into wiki/concepts/ before building" (here research/ + will ref in wiki if needed).

Next: use this to write tests that independently cover phases + deep paths.
