/**
 * AgentTrace Benchmark Suite (root)
 * Benchmarks AgentTrace performance vs raw logging baseline (see compare-logging.ts)
 *
 * Run:
 *   node --experimental-strip-types benchmarks/trace-benchmark.ts
 *
 * Requires built SDK (packages/sdk/dist). Run `pnpm --filter @agenttrace-io/sdk build` if dist missing.
 *
 * Outputs JSON results + human summary. Also used to populate RESULTS.md.
 */

import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { AgentTrace, TraceStorage } from '../packages/sdk/dist/index.js';
import type { Trace, AgentUsageRecord, TraceFilter } from '../packages/sdk/dist/types.js';

export interface TraceBenchmarkResult {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  config: {
    traceCount: number;
    queryDatasetSize: number;
  };
  insertion: {
    viaTraceAPI: { count: number; timeMs: number; tracesPerSecond: number };
    viaStorage: { count: number; timeMs: number; tracesPerSecond: number };
  };
  queries: Array<{
    name: string;
    filter: TraceFilter;
    count: number;
    timeMs: number;
  }>;
  stats: {
    timeMs: number;
    result: { totalTraces: number; totalCostUsd: number };
  };
  agentUsage: {
    count: number;
    timeMs: number;
    recordsPerSecond: number;
  };
  memory: {
    datasetSize: number;
    before: { rssMB: number; heapUsedMB: number };
    after10k: { rssMB: number; heapUsedMB: number };
    deltaMB: { rss: number; heap: number };
    mbPerTrace: number;
  };
  dbSize: {
    datasetSize: number;
    dbPath: string;
    sizeBytes: number;
    sizeKB: number;
    kbPerTrace: number;
  };
}

function makeTempDb(prefix = 'agenttrace-bench'): { dbPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const dbPath = path.join(dir, 'bench.db');
  return {
    dbPath,
    cleanup: () => {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        // also wal/shm
        ['-wal', '-shm'].forEach((ext) => {
          const f = dbPath + ext;
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
    },
  };
}

function makeTraceData(i: number, runId: string, baseTime: number): Omit<Trace, 'createdAt' | 'updatedAt'> {
  const models = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'gemini-2.0-flash'] as const;
  const model = models[i % models.length];
  const isError = i % 20 === 0;
  const status: Trace['status'] = isError ? 'error' : 'success';
  const promptTokens = 80 + (i % 180);
  const completionTokens = 30 + (i % 90);
  const latencyMs = 15 + (i % 480);
  const costUsd = (promptTokens * 0.0015 + completionTokens * 0.002) / 1000;

  const hasTools = i % 5 === 0;
  const toolCalls = hasTools
    ? [
        {
          id: `tool-${i}`,
          name: i % 3 === 0 ? 'web_search' : 'calculator',
          input: { query: `q${i}` },
          output: { result: `r${i}` },
          latencyMs: 4 + (i % 12),
          success: true,
          timestamp: baseTime + i,
        },
      ]
    : [];

  return {
    id: `bench-${baseTime}-${i}`,
    runId,
    name: `op-${i % 28}`,
    status,
    input: i % 2 === 0 ? { prompt: `input for ${i}` } : null,
    output: isError ? null : i % 3 === 0 ? { value: i * 2 } : `output-${i}`,
    tokens: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model,
      provider: 'openai',
    },
    toolCalls,
    latencyMs,
    costUsd,
    error: isError ? 'simulated error for benchmark' : undefined,
    metadata: { iter: i, batch: Math.floor(i / 100), tag: `tag-${i % 12}` },
    parentId: undefined,
  };
}

function makeUsageRecord(i: number, baseTime: number): AgentUsageRecord {
  return {
    id: randomUUID(),
    agentName: `agent-${i % 8}`,
    agentType: i % 3 === 0 ? 'orchestrator' : 'worker',
    sessionId: `sess-${Math.floor(i / 50)}`,
    action: ['think', 'tool', 'delegate', 'research', 'finalize'][i % 5],
    target: `target-${i % 20}`,
    tokensUsed: 50 + (i % 500),
    costUsd: (0.001 * (50 + (i % 500))) / 1000,
    durationMs: 10 + (i % 1200),
    status: i % 25 === 0 ? 'failure' : 'success',
    metadata: { step: i % 10 },
    createdAt: baseTime + i,
  };
}

async function benchTraceInsertion(count = 5000): Promise<{
  viaTraceAPI: { count: number; timeMs: number; tracesPerSecond: number };
  viaStorage: { count: number; timeMs: number; tracesPerSecond: number };
}> {
  // via high-level trace() API (includes timing, cost calc, storage, optional cleanup)
  const { dbPath, cleanup } = makeTempDb('trace-api');
  const agent = new AgentTrace({ dbPath, silent: true, autoCleanup: false });
  const runId = agent.startRun('bench-insert-traceapi');
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    await agent.trace(`ins-${i}`, async () => ({ ok: i }), {
      input: { i },
      tokens: { promptTokens: 50, completionTokens: 20, totalTokens: 70, model: 'gpt-4o-mini' },
      metadata: { bench: true, i },
    });
  }
  const durAPI = performance.now() - t0;
  agent.close();
  cleanup();

  // via direct storage (raw insert path, closer to "trace insertion")
  const { dbPath: db2, cleanup: c2 } = makeTempDb('trace-storage');
  const storage = new TraceStorage(db2);
  const runId2 = randomUUID();
  storage.createRun({ id: runId2, name: 'bench-insert-storage', startedAt: Date.now(), metadata: {} });
  const baseTime = Date.now() - count * 10;
  const t1 = performance.now();
  for (let i = 0; i < count; i++) {
    storage.createTrace(makeTraceData(i, runId2, baseTime));
  }
  const durStorage = performance.now() - t1;
  storage.close();
  c2();

  return {
    viaTraceAPI: {
      count,
      timeMs: Math.round(durAPI * 100) / 100,
      tracesPerSecond: Math.round(count / (durAPI / 1000)),
    },
    viaStorage: {
      count,
      timeMs: Math.round(durStorage * 100) / 100,
      tracesPerSecond: Math.round(count / (durStorage / 1000)),
    },
  };
}

function populateForQueries(size: number): { agent: AgentTrace; storage: TraceStorage; runId: string; cleanup: () => void } {
  const { dbPath, cleanup } = makeTempDb('queries');
  const agent = new AgentTrace({ dbPath, silent: true, autoCleanup: false });
  const runId = agent.startRun('bench-queries');
  const storage = (agent as unknown as { storage: TraceStorage }).storage;
  const baseTime = Date.now() - size * 5;
  for (let i = 0; i < size; i++) {
    storage.createTrace(makeTraceData(i, runId, baseTime));
  }
  return { agent, storage, runId, cleanup };
}

async function benchQueries(datasetSize = 10000): Promise<Array<{ name: string; filter: TraceFilter; count: number; timeMs: number }>> {
  const { agent, cleanup } = populateForQueries(datasetSize);
  const queries: Array<{ name: string; filter: TraceFilter; count: number; timeMs: number }> = [];

  // 1. no filter
  let t0 = performance.now();
  let res = agent.getTraces();
  queries.push({ name: 'noFilter', filter: {}, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 2. by status success
  t0 = performance.now();
  res = agent.getTraces({ status: ['success'] });
  queries.push({ name: 'byStatusSuccess', filter: { status: ['success'] }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 3. by status error
  t0 = performance.now();
  res = agent.getTraces({ status: ['error'] });
  queries.push({ name: 'byStatusError', filter: { status: ['error'] }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 4. name LIKE
  t0 = performance.now();
  res = agent.getTraces({ name: 'op-1' });
  queries.push({ name: 'byNameLike', filter: { name: 'op-1' }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 5. cost range
  t0 = performance.now();
  res = agent.getTraces({ minCost: 0.0002, maxCost: 0.0006 });
  queries.push({ name: 'byCostRange', filter: { minCost: 0.0002, maxCost: 0.0006 }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 6. latency range
  t0 = performance.now();
  res = agent.getTraces({ minLatency: 100, maxLatency: 300 });
  queries.push({ name: 'byLatencyRange', filter: { minLatency: 100, maxLatency: 300 }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 7. pagination limit/offset
  t0 = performance.now();
  res = agent.getTraces({ limit: 100, offset: 3000 });
  queries.push({ name: 'limitOffset', filter: { limit: 100, offset: 3000 }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  // 8. by runId
  const runs = agent.getRuns(1);
  if (runs[0]) {
    t0 = performance.now();
    res = agent.getTraces({ runId: runs[0].id });
    queries.push({ name: 'byRunId', filter: { runId: runs[0].id }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });
  }

  // 9. combined filter
  t0 = performance.now();
  res = agent.getTraces({ status: ['success'], minLatency: 50, limit: 500 });
  queries.push({ name: 'combined', filter: { status: ['success'], minLatency: 50, limit: 500 }, count: res.length, timeMs: Math.round((performance.now() - t0) * 100) / 100 });

  agent.close();
  cleanup();
  return queries;
}

async function benchStats(datasetSize = 10000): Promise<{ timeMs: number; result: { totalTraces: number; totalCostUsd: number } }> {
  const { agent, cleanup } = populateForQueries(datasetSize);
  const t0 = performance.now();
  const stats = agent.getStats();
  const timeMs = Math.round((performance.now() - t0) * 100) / 100;
  agent.close();
  cleanup();
  return {
    timeMs,
    result: { totalTraces: stats.totalTraces, totalCostUsd: stats.totalCostUsd },
  };
}

async function benchAgentUsage(count = 10000): Promise<{ count: number; timeMs: number; recordsPerSecond: number }> {
  const { dbPath, cleanup } = makeTempDb('usage');
  const storage = new TraceStorage(dbPath);
  const baseTime = Date.now() - count * 3;
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    storage.recordAgentUsage(makeUsageRecord(i, baseTime));
  }
  const dur = performance.now() - t0;
  storage.close();
  cleanup();
  const rate = count / (dur / 1000);
  return {
    count,
    timeMs: Math.round(dur * 100) / 100,
    recordsPerSecond: Math.round(rate),
  };
}

async function benchMemory(size = 10000): Promise<{
  datasetSize: number;
  before: { rssMB: number; heapUsedMB: number };
  after10k: { rssMB: number; heapUsedMB: number };
  deltaMB: { rss: number; heap: number };
  mbPerTrace: number;
}> {
  const { dbPath, cleanup } = makeTempDb('memory');
  const agent = new AgentTrace({ dbPath, silent: true, autoCleanup: false });
  const before = process.memoryUsage();

  const runId = agent.startRun('bench-memory');
  const storage = (agent as unknown as { storage: TraceStorage }).storage;
  const base = Date.now();
  for (let i = 0; i < size; i++) {
    storage.createTrace(makeTraceData(i, runId, base));
  }
  const after = process.memoryUsage();

  // force load to measure object overhead
  void agent.getTraces({ limit: size });

  const afterLoad = process.memoryUsage();

  agent.close();
  cleanup();

  const deltaRss = (after.rss - before.rss) / 1024 / 1024;
  const deltaHeap = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const perTrace = (afterLoad.heapUsed - before.heapUsed) / 1024 / 1024 / size;

  return {
    datasetSize: size,
    before: { rssMB: Math.round((before.rss / 1024 / 1024) * 100) / 100, heapUsedMB: Math.round((before.heapUsed / 1024 / 1024) * 100) / 100 },
    after10k: { rssMB: Math.round((after.rss / 1024 / 1024) * 100) / 100, heapUsedMB: Math.round((after.heapUsed / 1024 / 1024) * 100) / 100 },
    deltaMB: { rss: Math.round(deltaRss * 100) / 100, heap: Math.round(deltaHeap * 100) / 100 },
    mbPerTrace: Math.round(perTrace * 10000) / 10000,
  };
}

async function benchDbSize(size = 10000): Promise<{
  datasetSize: number;
  dbPath: string;
  sizeBytes: number;
  sizeKB: number;
  kbPerTrace: number;
}> {
  const { dbPath, cleanup } = makeTempDb('dbsize');
  const storage = new TraceStorage(dbPath);
  const runId = randomUUID();
  storage.createRun({ id: runId, name: 'bench-dbsize', startedAt: Date.now(), metadata: {} });
  const base = Date.now();
  for (let i = 0; i < size; i++) {
    storage.createTrace(makeTraceData(i, runId, base));
  }
  // also some usage to be realistic
  for (let i = 0; i < Math.floor(size / 3); i++) {
    storage.recordAgentUsage(makeUsageRecord(i, base));
  }
  storage.close();

  const stat = fs.statSync(dbPath);
  const walStat = (() => { try { return fs.statSync(dbPath + '-wal').size; } catch { return 0; } })();
  const totalBytes = stat.size + walStat;

  cleanup(); // we still report the size measured before delete

  // re-create temp path just for reporting? No, we measured before cleanup. But path was deleted.
  // For report, use a representative path name.
  return {
    datasetSize: size,
    dbPath: 'agenttrace.db (temp)',
    sizeBytes: totalBytes,
    sizeKB: Math.round((totalBytes / 1024) * 100) / 100,
    kbPerTrace: Math.round((totalBytes / 1024 / size) * 1000) / 1000,
  };
}

export async function runTraceBenchmarks(): Promise<TraceBenchmarkResult> {
  const TRACE_N = 5000;
  const QUERY_N = 10000;
  const USAGE_N = 10000;
  const MEM_DB_N = 10000;

  console.log('Running AgentTrace trace benchmarks...');

  const insertion = await benchTraceInsertion(TRACE_N);
  console.log(`  Insertion (via trace API): ${insertion.viaTraceAPI.tracesPerSecond} traces/s`);
  console.log(`  Insertion (via storage):   ${insertion.viaStorage.tracesPerSecond} traces/s`);

  const queries = await benchQueries(QUERY_N);
  console.log(`  Queries: ${queries.length} filter variants on ${QUERY_N} traces`);

  const stats = await benchStats(QUERY_N);
  console.log(`  Stats aggregation: ${stats.timeMs}ms`);

  const agentUsage = await benchAgentUsage(USAGE_N);
  console.log(`  Agent usage recording: ${agentUsage.recordsPerSecond} records/s`);

  const memory = await benchMemory(MEM_DB_N);
  console.log(`  Memory delta for ${MEM_DB_N} traces: ~${memory.deltaMB.heap}MB heap`);

  const dbSize = await benchDbSize(MEM_DB_N);
  console.log(`  DB size for ${MEM_DB_N} traces + usage: ${dbSize.sizeKB}KB (~${dbSize.kbPerTrace}KB/trace)`);

  const result: TraceBenchmarkResult = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    config: { traceCount: TRACE_N, queryDatasetSize: QUERY_N },
    insertion,
    queries,
    stats,
    agentUsage,
    memory,
    dbSize,
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
    const res = await runTraceBenchmarks();
    console.log('\n=== TRACE BENCHMARK JSON ===');
    console.log(JSON.stringify(res, null, 2));
  } catch (err: unknown) {
    console.error('Benchmark failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (isMain()) {
  main();
}
