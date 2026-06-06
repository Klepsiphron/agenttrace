# AgentTrace Product Website & Documentation

## Goal

Create a clean, professional product website for AgentTrace that:

1. Explains what it does (AI agent observability, token tracking, cost monitoring)
2. Shows how to install and use it (minimal setup)
3. Has a live demo or screenshots of the dashboard
4. Includes API documentation
5. Positions it for corporate/enterprise use

## What to Build

### 1. Product Landing Page

**File**: `website/index.html` (single-page, no framework needed)

Sections:

- Hero: "AI Agent Observability for Teams That Care About Token Costs"
- Problem: "Your agents burned $4,200 in tokens this week. Do you know which ones?"
- Solution: AgentTrace -- install in 30 seconds, see everything
- Features grid:
  - Zero-config self-tracing
  - Per-agent token/cost tracking
  - Multi-agent correlation (trace across subagent trees)
  - Budget alerts & anomaly detection
    -- Local SQLite (no cloud dependency)
  - Open source (MIT)
- Install section: `npm install -g @agenttrace-io/cli` → `agenttrace-io self-stats`
- Dashboard screenshot (placeholder)
- Pricing section (Free / Team $29/mo / Enterprise)
- Footer: GitHub, docs, license

### 2. Quick Start Guide

**File**: `website/docs/quickstart.md`

```markdown
# Quick Start

## Install

npm install -g @agenttrace-io/cli

## Trace Your First Agent

const { AgentTrace } = require('@agenttrace-io/sdk');
const agent = new AgentTrace({ dbPath: './my-agent.db' });

agent.startRun('my-session');
const result = await agent.trace('search-web', async () => {
return await fetch('https://api.example.com/search?q=hello');
}, { input: 'hello', tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
agent.completeRun();

## View Stats

npx agenttrace-io --db-path ./my-agent.db self-stats

## Launch Dashboard

npx agenttrace-io --db-path ./my-agent.db dashboard
```

### 3. API Reference

**File**: `website/docs/api.md`

Document all SDK methods:

- AgentTrace constructor options
- startRun / completeRun
- trace (with all options)
- getTraces / getRuns / getStats / getCostBreakdown
- recordAgentUsage / getAgentUsage / getUsageStats
- export (JSON/CSV)
- evaluate (scoring)
- registerAlert / checkAlerts
- addWebhook / triggerWebhook
- createChild / linkTraces / getTraceTree

### 4. Corporate/Enterprise Page

**File**: `website/docs/enterprise.md`

- Why observability matters for AI governance
- Token budget management
- Per-agent cost attribution
- Compliance & audit trails
- Team dashboards
- Contact for enterprise pricing

## Style

- Clean, minimal, developer-focused
- Dark theme (matches AgentTrace dashboard)
- Use CSS only (no frameworks)
- Responsive
- Fast loading

## Output

All files in `/home/ryano/projects/agenttrace/website/` directory.
