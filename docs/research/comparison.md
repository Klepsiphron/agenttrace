# AgentTrace vs. LLM Observability Platforms (2026)

**Research date:** ~June 2026 (data from web searches, GitHub pages, official pricing/docs as of latest crawls).  
**Note:** This is a research document only. Do not commit. AgentTrace is a new local-first project (v0.1.0 released 2026-06-02).

AgentTrace is a lightweight, **local-only**, open-source (MIT) AI agent observability tool. It uses SQLite for storage, provides TypeScript + Python SDKs with a `trace()` wrapper, automatic cost tracking, a full CLI, an embedded local dashboard (via `npx`), OpenTelemetry export, and native middleware for LangGraph and CrewAI. Emphasis: zero cloud, zero accounts, zero infra for basic use, privacy (data never leaves unless explicitly exported), and terminal-friendly workflows.

This document compares it honestly to:

- **Langfuse**
- **LangSmith**
- **Braintrust**
- **Helicone**
- **Arize Phoenix** (OSS component of Arize AI)
- **AgentOps**

Categories covered for each: key features, pricing, setup complexity, self-hosting, framework/LLM support, GitHub stars (where applicable), last update/activity.

Data synthesized from official sites, GitHub repos, pricing pages, and independent comparisons. Be warned: the space moves fast; verify current numbers.

## Overview Comparison Table

| Aspect                  | AgentTrace                  | Langfuse                          | LangSmith                          | Braintrust                        | Helicone                          | Arize Phoenix                     | AgentOps                          |
|-------------------------|-----------------------------|-----------------------------------|------------------------------------|-----------------------------------|-----------------------------------|-----------------------------------|-----------------------------------|
| **License / Open**     | MIT (full)                 | MIT (core full features now)     | Closed (SDKs partial)             | Closed (SDKs OSS, low stars)     | Apache 2.0                       | ELv2 (OSS Phoenix)               | MIT (app open)                   |
| **GitHub Stars**       | New/low visibility (~launched 2026-06; searches surface peers) | ~28k+ (langfuse/langfuse)        | N/A (core); SDK ~900              | N/A main; SDKs ~10s              | ~5.8k (helicone/helicone)        | ~9-10k (arize-ai/phoenix)        | ~5.6k (AgentOps-AI/agentops)     |
| **Last Update**        | Active (v0.1.0 2026-06-02 + unreleased middlewares) | Highly active (thousands commits, recent releases/docs May 2026) | Active (SDK releases May 2026, platform updates) | Active (SDKs recent; platform updates) | Active (5k+ commits, recent self-host work) | Extremely active (v17 Jun 2026, 8k+ commits) | Active (810 commits, releases to 0.4.x) |
| **Core Model**         | Local SQLite, zero-config  | Full LLM engineering platform (obs + evals + prompts) | LangChain-native obs + evals + prompts | Eval-heavy obs + annotation platform | Proxy/gateway + obs (caching/routing) | OTel-native local/experiment obs + evals | Agent-focused SDK + replay obs  |
| **Pricing (Cloud/Hosted)** | N/A (local only)          | Free (Hobby 50k units/mo); Core $29/mo base + usage; Pro $199; Enterprise $2499 | Free (5k traces/mo); Plus $39/seat/mo + overages | Free (Starter: 1M spans + 10k scores); Pro $249/mo | Free (Hobby ~10-50k reqs/mo); Pro $79/mo; Team $799 | Phoenix OSS free; Arize AX paid (Pro ~$50/mo?, Enterprise custom) | Free (5k events); Pro ~$40/mo pay-as-you-go; Enterprise custom |
| **Self-Hosting**       | Built-in (SQLite file; optional Docker single container) | Full OSS free (Docker Compose easy; K8s/Helm/Terraform for prod; needs Postgres/ClickHouse/Redis/S3) | Enterprise-only (K8s on AWS/GCP/Azure, contact sales) | Hybrid Enterprise only (data plane self via Terraform; control plane hosted by Braintrust) | Yes, Docker Compose (simplified recently); Helm for enterprise | Excellent (pip/conda local, Docker, K8s/Helm; runs in notebooks) | Yes (full dashboard+API via app/; on-prem for Enterprise) |
| **Setup Complexity**   | Lowest: `npm install` / `pip install` + optional `npx agenttrace dashboard` (no Docker/account for basics) | Low-medium: SDK + (cloud sign-up or `docker compose` + infra config) | Low for LangChain users (env var); medium-high otherwise | Low (SDKs); self-host complex (Enterprise Terraform) | Lowest for proxy users (change baseURL/header, 1-line); SDK option | Very low for local: `pip install arize-phoenix` + run (or Docker) | Very low: `pip install` + 2 lines + key |
| **Framework / LLM Support** | Agnostic (wrappers + middlewares); LangGraph (TS), CrewAI (Py) native; custom easy; OTEL export; costs for 15+ models | Broad (80+): LangChain, LlamaIndex, OpenAI, LiteLLM, Vercel AI, Haystack, CrewAI, AutoGen, DSPy, etc. + OTel | Best-in-class for LangGraph/LangChain (auto via env); also OTel/SDK for others | Agnostic + multi-lang SDKs (Py/TS + Java/Go/Ruby/C#); OTel | Proxy (any OpenAI-compatible, 100+ models); LangChain, LlamaIndex, CrewAI, Vercel, etc. via gateway/SDK | Very broad via OpenInference/OTel (LangGraph, CrewAI, LlamaIndex, OpenAI, Anthropic, Bedrock, DSPy, Vercel, Mastra, etc.); vision/RAG strong | Strong agent-native (CrewAI, AG2/AutoGen, Agno, LangGraph, OpenAI Agents SDK, Camel, LlamaIndex, etc.); 400+ LLMs for costs |
| **Key Features**       | trace() wrapper, auto costs + breakdowns, full CLI (runs/stats/export), local dark dashboard, OTEL JSON export, alerts/webhooks (local), scores on traces, normalized SQLite (queryable), run lifecycle | Tracing/sessions/users/costs, evals (LLM-as-judge + code + human), prompt mgmt + playground + versioning, datasets/experiments, analytics, collab (RBAC/SSO paid), webhooks, full API | Tracing, evals/experiments, prompt management/playground, monitoring, datasets, team features, deep LangChain integration, deployment (paid) | Tracing + strong evals (CI/CD, auto metrics, annotations, playground), topics/filters, fast queries, multi-lang, hybrid for data residency | Obs (costs/latency), AI Gateway (routing, fallbacks, caching, rate limits, unified billing), sessions, playground?, prompts?, export | Tracing (OTel), evals (RAG/LLM-judge), datasets + experiments, playground, prompt mgmt/versioning, local-first debugging, exports | Session replays/time-travel debugging, multi-agent graphs, cost tracking, decorators (@session/@agent/@operation), framework auto-instr, analytics |
| **Evals / Prompt Mgmt**| Not yet (planned in roadmap) | Yes (mature: online/offline, LLM-judge, human annos, datasets, experiments, playground) | Yes (mature, integrated with LangChain) | Yes (core strength: evals harness, CI, scores, annotations) | Limited (focus more obs/gateway; some eval support) | Yes (strong built-in LLM evals + RAG-specific, experiments, datasets) | Partial (custom metrics, roadmap for more eval builder/scorecards) |
| **Team / Enterprise**  | None yet (local single-user) | Yes (collab, RBAC, SSO, audit in paid/self EE) | Yes (seats, enterprise features) | Yes (via Pro/Enterprise) | Yes (Team/Enterprise plans) | Via Arize AX (paid) | Yes (Enterprise plans + self-host) |
| **Data Residency / Privacy** | Absolute (local file; never leaves unless export/webhook) | Full control in self-host; cloud options (US/EU/JP/HIPAA) | Cloud primary (GCP); self-host Enterprise only | Hybrid: data plane in your VPC (Enterprise) | Self-host or cloud; proxy keeps some local | Full in self-host/Phoenix local; Arize cloud paid | Self-host option; cloud with free tier |

**Sources for table data:** Aggregated from GitHub repo pages (stars/commits/releases), official pricing/self-host docs (Langfuse, Helicone, Braintrust, AgentOps, Arize), SDK pages, and comparison articles. AgentTrace details from local codebase/README/CHANGELOG.

## Detailed Breakdowns

### Langfuse
**Strengths:** Most mature full-featured open-source LLM engineering platform. Tracing, evals, prompt management/versioning/playground, datasets, experiments, analytics, and collaboration all first-class. Recently made more features available in OSS. Excellent docs, huge ecosystem (used by Langflow, LlamaIndex, etc.), OTel + 80+ integrations. Self-host is a "first-class citizen" with full feature parity. Generous free cloud tier. Active YC company with massive adoption (50M+ SDK installs/mo claimed in some pages).

**Weaknesses vs AgentTrace:** Self-host requires real infrastructure (Docker Compose is "5 min" for local but prod needs ClickHouse/Postgres/Redis/S3 + maintenance). Cloud usage-based (units = traces/obs/scores) can add up; self-host infra costs real $. Not "zero config" — you run a stack. Data can leave machine by design (cloud option or team features). Larger surface area than simple local SQLite.

**Pricing note:** Self-host OSS free (unlimited); cloud Hobby free (50k units), Core $29 base + overages, Pro $199+. Enterprise high. Self-host Enterprise license for extras like UI custom ~$500/mo min in some reports.

**When better:** You need prompt management, built-in evals/experiments today, team collaboration, or want the "full platform" battle-tested by thousands. 28k+ stars community is real signal.

### LangSmith
**Strengths:** Deepest, most seamless integration for LangGraph/LangChain users (often just an env var for auto-tracing). Mature production observability + evals + prompt tools + deployment features. Trusted for serious LangChain apps. Good free tier for small use.

**Weaknesses vs AgentTrace:** Cloud-first (data always leaves for standard use). Self-host is Enterprise-only, Kubernetes, complex, and "contact sales" (not OSS). Per-seat pricing ($39/user/mo) punishes teams. Framework lock-in risk (best experience is LangGraph). No local zero-config story. Closed source core.

**Pricing:** Free Developer 5k traces/mo (14d retention); Plus $39/seat + trace overages; Enterprise custom (self-host add-on).

**When better:** You're all-in on LangGraph/LangChain, need enterprise compliance/SOC2 out of box, or want the most polished LangChain-specific debugging + evals.

### Braintrust
**Strengths:** Evaluation-centric with excellent workflows for shipping reliable AI (CI evals, auto-captured metrics, annotations, playground, fast queries). Strong multi-language SDK support (recent Java/Go/Ruby/C#). Generous free tier. Good for teams that treat evals as first-class in dev lifecycle. Hybrid deployment for data control without full self-host burden.

**Weaknesses vs AgentTrace:** Core platform is commercial/closed (no full OSS self-host like Langfuse/Phoenix; deployment configs repo has ~0 stars). Self-host is hybrid Enterprise only (Terraform data plane; control plane stays with them — not air-gapped full control). Pricing jumps from free to $249/mo Pro with no cheap middle tier. Less focus on simple "just trace my agent locally with costs in terminal."

**Pricing:** Starter free (1M spans, 10k scores, 14d); Pro $249/mo (more data/retention/scores); Enterprise custom.

**When better:** Your bottleneck is rigorous evaluation, scoring, and regression testing in CI rather than raw tracing or local debugging. You value their eval harness and don't mind the commercial model or hybrid hosting.

### Helicone
**Strengths:** Fastest "zero code change" path via proxy/gateway (swap base URL or add header — logs everything with <5-8ms overhead in Rust impl). Built-in AI Gateway features are unique: intelligent routing, automatic fallbacks, semantic caching, rate limiting, unified billing across 100+ models. Self-host Docker available and recently simplified. Good for cost control + obs. Apache license.

**Weaknesses vs AgentTrace:** Proxy model adds a hop (even if low latency) and is LLM-call focused (deeper agent/tool tracing may need SDKs too). Feature set leans more gateway/obs than deep agent debugging or first-class evals/prompts (though improving). Cloud pricing tiers; self-host still runs their full stack (multiple services in compose).

**Pricing (approx from sources):** Hobby free (10k-50k requests/mo); Pro $79/mo; higher tiers for teams/enterprise.

**When better:** You want minimal instrumentation friction for LLM calls across providers, value caching/routing/fallbacks to save money/reliability, or prefer gateway architecture. Great complement or alternative when you don't want per-call SDK wrapping.

### Arize Phoenix
**Strengths:** Outstanding for local development, experimentation, and troubleshooting. `pip install` + run (or Docker/notebook) gets you a full UI instantly — one of the easiest self-host/local experiences. Built on OpenTelemetry + OpenInference (portable, future-proof). Excellent RAG-specific views, LLM evals, datasets + experiments, playground, and prompt management even in OSS. Extremely active development (v17 June 2026, frequent releases, 8k+ commits). 9-10k stars and strong community. Free OSS with no feature gates for core.

**Weaknesses vs AgentTrace:** Phoenix is positioned more as "experiment + debug locally then send to Arize AX or your own backend." Not as "always-on local production tracing with CLI-first + zero infra." Evals/datasets strong, but the local dashboard is more for analysis than always-running lightweight agent monitoring. License is Elastic 2.0 (not pure MIT; some restrictions on offering as managed service).

**Pricing:** Phoenix OSS completely free. Arize AX (managed/full platform) has free tier (limited users), paid plans starting low (~$50/mo Pro reported in comparisons), Enterprise custom.

**When better:** You're doing heavy RAG/agent experimentation, want rich local evals + datasets + playground without any cloud, value OTel standards/portability, or like the notebook-friendly + visual RAG debugging tools. Very strong "local Phoenix" story that overlaps AgentTrace's simplicity but with more built-in analysis primitives.

### AgentOps
**Strengths:** Purpose-built for *agents* (not just LLM calls). Outstanding session replays, time-travel debugging, multi-agent workflow visualization, and graphs. Native deep integrations with popular agent frameworks (CrewAI "just works" with extra, AG2/AutoGen, LangGraph, OpenAI Agents SDK, Camel, etc.). Cost tracking across 400+ LLMs. Decorator-based SDK for clean instrumentation (@session, @agent, @operation etc.). Open-sourced the app/dashboard. Self-host supported. Cheap entry to paid.

**Weaknesses vs AgentTrace:** More cloud-oriented by default (free tier 5k events is small for heavy use). Self-host exists but less emphasized/documented as "zero config local" than AgentTrace's npx/SQLite model (you run the full app stack). Python-first feel (TS SDK exists but ecosystem leans Py agent frameworks). Fewer "local SQLite query anything" or built-in OTEL export stories. Pricing usage-based beyond free.

**Pricing:** Free up to 5k events; Pro starts ~$40/mo pay-as-you-go; Enterprise (self-host, SSO, etc.) custom/high.

**When better:** Building complex multi-agent systems (especially CrewAI/AutoGen/LangGraph), you live for replay debugging and visual execution graphs, or want broad LLM cost coverage out of the box with agent-native tracing.

## Honest Limitations of AgentTrace (and Where Competitors Win)
- **No evaluation framework yet** (planned; see docs/plans). Langfuse, LangSmith, Braintrust, Phoenix, and even AgentOps have mature evals, LLM-as-judge, datasets, experiments today.
- **No prompt management/versioning/playground.** Langfuse, LangSmith, Phoenix, and others treat this as table stakes.
- **No team/collaboration, RBAC, SSO, audit logs.** All the bigger platforms have paid/enterprise paths here.
- **No cloud hosted option.** If you want managed SaaS with SLAs/retention/compliance, others provide it (AgentTrace is deliberately local-only).
- **New/small community.** Langfuse (28k stars), Phoenix (10k), Helicone/AgentOps (~5-6k) have real ecosystems, examples, and contributors. AgentTrace is early (launched mid-2026).
- **Fewer integrations.** No built-in support for the long tail of frameworks yet (though middleware + OTEL export help).
- **Local scale limits.** SQLite + single dashboard is great for individuals/teams dev/prod small-medium; high-volume production with team dashboards favors the distributed backends of Langfuse/Phoenix/etc.
- **Evals and analysis are post-hoc only right now.** Some competitors make "run experiments" a first-class primitive.

AgentTrace also has some unique edges (see below) that the others don't match easily.

## When to Choose AgentTrace
Choose AgentTrace when the following are true (it is opinionated and deliberately narrow):

- **Absolute privacy and data sovereignty matter** — prompts, tool calls, and traces must *never* leave the machine by default. (No cloud, no telemetry, single SQLite file you control.)
- **Zero-config, zero-infra simplicity is the priority** — `npm install @agenttrace/sdk && npx agenttrace dashboard` (or pip equivalent) should be enough. No Docker, no Postgres, no accounts, no YAML, no "run the stack."
- **You live in the terminal/CLI** and want rich local querying (`stats`, cost breakdowns by model/day, export JSON/CSV/OTEL, filter runs) + a local web view when needed.
- **You want automatic cost tracking and latency without extra work** — built into the trace model for supported models, with easy extension.
- **Framework agnostic or using LangGraph/CrewAI/custom** — middlewares give auto-instrumentation where it counts; wrappers work everywhere else. No LangChain tax.
- **You value a queryable local artifact** (SQLite with normalized runs/traces/tool_calls/scores) that you can `sqlite3` against, back up, or diff.
- **OpenTelemetry export for future integration** without pulling in heavy SDKs.
- **You're an individual, small team, or in early dev/prototype-to-small-prod phase** where a full platform's complexity and cost aren't justified.
- **You want MIT + truly local self-host that is dead simple** (Docker is optional one-container for the dashboard+API if you want to run it as a service).

**Realistic guidance:** Many teams will use AgentTrace *during development and local debugging* (or for air-gapped/privacy-sensitive work) and layer or migrate to Langfuse/Phoenix/Braintrust for shared evals, team dashboards, and production scale. The OTEL export and structured data make that path feasible.

If your primary needs are evals today, prompt management, or multi-person collaboration with retention/SLAs, start with Langfuse (self-host or cloud) or Phoenix (local) instead — they are more complete platforms right now.

We built AgentTrace because the existing options were either too heavy, required accounts/cloud, or lacked the local CLI + cost + zero-friction experience we wanted for agent work. If that resonates, try it. Feedback and contributions welcome (see repo).

---

**Appendix notes / sources (partial):** 
- Stars and activity from direct GitHub fetches and search results (e.g., langfuse ~28k, phoenix ~9-10k, helicone 5.8k, agentops 5.6k).
- Pricing/self-host details from official /pricing and /self-hosting pages (Langfuse, Helicone, Braintrust docs, AgentOps site, Arize).
- Feature matrices cross-checked against multiple 2026 comparison articles and vendor docs.
- AgentTrace specifics from local README, CHANGELOG, package sources, and examples.
- "Last update" based on release tags, commit activity badges, and doc "last edited" dates around May-June 2026.

This document should be re-run with fresh `web_search` + page fetches before any public use. Numbers and features shift quickly in this category.
