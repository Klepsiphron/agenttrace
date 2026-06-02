/**
 * AgentTrace LangGraph Middleware
 * Automatic tracing for LangGraph node executions (JS/TS)
 */
import { randomUUID } from 'node:crypto';
import { AgentTrace, type TraceConfig, type TokenUsage } from '@agenttrace/sdk';

export const VERSION = '0.2.0';
export const PACKAGE_NAME = '@agenttrace/middleware-langgraph';

export type { TraceConfig } from '@agenttrace/sdk';

/**
 * Approximate NodeMiddleware interface implemented for LangGraph.
 * Implementations of beforeNode/afterNode/onError are invoked by LangGraph
 * around each node execution when registered appropriately (e.g. via compile options
 * or graph middleware support in your LangGraph version).
 */
export interface NodeMiddleware {
  beforeNode?(nodeName: string, state: any, config?: any): any | Promise<any>;
  afterNode?(nodeName: string, state: any, result: any, config?: any): any | Promise<any>;
  onError?(nodeName: string, state: any, error: Error, config?: any): void | Promise<void>;
}

export class AgentTraceMiddleware implements NodeMiddleware {
  private agent: AgentTrace;
  // Per-node stacks to support nested/sequential invocations of same node name
  private pending: Record<string, Array<{ startTime: number; input: unknown }>> = {};

  constructor(config: TraceConfig = {}) {
    this.agent = new AgentTrace(config);
  }

  /**
   * Access the underlying AgentTrace instance (e.g. to call startRun()).
   */
  getAgentTrace(): AgentTrace {
    return this.agent;
  }

  beforeNode(nodeName: string, state: any, config?: any): any | Promise<any> {
    if (!this.pending[nodeName]) {
      this.pending[nodeName] = [];
    }
    this.pending[nodeName].push({
      startTime: Date.now(),
      input: state,
    });
    return state;
  }

  afterNode(nodeName: string, state: any, result: any, config?: any): any | Promise<any> {
    const stack = this.pending[nodeName] || [];
    const startInfo = stack.pop() || { startTime: Date.now(), input: state };
    if (stack.length === 0) {
      delete this.pending[nodeName];
    }

    const latencyMs = Date.now() - startInfo.startTime;
    const tokens = this.extractTokens(result, state);
    const costUsd = this.computeCost(tokens, tokens.model);

    this.recordTrace({
      name: nodeName,
      status: 'success',
      input: startInfo.input,
      output: result,
      tokens,
      latencyMs,
      costUsd,
    });

    return result;
  }

  onError(nodeName: string, state: any, error: Error, config?: any): void | Promise<void> {
    const stack = this.pending[nodeName] || [];
    const startInfo = stack.pop() || { startTime: Date.now(), input: state };
    if (stack.length === 0) {
      delete this.pending[nodeName];
    }

    const latencyMs = Date.now() - startInfo.startTime;
    const tokens = this.extractTokens(state, null);
    const costUsd = this.computeCost(tokens, tokens.model);

    this.recordTrace({
      name: nodeName,
      status: 'error',
      input: startInfo.input,
      output: null,
      tokens,
      latencyMs,
      costUsd,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Close the underlying storage connection.
   */
  close(): void {
    this.agent.close();
  }

  private extractTokens(result: any, state: any): TokenUsage {
    const search = [result, state].filter(Boolean);
    for (const cand of search) {
      if (!cand) continue;

      // Array of messages / outputs
      if (Array.isArray(cand)) {
        for (const item of cand) {
          const t = this.extractFromCandidate(item);
          if (t.totalTokens > 0) return t;
        }
      }

      const t = this.extractFromCandidate(cand);
      if (t.totalTokens > 0) return t;
    }

    // Deep scan for any usage-like object
    const deep = this.deepFindUsage([result, state]);
    if (deep) return deep;

    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  private extractFromCandidate(cand: any): TokenUsage {
    if (!cand || typeof cand !== 'object')
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Modern LangChain: usage_metadata
    const um =
      cand.usage_metadata || cand.additional_kwargs?.usage_metadata || cand.kwargs?.usage_metadata;
    if (um && (um.total_tokens != null || um.totalTokens != null)) {
      return {
        promptTokens: um.input_tokens ?? um.prompt_tokens ?? um.promptTokens ?? 0,
        completionTokens: um.output_tokens ?? um.completion_tokens ?? um.completionTokens ?? 0,
        totalTokens: um.total_tokens ?? um.totalTokens ?? 0,
        model: cand.response_metadata?.model_name || cand.name,
      };
    }

    // Older tokenUsage in response_metadata
    const rm = cand.response_metadata || {};
    const tu =
      rm.tokenUsage ||
      rm.token_usage ||
      rm.usage ||
      cand.tokenUsage ||
      cand.usage ||
      cand.llmOutput?.tokenUsage;
    if (tu && (tu.totalTokens != null || tu.total_tokens != null || tu.total != null)) {
      return {
        promptTokens: tu.promptTokens ?? tu.prompt_tokens ?? tu.input_tokens ?? tu.inputTokens ?? 0,
        completionTokens:
          tu.completionTokens ?? tu.completion_tokens ?? tu.output_tokens ?? tu.outputTokens ?? 0,
        totalTokens: tu.totalTokens ?? tu.total_tokens ?? tu.total ?? 0,
        model: rm.model_name,
      };
    }

    // Direct on object
    if (cand.totalTokens != null || cand.total_tokens != null) {
      return {
        promptTokens: cand.promptTokens ?? cand.prompt_tokens ?? cand.input_tokens ?? 0,
        completionTokens:
          cand.completionTokens ?? cand.completion_tokens ?? cand.output_tokens ?? 0,
        totalTokens: cand.totalTokens ?? cand.total_tokens ?? 0,
        model: cand.model,
      };
    }

    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  private deepFindUsage(roots: any[]): TokenUsage | null {
    const seen = new Set<any>();
    const queue = [...roots];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);

      // check keys that look like usage
      for (const [k, v] of Object.entries(cur)) {
        if (/usage|token/i.test(k) && v && typeof v === 'object') {
          const p =
            (v as any).promptTokens ?? (v as any).prompt_tokens ?? (v as any).input_tokens ?? 0;
          const c =
            (v as any).completionTokens ??
            (v as any).completion_tokens ??
            (v as any).output_tokens ??
            0;
          const t = (v as any).totalTokens ?? (v as any).total_tokens ?? (v as any).total ?? 0;
          if (t || p || c) {
            return {
              promptTokens: p,
              completionTokens: c,
              totalTokens: t,
              model: (v as any).model,
            };
          }
        }
        if (v && typeof v === 'object') queue.push(v);
      }
    }
    return null;
  }

  private computeCost(tokens: TokenUsage, model?: string): number {
    const cfg = (this.agent as any).config || {};
    const calc = cfg.costCalculator;
    if (typeof calc === 'function') {
      return calc(tokens, model || tokens.model);
    }
    // Fallback (matches SDK defaultCostCalculator)
    const rates: Record<string, { prompt: number; completion: number }> = {
      'gpt-4o': { prompt: 0.0025, completion: 0.01 },
      'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
      'claude-sonnet-4': { prompt: 0.003, completion: 0.015 },
      'claude-haiku-4': { prompt: 0.00025, completion: 0.00125 },
      'gemini-2.0-flash': { prompt: 0.0001, completion: 0.0004 },
      'llama-3.1-70b': { prompt: 0.0009, completion: 0.0009 },
    };
    const rate = rates[model || tokens.model || ''] || { prompt: 0.001, completion: 0.002 };
    return (tokens.promptTokens * rate.prompt + tokens.completionTokens * rate.completion) / 1000;
  }

  private recordTrace(opts: {
    name: string;
    status: 'success' | 'error';
    input: unknown;
    output: unknown;
    tokens: TokenUsage;
    latencyMs: number;
    costUsd: number;
    error?: string;
  }): void {
    const storage = (this.agent as any).storage;
    const cfg = (this.agent as any).config || {};
    const runId = (this.agent as any).currentRunId || randomUUID();

    const trace = {
      id: randomUUID(),
      runId,
      name: opts.name,
      status: opts.status,
      input: opts.input ?? null,
      output: opts.output ?? null,
      tokens: opts.tokens,
      toolCalls: [],
      latencyMs: opts.latencyMs,
      costUsd: opts.costUsd,
      error: opts.error,
      metadata: { framework: 'langgraph' as const },
    };

    try {
      storage.createTrace(trace);
      if (cfg.autoCleanup !== false) {
        storage.cleanup(cfg.maxTraces || 10000);
      }
    } catch (e) {
      if (!cfg.silent) {
        // eslint-disable-next-line no-console
        console.error('[AgentTraceMiddleware] failed to record trace:', e);
      }
    }
  }
}
