# Troubleshooting Guide

Common issues and solutions for AgentTrace installation, configuration, and operation.

---

## Table of Contents

1. [Common Installation Issues](#common-installation-issues)
2. [Database Migration Problems](#database-migration-problems)
3. [Rate Limit Errors](#rate-limit-errors)
4. [Webhook Delivery Failures](#webhook-delivery-failures)
5. [Dashboard Not Loading](#dashboard-not-loading)
6. [High Memory Usage](#high-memory-usage)
7. [How to Enable Debug Logging](#how-to-enable-debug-logging)

---

## Common Installation Issues

### `better-sqlite3` native build fails

**Symptoms:** `npm install` or `pnpm install` fails with `node-gyp` errors, `ERR! build error`, or `prebuild-install` warnings.

**Cause:** `better-sqlite3` is a native module that compiles C++ bindings via `node-gyp`. It requires a C++ compiler, Python, and build tools.

**Fix - Linux / WSL2:**

```bash
sudo apt update
sudo apt install -y build-essential python3
pnpm install
```

**Fix - macOS:**

```bash
xcode-select --install
pnpm install
```

**Fix - Alpine / Docker:**
Alpine uses musl instead of glibc. The Dockerfile already handles this:

```dockerfile
RUN apk add --no-cache python3 make g++ linux-headers
```

If building your own Alpine image, ensure `python3`, `make`, `g++`, and `linux-headers` are installed before `pnpm install`.

**Fix - Windows (native, not WSL):**

```bash
npm install -g windows-build-tools
# or install Visual Studio Build Tools with "Desktop development with C++" workload
```

### `pnpm install` fails with workspace errors

**Symptoms:** `ERR_PNPM_NO_MATCHING_VERSION` or workspace dependency resolution failures.

**Fix:** Ensure you are using a compatible pnpm version:

```bash
pnpm --version   # should be 8.x or 9.x
npm install -g pnpm@latest
```

### Python SDK: `pip install agenttrace-io` fails

**Symptoms:** `No matching distribution found` or build errors during pip install.

**Fix:**

```bash
# Ensure Python 3.10+ is installed
python3 --version

# Upgrade pip
pip install --upgrade pip

# Install
pip install agenttrace-io
```

If building from source in the monorepo:

```bash
cd packages/sdk-python
pip install -e .
```

### `npx agenttrace-io` command not found

**Symptoms:** `command not found: agenttrace-io` or `command not found: npx`.

**Fix:**

```bash
# Verify Node.js is installed (18+ required)
node --version

# Install the CLI globally
npm install -g @agenttrace-io/cli

# Or use npx with the full package name
npx @agenttrace-io/cli --help
```

---

## Database Migration Problems

### "SQLITE_ERROR: table already exists" or schema mismatch

**Symptoms:** Errors like `table "meta" already exists`, `no such column`, or `SQLITE_ERROR` on startup after upgrading AgentTrace.

**Cause:** The database file was created with an older version of AgentTrace and the migration runner failed to apply newer schema changes.

**Fix 1 -- Let migrations auto-run:**
AgentTrace applies migrations automatically on SDK init. Ensure you are not catching and swallowing errors silently:

```typescript
const agent = init({ dbPath: './agenttrace.db' });
// Check for errors in console output
```

**Fix 2 -- Check current schema version:**

```bash
sqlite3 agenttrace.db "SELECT * FROM meta WHERE key = 'schema_version';"
# or for older databases:
sqlite3 agenttrace.db "SELECT * FROM version WHERE key = 'schema_version';"
```

**Fix 3 -- Fresh start (data loss):**
If the database is non-critical or you have exports:

```bash
rm agenttrace.db
npx agenttrace-io init
```

**Fix 4 -- Manual migration:**
If a specific migration failed, you can inspect the migration files at:

```
packages/sdk/src/migrations/
  001-initial.ts
  002-scores.ts
  003-alerts.ts
  004-trace-context.ts
  005-agent-usage.ts
  005-webhooks.ts
  006-api-keys.ts
```

Run the missing SQL statements manually against your database.

### Database locked / `SQLITE_BUSY`

**Symptoms:** `SQLITE_BUSY: database is locked` errors during tracing.

**Cause:** Multiple processes writing to the same SQLite file concurrently, or a process crashed while holding a write lock.

**Fix:**

```bash
# Remove the WAL/SHM files (they are safe to delete when no process is using the db)
rm -f agenttrace.db-wal agenttrace.db-shm
```

AgentTrace uses WAL mode by default, which reduces but does not eliminate contention. If you have multiple processes writing traces, consider:

- Using a single writer process and aggregating traces
- Setting `maxTracesPerSecond` to reduce write frequency
- Using separate database files per process

### Python SDK: schema not initialized

**Symptoms:** `sqlite3.OperationalError: no such table: traces` when using the Python SDK.

**Cause:** The Python SDK initializes schema in `TraceStorage.__init__`, but the database file may be in a directory that does not exist or is not writable.

**Fix:**

```python
import os
os.makedirs(os.path.dirname(db_path), exist_ok=True)
agent = init(db_path=db_path)
```

---

## Rate Limit Errors

### Traces are being silently dropped

**Symptoms:** `getDroppedTraces()` returns a value greater than 0, or trace count is lower than expected.

**Cause:** Rate limiting is configured via `maxTracesPerSecond` or `maxTracesPerMinute` and the trace volume exceeds the configured limits.

**Check current drop count:**

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  maxTracesPerSecond: 10,
  maxTracesPerMinute: 100,
});

// After running traces
console.log('Dropped:', agent.getDroppedTraces());
```

**Check via CLI:**

```bash
npx agenttrace-io stats
```

**Fix -- Increase limits:**

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  maxTracesPerSecond: 50, // increase from default
  maxTracesPerMinute: 500, // increase from default
  burstAllowance: 20, // allow burst above sustained rate
});
```

**Fix -- Disable rate limiting:**

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  maxTracesPerSecond: 0, // 0 = disabled
  maxTracesPerMinute: 0, // 0 = disabled
});
```

### Understanding the token bucket

AgentTrace uses a token bucket algorithm with two independent buckets:

- **Per-second bucket:** Controls sustained rate. Refills at `maxTracesPerSecond` tokens per second.
- **Per-minute bucket:** Controls longer-term rate. Refills at `maxTracesPerMinute` tokens per minute.
- **Burst allowance:** Extra tokens above the sustained rate, allowing short bursts.

A trace is recorded only if BOTH buckets have at least 1 token. If either bucket is empty, the trace is dropped and the dropped counter increments.

---

## Webhook Delivery Failures

### Alerts trigger but webhook is not received

**Symptoms:** `agenttrace-io alerts history` shows `delivered: false` or `error` field populated.

**Check delivery history:**

```bash
npx agenttrace-io alerts history
```

**Common causes and fixes:**

**1. Network connectivity from the AgentTrace process:**

```bash
# Test the webhook URL manually
curl -X POST https://your-webhook-url.com/endpoint \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**2. Non-2xx HTTP response:**
AgentTrace marks delivery as failed if the webhook endpoint returns a non-2xx status code. Check your endpoint logs.

**3. Timeout or DNS failure:**
If the webhook host is unreachable, the error will contain the fetch error message (e.g., `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`).

**4. Webhook payload format:**
AgentTrace POSTs JSON with this structure:

```json
{
  "alertName": "my-alert",
  "stats": {
    "totalTraces": 100,
    "successRate": 0.95,
    "totalCostUsd": 1.23,
    "avgLatencyMs": 450,
    "totalTokens": 50000,
    "avgTokensPerTrace": 500
  },
  "timestamp": 1717000000000
}
```

**5. Test an alert manually:**

```bash
npx agenttrace-io alerts test --name my-alert
```

### Webhook delivery history growing large

The `webhook_deliveries` table retains all delivery records. To clean up old records:

```bash
sqlite3 agenttrace.db "DELETE FROM webhook_deliveries WHERE created_at < strftime('%s', 'now', '-7 days');"
```

---

## Dashboard Not Loading

### "Connection refused" or blank page at http://localhost:4317

**Symptoms:** Browser shows `ERR_CONNECTION_REFUSED`, `Unable to connect`, or a blank white page.

**Fix 1 -- Verify the dashboard is running:**

```bash
npx agenttrace-io dashboard
# Should print: [agenttrace] Dashboard running at http://127.0.0.1:4317
```

**Fix 2 -- Check port availability:**

```bash
# Linux / macOS
lsof -i :4317

# Windows (PowerShell)
netstat -ano | findstr 4317
```

If another process is using port 4317, start the dashboard on a different port:

```bash
npx agenttrace-io dashboard --port 4318
```

**Fix 3 -- Check the host binding:**
By default, the dashboard binds to `127.0.0.1` (localhost only). To access from another machine:

```bash
npx agenttrace-io dashboard --host 0.0.0.0
```

**Fix 4 -- Verify the database path:**
The dashboard reads from the same database file as the SDK. If the database does not exist or is corrupted:

```bash
npx agenttrace-io init
npx agenttrace-io dashboard
```

### Dashboard shows "No data" or empty tables

**Symptoms:** Dashboard loads but all tables are empty.

**Cause:** The dashboard is reading from a different database file than the one your SDK writes to.

**Fix:** Explicitly specify the database path:

```bash
npx agenttrace-io dashboard --db-path /absolute/path/to/agenttrace.db
```

Or set the environment variable:

```bash
export AGENTTRACE_DB_PATH=/absolute/path/to/agenttrace.db
npx agenttrace-io dashboard
```

### Dashboard API returns 500 errors

**Symptoms:** Dashboard UI shows error toasts or the network tab shows 500 responses.

**Fix:** Check the dashboard server console output for the full error. Common causes:

- Database file is corrupted: try `sqlite3 agenttrace.db "PRAGMA integrity_check;"`
- Database file is locked by another process
- Insufficient file permissions: `chmod 644 agenttrace.db`

---

## High Memory Usage

### AgentTrace process memory grows over time

**Symptoms:** The Node.js or Python process using AgentTrace consumes increasing memory.

**Cause:** By default, AgentTrace retains up to 10,000 traces in the database and runs an in-memory cleanup check after each trace call. High trace volumes without cleanup can cause memory growth.

**Fix 1 -- Reduce maxTraces:**

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  maxTraces: 1000, // reduce from default 10000
  autoCleanup: true,
});
```

**Fix 2 -- Set retention policy:**

```typescript
// Delete traces older than 7 days
agent.setRetentionPolicy(7, 24); // 7 days, cleanup every 24 hours
```

**Fix 3 -- Manual cleanup:**

```bash
# Delete traces older than 30 days
sqlite3 agenttrace.db "DELETE FROM traces WHERE created_at < strftime('%s', 'now', '-30 days');"

# Vacuum to reclaim disk space
sqlite3 agenttrace.db "VACUUM;"
```

**Fix 4 -- Disable auto-cleanup and run it manually:**

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  autoCleanup: false,
});
// Run cleanup on your own schedule
agent.cleanup();
```

### Large database file

**Symptoms:** `agenttrace.db` file is hundreds of MB or larger.

**Fix:**

```bash
# Check table sizes
sqlite3 agenttrace.db "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY SUM(pgsize) DESC;"

# Delete old traces
sqlite3 agenttrace.db "DELETE FROM traces WHERE created_at < strftime('%s', 'now', '-7 days');"

# Reclaim space (locks the database briefly)
sqlite3 agenttrace.db "VACUUM;"
```

### Dashboard server memory

The dashboard server loads data from the database on each API request but does not cache aggressively. If the dashboard itself is using excessive memory, it is likely due to very large query results.

**Fix:** Add filters to reduce the data returned:

- Use the `--limit` flag on CLI commands
- Use date-range filters in the dashboard UI
- Reduce `maxTraces` to keep the dataset smaller

---

## How to Enable Debug Logging

### SDK debug output

AgentTrace does not have a built-in debug logging framework. To trace SDK behavior:

**TypeScript -- Set `silent: false` (default):**
The SDK prints errors to `stderr` by default. Ensure you are not suppressing them:

```typescript
const agent = init({
  dbPath: './agenttrace.db',
  silent: false, // default; set true to suppress all output
});
```

**TypeScript -- Wrap calls with your own logging:**

```typescript
const agent = init({ dbPath: './agenttrace.db' });

try {
  const result = await agent.trace('my-op', async () => {
    console.log('[debug] Starting operation');
    const r = await callLLM(input);
    console.log('[debug] Got result', r);
    return r;
  });
  console.log('[debug] Trace recorded, stats:', agent.getStats());
} catch (err) {
  console.error('[debug] Trace failed:', err);
}
```

### CLI verbose output

Most CLI commands support `--json` for machine-readable output, which can help diagnose issues:

```bash
npx agenttrace-io stats --json
npx agenttrace-io health --json
```

### Database inspection

Direct SQL queries are the most powerful debugging tool:

```bash
# Check schema version
sqlite3 agenttrace.db "SELECT * FROM meta;"

# Check recent traces
sqlite3 agenttrace.db "SELECT id, name, status, created_at FROM traces ORDER BY created_at DESC LIMIT 10;"

# Check alert history
sqlite3 agenttrace.db "SELECT * FROM alert_history ORDER BY triggered_at DESC LIMIT 10;"

# Check webhook delivery status
sqlite3 agenttrace.db "SELECT * FROM webhook_deliveries ORDER BY created_at DESC LIMIT 10;"

# Check for errors in traces
sqlite3 agenttrace.db "SELECT id, name, error FROM traces WHERE status = 'error' ORDER BY created_at DESC LIMIT 20;"

# Check rate limit log
sqlite3 agenttrace.db "SELECT * FROM rate_limit_log ORDER BY dropped_at DESC LIMIT 10;"
```

### Environment variables

| Variable             | Description                  | Default           |
| -------------------- | ---------------------------- | ----------------- |
| `AGENTTRACE_DB_PATH` | Path to SQLite database file | `./agenttrace.db` |

### Health check

Run the built-in health check:

```bash
npx agenttrace-io health
# or with JSON output:
npx agenttrace-io health --json
```

This reports database connectivity, table counts, and process memory usage.

### Node.js debug mode

For deep debugging of the SDK internals, use Node.js built-in debug inspector:

```bash
# Enable inspector
node --inspect -e "const {init} = require('@agenttrace-io/sdk'); const a = init(); console.log(a.getStats());"

# Or with Chrome DevTools
node --inspect-brk your-script.js
# Then open chrome://inspect in Chrome
```

### Python SDK debugging

```python
import logging
logging.basicConfig(level=logging.DEBUG)

from agenttrace import init
agent = init(db_path="./agenttrace.db")
result = agent.trace("my-op", lambda: "hello")
print(agent.get_stats())
```

---

## Getting Help

If your issue is not covered here:

1. Run `npx agenttrace-io health --json` and include the output in your report
2. Check the database directly with `sqlite3 agenttrace.db` queries above
3. Open an issue at https://github.com/Klepsiphron/agenttrace/issues
