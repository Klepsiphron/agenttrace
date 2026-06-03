# AgentTrace Project Fix Plan

# Created: 2026-06-02 by OWL (orchestrator)

## Goal: Green CI — all tests passing, core SDK stable

## Current State: 19 test failures across 3 files

### Problem 1: retention.test.ts — Transform Error

- File fails to compile (syntax or import error)
- Not a core tracing feature — retention is half-baked
- Priority: Quick fix or disable

### Problem 2: index.test.ts — 5 Failures

- `getTraces()` delegates — tenant_id param breaks mock expectations
- `export()` OTEL format — same signature mismatch
- `evaluate()` runId/traceIds filters — same issue
- Root cause: tenant_id leaked into core public API method signatures
- Priority: Fix signatures, align tests

### Problem 3: multi-tenant.test.ts — 14 Failures

- Half-baked multi-tenant feature
- Tests reference missing storage methods (getProject, createProject, etc.)
- Priority: Either implement missing methods OR remove multi-tenant tests entirely

## Approach

Fix problems 1 and 2. For problem 3, evaluate whether multi-tenant is worth keeping.
If not, remove the tests and the half-baked code paths.
