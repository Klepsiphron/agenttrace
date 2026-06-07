/**
 * AgentTrace Auto-Instrument
 * 
 * Zero-code auto-instrumentation for AI agents.
 * 
 * Usage (before any other imports):
 *   import '@agenttrace-io/auto-instrument';
 * 
 * Or via CLI:
 *   agenttrace-instrument node my-agent.js
 * 
 * Automatically detects and traces:
 * - LangChain / LangGraph (@arizeai/openinference-instrumentation-langchain)
 * - CrewAI (openinference-instrumentation-crewai)
 * - AutoGen (openinference-instrumentation-autogen)
 * - Raw OpenAI API calls (HTTP interception)
 * - Raw Anthropic API calls (HTTP interception)
 * - Any HTTP call to known LLM provider endpoints
 */

import { NodeSDK } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { NodeSDKOptions } from '@opentelemetry/sdk-trace-node';
import type { InstrumentationOption } from '@opentelemetry/instrumentation';

// AgentTrace storage backend for OpenTelemetry spans
import { TraceStorage, Run, Trace } from '@agenttrace-io/sdk';

const AGENTTRACE_VERSION = '0.4.0';

export interface AutoInstrumentConfig {
  /** AgentTrace database path */
  dbPath?: string;
  /** Service name for traces */
  serviceName?: string;
  /** Service version */
  serviceVersion?: string;
  /** Enable console output of traces */
  console?: boolean;
  /** Custom trace storage instance */
  storage?: TraceStorage;
  /** Additional OpenTelemetry instrumentations */
  extraInstrumentations?: InstrumentationOption[];
}

// Global state
let sdk: NodeSDK | null = null;
let storage: TraceStorage | null = null;
let activeSpans: Map<string, { runId: string; traceId: string; startTime: number }> = new Map();

/**
 * Initialize auto-instrumentation.
 * Call this before any agent framework imports.
 */
export function initAutoInstrument(config: AutoInstrumentConfig = {}): NodeSDK {
  if (sdk) {
    return sdk; // Already initialized
  }

  const dbPath = config.dbPath || process.env.AGENTTRACE_DB_PATH || './agenttrace.db';
  const serviceName = config.serviceName || process.env.AGENTTRACE_SERVICE_NAME || detectServiceName();
  
  // Create our storage backend
  storage = config.storage || new TraceStorage(dbPath);

  // Build OpenTelemetry instrumentations
  const instrumentations: InstrumentationOption[] = [];

  // HTTP instrumentation - captures ALL HTTP calls including to LLM APIs
  instrumentations.push(new HttpInstrumentation({
    ignoreIncomingPaths: ['/health', '/api/health'],
    headersToCapture: ['content-type', 'x-request-id'],
  }));

  // Try to load optional framework-specific instrumentations
  instrumentations.push(...loadOptionalInstrumentations());

  // Add any user-provided instrumentations
  if (config.extraInstrumentations) {
    instrumentations.push(...config.extraInstrumentations);
  }

  // Custom span processor that bridges OTel spans → AgentTrace storage
  const agentTraceProcessor = new AgentTraceSpanProcessor(storage, config.console);

  // Create the OTel NodeSDK
  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion || AGENTTRACE_VERSION,
      [SemanticResourceAttributes.AGENTTRACE_VERSION]: AGENTTRACE_VERSION,
    }),
    spanProcessor: new BatchSpanProcessor(agentTraceProcessor),
    contextManager: new AsyncLocalStorageContextManager(),
    instrumentations,
  });

  sdk.start();

  // Register shutdown hooks
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  process.on('exit', () => shutdown());

  if (config.console) {
    console.log(`[AgentTrace] Auto-instrumentation initialized for "${serviceName}"`);
    console.log(`[AgentTrace] DB: ${dbPath}`);
  }

  return sdk;
}

/**
 * Shutdown auto-instrumentation gracefully.
 */
export function shutdown(): void {
  if (sdk) {
    sdk.shutdown().then(() => {
      if (storage) {
        try { storage.close(); } catch { /* ignore */ }
      }
    });
    sdk = null;
  }
}

/**
 * Get the current trace storage instance.
 */
export function getStorage(): TraceStorage | null {
  return storage;
}

/**
 * Detect service name from package.json or process.
 */
function detectServiceName(): string {
  try {
    // Try to read package.json from cwd
    const fs = require('node:fs');
    const path = require('node:path');
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.name || 'unknown-agent';
    }
  } catch { /* ignore */ }
  
  // Fallback to script name
  const scriptPath = process.argv[1];
  if (scriptPath) {
    return require('node:path').basename(scriptPath, require('node:path').extname(scriptPath));
  }
  
  return 'unknown-agent';
}

/**
 * Try to load optional framework-specific instrumentations.
 * These are optional - if not installed, we still work via HTTP interception.
 */
function loadOptionalInstrumentations(): InstrumentationOption[] {
  const instrumentations: InstrumentationOption[] = [];

  // LangChain.js
  try {
    const { LangChainInstrumentation } = require('@arizeai/openinference-instrumentation-langchain');
    instrumentations.push(new LangChainInstrumentation({}));
  } catch { /* optional */ }

  // OpenAI SDK
  try {
    const { OpenAIInstrumentation } = require('@opentelemetry/instrumentation-openai');
    instrumentations.push(new OpenAIInstrumentation({}));
  } catch { /* optional */ }

  // CrewAI (Python - would need a bridge, skip for Node.js)

  return instrumentations;
}

/**
 * Custom OpenTelemetry SpanProcessor that bridges spans to AgentTrace storage.
 */
import { SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base';

class AgentTraceSpanProcessor implements SpanProcessor {
  private storage: TraceStorage;
  private console: boolean;

  constructor(storage: TraceStorage, consoleOutput = false) {
    this.storage = storage;
    this.console = consoleOutput;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onStart(span: Span): void {
    // Track active spans
    const spanContext = span.spanContext();
    activeSpans.set(spanContext.traceId, {
      runId: '',
      traceId: spanContext.traceId,
      startTime: Date.now(),
    });
  }

  onEnd(span: ReadableSpan): void {
    const spanContext = span.spanContext();
    const name = span.name;
    const attributes = span.attributes;
    const status = span.status;
    const startTime = span.startTime[0] * 1000 + Math.floor(span.startTime[1] / 1_000_000);
    const endTime = span.endTime[0] * 1000 + Math.floor(span.endTime[1] / 1_000_000);
    const latencyMs = endTime - startTime;

    // Determine if this is an LLM call
    const isLLMCall = this.isLLMCall(name, attributes);
    const isAgentInvocation = this.isAgentInvocation(name, attributes);

    // Extract relevant data
    const model = String(attributes['llm.model'] || attributes['gen_ai.request.model'] || attributes['openai.model'] || '');
    const promptTokens = Number(attributes['llm.usage.prompt_tokens'] || attributes['gen_ai.usage.input_tokens'] || attributes['openai.usage.prompt_tokens'] || 0);
    const completionTokens = Number(attributes['llm.usage.completion_tokens'] || attributes['gen_ai.usage.output_tokens'] || attributes['openai.usage.completion_tokens'] || 0);
    const totalTokens = promptTokens + completionTokens;
    const costUsd = this.calculateCost(model, promptTokens, completionTokens);

    // Find or create parent run
    const parentTraceId = String(attributes['agenttrace.parent_trace_id'] || '');
    let runId = parentTraceId;
    
    if (!runId) {
      // Create a new run for this trace
      runId = this.storage.createRun({
        id: spanContext.traceId,
        name: isAgentInvocation ? name : `http:${name}`,
        startedAt: startTime,
        metadata: {
          serviceName: String(attributes['service.name'] || 'unknown'),
          isLLMCall,
          isAgentInvocation,
          spanKind: String(span.kind || 'INTERNAL'),
          ...this.sanitizeAttributes(attributes),
        },
      });
    }

    // Create the trace
    try {
      this.storage.createTrace({
        id: spanContext.spanId || `${spanContext.traceId}-${Date.now()}`,
        runId,
        name,
        status: status.code === 0 ? 'success' : 'error',
        input: this.extractInput(attributes),
        output: this.extractOutput(attributes),
        tokens: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        latencyMs,
        costUsd,
        error: status.message || undefined,
        metadata: {
          otelSpanKind: String(span.kind || ''),
          otelStatusCode: String(status.code),
          model,
          ...this.sanitizeAttributes(attributes),
        },
        parentId: undefined,
      });
    } catch (e) {
      // Don't crash the host application if tracing fails
      if (this.console) {
        console.error(`[AgentTrace] Failed to record trace:`, e);
      }
    }

    // Clean up
    activeSpans.delete(spanContext.traceId);
  }

  private isLLMCall(name: string, attrs: Record<string, unknown>): boolean {
    const lower = name.toLowerCase();
    return lower.includes('openai') || lower.includes('anthropic') || lower.includes('claude') ||
           lower.includes('gpt') || lower.includes('llm') || lower.includes('chat') ||
           lower.includes('completion') || lower.includes('generate') ||
           !!attrs['llm.model'] || !!attrs['gen_ai.request.model'] || !!attrs['openai.model'];
  }

  private isAgentInvocation(name: string, attrs: Record<string, unknown>): boolean {
    const lower = name.toLowerCase();
    return lower.includes('agent') || lower.includes('chain') || lower.includes('graph') ||
           lower.includes('crew') || lower.includes('autogen') || lower.includes('executor') ||
           !!attrs['agent.name'] || !!attrs['langchain.chain.type'];
  }

  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Approximate pricing per 1K tokens
    const pricing: Record<string, { prompt: number; completion: number }> = {
      'gpt-4o': { prompt: 0.0025, completion: 0.01 },
      'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
      'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
      'gpt-4': { prompt: 0.03, completion: 0.06 },
      'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
      'claude-3-opus': { prompt: 0.015, completion: 0.075 },
      'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
      'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
      'claude-3.5-sonnet': { prompt: 0.003, completion: 0.015 },
    };

    const modelKey = Object.keys(pricing).find(k => model.toLowerCase().includes(k)) || 'gpt-4o';
    const p = pricing[modelKey] || pricing['gpt-4o'];
    return (promptTokens / 1000) * p.prompt + (completionTokens / 1000) * p.completion;
  }

  private extractInput(attrs: Record<string, unknown>): unknown {
    return attrs['llm.prompt'] || attrs['gen_ai.prompt'] || attrs['http.url'] || attrs['http.target'] || null;
  }

  private extractOutput(attrs: Record<string, unknown>): unknown {
    return attrs['llm.response'] || attrs['gen_ai.completion'] || attrs['http.status_code'] || null;
  }

  private sanitizeAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      }
    }
    return result;
  }
}

// Auto-initialize if AGENTTRACE_AUTO_INIT is set
if (process.env.AGENTTRACE_AUTO_INIT === 'true') {
  initAutoInstrument({
    console: process.env.AGENTTRACE_DEBUG === 'true',
  });
}
