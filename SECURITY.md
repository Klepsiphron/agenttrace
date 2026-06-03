# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability responsibly:

1. **Preferred**: Use GitHub's private vulnerability reporting feature (Security > Advisories > "Report a vulnerability") if available for the repository. This creates a private draft security advisory visible only to maintainers.
2. **Alternative**: Email the maintainers with details (subject: "SECURITY: <brief description>"). Include reproduction steps, affected versions, and any potential impact. A response is expected within 48 hours.
3. **If the above are unavailable**: Open a **private** GitHub issue or draft and immediately contact a maintainer via other channels (e.g., linked discussion or email in package metadata) requesting it be converted to a security advisory. Do **not** include exploit details in the initial public title/description.

We follow coordinated vulnerability disclosure (CVD). Please give us a reasonable time to investigate and prepare a fix before any public disclosure. We will acknowledge receipt promptly, keep you informed of progress, and credit reporters (unless anonymity is requested).

## Security Considerations

AgentTrace is a **local-first** observability tool with a deliberate zero-telemetry, zero-cloud design. All traces, runs, scores, and configuration remain on your machine in a SQLite database. This architecture reduces many supply-chain and exfiltration risks compared to hosted tracing platforms.

**Key facts and risks** (see also `docs/research/security-audit.md` for the full internal review):

- **SQLite storage of sensitive data**: The `traces` and `tool_calls` tables store `input` and `output` verbatim. These routinely contain user prompts, LLM completions, tool arguments/results, and arbitrary metadata. Alert webhook URLs (which may embed tokens or credentials) are also stored in the clear in the `alerts` table. Database files (including WAL companions) must be treated as sensitive artifacts.
- **File permissions**: The database is a regular file created with default umask permissions. On shared or multi-user machines, other local users/processes may be able to read it.
- **Dashboard exposure**:
  - By default the dashboard binds to `127.0.0.1:4317` (localhost only) — this is the recommended and safe behavior for solo development.
  - There is **no authentication or authorization** on any dashboard routes or API endpoints (`/api/traces`, `/api/export`, etc.). Anyone who can reach the listening address can read all stored data.
  - On shared workstations, containers (Docker publishes the port and overrides the host to `0.0.0.0`), remote desktop sessions, or devcontainer environments, the "localhost only" protection is insufficient.
- **Data retention**: A count-based `maxTraces` + `autoCleanup` mechanism exists, but there are no built-in time-based retention policies or easy "prune older than N days" tooling.
- **No encryption at rest**: Plain SQLite by default. Users must rely on OS-level full-disk encryption or container/volume encryption.
- **No telemetry**: The core SDK makes no outbound network calls. The only external calls are user-configured alert webhooks (which you control).
- **Exports and tooling**: `agenttrace export` and the dashboard export endpoint can dump full trace contents (including prompts/outputs) to JSON/CSV.

**In short**: The greatest risk is not remote network attack, but local data exposure or accidental leakage of the SQLite file containing your agents' prompts and outputs.

## Best Practices for Users

- Use strict file permissions on the database (`chmod 600 agenttrace.db*` and a restrictive umask) especially on shared machines.
- Prefer the default localhost binding. Only use `--host 0.0.0.0` (or equivalent) when you also enable authentication (future) or place the dashboard behind a reverse proxy with its own access controls + TLS.
- When running in Docker or published containers, ensure the published port is not reachable from untrusted networks or other tenants.
- Enable `autoCleanup` (default on) and use aggressive `maxTraces` values. Plan to periodically archive via export and rotate database files for long-lived projects.
- Avoid placing raw secrets, PII, or highly sensitive customer data in prompts sent to traced LLM calls when possible. Apply redaction before or after tracing where required.
- For webhook alerts, prefer short-lived or narrowly-scoped tokens; do not embed long-lived credentials in URLs stored in the database.
- Treat the entire `agenttrace.db` (and any exported artifacts) with the same care as application logs or secret material.
- Keep AgentTrace packages updated to receive security and stability fixes.

## Development / Contribution Notes

See [CONTRIBUTING.md](./CONTRIBUTING.md) (Security section) for rules about never committing database files, credentials, or `.env` data.

Internal research notes on the current security posture (storage layout, dashboard implementation, Docker overrides, etc.) live in `docs/research/security-audit.md`.
