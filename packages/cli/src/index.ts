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
  type TraceTreeNode,
  type AgentUsageRecord,
  type AgentWho,
  type AgentSession,
  type AgentUsageFilter,
  AlertCondition,
  ExportFormat,
  TraceStorage,
} from '@agenttrace-io/sdk';
import { startDashboard } from '@agenttrace-io/dashboard';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';

/** Published npm package name. */
export const PACKAGE_NAME = '@agenttrace-io/cli';

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

function printTraceTree(node: TraceTreeNode | null | undefined, prefix = '', isLast = true): void {
  if (!node || !node.trace) return;
  const t = node.trace;
  const branch = prefix + (isLast ? '└── ' : '├── ');
  const status = colorizeStatus(t.status || '');
  const shortId = (t.id || '').substring(0, 8);
  console.log(
    `${branch}${shortId} ${t.name || ''} ${status} ${t.latencyMs ?? 0}ms $${((t.costUsd ?? 0) as number).toFixed(4)}`,
  );
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  const children = (node.children || []) as TraceTreeNode[];
  children.forEach((child, idx) => {
    const lastChild = idx === children.length - 1;
    printTraceTree(child, childPrefix, lastChild);
  });
}

function printUsage(): void {
  console.log(`Usage: agenttrace-io <command> [options]  (alias: agenttrace)

Commands:
  init                 Create empty agenttrace.db in current dir
  dashboard            Start the local dashboard server
  runs                 List recent runs (most recent first)
  traces               List traces (most recent first)
  stats                Show summary statistics
  costs                Show cost breakdown by model (or --daily)
  export               Export traces to JSON or CSV
  benchmark            Run performance benchmark suite (prints JSON results)
  tree                 Show parent/child/related trace tree (multi-agent)
  alerts               Manage alerts: list | test --name N | history
  health               Check health of gateway, dashboard, and database
  self-stats           Show OWL/Hermes self-tracked usage (today, week, top actions, costs, sessions)
  who                  Show active agents (usage tracking)
  cost                 Show agent cost breakdown (periods + by agent/model)
  sessions             List agent sessions with aggregates
  activity             Show recent agent activity timeline
  cleanup              Manually run data retention cleanup (deletes expired traces, runs, usage)
  retention            Manage data retention policy: show | set <days> [--interval H]
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
  tree:
    --trace-id ID        Trace ID to display tree for (required)
  alerts:
    list                 List configured alerts
    test --name NAME     Test delivery for alert (forces condition + ignores cooldown)
    history              Show alert trigger history
  who:
    --active             Only agents active in last 30min
    --type TYPE          Filter by agent type
    --limit N            Max agents to show (default 50)
  cost:
    --from DATE          Start date (YYYY-MM-DD or ISO)
    --to DATE            End date (YYYY-MM-DD or ISO)
    --agent NAME         Filter to specific agent
    --format json|table  Output format (default: table)
  sessions:
    --agent NAME         Filter by agent name
    --active             Only sessions with recent activity (30min)
    --limit N            Max sessions (default 20)
  activity:
    --agent NAME         Filter by agent
    --type ACTION        Filter by action type
    --limit N            Max entries (default 30)
    --since DURATION     e.g. 1h, 30m, 2d (from now backwards)
  cleanup:
    --days N             Override retention days (default: use policy setting)
    --dry-run            Show what would be deleted without deleting
  retention:
    show                 Show current retention policy and storage stats
    set <days>           Set retention policy (days); optional --interval H

Global:
  --json               Emit machine-readable JSON (for runs, traces, stats, costs, export, self-stats)
  --help               Show this help

Examples:
  agenttrace-io init
  agenttrace-io runs --limit 5 --status success,running
  agenttrace-io traces --run-id 123e4567 --json
  agenttrace-io export --format csv --output out.csv --run-id abc
  agenttrace-io dashboard
  agenttrace-io costs
  agenttrace-io costs --daily --json
  agenttrace-io costs --run-id abc123
  agenttrace-io alerts list
  agenttrace-io alerts test --name high-error-rate
  agenttrace-io alerts history
  agenttrace-io tree --trace-id abc123def
  agenttrace-io self-stats
  agenttrace-io self-stats --json
  agenttrace-io who --active --limit 10
  agenttrace-io cost --format table
  agenttrace-io cost --agent researcher-1 --from 2026-01-01
  agenttrace-io sessions --active
  agenttrace-io activity --since 2h --limit 20
  agenttrace-io cleanup
  agenttrace-io cleanup --days 7 --dry-run
  agenttrace-io retention show
  agenttrace-io retention set 60
  agenttrace-io retention set 90 --interval 12
  npx agenttrace-io version
  # alias also works: npx agenttrace ...
`);
}

function isSelfTracked(t: Trace | Run): boolean {
  const meta = (t as Trace).metadata || (t as Run).metadata || {};
  return meta.selfTracked === true || (t as Trace).name?.startsWith?.('self:') === true;
}

function getDayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getWeekStart(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function printSelfStats(storage: TraceStorage, useJson: boolean): void {
  // Fetch recent data (no hard limit to include historical self usage)
  const runs = storage.getRuns(5000);
  const traces = storage.getTraces({ limit: 20000 });

  const selfRuns = runs.filter((r) => isSelfTracked(r));
  const selfTraces = traces.filter((t) => isSelfTracked(t));

  const now = Date.now();
  const todayStart = getDayStart(now);
  const weekStart = getWeekStart(now);

  const todayTraces = selfTraces.filter((t) => (t.createdAt || 0) >= todayStart);
  const weekTraces = selfTraces.filter((t) => (t.createdAt || 0) >= weekStart);

  // Today's summary
  const todayActions = todayTraces.length;
  const todayTokens = todayTraces.reduce((s, t) => s + (t.tokens?.totalTokens || 0), 0);
  const todayCost = todayTraces.reduce((s, t) => s + (t.costUsd || 0), 0);
  const todaySessions = new Set(todayTraces.map((t) => t.runId)).size;

  // Week summary
  const weekActions = weekTraces.length;
  const weekTokens = weekTraces.reduce((s, t) => s + (t.tokens?.totalTokens || 0), 0);
  const weekCost = weekTraces.reduce((s, t) => s + (t.costUsd || 0), 0);
  const weekSessions = new Set(weekTraces.map((t) => t.runId)).size;

  // Top actions by type (use actionType from meta or derive from name)
  const actionCounts: Record<string, number> = {};
  for (const t of selfTraces) {
    const meta = t.metadata || {};
    const at =
      (meta.actionType as string) ||
      (t.name || '').replace(/^self:/, '').split(':')[0] ||
      'unknown';
    actionCounts[at] = (actionCounts[at] || 0) + 1;
  }
  const topActions = Object.entries(actionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  // Cost breakdown (self only) - by day for recent
  const costByDay: Record<string, number> = {};
  for (const t of selfTraces) {
    if (!t.createdAt) continue;
    const day = new Date(t.createdAt).toISOString().slice(0, 10);
    costByDay[day] = (costByDay[day] || 0) + (t.costUsd || 0);
  }
  const totalSelfCost = Object.values(costByDay).reduce((s, v) => s + v, 0);

  // Active sessions
  const activeSessions = selfRuns.filter((r) => r.status === 'running').length;
  const activeSessionIds = selfRuns
    .filter((r) => r.status === 'running')
    .map((r) => (r.id || '').substring(0, 8));

  const summary = {
    today: {
      actions: todayActions,
      tokens: todayTokens,
      costUsd: Number(todayCost.toFixed(6)),
      sessions: todaySessions,
    },
    week: {
      actions: weekActions,
      tokens: weekTokens,
      costUsd: Number(weekCost.toFixed(6)),
      sessions: weekSessions,
    },
    topActions,
    costBreakdown: {
      totalCostUsd: Number(totalSelfCost.toFixed(6)),
      costByDay,
    },
    activeSessions,
    activeSessionIds,
    totalSelfTraces: selfTraces.length,
    totalSelfRuns: selfRuns.length,
  };

  if (useJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('AgentTrace Self-Tracking Stats (OWL / Hermes)');
  console.log('==============================================');
  console.log('');
  console.log("Today's Activity:");
  console.log(`  Actions:  ${summary.today.actions}`);
  console.log(`  Tokens:   ${summary.today.tokens}`);
  console.log(`  Cost:     $${summary.today.costUsd}`);
  console.log(`  Sessions: ${summary.today.sessions}`);
  console.log('');
  console.log('This Week:');
  console.log(`  Actions:  ${summary.week.actions}`);
  console.log(`  Tokens:   ${summary.week.tokens}`);
  console.log(`  Cost:     $${summary.week.costUsd}`);
  console.log(`  Sessions: ${summary.week.sessions}`);
  console.log('');
  if (topActions.length > 0) {
    console.log('Top Actions by Type:');
    for (const a of topActions.slice(0, 5)) {
      console.log(`  ${a.type}: ${a.count}`);
    }
    console.log('');
  }
  console.log('Cost Breakdown (self-tracked):');
  console.log(`  Total: $${summary.costBreakdown.totalCostUsd}`);
  const sortedDays = Object.keys(costByDay).sort();
  if (sortedDays.length > 0) {
    for (const d of sortedDays.slice(-7)) {
      const c = costByDay[d] ?? 0;
      console.log(`  ${d}: $${c.toFixed(6)}`);
    }
  }
  console.log('');
  console.log(
    `Active Sessions: ${activeSessions}${activeSessionIds.length ? ' (' + activeSessionIds.join(', ') + ')' : ''}`,
  );
  if (summary.totalSelfTraces === 0) {
    console.log('\n(No self-tracked data yet. Use SelfTracker in your agent to record actions.)');
  }
}

// ---- Agent usage CLI helpers (who, cost, sessions, activity) ----

function parseSinceDuration(s: string | boolean | undefined): number | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const m = s.trim().match(/^(\d+)([smhd])$/i);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = m[2]!.toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return Date.now() - n * mult;
}

function parseDateInput(d: string | boolean | undefined): number | undefined {
  if (!d || typeof d !== 'string') return undefined;
  const t = Date.parse(d);
  if (Number.isFinite(t)) return t;
  return undefined;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s}s`;
}

function formatDateShort(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
}

function getModelFromRec(r: AgentUsageRecord): string {
  const meta = r.metadata || {};
  const m = (meta as Record<string, unknown>).model;
  return typeof m === 'string' ? m : 'unknown';
}

function computeAgentCostBreakdown(recs: AgentUsageRecord[]): {
  totalCostUsd: number;
  costByAgent: Record<string, number>;
  costByModel: Record<string, number>;
} {
  let total = 0;
  const byAgent: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const r of recs) {
    const c = r.costUsd || 0;
    total += c;
    byAgent[r.agentName] = (byAgent[r.agentName] || 0) + c;
    const mod = getModelFromRec(r);
    byModel[mod] = (byModel[mod] || 0) + c;
  }
  return { totalCostUsd: total, costByAgent: byAgent, costByModel: byModel };
}

function getPeriodStarts(): { today: number; week: number; month: number; all: number } {
  const now = Date.now();
  const dToday = new Date(now);
  dToday.setHours(0, 0, 0, 0);
  const today = dToday.getTime();

  // week start (monday) reuse logic similar to self-stats
  const dWeek = new Date(now);
  const day = dWeek.getDay();
  const diff = dWeek.getDate() - day + (day === 0 ? -6 : 1);
  dWeek.setDate(diff);
  dWeek.setHours(0, 0, 0, 0);
  const week = dWeek.getTime();

  const dMonth = new Date(now);
  dMonth.setDate(1);
  dMonth.setHours(0, 0, 0, 0);
  const month = dMonth.getTime();

  return { today, week, month, all: 0 };
}

function printAgentCostSection(title: string, bd: ReturnType<typeof computeAgentCostBreakdown>): void {
  console.log(title);
  console.log('='.repeat(title.length));
  console.log(`Total: $${bd.totalCostUsd.toFixed(4)}`);
  // by agent
  const agents = Object.entries(bd.costByAgent).sort(([, a], [, b]) => b - a);
  if (agents.length > 0) {
    console.log('By Agent:');
    for (const [name, c] of agents.slice(0, 10)) {
      console.log(`  ${name}: $${c.toFixed(4)}`);
    }
  }
  // by model
  const models = Object.entries(bd.costByModel).sort(([, a], [, b]) => b - a);
  if (models.length > 0) {
    console.log('By Model:');
    for (const [m, c] of models.slice(0, 10)) {
      console.log(`  ${m}: $${c.toFixed(4)}`);
    }
  }
  console.log('');
}

function printWhoTable(who: AgentWho[]): void {
  const headers = ['Agent', 'Type', 'Session', 'Last Action', 'Actions', 'Tokens', 'Cost'];
  const rows = who.map((w) => [
    w.agentName,
    w.agentType || '',
    w.sessionId ? w.sessionId.substring(0, 8) : '',
    w.lastAction,
    String(w.actions),
    String(w.tokens),
    (w.costUsd || 0).toFixed(4),
  ]);
  printTable(headers, rows);
}

function printSessionsTable(sessions: AgentSession[]): void {
  const headers = ['Session ID', 'Agent', 'Started', 'Duration', 'Actions', 'Tokens', 'Cost', 'Status'];
  const rows = sessions.map((s) => [
    s.sessionId.substring(0, 12),
    s.agentName,
    formatDateShort(s.startedAt),
    formatDuration(s.durationMs),
    String(s.actions),
    String(s.tokens),
    (s.costUsd || 0).toFixed(4),
    colorizeStatus(s.status),
  ]);
  printTable(headers, rows);
}

function printActivityTimeline(recs: AgentUsageRecord[]): void {
  if (recs.length === 0) {
    console.log('No activity found.');
    return;
  }
  const headers = ['Time', 'Agent', 'Action', 'Tokens', 'Cost', 'Status'];
  const rows = recs.map((r) => [
    formatDateShort(r.createdAt),
    r.agentName,
    r.action + (r.target ? `:${r.target}` : ''),
    String(r.tokensUsed || 0),
    (r.costUsd || 0).toFixed(4),
    colorizeStatus(r.status),
  ]);
  printTable(headers, rows);
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
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      flags[key] = val;
    } else {
      const key = arg.slice(2);
      const next = args[i + 1];
      const val: string | boolean =
        i + 1 < args.length && typeof next === 'string' && !next.startsWith('-')
          ? (i++, next)
          : true;
      flags[key] = val;
    }
  }
  return { command, flags };
}

function getAgentTrace(requireDb = true): AgentTrace {
  const dbp = getDbPath();
  if (requireDb && !existsSync(dbp)) {
    console.error(`No ${dbp} found in current directory.`);
    console.error('Run "agenttrace-io init" to create one.');
    process.exit(1);
  }
  return new AgentTrace({ dbPath: dbp, silent: true });
}

async function runMain(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  if (flags.help || command === 'help') {
    printUsage();
    return;
  }

  const useJson = !!flags.json;

  // detect subcommand for alerts (e.g. alerts list, alerts test)
  const alertsSub: string | undefined = (() => {
    if (command !== 'alerts') return undefined;
    const argvArgs = process.argv.slice(2);
    const idx = argvArgs.indexOf('alerts');
    if (idx === -1) return undefined;
    for (let k = idx + 1; k < argvArgs.length; k++) {
      const c = argvArgs[k];
      if (typeof c === 'string' && !c.startsWith('-')) {
        return c;
      }
    }
    return undefined;
  })();

  // detect subcommand for retention (e.g. retention show, retention set <days>)
  const retentionSub: string | undefined = (() => {
    if (command !== 'retention') return undefined;
    const argvArgs = process.argv.slice(2);
    const idx = argvArgs.indexOf('retention');
    if (idx === -1) return undefined;
    for (let k = idx + 1; k < argvArgs.length; k++) {
      const c = argvArgs[k];
      if (typeof c === 'string' && !c.startsWith('-')) {
        return c;
      }
    }
    return undefined;
  })();

  // For 'retention set <days>', capture the days positional arg
  const retentionSetDays: string | undefined = (() => {
    if (command !== 'retention') return undefined;
    if (retentionSub !== 'set') return undefined;
    const argvArgs = process.argv.slice(2);
    const idx = argvArgs.indexOf('retention');
    if (idx === -1) return undefined;
    // Find the subcommand index first
    let subIdx = -1;
    for (let k = idx + 1; k < argvArgs.length; k++) {
      const c = argvArgs[k];
      if (typeof c === 'string' && !c.startsWith('-')) {
        subIdx = k;
        break;
      }
    }
    if (subIdx === -1 || subIdx + 1 >= argvArgs.length) return undefined;
    // Next non-flag arg after subcommand is the days value
    const next = argvArgs[subIdx + 1];
    if (typeof next === 'string' && !next.startsWith('-')) {
      return next;
    }
    return undefined;
  })();

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
      const allRuns = trace.getRuns(Math.max(1, Math.min(1000, lim)));

      const statusRaw = flags.status ? String(flags.status) : '';
      const runs = statusRaw
        ? (() => {
            const allowed = statusRaw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            return allowed.length ? allRuns.filter((r) => allowed.includes(r.status)) : allRuns;
          })()
        : allRuns;

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

    case 'tree': {
      const traceId = (flags['trace-id'] || flags.traceId || flags['traceId']) as
        | string
        | undefined;
      if (!traceId) {
        console.error('Usage: agenttrace-io tree --trace-id <id>');
        process.exit(1);
      }
      const tr = getAgentTrace();
      const tree: TraceTreeNode = (() => {
        try {
          return tr.getTraceTree(String(traceId));
        } catch (e: unknown) {
          console.error('Error:', e instanceof Error ? e.message : String(e));
          tr.close();
          process.exit(1);
        }
      })();
      tr.close();

      if (useJson) {
        console.log(JSON.stringify(tree, null, 2));
      } else if (!tree || !tree.trace) {
        console.log('Trace not found.');
      } else {
        console.log('Trace Tree:');
        printTraceTree(tree);
      }
      break;
    }

    case 'alerts': {
      const sub = alertsSub || 'list';
      const dbp = getDbPath();
      const dbExists = existsSync(dbp);
      if (!dbExists && (sub === 'test' || sub === 'history')) {
        console.error(`No ${dbp} found in current directory.`);
        console.error('Run "agenttrace-io init" to create one.');
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
            const last = a.lastTriggered
              ? new Date(a.lastTriggered).toISOString().slice(0, 19)
              : 'never';
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
        const name = flags.name || flags['name'] ? String(flags.name || flags['name']) : '';
        if (!name) {
          console.error('Usage: agenttrace-io alerts test --name <name>');
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

    case 'health': {
      const dbp = getDbPath();
      const useJsonLocal = useJson;
      const GREEN = '\x1b[32m';
      const RED = '\x1b[31m';
      const YELLOW = '\x1b[33m';
      const RESET = '\x1b[0m';

      const checks: Record<string, unknown> = {};

      // Database check (always; creates empty db if absent like init)
      let dbOk = false;
      let dbTraceCount = 0;
      let dbSize = 0;
      let dbIntegrity: { tablesExist: boolean; noOrphans: boolean; details?: string } | undefined;
      try {
        const tr = new AgentTrace({ dbPath: dbp, silent: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h: any = tr.getHealth();
        tr.close();
        dbOk = h.status === 'ok';
        dbTraceCount = h.traceCount;
        dbSize = h.dbSize;
        dbIntegrity = h.integrity;
        checks.database = {
          ok: dbOk,
          dbPath: dbp,
          traceCount: dbTraceCount,
          dbSize,
          integrity: dbIntegrity,
        };
      } catch (e: unknown) {
        checks.database = { ok: false, dbPath: dbp, error: String(e) };
      }

      // Dashboard check (local default)
      let dashOk = false;
      const dashPort = 4317;
      const dashUrl = `http://127.0.0.1:${dashPort}/api/health`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const resp = await fetch(dashUrl, { signal: controller.signal, method: 'GET' });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = (await resp.json()) as { status?: string };
          dashOk = data && data.status === 'ok';
        }
      } catch (_) {
        // not reachable
      }
      checks.dashboard = { ok: dashOk, url: dashUrl };

      // Gateway: treat as core data access (db/sdk layer)
      const gatewayOk = dbOk;
      checks.gateway = { ok: gatewayOk };

      const overallOk = gatewayOk && dbOk;

      if (useJsonLocal) {
        console.log(
          JSON.stringify(
            {
              status: overallOk ? 'ok' : 'degraded',
              checks,
            },
            null,
            2,
          ),
        );
      } else {
        console.log('AgentTrace Health');
        console.log('=================');
        const gStr = gatewayOk ? `${GREEN}ok${RESET}` : `${RED}fail${RESET}`;
        console.log(`gateway:   ${gStr}`);
        const dStr = dashOk ? `${GREEN}ok${RESET}` : `${YELLOW}not running${RESET}`;
        console.log(`dashboard: ${dStr} (${dashUrl})`);
        const dbStr = dbOk ? `${GREEN}ok${RESET}` : `${RED}fail${RESET}`;
        const extra = dbOk ? ` (traces=${dbTraceCount}, size=${dbSize}B)` : '';
        console.log(`database:  ${dbStr} (${dbp})${extra}`);
        if (dbOk && dbIntegrity && (!dbIntegrity.tablesExist || !dbIntegrity.noOrphans)) {
          console.log(
            `  ${YELLOW}integrity: tablesExist=${dbIntegrity.tablesExist}, noOrphans=${dbIntegrity.noOrphans}${dbIntegrity.details ? ' ' + dbIntegrity.details : ''}${RESET}`,
          );
        }
      }

      if (!overallOk) {
        process.exit(1);
      }
      break;
    }

    case 'version': {
      console.log(`${PACKAGE_NAME} ${VERSION}`);
      break;
    }

    case 'self-stats': {
      const dbp = getDbPath();
      // self-stats creates db on demand (no error if missing; will just show zeros)
      const storage = new TraceStorage(dbp);
      try {
        printSelfStats(storage, useJson);
      } finally {
        storage.close();
      }
      break;
    }

    case 'who': {
      const dbp = getDbPath();
      const storage = new TraceStorage(dbp);
      try {
        const activeOnly = !!flags.active;
        const typeF = flags.type ? String(flags.type) : undefined;
        const rawLim = flags.limit ? parseInt(String(flags.limit), 10) : NaN;
        const lim = Number.isFinite(rawLim) && rawLim > 0 ? rawLim : 50;
        const who = storage.getAgentWho({ activeOnly, agentType: typeF, limit: lim });
        if (useJson) {
          console.log(JSON.stringify(who, null, 2));
        } else if (who.length === 0) {
          console.log('No agents found.');
        } else {
          printWhoTable(who);
        }
      } finally {
        storage.close();
      }
      break;
    }

    case 'cost': {
      const dbp = getDbPath();
      const storage = new TraceStorage(dbp);
      try {
        const agentF = flags.agent ? String(flags.agent) : undefined;
        const from = parseDateInput(flags.from);
        const to = parseDateInput(flags.to);
        const fmt = (flags.format ? String(flags.format) : 'table').toLowerCase();
        const isJson = fmt === 'json' || useJson;

        const allRecs = storage.getAgentUsage({
          agentName: agentF,
          limit: 50000,
        });

        if (from || to) {
          const filtered = allRecs.filter((r) => {
            if (from && r.createdAt < from) return false;
            if (to && r.createdAt > to) return false;
            return true;
          });
          const bd = computeAgentCostBreakdown(filtered);
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  range: { from: from ? new Date(from).toISOString() : null, to: to ? new Date(to).toISOString() : null },
                  agent: agentF || null,
                  ...bd,
                },
                null,
                2,
              ),
            );
          } else {
            const title = `Agent Cost Breakdown (custom range)${agentF ? ` for ${agentF}` : ''}`;
            printAgentCostSection(title, bd);
          }
        } else {
          // show 4 periods + breakdowns
          const periods = getPeriodStarts();
          const todayRecs = allRecs.filter((r) => r.createdAt >= periods.today);
          const weekRecs = allRecs.filter((r) => r.createdAt >= periods.week);
          const monthRecs = allRecs.filter((r) => r.createdAt >= periods.month);
          const allBd = computeAgentCostBreakdown(allRecs);
          const todayBd = computeAgentCostBreakdown(todayRecs);
          const weekBd = computeAgentCostBreakdown(weekRecs);
          const monthBd = computeAgentCostBreakdown(monthRecs);

          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  agent: agentF || null,
                  today: todayBd,
                  week: weekBd,
                  month: monthBd,
                  allTime: allBd,
                },
                null,
                2,
              ),
            );
          } else {
            console.log('Agent Cost Breakdown');
            console.log('====================');
            if (agentF) console.log(`Filter: agent=${agentF}`);
            console.log('');
            printAgentCostSection('Today', todayBd);
            printAgentCostSection('This Week', weekBd);
            printAgentCostSection('This Month', monthBd);
            printAgentCostSection('All Time', allBd);
          }
        }
      } finally {
        storage.close();
      }
      break;
    }

    case 'sessions': {
      const dbp = getDbPath();
      const storage = new TraceStorage(dbp);
      try {
        const agentF = flags.agent ? String(flags.agent) : undefined;
        const activeOnly = !!flags.active;
        const rawLim = flags.limit ? parseInt(String(flags.limit), 10) : NaN;
        const lim = Number.isFinite(rawLim) && rawLim > 0 ? rawLim : 20;
        const sessions = storage.getAgentSessions({ agentName: agentF, activeOnly, limit: lim });
        if (useJson) {
          console.log(JSON.stringify(sessions, null, 2));
        } else if (sessions.length === 0) {
          console.log('No sessions found.');
        } else {
          printSessionsTable(sessions);
        }
      } finally {
        storage.close();
      }
      break;
    }

    case 'activity': {
      const dbp = getDbPath();
      const storage = new TraceStorage(dbp);
      try {
        const agentF = flags.agent ? String(flags.agent) : undefined;
        const actionF = flags.type ? String(flags.type) : undefined; // --type means action
        const rawLim = flags.limit ? parseInt(String(flags.limit), 10) : NaN;
        const lim = Number.isFinite(rawLim) && rawLim > 0 ? rawLim : 30;
        const sinceFrom = parseSinceDuration(flags.since);
        const f: Record<string, unknown> = { limit: lim };
        if (agentF) f.agentName = agentF;
        if (actionF) f.action = actionF;
        if (sinceFrom) f.fromDate = sinceFrom;
        const recs = storage.getAgentUsage(f as AgentUsageFilter);
        // recs are newest-first; for "chronological" we keep that order (recent activity first is conventional)
        if (useJson) {
          console.log(JSON.stringify(recs, null, 2));
        } else if (recs.length === 0) {
          console.log('No activity found.');
        } else {
          printActivityTimeline(recs);
        }
      } finally {
        storage.close();
      }
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }
  }
}

function main(): void {
  try {
    const result = runMain();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<void>).catch((err: unknown) => {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
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
  } catch (_) {
    /* ignore */
    return false;
  }
})();

if (isMain) {
  main();
}

export { main };
