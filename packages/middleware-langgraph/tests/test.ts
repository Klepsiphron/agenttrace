import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AgentTraceMiddleware, VERSION, PACKAGE_NAME } from '../src/index.js';
import { AgentTrace } from '@agenttrace/sdk';

function makeTempDb(): { path: string; cleanup: () => void } {
  const path = `/tmp/agenttrace-mw-langgraph-${randomUUID()}.db`;
  const cleanup = () => {
    try {
      // best effort remove; storage will handle
      void 0;
    } catch (_) { /* ignore */ }
  };
  return { path, cleanup };
}

describe('@agenttrace/middleware-langgraph', () => {
  it('exports version and package name', () => {
    expect(VERSION).toBe('0.2.0');
    expect(PACKAGE_NAME).toBe('@agenttrace/middleware-langgraph');
  });
});

describe('AgentTraceMiddleware', () => {
  let mw: AgentTraceMiddleware;
  let dbPath: string;
  let cleanup: () => void;
  let inspector: AgentTrace;

  beforeEach(() => {
    const t = makeTempDb();
    dbPath = t.path;
    cleanup = t.cleanup;
    mw = new AgentTraceMiddleware({ dbPath, silent: true });
    inspector = new AgentTrace({ dbPath, silent: true });
  });

  afterEach(() => {
    try { mw.close(); } catch (_) { /* ignore */ }
    try { inspector.close(); } catch (_) { /* ignore */ }
    cleanup();
  });

  it('traces a successful node via before/after', () => {
    mw.beforeNode('research', { query: 'foo' });
    mw.afterNode('research', { query: 'foo' }, { answer: 'bar' });

    const traces = inspector.getTraces();
    expect(traces.length).toBe(1);
    const t = traces[0];
    expect(t.name).toBe('research');
    expect(t.status).toBe('success');
    expect(t.input).toEqual({ query: 'foo' });
    expect(t.output).toEqual({ answer: 'bar' });
    expect(t.metadata.framework).toBe('langgraph');
    expect(typeof t.latencyMs).toBe('number');
  });

  it('records error via onError', () => {
    mw.beforeNode('bad-node', { x: 1 });
    mw.onError('bad-node', { x: 1 }, new Error('node failed'));

    const traces = inspector.getTraces({ status: ['error'] });
    expect(traces.length).toBe(1);
    expect(traces[0].status).toBe('error');
    expect(traces[0].error).toBe('node failed');
  });

  it('extracts tokens from common LangGraph/LangChain message shapes', () => {
    mw.beforeNode('llm', {});
    const resultWithUsage = {
      content: 'hi',
      usage_metadata: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
      response_metadata: { model_name: 'gpt-4o-mini' },
    };
    mw.afterNode('llm', {}, resultWithUsage);

    const traces = inspector.getTraces();
    expect(traces[0].tokens).toMatchObject({
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
      model: 'gpt-4o-mini',
    });
  });

  it('supports nested calls to same node name via stack', () => {
    mw.beforeNode('step', { i: 0 });
    mw.beforeNode('step', { i: 1 });
    mw.afterNode('step', { i: 1 }, { o: 1 });
    mw.afterNode('step', { i: 0 }, { o: 0 });

    const traces = inspector.getTraces().sort((a, b) => a.createdAt - b.createdAt);
    expect(traces.length).toBe(2);
    expect(traces[0].input).toEqual({ i: 0 });
    expect(traces[1].input).toEqual({ i: 1 });
  });

  it('getAgentTrace returns the internal agent and supports startRun', () => {
    const agent = mw.getAgentTrace();
    expect(agent).toBeInstanceOf(AgentTrace);
    const rid = agent.startRun('lg-run');
    expect(typeof rid).toBe('string');
    // run recorded
    expect(agent.getRuns().length).toBe(1);
  });

  it('close shuts down storage', () => {
    const agent = mw.getAgentTrace();
    mw.close();
    // calling again is safe
    expect(() => agent.close()).not.toThrow();
  });
});
