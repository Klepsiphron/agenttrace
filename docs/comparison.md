# AgentTrace vs AgentOps vs LangSmith vs Helicone

**Honest, research-backed comparison (2026).** AgentTrace is a local-first, zero-config, open-source AI agent observability tool using SQLite for storage, with first-class CLI, embedded dashboard, automatic cost tracking, OTEL export, post-hoc evaluations, local webhooks/alerts, and multi-agent tracing. It never sends data off-machine by default.

The competitors (AgentOps, LangSmith, Helicone) are primarily cloud SaaS platforms with rich web UIs, advanced evals/prompt tooling, team features, and optional (but complex) self-hosting. They excel at scale, collaboration, and production agent platforms but require accounts, data egress (unless self-hosted), and more setup.

**Sources:** Official sites, docs, GitHub repos, pricing pages (AgentOps ~5.6k stars, Helicone ~5.8k stars; LangSmith closed-source; AgentTrace early/new project). Features verified via public docs and code inspection as of research date.

## Feature Comparison (50+ Features)

| # | Feature | AgentTrace | AgentOps | LangSmith | Helicone | Notes / Honesty |
|---|---------|------------|----------|-----------|----------|-----------------|
| 1 | Primary architecture | Local SQLite file (WAL) + normalized tables (runs/traces/tool_calls/scores/alerts/agent_usage) | Cloud (Supabase + ClickHouse) + optional full self-host | Cloud-first (managed) + Enterprise self-host/hybrid | Cloud proxy + analytics (ClickHouse/Supabase) + Docker self-host | AgentTrace: truly portable single file. Others: server-oriented DBs even in self-host. |
| 2 | Zero-config local run | Yes (npx/pip + ./agenttrace.db) | No (API key + dashboard required for value; self-host complex) | No (account + API key) | No (account or self-host stack) | AgentTrace wins for solo/local dev loops. |
| 3 | Data leaves machine by default | Never (unless user exports or configures webhook) | Yes (to AgentOps cloud unless self-host) | Yes (to LangChain cloud unless Enterprise self-host) | Yes (via gateway/proxy unless self-host) | Strongest privacy for AgentTrace. |
| 4 | Open source | MIT (full monorepo: SDK+CLI+dashboard+middlewares) | MIT (SDK + app sources) | Closed source (proprietary) | Apache-2.0 (core platform) | LangSmith is the only fully closed. |
| 5 | Self-hosting ease | Trivial (file, Docker compose for dashboard, or full app) | Complex (Supabase + ClickHouse + Docker/K8s + external services) | Enterprise-only (Kubernetes, hybrid, or full self-managed; sales contract) | Good (official Docker compose + Helm for prod; 4 services) | AgentTrace simplest; Helicone practical; AgentOps/LangSmith heavy. |
| 6 | Setup time (first trace visible) | < 30s (npm/pip + 2 lines code + CLI or npx dashboard) | ~2 lines + API key (cloud instant; self-host hours/days) | Sign up + key + integrate (minutes for cloud) | 1-line baseURL change or async log (minutes) | AgentTrace fastest for privacy-focused. |
| 7 | Pricing (free tier / local) | Free forever (local); no cloud | Free: 5k events/mo; Pro from ~$40/mo | Free: 5k traces/mo + pay-as-you-go; seats $39/mo | Free/Hobby: 10k requests/mo, 7d retention, 1GB | AgentTrace has no usage costs ever locally. |
| 8 | Cost tracking (built-in auto) | Yes (15+ 2026 models incl. gpt-4o, claude-*, gemini-*, llama-*; runtime registerModelRate) | Yes (400+ LLMs claimed) | Yes (detailed breakdowns, per-trace) | Yes (large pricing DB 300+ models; usage-based) | AgentTrace: client-side, free, extensible. Others: server-computed. |
| 9 | Token usage tracking | First-class (prompt/completion/total + model/provider per trace/run) | Yes | Yes (rich) | Yes | All strong. |
| 10 | Tool call tracking | Structured ToolCall[] (name, input, output, latency, success, error, ts) normalized | Yes (events + viz) | Yes (tool/agent trajectory) | Yes (in requests/sessions) | AgentTrace normalized for local SQL queries. |
| 11 | LLM call instrumentation | Explicit via trace() wrapper + middleware auto-extract | Auto via init + decorators; broad provider support | Deep tracing (LangChain native + others) | Via gateway (baseURL) or async logging/OpenLLMetry | Helicone gateway changes least code for many providers. |
| 12 | Multi-agent / hierarchical tracing | Native (parentId, TraceContext, createChild, linkTraces, getTraceTree) | Strong (multi-agent viz, session replays, waterfalls) | Strong (traces + runs in LangGraph) | Sessions + session-path for hierarchy | All support; AgentTrace explicit tree API + links. |
| 13 | Runs / sessions grouping | Explicit Run with auto aggregates (traceCount, totals for tokens/cost/latency/toolCalls) | Sessions (replay-focused) | Runs/traces + experiments | Sessions for agent flows | AgentTrace: relational rollups for fast local stats. |
| 14 | Automatic cleanup / retention | maxTraces (default 10k) + autoCleanup | Configurable in paid/self-host | Retention tiers (base 14d vs extended 400d; paid) | Configurable by plan (7d hobby → forever enterprise); storage usage-based | AgentTrace simple local cap. |
| 15 | Evaluations / scoring | Post-hoc: evaluate({scorers}), score(name, fn), stores in scores table, concurrency | Custom eval metrics (SDK); roadmap for builder/scorecards/playground | Mature: online/offline evals, LLM-as-judge, code, annotation queues, datasets | Scores, datasets, playground; evals via integration (RAGAS etc.); not agent-native first-class | LangSmith strongest/most mature. AgentTrace flexible post-capture (works on prod traces). |
| 16 | Prompt management / versioning | No | Limited (roadmap mentions) | Yes (Prompt Hub, versioning, playground, collaboration) | Yes (version prompts, deploy via gateway) | LangSmith/Helicone win. |
| 17 | Playground / prompt testing | No (use export + external) | Basic via dashboard | Yes (rich Playground + Canvas) | Yes (test prompts/sessions/traces) | Competitors have dedicated UX. |
| 18 | Alerting / webhooks | Yes: registerAlert({name, condition(stats)=>bool, webhook, cooldown}); persisted + history + auto on trace; local delivery | Roadmap / basic infra alerts in self-host; not prominent user-facing in SDK | Yes (webhooks + PagerDuty on monitoring metrics) | Yes (alerts on error rates/costs with filters; webhooks/PagerDuty mentioned) | AgentTrace: fully local condition eval on your stats; no vendor. Others: cloud or self-host server-side. |
| 19 | Agent usage / action tracking (separate from traces) | Yes (AgentUsageRecord table + SelfTracker for internal agents like OWL/Hermes; UsageStats; dedicated CLI self-stats + today/week breakdowns) | Event-based (LLM/tools/actions); not separate normalized "agent actions" | Traces cover; Fleet for no-code agents | Request/session focused; user analytics/custom props | AgentTrace unique for meta-observability of the agent itself (tools/actions/costs). |
| 20 | CLI | Full-featured: init, runs, traces, stats, costs (--daily), export (json/csv), dashboard, tree, alerts (list/test/history), health, self-stats, benchmark, --json, colored tables, filters | Minimal / not first-class (focus SDK + web dashboard) | Yes (LangSmith CLI: query traces/datasets/experiments) | Limited (focus gateway + web + API/MCP export) | AgentTrace: CLI is primary interface + rich. |
| 21 | Dashboard | Embedded local (npx agenttrace-io dashboard; Express + static HTML/JS/CSS at :4317; stats/runs/traces/costs/export/tree) | Rich cloud web (session replays, waterfalls, time-travel, graphs, overview charts) + self-host | Rich cloud web (traces, monitoring dashboards, evals, prompts, deployments, Fleet UI) | Rich cloud web (requests, sessions, analytics, playground, prompts, alerts) + self-host | AgentTrace: zero-config local; others far richer viz/UX but require infra. |
| 22 | Export formats | json, csv, otel (OTLP JSON spans, client-side, no deps, agenttrace.* attrs + resource) | Session/event export (paid); DB dumps in self-host | Bulk data export; API; datasets | API export, PostHog one-line, request export guides, MCP | AgentTrace: best zero-dep OTEL for existing pipelines (Grafana/Jaeger etc.). |
| 23 | OpenTelemetry support | Native client-side OTEL JSON export + attrs | OTEL collector in self-host; SDK supports | Full tracing (OTEL compatible in parts) | Built-in + OTEL support via gateway/integrations | AgentTrace: pure local export ready to pipe anywhere. |
| 24 | Framework integrations (auto) | LangGraph (TS middleware: before/afterNode, heuristic token from usage_metadata), CrewAI (Py middleware via event bus) | Broadest: CrewAI, AG2/AutoGen, OpenAI Agents (Py/TS), LangChain, LlamaIndex, Haystack, Smolagents, Agno, Camel, etc. (400+ LLMs) | Strongest in LangChain/LangGraph ecosystem; callbacks/handlers for others | Gateway (OpenAI compat) for LangChain/LangGraph/CrewAI/LlamaIndex/Vercel/etc.; async logging | AgentOps broadest agent-framework auto; Helicone easiest proxy; LangSmith deepest Lang* ; AgentTrace focused + middleware (less boilerplate than pure manual). |
| 25 | Language / SDK parity | First-class TS + Python (near API parity: trace/init, costs, evals, alerts, OTEL, storage) | Python primary (mature); TS/JS (OTEL-based modern SDK alpha/recommended) | Primarily Python/TS (LangChain stack); others via integrations | JS/TS + Python primary (gateway + SDKs); many via proxy | AgentTrace best cross-lang symmetry for non-LangChain users. |
| 26 | Custom cost calculator | Yes (config.costCalculator at init; global registerModelRate) | Pricing in shared/utils; auto via platform | Yes (detailed) | Large built-in pricing DB + custom | AgentTrace: fully local/runtime override. |
| 27 | Hallucination / custom detectors | Yes (config.hallucinationDetector hook) | Via evals/custom events | Via evals/feedback/scores | Via scores/custom properties | Similar extensibility. |
| 28 | Trace filtering / query power (local) | Rich TraceFilter (runId, status, name, dates, min/max cost/latency, limit/offset); getStats with topTools/topErrors/costByModel; SQL-friendly DB | Dashboard filters + search; analytics DB | Powerful search/filters/dashboards + API/CLI | HQL (Helicone Query Language), filters, sessions, custom props | Local SQL wins for AgentTrace power users; others have polished UIs. |
| 29 | Health / integrity checks | getHealth() + CLI `health` (tables, orphans, db size, uptime, trace count) | Health endpoints in self-host | Platform monitoring | Platform health | AgentTrace exposes for scripts/CI. |
| 30 | Max traces / bounded storage | Yes (config.maxTraces + auto cleanup) | Retention policies (paid/self) | Retention + limits | Storage quotas + retention by plan + ingestion rate limits | All have controls. |
| 31 | Silent / no-console mode | Yes (config.silent) | Configurable logging | N/A (cloud) | N/A | AgentTrace good for prod embedding. |
| 32 | Distributed / context passing | TraceContext + parentSpanId + metadata for cross-agent linking | Session/trace IDs + decorators | Trace IDs + run context | Session-Id + Session-Path headers | All viable. |
| 33 | Scores storage / history | Yes (scores table per trace; ScorerResult) | Custom metrics | Full eval results + feedback | Scores + datasets | Mature in competitors for regression. |
| 34 | Alert history / audit | Yes (AlertHistory persisted: triggeredAt, stats snapshot, delivered, error) | Limited in self-host infra | Monitoring history + alerts | Alerts history | AgentTrace: local, queryable. |
| 35 | Webhook delivery | Yes (fetch POST with payload; tracks delivered/error in history) | Not first-class user webhook on events (infra) | Yes (webhooks/PagerDuty) | Yes (webhooks + integrations) | AgentTrace simplest local; others cloud-native. |
| 36 | Gateway / proxy / routing | No (pure observability) | No | No (but deployment hosting) | Yes (major: AI Gateway for 100+ models, intelligent routing, fallbacks, caching, rate limits, 0% markup) | Helicone unique strength here. |
| 37 | Prompt injection / security detection | No built-in (extensible via scorer/metadata) | Yes (honeypot, prompt injection detection via PromptArmor partnership, audit logs, PII) | Yes (via evals + enterprise) | LLM security features in gateway | AgentOps highlights compliance/security. |
| 38 | Fine-tuning support | No (export data for external) | Yes (save completions for fine-tune partners, up to 25x cheaper claimed) | Datasets + evals feed into tuning | Yes (partners: OpenPipe, Autonomi) | Others have direct paths. |
| 39 | Team / collab / RBAC / SSO | No (local file; share DB manually) | Role-based (Pro+); SSO/ custom in Enterprise self-host | Workspaces, seats, custom SSO/RBAC (Enterprise) | Orgs, seats (unlimited paid); SAML SSO Enterprise | Cloud tools win for teams. |
| 40 | Compliance (SOC2, HIPAA, etc.) | Local: you control (file on disk) | Enterprise: SOC2, HIPAA, NIST AI RMF, on-prem | Enterprise: SOC2, HIPAA, GDPR; trust center | SOC2, GDPR; HIPAA in higher tiers | Enterprise plans for cloud tools. |
| 41 | Production agent deployment / hosting | No (export traces or use external) | No (observability + testing focus) | Yes (LangSmith Deployment, Assistants API, 1-click, scalable; Fleet for no-code agents; Sandboxes for code gen) | Gateway aids but no full agent hosting | LangSmith strongest for "deploy agents here". |
| 42 | Auto root-cause / AI-assisted debugging | No | Basic failure detection; roadmap | Yes (LangSmith Engine: auto monitors, clusters issues, diagnoses, recommends prompt/code fixes using models) | Analytics + alerts | LangSmith Engine is unique advanced. |
| 43 | Ingestion limits / rate | Local: none (your disk/CPU) | Cloud limits; self-host you manage | Hourly trace limits + size; overage pricing | Strict (hobby 10 logs/min, paid higher; API rate limits) | Local unlimited. |
| 44 | Data export / ETL friendliness | Full JSON/CSV/OTEL + direct SQLite queries + CLI | Export paid; self-host full DB access | Bulk export + API + datasets | Strong (API, PostHog, MCP server, ETL guides, request export) | All good; AgentTrace + direct file easiest. |
| 45 | Benchmark / performance tooling | Built-in `benchmark` CLI command (prints JSON) | Agent benchmarking vs 1k+ evals claimed | Experiments + evals | Analytics + caching impact reports | Varies. |
| 46 | Custom attributes / metadata / tags | Yes (metadata on traces/runs; filterable) | Tags + custom events + attributes | Rich metadata, tags, feedback | Custom properties, user tracking | All support extensibility. |
| 47 | Time-travel / replay debugging | Basic (tree + traces + export) | Yes (session replays, rewind, point-in-time precision, waterfalls) | Strong tracing + Studio visual | Sessions + playground for replay/inspect | AgentOps standout for visual replay. |
| 48 | Cost per trace / overage model | $0 (local) | Usage-based on events | $2.50–$5 /1k traces (base vs extended) + seats + deployments | Usage-based storage/requests + plan fees | AgentTrace cheapest at volume for local. |
| 49 | GitHub stars / maturity | New / small (early) | ~5.6k | N/A (closed) | ~5.8k | Established have more community/examples. |
| 50 | Best for ... | Privacy, terminal devs, local-first, zero-cost, simple agents any framework, air-gapped/CI | Broad agent framework support, visual replay debugging, teams wanting hosted + self-host option | LangChain/LangGraph deep users wanting evals + production deployment + auto-assist (Engine) | Gateway users wanting proxy + obs + prompts + scale with self-host option | - |
| 51 | Dashboard viz depth (waterfall, graphs, replays) | Basic tables + tree view (local HTML/JS) | Excellent (waterfall, replays, graphs, session drilldown) | Excellent (dashboards, traces, monitoring, Studio) | Good (requests, sessions, analytics, playground) | Visual polish is where cloud tools dominate. |
| 52 | No vendor lock-in / portable data | Yes (SQLite file + standard exports; query with any SQL tool) | Partial (self-host DB access; exports) | Partial (Enterprise self-host; export formats) | Partial (self-host + exports) | AgentTrace most portable. |
| 53 | Support for local LLMs / Ollama etc. | Yes (manual model/rate registration + trace) | Yes (via LiteLLM etc. integrations) | Yes (via LangChain) | Yes (Ollama + gateway support) | All work; no lock to specific providers. |

(53+ rows; many more derivable from storage schema, CLI flags, middleware code, types.)

## Pricing Comparison

| Aspect | AgentTrace | AgentOps | LangSmith | Helicone |
|--------|------------|----------|-----------|----------|
| Local / self dev | Free forever (SQLite) | Free tier 5k events/mo (cloud) | Free 5k traces/mo | Hobby free 10k/mo |
| Paid entry | N/A | Pro ~$40/mo (unlimited events, retention, export) | Plus $39/seat/mo + overages (~$2.50/1k traces) | Pro $79/mo + usage; Team $799/mo |
| Enterprise | N/A (you run it) | Custom (self-host on-prem, SSO, SLA, compliance) | Custom (self-host/hybrid, advanced hosting, SLA, dedicated) | Custom (high limits, forever retention, SSO, HIPAA) |
| Overages / scaling | Your infra only | Pay-as-you-go events | Trace volume + seats + deployment runs/uptime + LCUs (Engine) + sandboxes | Requests/storage + higher tiers |
| Hidden costs | None (no egress, no seats) | Self-host infra (Supabase/CH) | High at volume; seat-based team scaling | Gateway usage + storage |
| Best value | Local/high-privacy/high-volume | Teams needing replay + broad frameworks | Lang* ecosystem + full platform (evals/deploy) | Proxy + obs + cost control at scale |

See official pages for latest calculators.

## Architecture Comparison (local-first vs cloud)

- **AgentTrace**: Pure local-first. Single SQLite file (portable, queryable with `sqlite3`, WAL mode). SDK embeds storage + analytics. Dashboard/CLI are thin clients over the file. No server required for core use. Export or webhook only when you choose. Docker compose optional for multi-service demo.
- **AgentOps**: Cloud SaaS primary (events to their backend). Self-host: full backend (FastAPI + Next.js dashboard + Supabase Postgres + ClickHouse analytics + storage + optional Stripe/monitoring). Requires external managed services even for "self"; complex for true air-gap.
- **LangSmith**: Cloud SaaS primary. Self-host/hybrid/Enterprise only: Kubernetes deployment (stateless components + object storage + Postgres); control plane vs data plane options. Designed for VPC data residency at enterprise cost.
- **Helicone**: Cloud (gateway workers + analytics). Self-host: Docker compose (web Next, worker, jawn server, Supabase, ClickHouse, Minio). Simpler than AgentOps/LangSmith self-host per their docs; production Helm available. Gateway is Rust/perf focused in parts.

**Local-first wins** for dev, privacy, air-gapped, CI, cost=0, speed (no network). Cloud wins for shared team dashboards, historical scale, managed uptime.

## Language Support Comparison

- AgentTrace: TypeScript (first-class SDK) + Python (parity, including decorators/context/lambda forms). No others native.
- AgentOps: Python (mature, decorators) + TypeScript/JS (OTEL modern SDK).
- LangSmith: Strong Python + JS/TS (LangChain ecosystem); broader via callbacks/integrations.
- Helicone: JS/TS + Python (SDKs + gateway works with any OpenAI-compat client: curl, other langs via proxy).

AgentTrace offers best parity for mixed TS/Py teams avoiding LangChain lock-in.

## Framework Integration Comparison

- **AgentTrace**: Explicit wrappers + dedicated middlewares (LangGraph TS: hooks into node execution + token scrape from common response shapes; CrewAI Py: event bus for tasks/tools). Framework-agnostic core (wrap any fn). Examples for custom.
- **AgentOps**: Widest native auto-instrumentation (CrewAI, AutoGen/AG2, OpenAI Agents Py/TS, LangChain, LlamaIndex, Haystack, Smolagents, Agno, Camel, Google ADK, etc.). Often 2-line init.
- **LangSmith**: Deepest for LangGraph/LangChain (callbacks, Studio, deployment). Framework-agnostic claims but ecosystem bias.
- **Helicone**: Gateway (change baseURL) works with LangChain, LlamaIndex, CrewAI, Vercel AI SDK, Semantic Kernel, etc. + direct provider SDKs + async logging. Proxy model.

**Honest**: AgentOps for "it just works with my obscure agent lib". LangSmith for Lang* power users. Helicone for minimal code change + many providers. AgentTrace for controlled explicit + targeted auto without proxy overhead.

## Export Format Comparison

- AgentTrace: `export('json'|'csv'|'otel')` in SDK + CLI `--format` + dashboard download. OTEL is full OTLP JSON resourceSpans (no external OTEL SDK needed). SQLite direct access.
- AgentOps: Session/event export (Pro+); full DB access in self-host.
- LangSmith: Bulk export, datasets, API.
- Helicone: REST API, PostHog export (1-line), MCP server, ETL/request export guides.

AgentTrace's client-side OTEL is unique for plugging into existing observability without runtime deps.

## Privacy Comparison

- AgentTrace: Highest by design — data stays in your `./agenttrace.db`. Only leaves on explicit export or your webhook config. No telemetry. Air-gapped friendly.
- AgentOps: Cloud default (data to their infra); self-host gives control but complex stack.
- LangSmith: Cloud default; Enterprise self-host/hybrid for VPC.
- Helicone: Gateway/proxy means requests route through them (or self-hosted gateway); self-host for full control.

All self-host options eventually give sovereignty; AgentTrace is the only "never leaves unless you say so" out of the box with zero infra.

## Self-hosting Comparison

- AgentTrace: `docker compose up` or just use the file + npx. Full features (CLI, evals, alerts, OTEL) work locally without extra DBs.
- AgentOps: Multi-service (API, dashboard, DBs). Requires Supabase project (or self PG) + ClickHouse. Native or Docker guides exist but non-trivial.
- LangSmith: Enterprise Kubernetes manifests; hybrid options. Not for casual self-host.
- Helicone: Recommended Docker compose (scripts provided); reduced to ~4 services recently. Helm for scale. Manual possible but discouraged.

AgentTrace: self-host is the default. Others: self-host is escape hatch for compliance/scale.

## Agent Usage Tracking Comparison

AgentTrace has dedicated `agent_usage` table + `SelfTracker` (for meta-agents like OWL/Hermes to log their own actions/tools/tokens/costs/durations/sessions) + `getAgentUsage` / `UsageStats` (topAgents, actionsByType) + `agenttrace-io self-stats` (today/week/active sessions/costByDay). Useful for tracking the agent's own "spend" on tools or internal ops separately from user traces.

Competitors track via general events/sessions/tools (AgentOps excels at this in viz). No exact equivalent normalized "self action" + CLI breakdown found in public docs for the others. AgentTrace's is specialized for agent-self-observability.

## Webhook/Alert System Comparison

- AgentTrace: `registerAlert` / `alert()` helper. Condition is a local JS/Py fn on current `TraceStats` (successRate, totalCost, topErrors etc.). Persisted config (w/o fn), cooldown, webhook POST (or email stub), full history with delivery status + snapshot stats. Fires automatically after traces. Test via CLI. All local.
- AgentOps: Infrastructure/service alerts in self-host; user event alerts not highlighted as first-class SDK feature (focus on dashboard monitoring).
- LangSmith: Webhooks + PagerDuty integration on monitoring dashboards/metrics.
- Helicone: Alerts (error rate, cost filters); webhooks + PagerDuty support.

AgentTrace unique in "define condition locally as code, runs against your local stats, delivers locally, history in same DB". Others: cloud-configured, server-evaluated.

## CLI Comparison

- AgentTrace: Rich (see full list in packages/cli: runs/traces/stats/costs/export/tree/alerts/health/self-stats + filters + --json + colored output + table printing). `npx agenttrace-io` or alias. Works offline on local DB.
- AgentOps: Not prominent; primarily SDK + web dashboard. Some CLI for self-host dev.
- LangSmith: Dedicated CLI for traces, datasets, experiments, etc.
- Helicone: Limited direct; focus on web + API + MCP + gateway CLIs indirectly.

AgentTrace treats CLI as first-class (terminal-native agents/devs).

## Dashboard Comparison

- AgentTrace: Lightweight embedded (no separate install; serves static + APIs from npx). Tables for runs/traces, cost breakdowns, tree viz, health. Dark theme. Fast for local.
- AgentOps: Feature-rich (session replays with time-travel, waterfalls with exact prompts/completions, event graphs, multi-agent viz, overview analytics, chat viewer). Cloud or self.
- LangSmith: Comprehensive (trace explorer, custom monitoring dashboards, evals UI, Prompt Hub, Studio visual builder, deployment views, Fleet).
- Helicone: Intuitive (per claims): requests table, sessions for agents, cost/latency analytics, playground, prompts, alerts, HQL. Cloud or self.

Cloud tools have years of polish on visualization/UX. AgentTrace prioritizes instant local access + CLI complementarity.

## When to Choose Each (Honest)

**Choose AgentTrace when**:
- Privacy is non-negotiable (prompts, data never leave your machine by default).
- You want zero-config, zero-cost, zero-account local observability (solo dev, research, air-gapped, CI).
- Terminal/CLI-first workflow + simple local dashboard.
- You need portable SQLite + standard exports (OTEL/CSV) for existing tools.
- Framework-agnostic (or using LangGraph/CrewAI) and value built-in costs + evals + local alerts without infra.
- You want agent self-usage tracking for meta-agents.
- Simplicity and speed of iteration matter more than polished replays or team dashboards.

**Choose AgentOps when**:
- You need broad out-of-box support for many agent frameworks (CrewAI, AutoGen, OpenAI Agents, etc.) with minimal code.
- Visual session replay, time-travel debugging, and multi-agent waterfalls are critical for debugging.
- You're okay with cloud (or willing to run complex self-host) and want hosted analytics + exports.
- Cost tracking across 400+ models + some eval/benchmark features.

**Choose LangSmith when**:
- Deep in LangChain/LangGraph ecosystem (or willing to be).
- You need mature evals, datasets, human feedback loops, prompt management, and production deployment (Fleet, Deployment, Sandboxes, Engine auto-analysis).
- Team collaboration, workspaces, enterprise compliance, and hosted scale.
- Willing to pay for traces/seats and accept cloud (or Enterprise self-host cost).

**Choose Helicone when**:
- You want an AI Gateway (unified 100+ models, routing, fallbacks, caching, rate limits) + observability in one.
- Proxy-based integration (minimal code change via baseURL) + strong prompt versioning + playground.
- Cost-effective scaling with usage-based + self-host option.
- Sessions for agent flows + good analytics/alerts + export options (PostHog etc.).
- Open-source self-host that is relatively straightforward.

## Honest Limitations of AgentTrace

- No built-in rich visual replay/waterfall/time-travel (basic tree + tables only).
- Evaluations are post-hoc scorers (powerful and works on any traces) but lack the full experiment harness, annotation queues, LLM judges UI, and regression tooling of LangSmith/others (roadmap exists in plans/).
- No prompt management/versioning/playground.
- No team/collaboration, RBAC, SSO (local file sharing or manual).
- No cloud hosted option (intentional; local-only).
- Newer project: smaller community, fewer docs/examples/integrations than 5k+ star competitors.
- Dashboard is functional but not as polished as dedicated web apps.
- Self-host for "production multi-user" still means managing the DB file or simple server; not a full distributed platform.
- Fewer "auto" instrumentations than AgentOps (but explicit + middleware is low-boilerplate).

We built AgentTrace because existing tools either force cloud, require Docker/K8s/accounts, or lack deep terminal + local analytics + costs + OTEL + alerts without complexity. If your needs match the "when to choose" above, it delivers unique value.

## AgentTrace Unique Value Propositions

- **True local-first with full power**: Costs, evals, alerts, OTEL, multi-agent trees, agent-usage tracking, rich CLI — all work offline on a single file. No hidden cloud dependency or "call home".
- **Terminal-native + zero friction**: `npx agenttrace-io dashboard` or full CLI for everything; perfect for agents that live in the shell.
- **Privacy + portability by default**: SQLite you own + standard exports. Auditable, git-ignoreable, scp-able, queryable with `sqlite3`.
- **Integrated cost + agent meta-observability**: Automatic pricing for modern models + separate tracking for what the agent itself does (tools/actions). Critical for spend governance on autonomous systems.
- **Standards-friendly escape hatch**: Client-side OTEL export means you can start local and pipe to any backend later without code changes.
- **Honest minimalism**: Does the core (trace every token/tool/LLM, cost it, score it, alert on it, export it) extremely well without bloat or lock-in.

**Bottom line**: If competitors are "full-featured LLM/agent platforms (mostly cloud)", AgentTrace is "the local observability layer you actually want to run everywhere, forever, for free, privately."

For the absolute latest, check the projects' docs and pricing pages directly, as features evolve quickly.

*(This document is research-only for internal use. Do not commit or push per instructions.)*