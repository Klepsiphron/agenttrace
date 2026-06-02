# Contributing to AgentTrace

Thank you for your interest in contributing. AgentTrace is an open-source project and we welcome issues, documentation improvements, and pull requests.

## Development setup

```bash
git clone https://github.com/your-org/agenttrace.git
cd agenttrace
pnpm install
pnpm build
pnpm test
```

## Workflow

1. Open an issue or comment on an existing one before large changes.
2. Create a branch from `main`.
3. Write tests first (TDD) for behavior changes.
4. Run `pnpm lint`, `pnpm test`, and `pnpm build` before opening a PR.
5. Keep PRs focused — one feature or fix per pull request.

## Code standards

- TypeScript strict mode; no `any` without justification.
- ESLint and Prettier must pass (`pnpm lint`, `pnpm format:check`).
- Prefer zero runtime dependencies in `@agenttrace/sdk` (core tracing package).

## Commit messages

Use clear, imperative subjects: `Add trace export filter`, `Fix SQLite migration ordering`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
