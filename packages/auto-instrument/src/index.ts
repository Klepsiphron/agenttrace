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
 *   AGENTTRACE_DB_PATH       Database path (default: ~/.agenttrace/agenttrace.db)
 *   AGENTTRACE_SERVICE_NAME  Service name (default: from package.json)
 *   AGENTTRACE_AUTO_INIT     Auto-init on import (true/false)
 *   AGENTTRACE_DEBUG         Enable debug output (true/false)
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let initialized = false;
let shutdownHandlersRegistered = false;

export interface AutoInstrumentConfig {
  dbPath?: string;
  serviceName?: string;
  console?: boolean;
  scanIntervalMs?: number;
}

function getDbPath(config?: AutoInstrumentConfig): string {
  return (
    config?.dbPath ||
    process.env.AGENTTRACE_DB_PATH ||
    path.join(os.homedir(), '.agenttrace', 'agenttrace.db')
  );
}

/**
 * Initialize auto-instrumentation.
 * Patches require() to auto-detect and patch known agent frameworks.
 */
export function initAutoInstrument(config: AutoInstrumentConfig = {}): void {
  if (initialized) return;
  initialized = true;

  const dbPath = getDbPath(config);

  if (config.console || process.env.AGENTTRACE_DEBUG === 'true') {
    console.log(`[AgentTrace] Auto-instrumentation initialized`);
    console.log(`[AgentTrace] DB: ${dbPath}`);
  }

  setupProcessHooks(dbPath, config);
  registerShutdownHandlers();
}

function setupProcessHooks(dbPath: string, config: AutoInstrumentConfig): void {
  // @ts-ignore - Module is available in Node.js
  const Module = require('node:module');
  const origRequire = Module.prototype.require;

  Module.prototype.require = function (id: string) {
    const result = origRequire.apply(this, arguments);

    try {
      // Auto-detect LangChain
      if (id.includes('langchain') || id.includes('@langchain')) {
        patchLangChain(result, dbPath);
      }
      // Auto-detect OpenAI SDK
      if (id === 'openai' || id.includes('openai')) {
        patchOpenAISDK(result, dbPath);
      }
      // Auto-detect Anthropic SDK
      if (id === 'anthropic' || id.includes('@anthropic')) {
        patchAnthropic(result, dbPath);
      }
    } catch {
      /* never crash the host application */
    }

    return result;
  };
}

function patchLangChain(mod: any, dbPath: string): void {
  if (mod?.BaseChain?.prototype?._call) {
    const original = mod.BaseChain.prototype._call;
    mod.BaseChain.prototype._call = async function (...args: any[]) {
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
      } catch (e: any) {
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

function patchOpenAISDK(mod: any, dbPath: string): void {
  if (mod?.OpenAI?.prototype?.chat?.completions?.create) {
    const original = mod.OpenAI.prototype.chat.completions.create;
    mod.OpenAI.prototype.chat.completions.create = async function (...args: any[]) {
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
      } catch (e: any) {
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

function patchAnthropic(mod: any, dbPath: string): void {
  if (mod?.Anthropic?.prototype?.messages?.create) {
    const original = mod.Anthropic.prototype.messages.create;
    mod.Anthropic.prototype.messages.create = async function (...args: any[]) {
      const startTime = Date.now();
      const body = args[0] || {};
      try {
        const result = await original.apply(this, args);
        const latencyMs = Date.now() - startTime;
        const usage = result?.usage || {};
        recordTrace(dbPath, {
          name: `anthropic:${body.model || 'unknown'}`,
          status: 'success',
          input: body.messages,
          output: result?.content,
          latencyMs,
          tokens: {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          },
          model: body.model,
        });
        return result;
      } catch (e: any) {
        const latencyMs = Date.now() - startTime;
        recordTrace(dbPath, {
          name: `anthropic:${body.model || 'unknown'}`,
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

function recordTrace(
  dbPath: string,
  data: {
    name: string;
    status: string;
    input: unknown;
    output: unknown;
    latencyMs: number;
    error?: string;
    tokens?: { promptTokens: number; completionTokens: number; totalTokens: number };
    model?: string;
  },
): void {
  try {
    // Dynamic import to avoid circular deps
    const { TraceStorage } = require('@agenttrace-io/sdk');
    const storage = new TraceStorage(dbPath);
    const runId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    storage.createRun({
      id: runId,
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
    storage.completeRun(runId, data.status === 'success' ? 'success' : 'error');
    storage.close();
  } catch {
    // Never crash the host application
  }
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  const handler = () => {
    shutdown();
  };

  process.on('exit', handler);
  process.on('SIGINT', () => {
    handler();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    handler();
    process.exit(143);
  });
}

/**
 * Shut down auto-instrumentation and clean up resources.
 */
export function shutdown(): void {
  if (!initialized) return;
  initialized = false;

  if (process.env.AGENTTRACE_DEBUG === 'true') {
    console.log('[AgentTrace] Auto-instrumentation shut down');
  }
}

// Auto-init if AGENTTRACE_AUTO_INIT is set
if (process.env.AGENTTRACE_AUTO_INIT === 'true') {
  initAutoInstrument();
}

export default { initAutoInstrument, shutdown };
