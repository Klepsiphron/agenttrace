# Fix Build & Test Failures After UI Redesign

## Context
A UI overhaul was just completed (commit ed0c3dc). It redesigned the dashboard, landing page, and docs. The build and tests are now broken. Fix ALL issues.

## Current State
- `pnpm build` fails: packages/sdk and packages/middleware-langgraph have TS errors
- `pnpm test` fails: 15 test files failing, only 5 passing
- The UI redesign changed many files but broke imports, exports, and test assertions

## Your Task
1. Run `pnpm build` and collect ALL errors
2. Run `pnpm test` and collect ALL failures
3. Fix EVERY issue -- don't stop until build passes AND all tests pass
4. Common issues to look for:
   - Missing/duplicate imports in packages/sdk/src/index.ts
   - Missing exports from SDK that CLI/middleware depend on
   - Test files referencing old HTML element IDs that changed in the redesigned UI
   - Test files referencing old CSS class names
   - Missing `eslint-disable` comments for `any` types in test files
   - Stale dist/ files (delete and rebuild if needed)
5. After ALL fixes, run `pnpm build && pnpm test` to verify
6. Commit: `fix: resolve build and test failures after UI redesign`
7. Push to origin/main

## Important
- Read each file you modify -- don't guess
- The SDK index.ts should export ALL types: Trace, Run, TraceConfig, TraceFilter, TraceStats, TokenUsage, ToolCall, ExportFormat, DashboardConfig, AgentFramework, FrameworkIntegration, Scorer, ScorerResult, EvaluateOptions, CostBreakdown, AlertCondition, AlertHistory, TraceTreeNode, HealthReport, AgentUsageRecord, AgentUsageFilter, UsageStats, AgentWho, AgentSession, ApiKey, CreatedApiKey, WebhookConfig, WebhookEvent, WebhookDelivery, Project
- The CLI imports WebhookConfig, WebhookEvent, WebhookEvent from @agenttrace-io/sdk -- make sure these are exported
- Dashboard test files may need updated selectors if HTML structure changed
