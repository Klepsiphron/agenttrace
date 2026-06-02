# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you find a security vulnerability in AgentTrace, please open a GitHub issue with the `security` label. We will respond within 48 hours.

## Security Considerations

- AgentTrace stores all data locally in SQLite -- no data leaves your machine
- No telemetry, no external network calls from the SDK itself
- The dashboard serves on localhost by default
- Database files may contain sensitive prompts/outputs -- handle with care
