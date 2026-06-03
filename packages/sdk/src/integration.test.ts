/**
 * AgentTrace Integration Test
 * Tests the full flow: trace → store → query → export
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty -- test files use loose any for fixtures/mocks and some unused for structure; added only for lint-clean on new multi-agent tests */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AgentTrace, score } from './index';
import { TraceStorage } from './storage';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

describe('AgentTrace Integration', () => {
  let agenttrace: AgentTrace;
  const testDb = `./test-${randomUUID()}.db`;

  beforeEach(() => {
    agenttrace = new AgentTrace({ dbPath: testDb, silent: true });
  });

  afterEach(() => {
    agenttrace.close();
    try {
      unlinkSync(testDb);
    } catch (_) {
      void 0;
    }
    try {
      unlinkSync(testDb + '-wal');
    } catch (_) {
      void 0;
    }
    try {
      unlinkSync(testDb + '-shm');
    } catch (_) {
      void 0;
    }
  });

  it('should trace a simple function', async () => {
    const runId = agenttrace.startRun('test-run');

    const result = await agenttrace.trace(
      'test-op',
      async () => {
        return 'hello world';
      },
      {
        input: { query: 'test' },
        tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-4o' },
      },
    );

    expect(result).toBe('hello world');

    const traces = agenttrace.getTraces({ runId });
    expect(traces.length).toBe(1);
    expect(traces[0].name).toBe('test-op');
    expect(traces[0].status).toBe('success');
    expect(traces[0].tokens.totalTokens).toBe(150);
  });

  it('should trace failures', async () => {
    const runId = agenttrace.startRun('failing-run');

    await expect(
      agenttrace.trace('fail-op', async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');

    const traces = agenttrace.getTraces({ runId });
    expect(traces.length).toBe(1);
    expect(traces[0].status).toBe('error');
    expect(traces[0].error).toBe('test error');
  });

  it('should calculate stats', async () => {
    agenttrace.startRun('stats-run');

    await agenttrace.trace('op-1', async () => 'ok', {
      tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    await agenttrace.trace('op-2', async () => 'ok', {
      tokens: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    });

    const stats = agenttrace.getStats();
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalTraces).toBe(2);
    expect(stats.successRate).toBe(1);
    expect(stats.totalTokens).toBe(450);
  });

  it('should export to JSON', async () => {
    agenttrace.startRun('export-run');

    await agenttrace.trace('export-op', async () => 'data', {
      tokens: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    });

    const json = agenttrace.export('json');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('export-op');
  });

  it('should export to CSV', async () => {
    agenttrace.startRun('csv-run');

    await agenttrace.trace('csv-op', async () => 'data', {
      tokens: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    });

    const csv = agenttrace.export('csv');
    const lines = csv.split('\n');
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[0]).toContain('id,runId,name,status');
  });

  it('should filter traces by status', async () => {
    agenttrace.startRun('filter-run');

    await agenttrace.trace('success-op', async () => 'ok', {
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    await expect(
      agenttrace.trace('fail-op', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow();

    const successTraces = agenttrace.getTraces({ status: ['success'] });
    expect(successTraces.length).toBe(1);
    expect(successTraces[0].status).toBe('success');

    const failedTraces = agenttrace.getTraces({ status: ['error'] });
    expect(failedTraces.length).toBe(1);
    expect(failedTraces[0].status).toBe('error');
  });

  it('should support evaluate and store scores in SQLite (retrievable via storage)', async () => {
    const runId = agenttrace.startRun('eval-run');

    await agenttrace.trace('eval-op-1', async () => 'short', {
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    await agenttrace.trace('eval-op-2', async () => 'much longer output here', {
      tokens: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    });

    const traces = agenttrace.getTraces({ runId });
    expect(traces.length).toBe(2);

    const lenScorer = score('output-len', (trace) => {
      const out = trace.output ? String(trace.output).length : 0;
      return Math.min(out / 10, 1);
    });

    const results = await agenttrace.evaluate({ scorers: [lenScorer], runId });
    expect(results.length).toBe(2);
    expect(results[0].scores['output-len']).toBeGreaterThan(0);
    expect(results[0].errors).toEqual({});
    expect(results[1].scores['output-len']).toBeGreaterThan(0);

    // Verify stored in SQLite via direct storage
    const storage = new TraceStorage(testDb);
    try {
      const allScores = storage.getScores();
      const t1Scores = storage.getScores(traces[0].id);
      expect(allScores.length).toBeGreaterThanOrEqual(2);
      expect(t1Scores.length).toBe(1);
      expect(t1Scores[0].name).toBe('output-len');
      expect(typeof t1Scores[0].value).toBe('number');
    } finally {
      storage.close();
    }

    // also test evaluateTrace
    const single = await agenttrace.evaluateTrace(traces[0].id, [lenScorer]);
    expect(single.traceId).toBe(traces[0].id);
    expect(single.scores['output-len']).toBeDefined();
  });

  // --- Multi-agent tracing tests (added for v0.2, existing tests untouched) ---

  it('TraceContext class holds traceId, parentSpanId, metadata', async () => {
    const { TraceContext } = await import('./index.js');
    const ctx = new TraceContext('trace-abc', 'parent-xyz', { foo: 'bar' });
    expect(ctx.traceId).toBe('trace-abc');
    expect(ctx.parentSpanId).toBe('parent-xyz');
    expect(ctx.metadata).toEqual({ foo: 'bar' });
  });

  it('createChild produces linked context with fresh traceId and parent set', async () => {
    const { TraceContext } = await import('./index.js');
    const parentCtx = new TraceContext('parent-trace-1', undefined, { level: 0 });
    const childCtx = agenttrace.createChild(parentCtx);
    expect(childCtx.traceId).not.toBe(parentCtx.traceId);
    expect(childCtx.parentSpanId).toBe(parentCtx.traceId);
    expect(childCtx.metadata).toEqual({ level: 0 });
  });

  it('trace() with parentId stores parentId on trace', async () => {
    const _runId = agenttrace.startRun('parent-run');
    const parentTrace = await agenttrace.trace('parent-agent', async () => 'p', {
      tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const childTrace = await agenttrace.trace('child-agent', async () => 'c', {
      parentId: parentTrace.id,
      tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    expect(childTrace.parentId).toBe(parentTrace.id);
    const fetched = agenttrace.getTrace(childTrace.id);
    expect(fetched?.parentId).toBe(parentTrace.id);
  });

  it('trace() with context from createChild links parent/child and id matches context', async () => {
    const _runId = agenttrace.startRun('ctx-run');
    const p = await agenttrace.trace('p-agent', async () => 1, {
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    const pCtx = new (await import('./index.js')).TraceContext(p.id, undefined);
    const cCtx = agenttrace.createChild(pCtx);
    const c = await agenttrace.trace('c-agent', async () => 2, {
      context: cCtx,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(c.id).toBe(cCtx.traceId);
    expect(c.parentId).toBe(p.id);
    const tree = agenttrace.getTraceTree(p.id);
    expect(tree.trace.id).toBe(p.id);
    expect(tree.children.length).toBeGreaterThanOrEqual(1);
    expect(tree.children[0].trace.id).toBe(c.id);
  });

  it('linkTraces and getTraceTree includes linked as children', async () => {
    const _runId = agenttrace.startRun('link-run');
    const t1 = await agenttrace.trace('t1', async () => 'a', { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const t2 = await agenttrace.trace('t2', async () => 'b', { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const t3 = await agenttrace.trace('t3', async () => 'c', { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    agenttrace.linkTraces([t1.id, t2.id, t3.id]);
    const tree = agenttrace.getTraceTree(t1.id);
    // since linked, t1 is root, should have t2,t3 under it via links
    const childIds = tree.children.map((n: unknown) => (n as any).trace.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(childIds).toContain(t2.id);
    expect(childIds).toContain(t3.id);
  });

  it('getTraceTree walks up to root and includes full subtree', async () => {
    const _runId = agenttrace.startRun('tree-run');
    const root = await agenttrace.trace('root', async () => 0, { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const c1 = await agenttrace.trace('c1', async () => 1, { parentId: root.id, tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const gc = await agenttrace.trace('gc', async () => 2, { parentId: c1.id, tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const treeFromLeaf = agenttrace.getTraceTree(gc.id);
    expect(treeFromLeaf.trace.id).toBe(root.id); // walked to root
    // depth check
    const lvl1 = treeFromLeaf.children.find((n: unknown) => (n as any).trace.id === c1.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(lvl1).toBeTruthy();
    expect(lvl1!.children.length).toBe(1);
    expect(lvl1!.children[0].trace.id).toBe(gc.id);
  });

  it('dashboard tree API and storage getTraceTree work (via sdk)', async () => {
    const _runId = agenttrace.startRun('api-tree');
    const r = await agenttrace.trace('r', async () => 'r', { tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const ch = await agenttrace.trace('ch', async () => 'ch', { parentId: r.id, tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const tree = agenttrace.getTraceTree(r.id);
    expect(tree.trace.id).toBe(r.id);
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].trace.id).toBe(ch.id);
    // also test storage directly
    const { TraceStorage } = await import('./storage.js');
    const st = new TraceStorage(testDb);
    try {
      const stTree = st.getTraceTree(ch.id); // eslint-disable-line @typescript-eslint/no-explicit-any -- no, the any is param in other
      expect(stTree.trace.id).toBe(r.id);
    } finally {
      st.close();
    }
  });
});
