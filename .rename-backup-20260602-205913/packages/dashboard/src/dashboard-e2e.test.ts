import { describe, it, expect, afterEach } from 'vitest';
import { createDashboardApp } from './index.js';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

function getServerPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === 'object' && 'port' in addr) {
    return ((addr as AddressInfo).port as number) || 0;
  }
  return 0;
}

describe('dashboard e2e API (all endpoints)', () => {
  let servers: http.Server[] = [];
  let closes: Array<() => void> = [];

  afterEach(() => {
    servers.forEach((s) => {
      try {
        s.close();
      } catch (_) {
        /* ignore */
      }
    });
    closes.forEach((c) => {
      try {
        c();
      } catch (_) {
        /* ignore */
      }
    });
    servers = [];
    closes = [];
  });

  async function startTemp(app: Express): Promise<{ port: number; base: string }> {
    const server = app.listen(0);
    servers.push(server);
    const port = getServerPort(server);
    await new Promise((r) => setTimeout(r, 5));
    return { port, base: `http://127.0.0.1:${port}` };
  }

  it('GET /api/stats returns stats object with expected keys', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    trace.startRun('stats-run');
    await trace.trace('s1', async () => 'ok', {
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-4o-mini' },
    });
    trace.completeRun();

    const { base } = await startTemp(app);
    const res = await fetch(`${base}/api/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.totalRuns).toBe('number');
    expect(typeof data.totalTraces).toBe('number');
    expect(typeof data.successRate).toBe('number');
    expect(typeof data.avgLatencyMs).toBe('number');
    expect(typeof data.totalCostUsd).toBe('number');
    expect(Array.isArray(data.topTools)).toBe(true);
    expect(Array.isArray(data.topErrors)).toBe(true);
  });

  it('GET /api/runs returns array (with limit and status filter)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const r1 = trace.startRun('run-success');
    await trace.trace('ok1', async () => 1);
    trace.completeRun();

    const r2 = trace.startRun('run-fail');
    await trace.trace('bad', async () => {
      throw new Error('boom');
    }).catch(() => {});
    trace.completeRun();

    const { base } = await startTemp(app);

    const all = await (await fetch(`${base}/api/runs?limit=10`)).json();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(2);

    const limited = await (await fetch(`${base}/api/runs?limit=1`)).json();
    expect(limited.length).toBe(1);

    const successOnly = await (await fetch(`${base}/api/runs?status=success`)).json();
    expect(successOnly.every((r: { status: string }) => r.status === 'success')).toBe(true);

    const multi = await (await fetch(`${base}/api/runs?status=success,failure`)).json();
    expect(multi.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/runs/:id returns run or 404', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('specific-run');
    await trace.trace('t', async () => 'x');
    trace.completeRun();

    const { base } = await startTemp(app);

    const ok = await fetch(`${base}/api/runs/${runId}`);
    expect(ok.status).toBe(200);
    const run = await ok.json();
    expect(run.id).toBe(runId);
    expect(run.name).toBe('specific-run');

    const nf = await fetch(`${base}/api/runs/nonexistent-id-xyz`);
    expect(nf.status).toBe(404);
    const err = await nf.json();
    expect(err.error).toMatch(/not found/i);
  });

  it('GET /api/traces returns filtered traces (runId, status, name, limit, offset)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('trace-filter-run');
    await trace.trace('alpha', async () => 'A');
    await trace.trace('beta', async () => 'B', { status: 'error' }); // force error? use try
    // redo beta as success for filter variety
    await trace.trace('beta', async () => 'B2');
    await trace.trace('gamma', async () => 'G');
    trace.completeRun();

    const { base } = await startTemp(app);

    const byRun = await (await fetch(`${base}/api/traces?runId=${runId}`)).json();
    expect(byRun.length).toBeGreaterThanOrEqual(3);

    const byName = await (await fetch(`${base}/api/traces?name=alpha&runId=${runId}`)).json();
    expect(byName.length).toBe(1);
    expect(byName[0].name).toBe('alpha');

    const limited = await (await fetch(`${base}/api/traces?runId=${runId}&limit=2`)).json();
    expect(limited.length).toBe(2);

    const offset = await (await fetch(`${base}/api/traces?runId=${runId}&limit=1&offset=1`)).json();
    expect(offset.length).toBe(1);

    // status filter (array in query)
    const success = await (await fetch(`${base}/api/traces?runId=${runId}&status=success`)).json();
    expect(success.every((t: { status: string }) => t.status === 'success')).toBe(true);
  });

  it('GET /api/traces/:id returns trace or 404', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('get-trace-run');
    await trace.trace('detail-op', async () => ({ ok: true }));
    trace.completeRun();

    const tr = trace.getTraces({ runId, name: 'detail-op', limit: 1 })[0];
    expect(tr).toBeTruthy();

    const { base } = await startTemp(app);

    const ok = await fetch(`${base}/api/traces/${tr.id}`);
    expect(ok.status).toBe(200);
    const t = await ok.json();
    expect(t.id).toBe(tr.id);
    expect(t.name).toBe('detail-op');

    const nf = await fetch(`${base}/api/traces/does-not-exist-123`);
    expect(nf.status).toBe(404);
  });

  it('GET /api/traces/:id/tree returns tree or 404', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('tree-run');
    await trace.trace('root-op', async () => 'root', {
      tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const roots = trace.getTraces({ runId, name: 'root-op', limit: 1 });
    const root = roots[0];

    await trace.trace('child-op', async () => 'child', {
      parentId: root.id,
      tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const childs = trace.getTraces({ runId, name: 'child-op', limit: 1 });
    const child = childs[0];

    const { base } = await startTemp(app);

    const treeRes = await fetch(`${base}/api/traces/${root.id}/tree`);
    expect(treeRes.status).toBe(200);
    const tree = await treeRes.json();
    expect(tree.trace.id).toBe(root.id);
    expect(Array.isArray(tree.children)).toBe(true);
    expect(tree.children.length).toBeGreaterThanOrEqual(1);
    expect(tree.children[0].trace.id).toBe(child.id);

    // not found
    const nf = await fetch(`${base}/api/traces/missing-tree-xyz/tree`);
    expect(nf.status).toBe(404);
    const e = await nf.json();
    expect(e.error).toMatch(/not found/i);
  });

  it('GET /api/export returns json (default) with headers and body', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    trace.startRun('export-run');
    await trace.trace('e1', async () => ({ a: 1 }));
    trace.completeRun();

    const { base } = await startTemp(app);

    const res = await fetch(`${base}/api/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="agenttrace-export.json"/);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/export?format=csv returns csv with headers', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    trace.startRun('csv-run');
    await trace.trace('c1', async () => 'csvdata');
    trace.completeRun();

    const { base } = await startTemp(app);

    const res = await fetch(`${base}/api/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/agenttrace-export.csv/);
    const text = await res.text();
    expect(text).toContain('id,runId,name,status');
    expect(text).toContain('c1');
  });

  it('GET /api/costs returns breakdown (total, costByModel, costByDay)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    trace.startRun('cost-run');
    await trace.trace('co1', async () => 'x', {
      tokens: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, model: 'gpt-4o' },
      model: 'gpt-4o',
    });
    trace.completeRun();

    const { base } = await startTemp(app);

    const res = await fetch(`${base}/api/costs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.totalCostUsd).toBe('number');
    expect(data.totalCostUsd).toBeGreaterThan(0);
    expect(data.costByModel).toBeTruthy();
    expect(typeof data.costByDay).toBe('object');
  });

  it('GET /api/costs?run-id=... (and runId alias) filters to run', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const rid1 = trace.startRun('c1');
    await trace.trace('x', async () => 1, {
      tokens: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, model: 'gpt-4.1' },
      model: 'gpt-4.1',
    });
    trace.completeRun();

    const rid2 = trace.startRun('c2');
    await trace.trace('y', async () => 2, {
      tokens: { promptTokens: 2000, completionTokens: 0, totalTokens: 2000, model: 'claude-haiku-4.5' },
      model: 'claude-haiku-4.5',
    });
    trace.completeRun();

    const { base } = await startTemp(app);

    const r1 = await (await fetch(`${base}/api/costs?run-id=${rid1}`)).json();
    expect(r1.totalCostUsd).toBeGreaterThan(0);
    expect(r1.costByModel['gpt-4.1']).toBeDefined();
    expect(r1.costByModel['claude-haiku-4.5']).toBeUndefined();

    const r2viaAlias = await (await fetch(`${base}/api/costs?runId=${rid2}`)).json();
    expect(r2viaAlias.costByModel['claude-haiku-4.5']).toBeDefined();
  });

  it('GET /api/alerts returns configured alerts (functions stripped on wire)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const al = {
      name: 'high-traces',
      condition: (s: { totalTraces?: number }) => (s.totalTraces || 0) > 5,
      cooldown: 60,
      webhook: 'https://example/hook',
    } as any;
    trace.registerAlert(al);

    // populate to make stats interesting but not required for list
    trace.startRun('al-run');
    await trace.trace('al-t', async () => 'ok');
    trace.completeRun();

    const { base } = await startTemp(app);

    const res = await fetch(`${base}/api/alerts`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((a: { name: string }) => a.name === 'high-traces');
    expect(found).toBeTruthy();
    expect(found.cooldown).toBe(60);
    expect(found.webhook).toBe('https://example/hook');
    // no 'condition' function in json
    expect(found.condition).toBeUndefined();
  });

  it('GET /api/traces/:id/tree works with linked traces via parentId', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('linked-tree');
    await trace.trace('p', async () => 'p');
    const ps = trace.getTraces({ runId, name: 'p', limit: 1 });
    const p = ps[0];
    await trace.trace('c', async () => 'c', { parentId: p.id });
    const cs = trace.getTraces({ runId, name: 'c', limit: 1 });
    const c = cs[0];

    const { base } = await startTemp(app);

    const tree = await (await fetch(`${base}/api/traces/${p.id}/tree`)).json();
    expect(tree.trace.id).toBe(p.id);
    expect(tree.children.some((ch: { trace: { id: string } }) => ch.trace.id === c.id)).toBe(true);
  });

  it('POST /api/evaluate runs built-in scorer and returns ScorerResult[] (supports runId, traceIds)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const runId = trace.startRun('eval-run');
    await trace.trace('e-short', async () => 'hi');
    await trace.trace('e-long', async () => 'this is a longer output string');
    trace.completeRun();

    const allTr = trace.getTraces({ runId });
    expect(allTr.length).toBe(2);

    const { base } = await startTemp(app);

    // full
    const res1 = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);
    const results1 = await res1.json();
    expect(Array.isArray(results1)).toBe(true);
    expect(results1.length).toBeGreaterThanOrEqual(2);
    expect(results1[0]).toHaveProperty('traceId');
    expect(results1[0]).toHaveProperty('scores');
    expect(results1[0]).toHaveProperty('errors');
    // our 'length' scorer
    expect(typeof results1.find((r: { scores: Record<string, number> }) => r.scores.length !== undefined)).toBe('object');

    // filter by runId
    const res2 = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    const results2 = await res2.json();
    expect(results2.length).toBe(2);

    // filter by traceIds (one)
    const res3 = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceIds: [allTr[0].id] }),
    });
    const results3 = await res3.json();
    expect(results3.length).toBe(1);
    expect(results3[0].traceId).toBe(allTr[0].id);
  });

  it('POST /api/evaluate with no traces returns empty array', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const { base } = await startTemp(app);

    const res = await fetch(`${base}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results).toEqual([]);
  });

  it('unknown trace id for tree returns 404 (error shape)', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const { base } = await startTemp(app);
    const res = await fetch(`${base}/api/traces/unknown-uuid-404/tree`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
