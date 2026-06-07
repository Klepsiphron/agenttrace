#!/usr/bin/env node
/**
 * agenttrace-instrument - CLI wrapper for zero-code auto-instrumentation
 * 
 * Usage:
 *   agenttrace-instrument node my-agent.js
 *   agenttrace-instrument python my_agent.py
 *   agenttrace-instrument --help
 */

import { initAutoInstrument, shutdown } from './index.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`
agenttrace-instrument - Zero-code auto-instrumentation for AI agents

Usage:
  agenttrace-instrument <runtime> [args...]
  agenttrace-instrument node my-agent.js
  agenttrace-instrument python my_agent.py

Options:
  --db PATH          AgentTrace database path (default: ./agenttrace.db)
  --service NAME     Service name for traces (default: from package.json)
  --console          Enable console output
  --help, -h         Show this help

Environment Variables:
  AGENTTRACE_DB_PATH        Database path
  AGENTTRACE_SERVICE_NAME   Service name
  AGENTTRACE_AUTO_INIT      Auto-init without wrapping (true/false)
  AGENTTRACE_DEBUG          Enable debug output (true/false)

Detected frameworks (auto-instrumented if installed):
  - LangChain / LangGraph
  - CrewAI
  - AutoGen
  - OpenAI SDK
  - Anthropic SDK (via HTTP interception)
  - Any HTTP call to known LLM endpoints

Install optional framework instrumentation:
  npm install @arizeai/openinference-instrumentation-langchain
  npm install @opentelemetry/instrumentation-openai
`);
  process.exit(0);
}

// Parse options
let dbPath: string | undefined;
let serviceName: string | undefined;
let consoleOutput = false;
const runtimeArgs: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--db' && rawArgs[i + 1]) { dbPath = rawArgs[++i]; continue; }
  if (arg === '--service' && rawArgs[i + 1]) { serviceName = rawArgs[++i]; continue; }
  if (arg === '--console') { consoleOutput = true; continue; }
  runtimeArgs.push(arg);
}

if (runtimeArgs.length === 0) {
  console.error('Usage: agenttrace-instrument <runtime> [args...]');
  console.error('Example: agenttrace-instrument node my-agent.js');
  process.exit(1);
}

// Initialize auto-instrumentation BEFORE running the target
initAutoInstrument({ dbPath, serviceName, console: consoleOutput });

const runtime = runtimeArgs[0];
const scriptArgs = runtimeArgs.slice(1);

if (scriptArgs.length === 0) {
  console.error(`Usage: agenttrace-instrument ${runtime} <script> [args...]`);
  shutdown();
  process.exit(1);
}

const script = scriptArgs[0];
const resolvedScript = path.resolve(process.cwd(), script);

if (!fs.existsSync(resolvedScript)) {
  console.error(`Script not found: ${script}`);
  shutdown();
  process.exit(1);
}

const child = spawn(runtime, scriptArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENTTRACE_AUTO_INIT: 'true',
    AGENTTRACE_DB_PATH: dbPath || process.env.AGENTTRACE_DB_PATH || './agenttrace.db',
    AGENTTRACE_SERVICE_NAME: serviceName || process.env.AGENTTRACE_SERVICE_NAME || '',
    AGENTTRACE_DEBUG: consoleOutput ? 'true' : 'false',
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import=${path.join(import.meta.dirname || '', 'index.js')}`,
    ].filter(Boolean).join(' '),
  },
  shell: process.platform === 'win32',
});

child.on('close', (code) => {
  shutdown();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
