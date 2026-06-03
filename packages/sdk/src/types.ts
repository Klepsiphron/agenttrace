/**
 * AgentTrace -- Core Types
 * Open source AI agent observability
 */

/** A single tool call within an agent run */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latencyMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

/** Token usage for a single LLM call */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}

/** A single trace (one agent run) */
export interface Trace {
  id: string;
  runId: string;
  name: string;
  status: 'success' | 'failure' | 'error' | 'timeout';
  input: unknown;
  output: unknown;
  tokens: TokenUsage;
  toolCalls: ToolCall[];
  latencyMs: number;
  costUsd: number;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Summary of an agent run (collection of traces) */
export interface Run {
  id: string;
  name: string;
  status: 'running' | 'success' | 'failure' | 'error';
  traceCount: number;
  totalTokens: TokenUsage;
  totalToolCalls: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  errorCount: number;
  startedAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;
}

/** Configuration for the trace collector */
export interface TraceConfig {
  /** Database file path (default: './agenttrace.db') */
  dbPath?: string;
  /** Maximum number of traces to retain (default: 10000) */
  maxTraces?: number;
  /** Enable automatic cleanup of old traces */
  autoCleanup?: boolean;
  /** Custom cost calculator (tokens -> USD) */
  costCalculator?: (tokens: TokenUsage, model?: string) => number;
  /** Custom hallucination detector */
  hallucinationDetector?: (output: unknown, expected?: unknown) => boolean;
  /** Silence console output */
  silent?: boolean;
}

/** Filter options for querying traces */
export interface TraceFilter {
  runId?: string;
  status?: Trace['status'][];
  name?: string;
  fromDate?: number;
  toDate?: number;
  minCost?: number;
  maxCost?: number;
  minLatency?: number;
  maxLatency?: number;
  limit?: number;
  offset?: number;
}

/** Summary statistics */
export interface TraceStats {
  totalRuns: number;
  totalTraces: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  totalTokens: number;
  avgTokensPerTrace: number;
  topTools: { name: string; count: number; avgLatencyMs: number }[];
  topErrors: { error: string; count: number }[];
}

/** Agent framework integrations */
export type AgentFramework = 'langgraph' | 'crewai' | 'autogen' | 'custom';

/** Framework-specific integration config */
export interface FrameworkIntegration {
  framework: AgentFramework;
  version?: string;
  autoTrace?: boolean;
  traceTools?: boolean;
  traceTokens?: boolean;
}

/** Export format */
export type ExportFormat = 'json' | 'csv' | 'otel';

/** Dashboard server config */
export interface DashboardConfig {
  port?: number;
  host?: string;
  openBrowser?: boolean;
  dbPath?: string;
}

/** Scorer function that evaluates a trace and returns a numeric score */
export interface Scorer {
  name: string;
  fn: (trace: Trace) => number | Promise<number>;
}

/** Result of running scorers against a trace */
export interface ScorerResult {
  traceId: string;
  scores: Record<string, number>;
  errors: Record<string, string>;
}

/** Options for running evaluations */
export interface EvaluateOptions {
  scorers: Scorer[];
  runId?: string;
  traceIds?: string[];
  concurrency?: number;
}
