#!/usr/bin/env node
/**
 * agenttrace-instrument - Zero-code auto-instrumentation wrapper
 * 
 * Usage:
 *   agenttrace-instrument node my-agent.js
 *   agenttrace-instrument --db ./traces.db node my-agent.js
 *   agenttrace-instrument --scan    (scan running processes for agents)
 *   agenttrace-instrument --help
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VERSION = '0.4.0';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
agenttrace-instrument v${VERSION} - Auto-detect and trace AI agents

Usage:
  agenttrace-instrument [options] <runtime> <script> [args...]
  agenttrace-instrument node my-agent.js
  agenttrace-instrument --db ./traces.db python my_agent.py
  agenttrace-instrument --scan     (scan for running agents)

Options:
  --db PATH          AgentTrace database path (default: ./agenttrace.db)
  --service NAME     Service name for traces
  --scan             Scan running processes for agents (no script execution)
  --json             Output scan results as JSON
  --verbose          Verbose output
  --help, -h         Show this help

Environment:
  AGENTTRACE_DB_PATH        Database path
  AGENTTRACE_SERVICE_NAME   Service name

Auto-detected frameworks:
  LangChain, LangGraph, CrewAI, AutoGen, LlamaIndex, DSPy,
  OpenAI SDK, Anthropic SDK, Semantic Kernel, Agno,
  any process with "agent", "llm", "gpt", "claude" in command line
`);
  process.exit(0);
}

// Parse options
let dbPath: string | undefined;
let serviceName: string | undefined;
let doScan = false;
let jsonOutput = false;
let verbose = false;
const passthroughArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--db' && args[i + 1]) { dbPath = args[++i]; continue; }
  if (arg === '--service' && args[i + 1]) { serviceName = args[++i]; continue; }
  if (arg === '--scan') { doScan = true; continue; }
  if (arg === '--json') { jsonOutput = true; continue; }
  if (arg === '--verbose') { verbose = true; continue; }
  passthroughArgs.push(arg);
}

if (doScan) {
  scanAgents(jsonOutput, verbose);
  process.exit(0);
}

if (passthroughArgs.length < 2) {
  console.error('Usage: agenttrace-instrument <runtime> <script> [args...]');
  console.error('Example: agenttrace-instrument node my-agent.js');
  console.error('Run --help for more info.');
  process.exit(1);
}

const runtime = passthroughArgs[0];
const scriptArgs = passthroughArgs.slice(1);
const script = scriptArgs[0];
const resolvedScript = path.resolve(process.cwd(), script);

if (!existsSync(resolvedScript)) {
  console.error(`Script not found: ${script}`);
  process.exit(1);
}

// Run the target script with AGENTTRACE_AUTO_INIT set
const child = spawn(runtime, scriptArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENTTRACE_AUTO_INIT: 'true',
    AGENTTRACE_DB_PATH: dbPath || process.env.AGENTTRACE_DB_PATH || './agenttrace.db',
    AGENTTRACE_SERVICE_NAME: serviceName || process.env.AGENTTRACE_SERVICE_NAME || '',
    AGENTTRACE_DEBUG: verbose ? 'true' : 'false',
  },
  shell: process.platform === 'win32',
});

child.on('close', (code: number | null) => {
  process.exit(code ?? 0);
});

process.on('SIGINT', () => { child.kill('SIGINT'); });
process.on('SIGTERM', () => { child.kill('SIGTERM'); });

// ── Process Scanner ────────────────────────────────────────────────

interface DetectedAgent {
  pid: string;
  name: string;
  cmdline: string;
  runtime: string;
  platform: 'wsl' | 'windows';
  framework: string | null;
  agentType: string | null;
}

const AGENT_FRAMEWORKS: Record<string, { framework: string; patterns: string[] }> = {
  langchain: { framework: 'LangChain', patterns: ['langchain', '@langchain', 'langgraph', 'ChatOpenAI', 'ChatAnthropic'] },
  crewai: { framework: 'CrewAI', patterns: ['crewai', 'Crew('] },
  autogen: { framework: 'AutoGen', patterns: ['autogen', 'ConversableAgent', 'AssistantAgent'] },
  openai: { framework: 'OpenAI', patterns: ['openai', 'openai.'] },
  anthropic: { framework: 'Anthropic', patterns: ['anthropic'] },
  llamaindex: { framework: 'LlamaIndex', patterns: ['llamaindex', 'llama-index'] },
  dspy: { framework: 'DSPy', patterns: ['dspy', 'DSPy'] },
  semantic: { framework: 'Semantic Kernel', patterns: ['semantic-kernel', 'SemanticKernel'] },
};

function scanAgents(json: boolean, verbose: boolean) {
  const agents: DetectedAgent[] = [];

  // Scan WSL/Linux processes
  try {
    const ps = require('child_process').execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
    for (const line of ps.split('\n')) {
      const lower = line.toLowerCase();
      const isNode = lower.includes('node ') || lower.includes('node.exe');
      const isPython = lower.includes('python') || lower.includes('python.exe');
      if (!isNode && !isPython) continue;

      let framework: string | null = null;
      let agentType: string | null = null;
      for (const [key, sig] of Object.entries(AGENT_FRAMEWORKS)) {
        if (sig.patterns.some((p: string) => lower.includes(p.toLowerCase()))) {
          framework = sig.framework;
          agentType = key;
          break;
        }
      }
      if (!framework && (lower.includes('agent') || lower.includes('llm') || lower.includes('gpt') || lower.includes('claude') || lower.includes('ai'))) {
        agentType = 'unknown-agent';
      }
      if (agentType) {
        const parts = line.trim().split(/\s+/);
        agents.push({ pid: parts[1] || '0', name: parts[10] || parts[0], cmdline: line.trim(), runtime: isNode ? 'node' : 'python', platform: 'wsl', framework, agentType });
      }
    }
  } catch { /* ignore */ }

  // Scan Windows processes from WSL
  try {
    const tasklist = require('child_process').execSync('cmd.exe /c tasklist /fo csv /nh 2>nul', { encoding: 'utf8', timeout: 5000 });
    for (const line of tasklist.split('\n')) {
      const lower = line.toLowerCase();
      const isNode = lower.includes('node.exe');
      const isPython = lower.includes('python.exe');
      if (!isNode && !isPython) continue;

      let framework: string | null = null;
      let agentType: string | null = null;
      for (const [key, sig] of Object.entries(AGENT_FRAMEWORKS)) {
        if (sig.patterns.some((p: string) => lower.includes(p.toLowerCase()))) {
          framework = sig.framework;
          agentType = key;
          break;
        }
      }
      // For Windows, we can't easily get cmdline, so detect by process name
      if (lower.includes('agent') || lower.includes('chatbot') || lower.includes('ai-')) {
        agentType = 'unknown-agent';
      }
      if (agentType) {
        const cols = line.split(',');
        const name = (cols[0] || '').replace(/"/g, '');
        const pid = (cols[1] || '').replace(/"/g, '');
        agents.push({ pid, name, cmdline: line.trim(), runtime: isNode ? 'node' : 'python', platform: 'windows', framework, agentType });
      }
    }
  } catch { /* ignore */ }

  if (json) {
    console.log(JSON.stringify({ version: VERSION, agents }, null, 2));
  } else {
    if (agents.length === 0) {
      console.log('[AgentTrace] No agent processes detected.');
      console.log('[AgentTrace] Make sure agents are running with a recognized framework.');
      console.log('[AgentTrace] Recognized: LangChain, CrewAI, AutoGen, OpenAI, Anthropic, LlamaIndex, DSPy');
    } else {
      console.log(`[AgentTrace] Detected ${agents.length} agent process(es):\n`);
      for (const a of agents) {
        console.log(`  ${a.platform.toUpperCase().padEnd(7)} ${a.pid.padStart(7)} ${a.runtime.padEnd(7)} ${a.framework || 'unknown'.padEnd(15)} ${a.name}`);
        if (verbose) console.log(`    ${a.cmdline.substring(0, 120)}`);
      }
    }
  }
}
