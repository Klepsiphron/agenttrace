#!/usr/bin/env node

/**
 * AgentTrace CLI
 * Command-line interface for querying traces, runs, stats and exports
 */

import {
  AgentTrace,
  type Run,
  type Trace,
  type TraceStats,
  type CostBreakdown,
  AlertCondition,
  ExportFormat,
} from '@agenttrace/sdk';
import { startDashboard } from '@agenttrace/dashboard';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';

/** Published npm package name. */
export const PACKAGE_NAME = '@agenttrace/cli';

function getDbPath(): string {
  return process.env.AGENTTRACE_DB_PATH || './agenttrace.db';
}

// ANSI colors for status
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function colorizeStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === 'success') return `${GREEN}${status}${RESET}`;
  if (s === 'error' || s === 'failure') return `${RED}${status}${RESET}`;
  if (s === 'running' || s === 'timeout') return `${YELLOW}${status}${RESET}`;
  return status;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

function pad(str: string, width: number): string {
  const vis = visibleLength(str);
  return str + ' '.repeat(Math.max(0, width - vis));
}

function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) return;

  const widths: number[] = headers.map((h, i) => {
    const rowMax = Math.max(0, ...rows.map((r) => visibleLength(r[i] ?? '')));
    return Math.max(h.length, rowMax);
  });

  // header
  console.log(headers.map((h, i) => pad(h, widths[i] ?? 0)).join('  '));
  // separator
  console.log(widths.map((w) => '-'.repeat(w ?? 0)).join('  '));
  // rows
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i] ?? 0)).join('  '));
  }
}

function printRunsTable(runs: Run[]): void {
  const headers = ['ID', 'Name', 'Status', 'Traces', 'Tokens', 'Cost', 'Started'];
  const rows = runs.map((r) => [
    (r.id || '').substring(0, 8),
    r.name || '',
    colorizeStatus(r.status || ''),
    String(r.traceCount ?? 0),
    String(r.totalTokens?.totalTokens ?? 0),
    (r.totalCostUsd ?? 0).toFixed(4),
    r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 19).replace('T', ' ') : '',
  ]);
  printTable(headers, rows);
}

function printTracesTable(traces: Trace[]): void {
  const headers = ['ID', 'Name', 'Status', 'Latency', 'Tokens', 'Cost', 'Created'];
  const rows = traces.map((t) => [
    (t.id || '').substring(0, 8),
    t.name || '',
    colorizeStatus(t.status || ''),
    `${t.latencyMs ?? 0}ms`,
    String(t.tokens?.totalTokens ?? 0),
    (t.costUsd ?? 0).toFixed(4),
    t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 19).replace('T', ' ') : '',
  ]);
  printTable(headers, rows);
}

function printStats(stats: TraceStats): void {
  console.log('AgentTrace Statistics');
  console.log('=====================');
  console.log(`Total Runs:     ${stats.totalRuns ?? 0}`);
  console.log(`Total Traces:   ${stats.totalTraces ?? 0}`);
  const rate = ((stats.successRate ?? 0) * 100).toFixed(1);
  console.log(`Success Rate:   ${rate}%`);
  console.log(`Avg Latency:    ${stats.avgLatencyMs ?? 0}ms`);
  console.log(`Total Cost:     $${(stats.totalCostUsd ?? 0).toFixed(4)}`);
  console.log(`Total Tokens:   ${stats.totalTokens ?? 0}`);
  console.log(`Avg Tokens:     ${stats.avgTokensPerTrace ?? 0}`);
  if (stats.topTools && stats.topTools.length > 0) {
    console.log('\nTop Tools:');
    for (const t of stats.topTools.slice(0, 5)) {
      console.log(`  ${t.name}: ${t.count} (avg ${t.avgLatencyMs}ms)`);
    }
  }
  if (stats.topErrors && stats.topErrors.length > 0) {
    console.log('\nTop Errors:');
    for (const e of stats.topErrors.slice(0, 5)) {
      console.log(`  ${e.error}: ${e.count}`);
    }
  }
}

function printCosts(breakdown: CostBreakdown, daily: boolean): void {
  const title = daily ? 'Daily Cost Breakdown' : 'Cost Breakdown by Model';
  console.log(title);
  console.log('='.repeat(title.length));
  const data = daily ? breakdown.costByDay : breakdown.costByModel;
  const entries = Object.entries(data);
  if (entries.length === 0) {
    console.log('No costs recorded.');
  } else {
    // sort by cost desc for models, chrono for days
    const sorted = daily
      ? entries.sort(([a], [b]) => a.localeCompare(b))
      : entries.sort(([, c1], [, c2]) => (c2 as number) - (c1 as number));
    for (const [key, cost] of sorted) {
      console.log(`  ${key}: $${(cost as number).toFixed(4)}`);
    }
  }
  console.log(`\nTotal: $${breakdown.totalCostUsd.toFixed(4)}`);
}

function printUsage(): void {
  console.log(`Usage: agenttrace <command> [options]

Commands:
  init                 Create empty agenttrace.db in current dir
  dashboard            Start the local dashboard server
  runs                 List recent runs (most recent first)
  traces               List traces (most recent first)
  stats                Show summary statistics
  costs                Show cost breakdown by model (or --daily)
  export               Export traces to JSON or CSV
  alerts               Manage alerts: list | test --name N | history
  version              Show CLI version

Options (by command):
  runs, traces:
    --limit N            Number of results (default: runs=20, traces=50)
    --status FILTER      Comma-separated statuses (success,error,failure,running,timeout)
  traces, export, costs:
    --run-id ID          Filter by run ID
  export:
    --format json|csv    Output format (default: json)
    --output FILE        Write to file instead of stdout
  costs:
    --daily              Breakdown costs by day instead of by model
  alerts:
    list                 List configured alerts
    test --name NAME     Test delivery for alert (forces condition + ignores cooldown)
    history              Show alert trigger history

Global:
  --json               Emit machine-readable JSON (for runs, traces, stats, costs, export)
  --help               Show this help

Examples:
  agenttrace init
  agenttrace runs --limit 5 --status success,running
  agenttrace traces --run-id 123e4567 --json
  agenttrace export --format csv --output out.csv --run-id abc
  agenttrace dashboard
  agenttrace costs
  agenttrace costs --daily --json
  agenttrace costs --run-id abc123
  agenttrace alerts list
  agenttrace alerts test --name high-error-rate
  agenttrace alerts history
  npx agenttrace version
`);
}

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  // Command is the first non-flag argument
  const command = args.find((a) => typeof a === 'string' && !a.startsWith('-')) || 'help';
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string' || !arg.startsWith('--')) continue;
    // flag
    const eqIdx = arg.indexOf('=');
    let key: string;
    let val: string | boolean = true;
    if (eqIdx !== -1) {
      key = arg.slice(2, eqIdx);
      val = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
      const next = args[i + 1];
      if (i + 1 < args.length && typeof next === 'string' && !next.startsWith('-')) {
        val = next;
        i++;
      }
    }
    flags[key] = val;
  }
  return { command, flags };
}

function getAgentTrace(requireDb = true): AgentTrace {
  const dbp = getDbPath();
  if (requireDb && !existsSync(dbp)) {
    console.error(`No ${dbp} found in current directory.`);
    console.error('Run "agenttrace init" to create one.');
    process.exit(1);
  }
  return new AgentTrace({ dbPath: dbp, silent: true });
}

async function main(): Promise<void> {
  try {
    const { command, flags } = parseArgs(process.argv);

    if (flags.help || command === 'help') {
      printUsage();
      return;
    }

    const useJson = !!flags.json;

    // detect subcommand for alerts (e.g. alerts list, alerts test)
    let alertsSub: string | undefined;
    if (command === 'alerts') {
      const argvArgs = process.argv.slice(2);
      const idx = argvArgs.indexOf('alerts');
      if (idx !== -1) {
        for (let k = idx + 1; k < argvArgs.length; k++) {
          const c = argvArgs[k];
          if (typeof c === 'string' && !c.startsWith('-')) {
            alertsSub = c;
            break;
          }
        }
      }
    }

    switch (command) {
      case 'init': {
        const dbp = getDbPath();
        if (existsSync(dbp)) {
          console.log(`${dbp} already exists.`);
        } else {
          const trace = new AgentTrace({ dbPath: dbp, silent: true });
          trace.close();
          console.log(`Created ${dbp}`);
        }
        break;
      }

      case 'dashboard': {
        const rawPort = flags.port ? parseInt(String(flags.port), 10) : NaN;
        const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : undefined;
        const host = typeof flags.host === 'string' ? String(flags.host) : undefined;
        startDashboard({ dbPath: getDbPath(), port, host });
        // server keeps process alive
        return;
      }

      case 'runs': {
        const trace = getAgentTrace();
        const rawLimit = flags.limit ? parseInt(String(flags.limit), 10) : NaN;
        const lim = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;
        let runs = trace.getRuns(Math.max(1, Math.min(1000, lim)));

        const statusRaw = flags.status ? String(flags.status) : '';
        if (statusRaw) {
          const allowed = statusRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (allowed.length) {
            runs = runs.filter((r) => allowed.includes(r.status));
          }
        }

        trace.close();

        if (useJson) {
          console.log(JSON.stringify(runs, null, 2));
        } else if (runs.length === 0) {
          console.log('No runs found.');
        } else {
          printRunsTable(runs);
        }
        break;
      }

      case 'traces': {
        const trace = getAgentTrace();
        const rawLimit = flags.limit ? parseInt(String(flags.limit), 10) : NaN;
        const lim = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50;
        const runId = (flags['run-id'] || flags.runId || flags['runId']) as string | undefined;

        const filter: Record<string, unknown> = {
          limit: Math.max(1, Math.min(1000, lim)),
        };
        if (runId) {
          filter.runId = String(runId);
        }
        const statusRaw = flags.status ? String(flags.status) : '';
        if (statusRaw) {
          const statuses = statusRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (statuses.length) {
            filter.status = statuses;
          }
        }

        const traces = trace.getTraces(filter);
        trace.close();

        if (useJson) {
          console.log(JSON.stringify(traces, null, 2));
        } else if (traces.length === 0) {
          console.log('No traces found.');
        } else {
          printTracesTable(traces);
        }
        break;
      }

      case 'stats': {
        const trace = getAgentTrace();
        const stats = trace.getStats();
        trace.close();

        if (useJson) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          printStats(stats);
        }
        break;
      }

      case 'costs': {
        const trace = getAgentTrace();
        const runId = (flags['run-id'] || flags.runId || flags['runId']) as string | undefined;
        const daily = !!flags.daily;
        const breakdown = trace.getCostBreakdown({ runId: runId ? String(runId) : undefined });
        trace.close();

        if (useJson) {
          console.log(JSON.stringify(breakdown, null, 2));
        } else {
          printCosts(breakdown, daily);
        }
        break;
      }

      case 'export': {
        const trace = getAgentTrace();
        const format: ExportFormat = flags.format === 'csv' ? 'csv' : 'json';
        const runId = (flags['run-id'] || flags.runId || flags['runId']) as string | undefined;

        const filter: Record<string, unknown> = {};
        if (runId) {
          filter.runId = String(runId);
        }

        const data = trace.export(format, filter);
        trace.close();

        const outFile = flags.output ? String(flags.output) : '';
        if (outFile) {
          writeFileSync(outFile, data, 'utf8');
          console.log(`Exported ${format.toUpperCase()} to ${outFile}`);
        } else {
          console.log(data);
        }
        break;
      }

      case 'alerts': {
        const sub = alertsSub || 'list';
        const dbp = getDbPath();
        const dbExists = existsSync(dbp);
        if (!dbExists && (sub === 'test' || sub === 'history')) {
          console.error(`No ${dbp} found in current directory.`);
          console.error('Run "agenttrace init" to create one.');
          process.exit(1);
        }
        if (sub === 'list' || sub === '') {
          if (!dbExists) {
            if (useJson) {
              console.log('[]');
            } else {
              console.log('No alerts configured.');
            }
            break;
          }
          const agent = new AgentTrace({ dbPath: dbp, silent: true });
          const alerts = agent.getAlerts();
          agent.close();
          if (useJson) {
            console.log(JSON.stringify(alerts, null, 2));
          } else if (alerts.length === 0) {
            console.log('No alerts configured.');
          } else {
            console.log('Configured alerts:');
            for (const a of alerts) {
              const parts: string[] = [`cooldown=${a.cooldown}s`];
              if (a.webhook) parts.push('webhook');
              if (a.email) parts.push('email');
              const last = a.lastTriggered ? new Date(a.lastTriggered).toISOString().slice(0, 19) : 'never';
              console.log(`  ${a.name} (${parts.join(', ')}) lastTriggered=${last}`);
            }
          }
          break;
        }
        const agent = new AgentTrace({ dbPath: dbp, silent: true });
        if (sub === 'history') {
          const history = agent.getAlertHistory();
          agent.close();
          if (useJson) {
            console.log(JSON.stringify(history, null, 2));
          } else if (history.length === 0) {
            console.log('No alert history.');
          } else {
            console.log('Alert history (newest first):');
            for (const h of history.slice(0, 100)) {
              const t = new Date(h.triggeredAt).toISOString().slice(0, 19).replace('T', ' ');
              const del = h.delivered ? 'delivered' : `failed${h.error ? ' (' + h.error + ')' : ''}`;
              console.log(`  ${t}  ${h.alertName}  ${del}`);
            }
          }
          break;
        }
        if (sub === 'test') {
          const name = (flags.name || flags['name']) ? String(flags.name || flags['name']) : '';
          if (!name) {
            console.error('Usage: agenttrace alerts test --name <name>');
            agent.close();
            process.exit(1);
          }
          const alerts = agent.getAlerts();
          const def = alerts.find((a: AlertCondition) => a.name === name);
          if (!def) {
            console.error(`Alert '${name}' not found. Register it via the SDK first.`);
            agent.close();
            process.exit(1);
          }
          // Force a test by registering a temp always-true version (bypasses cooldown + uses stored config)
          const testAlert: AlertCondition = {
            name: def.name,
            condition: () => true,
            webhook: def.webhook,
            email: def.email,
            cooldown: 0,
            lastTriggered: 0,
          };
          agent.registerAlert(testAlert);
          const fired = await agent.checkAlerts();
          agent.close();
          if (fired.length > 0) {
            const f = fired[0]!;
            const outcome = f.delivered ? 'delivered' : `failed${f.error ? ': ' + f.error : ''}`;
            console.log(`Test-fired alert '${name}'. ${outcome}`);
          } else {
            console.log(`Alert '${name}' test did not fire.`);
          }
          break;
        }
        console.error(`Unknown alerts subcommand: ${sub}`);
        printUsage();
        agent.close();
        process.exit(1);
        break;
      }

      case 'version': {
        console.log(`${PACKAGE_NAME} ${VERSION}`);
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
      }
    }
  } catch (err: unknown) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Run CLI main() only when this file is executed directly (bin or `node dist/index.js`).
// Prevents side effects (e.g. printing help) when the module is imported (tests, `require`/`import`).
const isMain = (() => {
  try {
    const invoked = process.argv[1];
    if (!invoked) return false;
    const thisFile = fileURLToPath(import.meta.url);
    // Normalize for cross-platform (esp. Windows backslashes)
    return invoked === thisFile || invoked.replace(/\\/g, '/') === thisFile.replace(/\\/g, '/');
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { main };
