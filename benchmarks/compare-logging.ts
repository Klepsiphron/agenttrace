/**
 * Compare AgentTrace storage/query vs raw logging approaches:
 *  - console.log (structured)
 *  - JSONL file append (./logs/*.jsonl)
 *  - AgentTrace (SQLite + indexes + getTraces API)
 *
 * Dimensions:
 *  - Write throughput (traces / records per second)
 *  - Query capability & speed (on common filters)
 *  - Storage efficiency (bytes per record on disk)
 *
 * Run:
 *   node --experimental-strip-types benchmarks/compare-logging.ts
 *
 * Outputs structured JSON + summary. Feeds RESULTS.md.
 */

import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { AgentTrace, TraceStorage } from '../packages/sdk/dist/index.js';
import type { Trace } from '../packages/sdk/dist/types.js';

interface LogRecord {
  id: string;
  ts: number;
  name: string;
  status: 'success' | 'error';
  latencyMs: number;
  costUsd: number;
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number; model?: string };
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

interface CompareResult {
  timestamp: string;
  nodeVersion: string;
  n: number;
  write: {
    agenttrace: { timeMs: number; perSecond: number };
    jsonl: { timeMs: number; perSecond: number; fileSizeBytes: number };
    console: { timeMs: number; perSecond: number };
  };
  storage: {
    agenttrace: { dbSizeBytes: number; kbPerRecord: number };
    jsonl: { fileSizeBytes: number; kbPerRecord: number };
    ratio: string; // jsonl:agenttrace size ratio
  };
  query: Array<{
    name: string;
    agenttraceMs: number;
    jsonlScanMs: number;
    agenttraceCount: number;
    jsonlCount: number;
    speedup: string;
  }>;
  notes: string[];
}

function makeTemp(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

function makeRecord(i: number, base: number): LogRecord {
  const isErr = i % 18 === 0;
  const model = ['gpt-4o-mini', 'claude-sonnet-4', 'gemini-2.0-flash'][i % 3];
  const pt = 60 + (i % 140);
  const ct = 25 + (i % 70);
  return {
    id: `log-${base}-${i}`,
    ts: base + i,
    name: `step-${i % 22}`,
    status: isErr ? 'error' : 'success',
    latencyMs: 12 + (i % 520),
    costUsd: Math.round(((pt * 0.00015 + ct * 0.0006) / 1000) * 1e6) / 1e6,
    tokens: { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct, model },
    input: i % 2 ? { prompt: `p${i}` } : undefined,
    output: isErr ? { error: 'fail' } : { res: i },
    metadata: { i: i % 50, tag: `t${i % 7}` },
  };
}

function recordToTrace(r: LogRecord, runId: string): Omit<Trace, 'createdAt' | 'updatedAt'> {
  return {
    id: r.id,
    runId,
    name: r.name,
    status: r.status === 'error' ? 'error' : 'success',
    input: r.input ?? null,
    output: r.output ?? null,
    tokens: r.tokens,
    toolCalls: [],
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
    error: r.status === 'error' ? 'fail' : undefined,
    metadata: r.metadata || {},
    parentId: undefined,
  };
}

// Realistic "console" write simulation using /dev/null (linux). Measures formatting + kernel write cost
// without flooding the terminal or relying on mutable stdout.
function benchConsoleWrite(records: LogRecord[]): { timeMs: number; perSecond: number } {
  const nullFd = fs.openSync('/dev/null', 'w');
  const t0 = performance.now();
  for (const r of records) {
    const line = JSON.stringify({ level: 'info', ...r }) + '\n';
    fs.writeSync(nullFd, line);
  }
  const dur = performance.now() - t0;
  fs.closeSync(nullFd);
  return {
    timeMs: Math.round(dur * 100) / 100,
    perSecond: Math.round(records.length / (dur / 1000)),
  };
}

function benchJsonlWrite(
  records: LogRecord[],
  logPath: string,
): { timeMs: number; perSecond: number; fileSizeBytes: number } {
  // ensure clean
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  const t0 = performance.now();
  for (const r of records) {
    fs.appendFileSync(logPath, JSON.stringify(r) + '\n', 'utf8');
  }
  const dur = performance.now() - t0;
  const size = fs.statSync(logPath).size;
  return {
    timeMs: Math.round(dur * 100) / 100,
    perSecond: Math.round(records.length / (dur / 1000)),
    fileSizeBytes: size,
  };
}

async function benchAgentTraceWrite(
  records: LogRecord[],
  dbPath: string,
): Promise<{ timeMs: number; perSecond: number }> {
  const agent = new AgentTrace({ dbPath, silent: true, autoCleanup: false });
  const runId = agent.startRun('compare-bench');
  const storage = (agent as unknown as { storage: TraceStorage }).storage;
  const t0 = performance.now();
  for (const r of records) {
    storage.createTrace(recordToTrace(r, runId));
  }
  const dur = performance.now() - t0;
  agent.close();
  return {
    timeMs: Math.round(dur * 100) / 100,
    perSecond: Math.round(records.length / (dur / 1000)),
  };
}

function loadJsonl(logPath: string): LogRecord[] {
  const content = fs.readFileSync(logPath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogRecord);
}

function jsonlFilter(recs: LogRecord[], predicate: (r: LogRecord) => boolean): LogRecord[] {
  return recs.filter(predicate);
}

async function benchQueries(n: number): Promise<
  Array<{
    name: string;
    agenttraceMs: number;
    jsonlScanMs: number;
    agenttraceCount: number;
    jsonlCount: number;
    speedup: string;
  }>
> {
  const base = Date.now() - n * 2;
  const records = Array.from({ length: n }, (_, i) => makeRecord(i, base));

  const tmp = makeTemp('compare-query');
  const jsonlPath = path.join(tmp.dir, 'bench.jsonl');
  const dbPath = path.join(tmp.dir, 'bench.db');

  // write both
  benchJsonlWrite(records, jsonlPath);
  await benchAgentTraceWrite(records, dbPath);

  const jsonlRecs = loadJsonl(jsonlPath);
  const agent = new AgentTrace({ dbPath, silent: true, autoCleanup: false });

  const results: any[] = [];

  // Query 1: errors
  let t0 = performance.now();
  const atErr = agent.getTraces({ status: ['error'] });
  const atErrMs = Math.round((performance.now() - t0) * 100) / 100;

  t0 = performance.now();
  const jlErr = jsonlFilter(jsonlRecs, (r) => r.status === 'error');
  const jlErrMs = Math.round((performance.now() - t0) * 100) / 100;

  results.push({
    name: 'errors',
    agenttraceMs: atErrMs,
    jsonlScanMs: jlErrMs,
    agenttraceCount: atErr.length,
    jsonlCount: jlErr.length,
    speedup: (jlErrMs / Math.max(0.001, atErrMs)).toFixed(1) + 'x',
  });

  // Query 2: high cost
  t0 = performance.now();
  const atCost = agent.getTraces({ minCost: 0.0001 });
  const atCostMs = Math.round((performance.now() - t0) * 100) / 100;

  t0 = performance.now();
  const jlCost = jsonlFilter(jsonlRecs, (r) => (r.costUsd || 0) >= 0.0001);
  const jlCostMs = Math.round((performance.now() - t0) * 100) / 100;

  results.push({
    name: 'minCost>=0.0001',
    agenttraceMs: atCostMs,
    jsonlScanMs: jlCostMs,
    agenttraceCount: atCost.length,
    jsonlCount: jlCost.length,
    speedup: (jlCostMs / Math.max(0.001, atCostMs)).toFixed(1) + 'x',
  });

  // Query 3: name prefix + success
  t0 = performance.now();
  const atName = agent.getTraces({ name: 'step-1', status: ['success'] });
  const atNameMs = Math.round((performance.now() - t0) * 100) / 100;

  t0 = performance.now();
  const jlName = jsonlFilter(jsonlRecs, (r) => r.name.includes('step-1') && r.status === 'success');
  const jlNameMs = Math.round((performance.now() - t0) * 100) / 100;

  results.push({
    name: 'name~step-1 + success',
    agenttraceMs: atNameMs,
    jsonlScanMs: jlNameMs,
    agenttraceCount: atName.length,
    jsonlCount: jlName.length,
    speedup: (jlNameMs / Math.max(0.001, atNameMs)).toFixed(1) + 'x',
  });

  // Query 4: latency range
  t0 = performance.now();
  const atLat = agent.getTraces({ minLatency: 200, maxLatency: 400 });
  const atLatMs = Math.round((performance.now() - t0) * 100) / 100;

  t0 = performance.now();
  const jlLat = jsonlFilter(jsonlRecs, (r) => r.latencyMs >= 200 && r.latencyMs <= 400);
  const jlLatMs = Math.round((performance.now() - t0) * 100) / 100;

  results.push({
    name: 'latency 200-400ms',
    agenttraceMs: atLatMs,
    jsonlScanMs: jlLatMs,
    agenttraceCount: atLat.length,
    jsonlCount: jlLat.length,
    speedup: (jlLatMs / Math.max(0.001, atLatMs)).toFixed(1) + 'x',
  });

  agent.close();
  tmp.cleanup();
  return results;
}

function getDbSize(dbPath: string): number {
  try {
    let sz = fs.statSync(dbPath).size;
    try {
      sz += fs.statSync(dbPath + '-wal').size;
    } catch {}
    try {
      sz += fs.statSync(dbPath + '-shm').size;
    } catch {}
    return sz;
  } catch {
    return 0;
  }
}

export async function runCompareBenchmarks(n = 10000): Promise<CompareResult> {
  console.log(`Running logging comparison benchmark (n=${n})...`);

  const base = Date.now() - n * 2;
  const records = Array.from({ length: n }, (_, i) => makeRecord(i, base));

  // WRITE phase
  const tmp = makeTemp('compare-write');
  const jsonlPath = path.join(tmp.dir, 'compare.jsonl');
  const dbPath = path.join(tmp.dir, 'compare.db');

  const consoleRes = benchConsoleWrite(records);
  console.log(`  console (blackhole): ${consoleRes.perSecond} writes/s`);

  const jsonlRes = benchJsonlWrite(records, jsonlPath);
  console.log(`  jsonl append:        ${jsonlRes.perSecond} writes/s`);

  const atWrite = await benchAgentTraceWrite(records, dbPath);
  console.log(`  AgentTrace storage:  ${atWrite.perSecond} writes/s`);

  // STORAGE sizes
  const jsonlSize = jsonlRes.fileSizeBytes;
  const dbSize = getDbSize(dbPath);
  const jsonlKB = Math.round((jsonlSize / 1024) * 100) / 100;
  const dbKB = Math.round((dbSize / 1024) * 100) / 100;
  const ratio = (jsonlSize / Math.max(1, dbSize)).toFixed(1) + 'x';
  console.log(`  Storage: JSONL=${jsonlKB}KB, AgentTrace=${dbKB}KB (JSONL is ${ratio} larger)`);

  // QUERY phase (fresh load for fairness)
  const queryResults = await benchQueries(n);
  console.log(
    `  Query comparisons: ${queryResults.length} scenarios (full scans for JSONL vs indexed for AgentTrace)`,
  );

  // cleanup after sizes captured
  tmp.cleanup();

  const result: CompareResult = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    n,
    write: {
      agenttrace: { timeMs: atWrite.timeMs, perSecond: atWrite.perSecond },
      jsonl: { timeMs: jsonlRes.timeMs, perSecond: jsonlRes.perSecond, fileSizeBytes: jsonlSize },
      console: { timeMs: consoleRes.timeMs, perSecond: consoleRes.perSecond },
    },
    storage: {
      agenttrace: {
        dbSizeBytes: dbSize,
        kbPerRecord: Math.round((dbSize / 1024 / n) * 1000) / 1000,
      },
      jsonl: {
        fileSizeBytes: jsonlSize,
        kbPerRecord: Math.round((jsonlSize / 1024 / n) * 1000) / 1000,
      },
      ratio,
    },
    query: queryResults,
    notes: [
      'console: measured via writeSync to /dev/null (formatting + write cost, no terminal spam)',
      'jsonl: uses fs.appendFileSync per record (realistic for simple logging)',
      'AgentTrace: uses direct storage.createTrace (bypasses trace() wrapper for raw rate)',
      'JSONL queries are full in-memory scans after loading entire file',
      'AgentTrace queries use SQLite indexes on status, cost, latency, name, run_id etc.',
      'DB size includes WAL journal (typical for WAL mode); JSONL is pure text',
    ],
  };

  return result;
}

function isMain(): boolean {
  try {
    if (!process.argv[1]) return false;
    const thisFile = new URL(import.meta.url).pathname;
    const invoked = process.argv[1];
    return invoked === thisFile || invoked.replace(/\\/g, '/') === thisFile.replace(/\\/g, '/');
  } catch {
    return false;
  }
}

async function main() {
  try {
    const res = await runCompareBenchmarks(10000);
    console.log('\n=== COMPARE LOGGING JSON ===');
    console.log(JSON.stringify(res, null, 2));
  } catch (err: unknown) {
    console.error('Compare benchmark failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (isMain()) {
  main();
}
