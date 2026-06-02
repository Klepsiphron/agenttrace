# AgentTrace Product Roadmap

## v0.1.0 (Current) -- Foundation
- [x] TypeScript SDK (trace, cost, SQLite storage)
- [x] Express dashboard (dark theme, runs list, trace details, stats, export)
- [x] CLI stub
- [x] GitHub Actions CI
- [x] OSS hygiene (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG)
- [x] Examples (LangGraph, CrewAI, custom)

## v0.2.0 (Next) -- Usability
- [ ] **Python SDK** -- must-have, 70%+ of AI agent code is Python
- [ ] **Full CLI** -- init, dashboard, runs, traces, stats, export commands
- [ ] **OpenTelemetry export** -- industry standard, enables integration with existing tools
- [ ] **Framework middleware** -- LangGraph callback handler, CrewAI integration
- [ ] **npm publishing** -- `npm install @agenttrace/sdk` works
- [ ] **PyPI publishing** -- `pip install agenttrace` works

## v0.3.0 -- Growth
- [ ] **Landing page** -- simple static site with demo GIF, docs, install instructions
- [ ] **Documentation site** -- proper docs with search, examples, API reference
- [ ] **GitHub Sponsors** -- enable sponsorship
- [ ] **Comparison page** -- "Why AgentTrace vs Langfuse/LangSmith" (honest, not FUD)

## v1.0.0 -- Monetization
- [ ] **Hosted version** -- team dashboards, shared traces, cloud storage
- [ ] **SSO/SAML** -- enterprise auth
- [ ] **Audit logs** -- compliance feature
- [ ] **Usage-based pricing** -- free tier (1K traces/mo), paid ($29/mo for 50K)
- [ ] **Stripe integration** -- payment processing

## Positioning Statement
"AgentTrace is the local-first, privacy-first observability tool for AI agents.
No cloud. No accounts. No telemetry. Just traces."

## Competitive Moat
- Langfuse: 28K stars, full-featured, but heavy (Docker/K8s), cloud-first
- LangSmith: LangGraph-native, but cloud-only, usage-based pricing
- AgentOps: agent reliability focus, but cloud-first
- **AgentTrace: zero-dependency, local-first, CLI-first, privacy-first**

We don't compete on features. We compete on simplicity and privacy.
