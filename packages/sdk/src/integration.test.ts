/**
 * AgentTrace Integration Test
 * Tests the full flow: trace → store → query → export
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AgentTrace } from './index';
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
    try { unlinkSync(testDb); } catch {}
    try { unlinkSync(testDb + '-wal'); } catch {}
    try { unlinkSync(testDb + '-shm'); } catch {}
  });

  it('should trace a simple function', async () => {
    const runId = agenttrace.startRun('test-run');
    
    const result = await agenttrace.trace('test-op', async () => {
      return 'hello world';
    }, {
      input: { query: 'test' },
      tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-4o' }
    });

    expect(result).toBe('hello world');
    
    const traces = agenttrace.getTraces({ runId });
    expect(traces.length).toBe(1);
    expect(traces[0].name).toBe('test-op');
    expect(traces[0].status).toBe('success');
    expect(traces[0].tokens.totalTokens).toBe(150);
  });

  it('should trace failures', async () => {
    const runId = agenttrace.startRun('failing-run');
    
    await expect(agenttrace.trace('fail-op', async () => {
      throw new Error('test error');
    })).rejects.toThrow('test error');

    const traces = agenttrace.getTraces({ runId });
    expect(traces.length).toBe(1);
    expect(traces[0].status).toBe('error');
    expect(traces[0].error).toBe('test error');
  });

  it('should calculate stats', async () => {
    agenttrace.startRun('stats-run');
    
    await agenttrace.trace('op-1', async () => 'ok', {
      tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    });
    
    await agenttrace.trace('op-2', async () => 'ok', {
      tokens: { promptTokens: 200, completionTokens: 100, totalTokens: 300 }
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
      tokens: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
    });

    const json = agenttrace.export('json');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('export-op');
  });

  it('should export to CSV', async () => {
    agenttrace.startRun('csv-run');
    
    await agenttrace.trace('csv-op', async () => 'data', {
      tokens: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
    });

    const csv = agenttrace.export('csv');
    const lines = csv.split('\n');
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[0]).toContain('id,runId,name,status');
  });

  it('should filter traces by status', async () => {
    agenttrace.startRun('filter-run');
    
    await agenttrace.trace('success-op', async () => 'ok', {
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    });
    
    await expect(agenttrace.trace('fail-op', async () => {
      throw new Error('fail');
    })).rejects.toThrow();

    const successTraces = agenttrace.getTraces({ status: ['success'] });
    expect(successTraces.length).toBe(1);
    expect(successTraces[0].status).toBe('success');

    const failedTraces = agenttrace.getTraces({ status: ['error'] });
    expect(failedTraces.length).toBe(1);
    expect(failedTraces[0].status).toBe('error');
  });
});
