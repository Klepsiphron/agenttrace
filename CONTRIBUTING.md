# Contributing to AgentTrace

Thank you for contributing! AgentTrace is MIT-licensed and community-driven.

## Quick Start

```bash
git clone https://github.com/Klepsiphron/agenttrace.git
cd agenttrace
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
agenttrace/
├── packages/
│   ├── sdk/              # @agenttrace/sdk -- TypeScript SDK
│   ├── sdk-python/       # agenttrace -- Python SDK
│   ├── dashboard/        # @agenttrace/dashboard -- Local web UI
│   ├── cli/              # @agenttrace/cli -- CLI tool
│   └── middleware-*/     # Framework-specific integrations
├── docs/                 # Documentation and planning
├── docs-site/            # GitHub Pages site
└── examples/             # Integration examples
```

## Development Workflow

1. **Create a feature branch** from `main`: `git checkout -b feat/my-feature`
2. **Write tests first** (TDD) for behavior changes
3. **Implement the change** -- keep it focused
4. **Verify everything passes:**
   ```bash
   pnpm build    # TypeScript compilation
   pnpm lint     # ESLint + Prettier
   pnpm test     # All 50+ tests
   ```
5. **Commit** -- the pre-commit hook auto-formats code
6. **Push and open a PR** against `main`
7. **CI must pass** (branch protection requires it)

## Code Standards

- TypeScript strict mode; avoid `any` (use `unknown` + type guards)
- Zero runtime dependencies in `@agenttrace/sdk`
- Format with Prettier (auto-run on commit)
- ESLint must pass -- no warnings
- Every public function needs tests
- Python code should have type hints and pass pytest

## Commit Messages

Follow conventional commits (enforced):

```
feat: add OpenTelemetry export
fix: resolve SQLite race condition
docs: update API reference
chore: add pre-commit format hook
test: expand SDK coverage to 29 tests
```

## Pull Request Guidelines

- One feature or fix per PR
- Describe what changed and why in the PR body
- Reference related issues: `Closes #123`
- Ensure CI passes before requesting review
- Keep changes atomic and reviewable

## Security

Never commit:

- API keys, tokens, or credentials
- `.env` files
- Database files (`*.db`, `*.sqlite`)
- `node_modules/` or `__pycache__/`

## Need Help?

Open an issue with the `question` label or join the discussion.

## License

By contributing, you agree that your contributions will be licensed under [MIT](LICENSE).
