#!/usr/bin/env node
/**
 * AgentTrace WSL Bridge
 * 
 * Detects running agents on both WSL and Windows sides.
 * Bridges process discovery across the WSL/Windows boundary.
 * 
 * Run this on the WSL side to detect both WSL and Windows agents:
 *   node wsl-bridge.js
 * 
 * Standalone usage for Windows agents:
 *   # From PowerShell, lists all node/python processes:
 *   node wsl-bridge.js --scan-windows
 */

import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const AGENTTRACE_VERSION = '0.4.0';

interface DetectedAgent {
  pid: string;
  name: string;
  cmdline: string;
  runtime: 'node' | 'python' | 'java' | 'dotnet' | 'ruby' | 'go' | 'unknown';
  platform: 'wsl' | 'windows';
  cwd?: string;
  startTime?: string;
  agentType?: string;
  framework?: string;
}

interface BridgeConfig {
  dbPath: string;
  scanIntervalMs: number;
  includeWindowsProcesses: boolean;
  verbose: boolean;
}

// Known agent framework signatures
const AGENT_SIGNATURES: Record<string, { framework: string; patterns: string[] }> = {
  'langchain': {
    framework: 'LangChain',
    patterns: ['langchain', '@langchain', 'langchainjs', 'LangChain', 'ChatOpenAI', 'ChatAnthropic'],
  },
  'crewai': {
    framework: 'CrewAI',
    patterns: ['crewai', 'CrewAI', 'Crew('],
  },
  'autogen': {
    framework: 'AutoGen',
    patterns: ['autogen', 'AutoGen', 'ConversableAgent', 'AssistantAgent'],
  },
  'openai-sdk': {
    framework: 'OpenAI SDK',
    patterns: ['openai', 'OpenAI', 'from_openai', 'AzureOpenAI'],
  },
  'anthropic-sdk': {
    framework: 'Anthropic SDK',
    patterns: ['anthropic', 'Anthropic'],
  },
  'llamaindex': {
    framework: 'LlamaIndex',
    patterns: ['llamaindex', 'llama-index', 'LlamaIndex'],
  },
  'semantic-kernel': {
    framework: 'Semantic Kernel',
    patterns: ['semantic-kernel', 'SemanticKernel'],
  },
  'dspy': {
    framework: 'DSPy',
    patterns: ['dspy', 'DSPy'],
  },
  'agno': {
    framework: 'Agno',
    patterns: ['agno', 'Agent('],
  },
};

const CONFIG: BridgeConfig = {
  dbPath: process.env.AGENTTRACE_DB_PATH || path.join(os.homedir(), '.hermes', 'agenttrace.db'),
  scanIntervalMs: parseInt(process.env.AGENTTRACE_SCAN_INTERVAL || '10000', 10),
  includeWindowsProcesses: true,
  verbose: process.env.AGENTTRACE_DEBUG === 'true',
};

function detectAgentsFromProcessList(list: string, platform: 'wsl' | 'windows'): DetectedAgent[] {
  const agents: DetectedAgent[] = [];
  const lines = list.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const lower = line.toLowerCase();
    
    // Detect runtime
    let runtime: DetectedAgent['runtime'] = 'unknown';
    if (lower.includes('node ') || lower.includes('node.exe')) runtime = 'node';
    else if (lower.includes('python') || lower.includes('python3') || lower.includes('python.exe')) runtime = 'python';
    else if (lower.includes('java ') || lower.includes('java.exe')) runtime = 'java';
    else if (lower.includes('dotnet ') || lower.includes('dotnet.exe')) runtime = 'dotnet';
    else if (lower.includes('ruby ') || lower.includes('ruby.exe')) runtime = 'ruby';
    else if (lower.includes('go ') || lower.includes('go.exe')) runtime = 'go';

    if (runtime === 'unknown') continue;

    // Check for agent framework signatures
    for (const [agentType, sig] of Object.entries(AGENT_SIGNATURES)) {
      if (sig.patterns.some(p => lower.includes(p.toLowerCase()))) {
        // Extract PID and command
        const parts = line.trim().split(/\s+/);
        const pid = parts[1] || parts[0] || '0';
        
        agents.push({
          pid,
          name: extractProcessName(line, runtime),
          cmdline: line.trim(),
          runtime,
          platform,
          agentType,
          framework: sig.framework,
        });
        break;
      }
    }

    // Also detect generic AI agent patterns
    if (!agents.find(a => a.cmdline === line.trim())) {
      const isAgentLike = lower.includes('agent') || lower.includes('llm') || 
                          lower.includes('gpt') || lower.includes('claude') ||
                          lower.includes('ai') || lower.includes('chat');
      if (isAgentLike) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[1] || parts[0] || '0';
        agents.push({
          pid,
          name: extractProcessName(line, runtime),
          cmdline: line.trim(),
          runtime,
          platform,
          agentType: 'unknown-agent',
          framework: undefined,
        });
      }
    }
  }

  return agents;
}

function extractProcessName(cmdline: string, runtime: string): string {
  // Extract the main script name from the command line
  if (runtime === 'node') {
    const match = cmdline.match(/node(?:\.exe)?\s+(.+?)(?:\s|$)/);
    if (match) {
      const script = match[1];
      return path.basename(script, path.extname(script));
    }
  }
  if (runtime === 'python') {
    const match = cmdline.match(/python(?:3)?(?:\.exe)?\s+(.+?)(?:\s|$)/);
    if (match) {
      const script = match[1];
      return path.basename(script, path.extname(script));
    }
  }
  return cmdline.split(/\s+/)[0] || 'unknown';
}

function scanWSLProcesses(): string {
  try {
    return execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
  } catch {
    return '';
  }
}

function scanWindowsProcesses(): string {
  try {
    // Use wsl.exe to run Windows tasklist from WSL
    return execSync('cmd.exe /c tasklist /fo csv /nh', { encoding: 'utf8', timeout: 10000 });
  } catch {
    return '';
  }
}

function getProcessCwd(pid: string, platform: 'wsl' | 'windows'): string | undefined {
  try {
    if (platform === 'wsl') {
      const link = `/proc/${pid}/cwd`;
      if (existsSync(link)) {
        return execSync(`readlink -f ${link}`, { encoding: 'utf8', timeout: 1000 }).trim();
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

function main() {
  console.log(`[AgentTrace WSL Bridge v${AGENTTRACE_VERSION}]`);
  console.log(`[Bridge] DB: ${CONFIG.dbPath}`);
  console.log(`[Bridge] Scanning WSL + Windows processes...`);
  console.log('');

  // Scan WSL processes
  const wslList = scanWSLProcesses();
  const wslAgents = detectAgentsFromProcessList(wslList || '', 'wsl');

  // Scan Windows processes
  let windowsAgents: DetectedAgent[] = [];
  if (CONFIG.includeWindowsProcesses) {
    const winList = scanWindowsProcesses();
    windowsAgents = detectAgentsFromProcessList(winList || '', 'windows');
  }

  const allAgents = [...wslAgents, ...windowsAgents];

  if (allAgents.length === 0) {
    console.log('[Bridge] No agent processes detected.');
    console.log('[Bridge] Make sure agents are running with a recognized framework.');
    console.log('[Bridge] Recognized: LangChain, CrewAI, AutoGen, OpenAI SDK, Anthropic SDK, LlamaIndex, DSPy, Agno');
    return;
  }

  console.log(`[Bridge] Detected ${allAgents.length} agent process(es):\n`);

  for (const agent of allAgents) {
    console.log(`  ${agent.platform.toUpperCase()} | ${agent.pid.padStart(6)} | ${agent.runtime.padEnd(6)} | ${agent.framework || 'unknown'} | ${agent.name}`);
    if (CONFIG.verbose) {
      console.log(`    cmd: ${agent.cmdline.substring(0, 100)}`);
    }
  }

  console.log('');
  console.log('[Bridge] Use agenttrace-io dashboard to view full traces.');
}

// Run
main();
