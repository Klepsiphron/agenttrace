/**
 * AgentTrace Auto-Instrument
 * 
 * Zero-code auto-instrumentation for AI agents.
 * 
 * Usage (import before any agent framework):
 *   import '@agenttrace-io/auto-instrument';
 * 
 * Or via CLI:
 *   agenttrace-instrument node my-agent.js
 *   agenttrace-instrument --scan
 * 
 * Environment variables:
 *   AGENTTRACE_DB_PATH     Database path (default: ./agenttrace.db)
 *   AGENTTRACE_SERVICE_NAME Service name (default: from package.json)
 *   AGENTTRACE_AUTO_INIT   Auto-init on import (true/false)
 */

import type { TraceStorage, Run, Trace } from '@agenttrace-io/sdk';

export interface AutoInstrumentConfig {
  dbPath?: string;
  serviceName?: string;
  console?: boolean;
}

let initialized = false;

/**
 * Initialize auto-instrumentation.
 */
export function initAutoInstrument(config: AutoInstrumentConfig = {}): void {
  if (initialized) return;
  initialized = true;

  const dbPath = config.dbPath || process.env.AGENTTRACE_DB_PATH || './agenttrace.db';
  
  if (config.console || process.env.AGENTTRACE_DEBUG === 'true') {
    console.log(`[AgentTrace] Auto-instrumentation initialized`);
    console.log(`[AgentTrace] DB: ${dbPath}`);
  }

  // Set up process-level hooks for detecting agent activity
  setupProcessHooks(dbPath, config);
}

function setupProcessHooks(dbPath: string, config: AutoInstrumentConfig): void {
  // Hook into common agent framework imports
  const originalRequire = Module.prototype.require;
  
  // @ts-ignore
  Module.prototype.require = function(id: string) {
    const result = originalRequire.apply(this, arguments);
    
    // Auto-detect LangChain
    if (id.includes('langchain') || id.includes('@langchain')) {
      try {
        patchLangChain(result, dbPath);
      } catch { /* ignore */ }
    }
    
    // Auto-detect OpenAI SDK
    if (id === 'openai' || id.includes('openai')) {
      try {
        patchOpenAI(result, dbPath);
      } catch { /* ignore */ }
    }
    
    return result;
  };
}

function patchLangChain(mod: any, dbPath: string): void {
  // Patch LangChain's BaseChain._call to trace execution
  if (mod?.BaseChain?.prototype?._call) {
    const original = mod.BaseChain.prototype._call;
    mod.BaseChain.prototype._call = async function(...args: any[]) {
      const startTime = Date.now();
      try {
        const result = await original.apply(this, args);
        const latencyMs = Date.now() - startTime;
        recordTrace(dbPath, {
          name: `langchain:${this.constructor.name}`,
          status: 'success',
          input: args[0],
          output: result,
          latencyMs,
        });
        return result;
      } catch (e) {
        const latencyMs = Date.now() - startTime;
        recordTrace(dbPath, {
          name: `langchain:${this.constructor.name}`,
          status: 'error',
          input: args[0],
          output: null,
          latencyMs,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    };
  }
}

function patchOpenAI(mod: any, dbPath: string): void {
  // Patch OpenAI's chat.completions.create
  if (mod?.OpenAI?.prototype?.chat?.completions?.create) {
    const original = mod.OpenAI.prototype.chat.completions.create;
    mod.OpenAI.prototype.chat.completions.create = async function(...args: any[]) {
      const startTime = Date.now();
      const body = args[0] || {};
      try {
        const result = await original.apply(this, args);
        const latencyMs = Date.now() - startTime;
        const usage = result?.usage || {};
        recordTrace(dbPath, {
          name: `openai:${body.model || 'unknown'}`,
          status: 'success',
          input: body.messages,
          output: result?.choices?.[0]?.message,
          latencyMs,
          tokens: {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          },
          model: body.model,
        });
        return result;
      } catch (e) {
        const latencyMs = Date.now() - startTime;
        recordTrace(dbPath, {
          name: `openai:${body.model || 'unknown'}`,
          status: 'error',
          input: body.messages,
          output: null,
          latencyMs,
          error: e instanceof Error ? e.message : String(e),
          model: body.model,
        });
        throw e;
      }
    };
  }
}

function recordTrace(dbPath: string, data: {
  name: string;
  status: string;
  input: any;
  output: any;
  latencyMs: number;
  tokens?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model?: string;
  error?: string;
}): void {
  try {
    // Dynamic import to avoid circular deps
    const { TraceStorage } = require('@agenttrace-io/sdk');
    const storage = new TraceStorage(dbPath);
    const runId = storage.createRun({
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      startedAt: Date.now() - data.latencyMs,
      metadata: { autoInstrumented: true, model: data.model },
    });
    storage.createTrace({
      id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      name: data.name,
      status: data.status as any,
      input: data.input,
      output: data.output,
      tokens: data.tokens || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: data.latencyMs,
      costUsd: 0,
      error: data.error,
      metadata: { autoInstrumented: true },
    });
    storage.completeRun(data.status === 'success' ? 'success' : 'error');
    storage.close();
  } catch {
    // Never crash the host application
  }
}

// Auto-init if AGENTTRACE_AUTO_INIT is set
if (process.env.AGENTTRACE_AUTO_INIT === 'true') {
  initAutoInstrument();
}

export default { initAutoInstrument };
