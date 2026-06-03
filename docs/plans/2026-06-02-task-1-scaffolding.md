# Task 1: Project Scaffolding — Plan

**Goal:** Monorepo foundation for AgentTrace (pnpm workspaces, strict TS, ESLint/Prettier, Vitest, MIT).

**Steps:**

1. Root workspace config (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, tooling configs).
2. Three packages: `@agenttrace-io/sdk`, `@agenttrace-io/dashboard`, `@agenttrace-io/cli` — each extends root TS, exports `VERSION` + `PACKAGE_NAME`.
3. TDD: failing Vitest tests per package → minimal `src/index.ts` → green.
4. Docs: `README.md`, `CONTRIBUTING.md`, `LICENSE`, `examples/` placeholders.
5. Verify: `pnpm install && pnpm build && pnpm test && pnpm lint`.

**Out of scope:** SDK tracing logic, SQLite, Express dashboard (Tasks 2+).
