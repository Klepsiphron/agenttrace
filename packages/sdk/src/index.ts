/**
 * AgentTrace -- Core SDK
 * Drop-in tracing for any AI agent
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite row mapping uses loose any (pre-existing pattern) */

import { randomUUID, createHash } from 'node:crypto';
import { TraceStorage } from './storage.js';
import {
  Trace,
  Run,
  TraceConfig,
  TraceFilter,
  TraceStats,
  TokenUsage,
  ToolCall,
  ExportFormat,
  Scorer,
  ScorerResult,
  EvaluateOptions,
} from './types.js';

export const VERSION = '0.1.0';
export const PACKAGE_NAME = '@agenttrace/sdk';

export type {
  Trace,
  Run,
  TraceConfig,
  TraceFilter,
  TraceStats,
  TokenUsage,
  ToolCall,
  ExportFormat,
  DashboardConfig,
  AgentFramework,
  FrameworkIntegration,
  Scorer,
  ScorerResult,
  EvaluateOptions,
} from './types.js';

export { TraceStorage } from './storage.js';

// Default cost calculator (approximate 2026 pricing)
function defaultCostCalculator(tokens: TokenUsage, model?: string): number {
  const rates: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o': { prompt: 0.0025, completion: 0.01 },
    'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
    'claude-sonnet-4': { prompt: 0.003, completion: 0.015 },
    'claude-haiku-4': { prompt: 0.00025, completion: 0.00125 },
    'gemini-2.0-flash': { prompt: 0.0001, completion: 0.0004 },
    'llama-3.1-70b': { prompt: 0.0009, completion: 0.0009 },
  };

  const rate = rates[model || ''] || { prompt: 0.001, completion: 0.002 };
  return (tokens.promptTokens * rate.prompt + tokens.completionTokens * rate.completion) / 1000;
}

// ---- OpenTelemetry (OTLP JSON) export helpers (no external deps) ----

function toOtelId(id: string, length: number): string {
  const cleaned = id.replace(/-/g, '');
  if (/^[0-9a-fA-F]{32}$/.test(cleaned)) {
    return cleaned.toLowerCase().slice(0, length);
  }
  // Fallback for non-UUID ids (e.g. test data like 'trace-1'); deterministic
  return createHash('sha256').update(id).digest('hex').slice(0, length);
}

function toUnixNano(timestampMs: number): string {
  return String(BigInt(Math.floor(timestampMs)) * 1000000n);
}

function toOtelAttrValue(v: unknown): any {
  if (v === null || v === undefined) return undefined;
  const t = typeof v;
  if (t === 'string') return { stringValue: v as string };
  if (t === 'number') {
    return Number.isInteger(v as number) ? { intValue: v as number } : { doubleValue: v as number };
  }
  if (t === 'boolean') return { boolValue: v as boolean };
  return { stringValue: JSON.stringify(v) };
}

function stringifyForAttr(v: unknown, maxLen = 2048): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

function buildOtelAttributes(trace: Trace): Array<{ key: string; value: any }> {
  const attrs: Array<{ key: string; value: any }> = [];
  attrs.push({ key: 'agenttrace.status', value: { stringValue: trace.status } });
  attrs.push({ key: 'agenttrace.latency_ms', value: { intValue: trace.latencyMs } });
  attrs.push({ key: 'agenttrace.cost_usd', value: { doubleValue: trace.costUsd } });
  attrs.push({ key: 'agenttrace.run_id', value: { stringValue: trace.runId } });
  const tok = trace.tokens || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  attrs.push({ key: 'agenttrace.tokens.prompt', value: { intValue: tok.promptTokens } });
  attrs.push({ key: 'agenttrace.tokens.completion', value: { intValue: tok.completionTokens } });
  attrs.push({ key: 'agenttrace.tokens.total', value: { intValue: tok.totalTokens } });
  if (tok.model) {
    attrs.push({ key: 'agenttrace.model', value: { stringValue: tok.model } });
  }
  if (tok.provider) {
    attrs.push({ key: 'agenttrace.provider', value: { stringValue: tok.provider } });
  }
  if (trace.error) {
    attrs.push({ key: 'agenttrace.error', value: { stringValue: trace.error } });
  }
  // metadata
  const meta = trace.metadata || {};
  for (const [k, v] of Object.entries(meta)) {
    const otelVal = toOtelAttrValue(v);
    if (otelVal) {
      attrs.push({ key: `agenttrace.metadata.${k}`, value: otelVal });
    }
  }
  // input/output (stringified, truncated)
  if (trace.input != null) {
    attrs.push({ key: 'agenttrace.input', value: { stringValue: stringifyForAttr(trace.input) } });
  }
  if (trace.output != null) {
    attrs.push({
      key: 'agenttrace.output',
      value: { stringValue: stringifyForAttr(trace.output) },
    });
  }
  return attrs;
}

function buildResourceAttributes(): Array<{ key: string; value: any }> {
  return [
    { key: 'service.name', value: { stringValue: 'agenttrace' } },
    { key: 'telemetry.sdk.name', value: { stringValue: 'agenttrace' } },
    { key: 'telemetry.sdk.version', value: { stringValue: VERSION } },
  ];
}

function traceToOtelSpan(trace: Trace): any {
  const traceId = toOtelId(trace.id, 32);
  const spanId = toOtelId(trace.id, 16);
  const endMs = trace.createdAt || Date.now();
  const startMs = Math.max(0, endMs - (trace.latencyMs || 0));
  const startTimeUnixNano = toUnixNano(startMs);
  const endTimeUnixNano = toUnixNano(endMs);
  const attributes = buildOtelAttributes(trace);
  const isSuccess = trace.status === 'success';
  const status: any = isSuccess
    ? { code: 1 } // STATUS_CODE_OK
    : { code: 2, message: trace.error || trace.status }; // STATUS_CODE_ERROR
  return {
    traceId,
    spanId,
    name: trace.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano,
    endTimeUnixNano,
    attributes,
    status,
  };
}

export class AgentTrace {
  private storage: TraceStorage;
  private config: Required<TraceConfig>;
  private currentRunId: string | null = null;

  constructor(config: TraceConfig = {}) {
    this.config = {
      dbPath: config.dbPath || './agenttrace.db',
      maxTraces: config.maxTraces || 10000,
      autoCleanup: config.autoCleanup !== false,
      costCalculator: config.costCalculator || defaultCostCalculator,
      hallucinationDetector: config.hallucinationDetector || (() => false),
      silent: config.silent || false,
    };
    this.storage = new TraceStorage(this.config.dbPath);
  }

  /**
   * Start a new agent run
   */
  startRun(name: string, metadata: Record<string, unknown> = {}): string {
    const runId = randomUUID();
    this.storage.createRun({
      id: runId,
      name,
      startedAt: Date.now(),
      metadata,
    });
    this.currentRunId = runId;
    return runId;
  }

  /**
   * Complete the current run
   */
  completeRun(status: Run['status'] = 'success'): void {
    if (this.currentRunId) {
      this.storage.completeRun(this.currentRunId, status);
      this.currentRunId = null;
    }
  }

  /**
   * Trace an async function call
   */
  async trace<T>(
    name: string,
    fn: () => Promise<T>,
    options: {
      input?: unknown;
      tokens?: TokenUsage;
      model?: string;
      provider?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const traceId = randomUUID();
    const startTime = Date.now();
    const toolCalls: ToolCall[] = [];
    let result: T;
    let error: string | undefined;
    let status: Trace['status'] = 'success';

    try {
      result = await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      status = 'error';
      throw e;
    } finally {
      const latencyMs = Date.now() - startTime;
      const tokens: TokenUsage = options.tokens || {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: options.model,
        provider: options.provider,
      };
      const costUsd = this.config.costCalculator(tokens, options.model);

      const trace: Omit<Trace, 'createdAt' | 'updatedAt'> = {
        id: traceId,
        runId: this.currentRunId || randomUUID(),
        name,
        status,
        input: options.input ?? null,
        output: result! ?? null,
        tokens,
        toolCalls,
        latencyMs,
        costUsd,
        error,
        metadata: options.metadata || {},
      };

      this.storage.createTrace(trace);

      if (this.config.autoCleanup) {
        this.storage.cleanup(this.config.maxTraces);
      }
    }

    return result!;
  }

  /**
   * Record a tool call within the current trace
   */
  recordToolCall(_call: Omit<ToolCall, 'id' | 'timestamp'>): string {
    const id = randomUUID();
    // Tool calls are stored as part of the trace
    return id;
  }

  /**
   * Get traces with filtering
   */
  getTraces(filter: TraceFilter = {}): Trace[] {
    return this.storage.getTraces(filter);
  }

  /**
   * Get a specific trace
   */
  getTrace(id: string): Trace | null {
    return this.storage.getTrace(id);
  }

  /**
   * Get recent runs (most recent first)
   */
  getRuns(limit: number = 100): Run[] {
    return this.storage.getRuns(limit);
  }

  /**
   * Get a specific run
   */
  getRun(id: string): Run | null {
    return this.storage.getRun(id);
  }

  /**
   * Get summary statistics
   */
  getStats(): TraceStats {
    return this.storage.getStats();
  }

  /**
   * Export traces to JSON, CSV, or OpenTelemetry (OTLP JSON)
   */
  export(format: ExportFormat = 'json', filter: TraceFilter = {}): string {
    const traces = this.storage.getTraces(filter);

    if (format === 'json') {
      return JSON.stringify(traces, null, 2);
    }

    if (format === 'otel') {
      const resourceAttributes = buildResourceAttributes();
      const spans = traces.map((t) => traceToOtelSpan(t));
      const otlp = {
        resourceSpans: [
          {
            resource: { attributes: resourceAttributes },
            scopeSpans: [
              {
                scope: { name: 'agenttrace' },
                spans,
              },
            ],
          },
        ],
      };
      return JSON.stringify(otlp, null, 2);
    }

    // CSV
    const headers = [
      'id',
      'runId',
      'name',
      'status',
      'latencyMs',
      'costUsd',
      'totalTokens',
      'createdAt',
    ];
    const rows = traces.map((t) => [
      t.id,
      t.runId,
      t.name,
      t.status,
      t.latencyMs,
      t.costUsd,
      t.tokens.totalTokens,
      t.createdAt,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.storage.close();
  }

  /**
   * Evaluate traces using the provided scorers.
   * If traceIds provided, scores only those; if runId, scores traces in that run; otherwise all traces.
   */
  async evaluate(options: EvaluateOptions): Promise<ScorerResult[]> {
    const { scorers, runId, traceIds, concurrency } = options;
    if (!scorers || scorers.length === 0) {
      return [];
    }

    let traces: Trace[];
    if (traceIds && traceIds.length > 0) {
      traces = traceIds.map((id) => this.getTrace(id)).filter((t): t is Trace => t != null);
    } else if (runId) {
      traces = this.getTraces({ runId });
    } else {
      traces = this.getTraces();
    }

    return this.scoreLoop(traces, scorers, concurrency);
  }

  /**
   * Score a single trace by id.
   */
  async evaluateTrace(traceId: string, scorers: Scorer[]): Promise<ScorerResult> {
    const trace = this.getTrace(traceId);
    if (!trace) {
      return { traceId, scores: {}, errors: {} };
    }
    return this.scoreTrace(trace, scorers);
  }

  /**
   * Internal helper to iterate traces with limited concurrency, run scorers, store scores.
   */
  private async scoreLoop(
    traces: Trace[],
    scorers: Scorer[],
    concurrency?: number,
  ): Promise<ScorerResult[]> {
    if (traces.length === 0) return [];
    const limit = Math.max(1, concurrency ?? 5);
    const results: ScorerResult[] = [];
    for (let i = 0; i < traces.length; i += limit) {
      const chunk = traces.slice(i, i + limit);
      const chunkResults = await Promise.all(chunk.map((t) => this.scoreTrace(t, scorers)));
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Internal: run all scorers on one trace (in parallel), catch errors, store successful scores.
   */
  private async scoreTrace(trace: Trace, scorers: Scorer[]): Promise<ScorerResult> {
    const traceId = trace.id;
    const scores: Record<string, number> = {};
    const errors: Record<string, string> = {};

    await Promise.all(
      scorers.map(async (scorer) => {
        try {
          const val = await Promise.resolve(scorer.fn(trace));
          if (typeof val === 'number' && Number.isFinite(val)) {
            scores[scorer.name] = val;
            const id = randomUUID();
            this.storage.createScore(id, traceId, scorer.name, val);
          } else {
            errors[scorer.name] = `Invalid score returned: ${val}`;
          }
        } catch (e: any) {
          errors[scorer.name] = e instanceof Error ? e.message : String(e);
        }
      }),
    );

    return { traceId, scores, errors };
  }
}

// Singleton for convenience
let instance: AgentTrace | null = null;

export function init(config?: TraceConfig): AgentTrace {
  instance = new AgentTrace(config);
  return instance;
}

export function getAgentTrace(): AgentTrace {
  if (!instance) {
    instance = new AgentTrace();
  }
  return instance;
}

/**
 * Helper to create a Scorer from name + function.
 */
export function score(name: string, fn: Scorer['fn']): Scorer {
  return { name, fn };
}
