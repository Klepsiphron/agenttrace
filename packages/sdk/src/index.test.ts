import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Trace, TraceStats, Run, TokenUsage } from './types.js';

const { mockStorage, MockTraceStorage } = vi.hoisted(() => {
  const mockStorage = {
    createRun: vi.fn(),
    completeRun: vi.fn(),
    createTrace: vi.fn(),
    getTrace: vi.fn(),
    getTraces: vi.fn(() => [] as Trace[]),
    getRuns: vi.fn(() => [] as Run[]),
    getRun: vi.fn(),
    getStats: vi.fn(
      (): TraceStats => ({
        totalRuns: 0,
        totalTraces: 0,
        successRate: 0,
        avgLatencyMs: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        avgTokensPerTrace: 0,
        topTools: [],
        topErrors: [],
      }),
    ),
    cleanup: vi.fn(() => 0),
    close: vi.fn(),
  };

  return {
    mockStorage,
    MockTraceStorage: vi.fn(function MockTraceStorage() {
      return mockStorage;
    }),
  };
});

vi.mock('./storage.js', () => ({
  TraceStorage: MockTraceStorage,
}));

import { AgentTrace, init, PACKAGE_NAME, VERSION } from './index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: 'trace-1',
    runId: 'run-1',
    name: 'test-op',
    status: 'success',
    input: null,
    output: 'hello',
    tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    toolCalls: [],
    latencyMs: 12,
    costUsd: 0.001,
    metadata: {},
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function lastCreatedTrace(): Omit<Trace, 'createdAt' | 'updatedAt'> {
  const call = mockStorage.createTrace.mock.calls.at(-1);
  if (!call) throw new Error('createTrace was not called');
  return call[0];
}

describe('@agenttrace/sdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getTraces.mockReturnValue([]);
    mockStorage.getStats.mockReturnValue({
      totalRuns: 0,
      totalTraces: 0,
      successRate: 0,
      avgLatencyMs: 0,
      totalCostUsd: 0,
      totalTokens: 0,
      avgTokensPerTrace: 0,
      topTools: [],
      topErrors: [],
    });
    mockStorage.createTrace.mockImplementation((trace) => ({
      ...trace,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });

  it('exports the package version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@agenttrace/sdk');
  });
});

describe('cost calculation (defaultCostCalculator)', () => {
  let agent: AgentTrace;

  beforeEach(() => {
    agent = new AgentTrace({ silent: true });
    agent.startRun('cost-run');
  });

  it('calculates cost for a known model (gpt-4o)', async () => {
    await agent.trace('priced-op', async () => 'ok', {
      tokens: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      model: 'gpt-4o',
    });

    // (1000 * 0.0025 + 500 * 0.01) / 1000 = 0.0075
    expect(lastCreatedTrace().costUsd).toBeCloseTo(0.0075, 6);
  });

  it('uses default rates for unknown models', async () => {
    await agent.trace('unknown-model-op', async () => 'ok', {
      tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      model: 'unknown-model-v99',
    });

    // (100 * 0.001 + 50 * 0.002) / 1000 = 0.0002
    expect(lastCreatedTrace().costUsd).toBeCloseTo(0.0002, 6);
  });

  it('returns zero cost for zero tokens', async () => {
    await agent.trace('free-op', async () => 'ok', {
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'gpt-4o',
    });

    expect(lastCreatedTrace().costUsd).toBe(0);
  });

  it('honors a custom costCalculator from config', async () => {
    const custom = vi.fn((_tokens: TokenUsage) => 42);
    const customAgent = new AgentTrace({ costCalculator: custom, silent: true });
    customAgent.startRun('custom-cost-run');

    await customAgent.trace('custom-op', async () => 'ok', {
      tokens: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      model: 'gpt-4o',
    });

    expect(custom).toHaveBeenCalled();
    expect(lastCreatedTrace().costUsd).toBe(42);
    customAgent.close();
  });
});

describe('AgentTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs TraceStorage with default dbPath', () => {
    new AgentTrace();
    expect(MockTraceStorage).toHaveBeenCalledWith('./agenttrace.db');
  });

  it('applies constructor options', () => {
    const agent = new AgentTrace({
      dbPath: '/tmp/custom.db',
      maxTraces: 500,
      autoCleanup: false,
      silent: true,
    });

    expect(MockTraceStorage).toHaveBeenCalledWith('/tmp/custom.db');
    agent.close();
  });

  it('close() shuts down storage', () => {
    const agent = new AgentTrace({ silent: true });
    agent.close();
    expect(mockStorage.close).toHaveBeenCalledTimes(1);
  });
});

describe('init()', () => {
  it('returns an AgentTrace instance wired to storage', () => {
    const instance = init({ dbPath: '/tmp/init.db', silent: true });
    expect(instance).toBeInstanceOf(AgentTrace);
    expect(MockTraceStorage).toHaveBeenCalledWith('/tmp/init.db');
    instance.close();
  });
});

describe('startRun()', () => {
  it('returns a valid UUID', () => {
    const agent = new AgentTrace({ silent: true });
    const runId = agent.startRun('my-run');
    expect(runId).toMatch(UUID_RE);
    agent.close();
  });

  it('persists the run via storage', () => {
    const agent = new AgentTrace({ silent: true });
    const metadata = { env: 'test' };
    const runId = agent.startRun('named-run', metadata);

    expect(mockStorage.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: runId,
        name: 'named-run',
        metadata,
      }),
    );
    agent.close();
  });
});

describe('trace()', () => {
  let agent: AgentTrace;

  beforeEach(() => {
    agent = new AgentTrace({ silent: true });
    agent.startRun('trace-run');
  });

  it('returns the function result on success', async () => {
    const result = await agent.trace('success-op', async () => ({ answer: 42 }));
    expect(result).toEqual({ answer: 42 });
    expect(lastCreatedTrace().status).toBe('success');
    expect(lastCreatedTrace().output).toEqual({ answer: 42 });
  });

  it('records error traces and rethrows', async () => {
    await expect(
      agent.trace('fail-op', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const trace = lastCreatedTrace();
    expect(trace.status).toBe('error');
    expect(trace.error).toBe('boom');
  });

  it('stores custom input and token usage', async () => {
    const input = { query: 'hello' };
    const tokens: TokenUsage = {
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    };

    await agent.trace('token-op', async () => 'done', { input, tokens, model: 'claude-sonnet-4' });

    const trace = lastCreatedTrace();
    expect(trace.input).toEqual(input);
    expect(trace.tokens).toEqual(tokens);
    expect(trace.name).toBe('token-op');
  });

  it('runs cleanup when autoCleanup is enabled', async () => {
    mockStorage.cleanup.mockClear();
    const cleanupAgent = new AgentTrace({ maxTraces: 100, silent: true });
    cleanupAgent.startRun('cleanup-run');

    await cleanupAgent.trace('op', async () => 'x');

    expect(mockStorage.cleanup).toHaveBeenCalledWith(100);
    cleanupAgent.close();
  });

  it('skips cleanup when autoCleanup is disabled', async () => {
    mockStorage.cleanup.mockClear();
    const noCleanupAgent = new AgentTrace({ autoCleanup: false, silent: true });
    noCleanupAgent.startRun('no-cleanup-run');

    await noCleanupAgent.trace('op', async () => 'x');

    expect(mockStorage.cleanup).not.toHaveBeenCalled();
    noCleanupAgent.close();
  });
});

describe('getTraces()', () => {
  it('delegates runId filter to storage', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [makeTrace({ runId: 'run-a' })];
    mockStorage.getTraces.mockReturnValue(traces);

    const result = agent.getTraces({ runId: 'run-a' });

    expect(mockStorage.getTraces).toHaveBeenCalledWith({ runId: 'run-a' });
    expect(result).toBe(traces);
    agent.close();
  });

  it('delegates limit to storage', () => {
    const agent = new AgentTrace({ silent: true });
    agent.getTraces({ limit: 5, offset: 10 });

    expect(mockStorage.getTraces).toHaveBeenCalledWith({ limit: 5, offset: 10 });
    agent.close();
  });
});

describe('getStats()', () => {
  it('returns empty stats when storage has no data', () => {
    const agent = new AgentTrace({ silent: true });
    const empty: TraceStats = {
      totalRuns: 0,
      totalTraces: 0,
      successRate: 0,
      avgLatencyMs: 0,
      totalCostUsd: 0,
      totalTokens: 0,
      avgTokensPerTrace: 0,
      topTools: [],
      topErrors: [],
    };
    mockStorage.getStats.mockReturnValue(empty);

    expect(agent.getStats()).toEqual(empty);
    agent.close();
  });

  it('returns stats for runs with mixed success and failure', () => {
    const agent = new AgentTrace({ silent: true });
    const mixed: TraceStats = {
      totalRuns: 1,
      totalTraces: 4,
      successRate: 0.5,
      avgLatencyMs: 120,
      totalCostUsd: 0.05,
      totalTokens: 900,
      avgTokensPerTrace: 225,
      topTools: [],
      topErrors: [{ error: 'boom', count: 2 }],
    };
    mockStorage.getStats.mockReturnValue(mixed);

    expect(agent.getStats()).toEqual(mixed);
    agent.close();
  });
});

describe('export()', () => {
  it('exports traces as JSON', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [makeTrace({ name: 'export-op' })];
    mockStorage.getTraces.mockReturnValue(traces);

    const json = agent.export('json', { runId: 'run-1' });
    const parsed = JSON.parse(json);

    expect(mockStorage.getTraces).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(parsed).toEqual(traces);
    agent.close();
  });

  it('exports traces as CSV with header and data row', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [
      makeTrace({
        id: 't-1',
        runId: 'r-1',
        name: 'csv-op',
        status: 'success',
        latencyMs: 99,
        costUsd: 0.01,
        tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        createdAt: 1234567890,
      }),
    ];
    mockStorage.getTraces.mockReturnValue(traces);

    const csv = agent.export('csv');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('id,runId,name,status,latencyMs,costUsd,totalTokens,createdAt');
    expect(lines[1]).toBe('t-1,r-1,csv-op,success,99,0.01,15,1234567890');
    agent.close();
  });
});

describe('export() otel format', () => {
  it('exports traces as OTLP JSON with correct top-level structure', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [makeTrace({ name: 'otel-op' })];
    mockStorage.getTraces.mockReturnValue(traces);

    const otlpJson = agent.export('otel', { runId: 'run-1' });
    const parsed = JSON.parse(otlpJson);

    expect(mockStorage.getTraces).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(parsed).toHaveProperty('resourceSpans');
    expect(Array.isArray(parsed.resourceSpans)).toBe(true);
    expect(parsed.resourceSpans.length).toBe(1);
    expect(parsed.resourceSpans[0]).toHaveProperty('resource');
    expect(parsed.resourceSpans[0]).toHaveProperty('scopeSpans');
    expect(Array.isArray(parsed.resourceSpans[0].scopeSpans)).toBe(true);
    expect(parsed.resourceSpans[0].scopeSpans.length).toBe(1);
    expect(parsed.resourceSpans[0].scopeSpans[0].scope.name).toBe('agenttrace');
    expect(Array.isArray(parsed.resourceSpans[0].scopeSpans[0].spans)).toBe(true);
    agent.close();
  });

  it('maps trace to OTLP span with traceId/spanId (UUID normalized), kind, times, name', () => {
    const agent = new AgentTrace({ silent: true });
    const traceUuid = '12345678-1234-5678-9abc-123456789def';
    const traces = [
      makeTrace({
        id: traceUuid,
        name: 'span-name',
        status: 'success',
        latencyMs: 42,
        createdAt: 1_700_000_000_042,
      }),
    ];
    mockStorage.getTraces.mockReturnValue(traces);

    const otlpJson = agent.export('otel');
    const parsed = JSON.parse(otlpJson);
    const span = parsed.resourceSpans[0].scopeSpans[0].spans[0];

    expect(span.traceId).toBe('12345678123456789abc123456789def'); // 32 hex, dashes removed
    expect(span.spanId).toBe('1234567812345678'); // first 16 hex chars
    expect(span.name).toBe('span-name');
    expect(span.kind).toBe(1); // SPAN_KIND_INTERNAL
    // start = createdAt - latencyMs (both in ms) then *1e6 for unix nano
    expect(span.startTimeUnixNano).toBe(String(BigInt(1_700_000_000_000) * 1000000n));
    expect(span.endTimeUnixNano).toBe(String(BigInt(1_700_000_000_042) * 1000000n));
    agent.close();
  });

  it('sets STATUS_CODE_OK (1) for success, STATUS_CODE_ERROR (2) for errors with message', () => {
    const agent = new AgentTrace({ silent: true });
    const successTraces = [makeTrace({ id: 's-uuid', status: 'success' })];
    const errorTraces = [makeTrace({ id: 'e-uuid', status: 'error', error: 'boom' })];
    mockStorage.getTraces.mockReturnValue(successTraces);
    let otlp = JSON.parse(agent.export('otel'));
    let span = otlp.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status).toEqual({ code: 1 });

    mockStorage.getTraces.mockReturnValue(errorTraces);
    otlp = JSON.parse(agent.export('otel'));
    span = otlp.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status).toEqual({ code: 2, message: 'boom' });
    agent.close();
  });

  it('includes attributes for metadata, tokens, cost, status', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [
      makeTrace({
        id: 'attr-uuid',
        status: 'success',
        costUsd: 0.123,
        latencyMs: 10,
        tokens: { promptTokens: 11, completionTokens: 22, totalTokens: 33, model: 'gpt-x', provider: 'openai' },
        metadata: { user: 'u1', count: 5, ok: true, obj: { a: 1 } },
      }),
    ];
    mockStorage.getTraces.mockReturnValue(traces);

    const otlp = JSON.parse(agent.export('otel'));
    const attrs = otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const get = (k: string) => attrs.find((a: any) => a.key === k)?.value;

    expect(get('agenttrace.status')?.stringValue).toBe('success');
    expect(get('agenttrace.cost_usd')?.doubleValue).toBe(0.123);
    expect(get('agenttrace.latency_ms')?.intValue).toBe(10);
    expect(get('agenttrace.tokens.prompt')?.intValue).toBe(11);
    expect(get('agenttrace.tokens.completion')?.intValue).toBe(22);
    expect(get('agenttrace.tokens.total')?.intValue).toBe(33);
    expect(get('agenttrace.model')?.stringValue).toBe('gpt-x');
    expect(get('agenttrace.provider')?.stringValue).toBe('openai');
    expect(get('agenttrace.metadata.user')?.stringValue).toBe('u1');
    expect(get('agenttrace.metadata.count')?.intValue).toBe(5);
    expect(get('agenttrace.metadata.ok')?.boolValue).toBe(true);
    expect(get('agenttrace.metadata.obj')?.stringValue).toBe('{"a":1}');
    // also run_id etc
    expect(get('agenttrace.run_id')).toBeTruthy();
    agent.close();
  });

  it('includes resource attributes and handles empty traces', () => {
    const agent = new AgentTrace({ silent: true });
    mockStorage.getTraces.mockReturnValue([]);
    const otlp = JSON.parse(agent.export('otel'));
    expect(otlp.resourceSpans[0].resource.attributes.length).toBeGreaterThan(0);
    const svc = otlp.resourceSpans[0].resource.attributes.find((a: any) => a.key === 'service.name');
    expect(svc.value.stringValue).toBe('agenttrace');
    expect(otlp.resourceSpans[0].scopeSpans[0].spans).toEqual([]);
    agent.close();
  });

  it('handles non-UUID trace ids via hash fallback for traceId/spanId', () => {
    const agent = new AgentTrace({ silent: true });
    const traces = [makeTrace({ id: 'trace-xyz-123' })];
    mockStorage.getTraces.mockReturnValue(traces);
    const otlp = JSON.parse(agent.export('otel'));
    const span = otlp.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    // length checks
    expect(span.traceId.length).toBe(32);
    expect(span.spanId.length).toBe(16);
    agent.close();
  });
});
