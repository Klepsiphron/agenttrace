import { describe, it, expect, afterEach } from 'vitest';
import { createDashboardApp } from './index.js';
import * as http from 'node:http';

/* eslint-disable @typescript-eslint/no-explicit-any -- test server address and fetch harness use loose types */

function getServerPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === 'object' && 'port' in addr) {
    return ((addr as any).port as number) || 0;
  }
  return 0;
}

describe('dashboard cost API endpoints (new tests)', () => {
  let servers: http.Server[] = [];
  let closes: Array<() => void> = [];

  afterEach(() => {
    servers.forEach((s) => {
      try {
        s.close();
      } catch (_) {
        /* ignore close errors in cleanup */
      }
    });
    closes.forEach((c) => {
      try {
        c();
      } catch (_) {
        /* ignore close errors in cleanup */
      }
    });
    servers = [];
    closes = [];
  });

  async function startTemp(app: any): Promise<{ port: number; base: string }> {
    const server = app.listen(0);
    servers.push(server);
    const port = getServerPort(server);
    // wait for listen
    await new Promise((r) => setTimeout(r, 5));
    return { port, base: `http://127.0.0.1:${port}` };
  }

  it('GET /api/costs returns total, costByModel, costByDay', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    trace.startRun('cost-run-x');
    await trace.trace('costed-1', async () => 'res1', {
      tokens: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, model: 'gpt-4o' },
      model: 'gpt-4o',
    });
    await trace.trace('costed-2', async () => 'res2', {
      tokens: { promptTokens: 200, completionTokens: 100, totalTokens: 300, model: 'gemini-2.5-pro' },
      model: 'gemini-2.5-pro',
    });

    const { base } = await startTemp(app);
    const res = await fetch(`${base}/api/costs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.totalCostUsd).toBe('number');
    expect(data.totalCostUsd).toBeGreaterThan(0);
    expect(data.costByModel).toBeTruthy();
    expect(data.costByModel['gpt-4o']).toBeCloseTo(0.0075, 6);
    expect(data.costByModel['gemini-2.5-pro']).toBeCloseTo(0.00125, 6);
    expect(data.costByDay).toBeTruthy();
    expect(typeof data.costByDay).toBe('object');
  });

  it('GET /api/costs?run-id=... returns costs for specific run only', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const run1 = trace.startRun('run-one');
    await trace.trace('r1-op', async () => 'x', {
      tokens: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, model: 'gpt-4.1' },
      model: 'gpt-4.1',
    });
    trace.completeRun();

    const run2 = trace.startRun('run-two');
    await trace.trace('r2-op', async () => 'y', {
      tokens: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, model: 'claude-haiku-4.5' },
      model: 'claude-haiku-4.5',
    });
    trace.completeRun();

    const { base } = await startTemp(app);

    const allRes = await fetch(`${base}/api/costs`);
    const all = await allRes.json();
    expect(all.totalCostUsd).toBeCloseTo(0.003, 6); // 0.002 + 0.001

    const r1Res = await fetch(`${base}/api/costs?run-id=${run1}`);
    const r1 = await r1Res.json();
    expect(r1.totalCostUsd).toBeCloseTo(0.002, 6);
    expect(r1.costByModel['gpt-4.1']).toBeCloseTo(0.002, 6);
    expect(r1.costByModel['claude-haiku-4.5']).toBeUndefined();

    const r2Res = await fetch(`${base}/api/costs?run-id=${run2}`);
    const r2 = await r2Res.json();
    expect(r2.totalCostUsd).toBeCloseTo(0.001, 6);
    expect(r2.costByModel['claude-haiku-4.5']).toBeCloseTo(0.001, 6);
  });

  it('supports both run-id and runId query params', async () => {
    const { app, trace, close } = createDashboardApp(':memory:');
    closes.push(close);

    const rid = trace.startRun('qparam');
    await trace.trace('qp', async () => 1, {
      tokens: { promptTokens: 500, completionTokens: 0, totalTokens: 500, model: 'llama-4-scout' },
      model: 'llama-4-scout',
    });
    trace.completeRun();

    const { base } = await startTemp(app);

    const res1 = await fetch(`${base}/api/costs?run-id=${rid}`);
    const d1 = await res1.json();
    expect(d1.totalCostUsd).toBeCloseTo(0.00004, 6); // 500*0.00008 /1000 = 0.00004

    const res2 = await fetch(`${base}/api/costs?runId=${rid}`);
    const d2 = await res2.json();
    expect(d2.totalCostUsd).toBeCloseTo(0.00004, 6);
  });
});
