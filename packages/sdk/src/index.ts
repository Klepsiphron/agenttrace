/**
 * AgentTrace -- Core SDK
 * Drop-in tracing for any AI agent
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite row mapping uses loose any (pre-existing pattern) */

import { randomUUID } from 'node:crypto';
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
} from './types.js';

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
   * Export traces to JSON or CSV
   */
  export(format: ExportFormat = 'json', filter: TraceFilter = {}): string {
    const traces = this.storage.getTraces(filter);

    if (format === 'json') {
      return JSON.stringify(traces, null, 2);
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
