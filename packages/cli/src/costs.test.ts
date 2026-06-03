import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main, PACKAGE_NAME, VERSION } from './index.js';
import { AgentTrace } from '@agenttrace/sdk';

/* eslint-disable @typescript-eslint/no-explicit-any -- test console/process spies and error catching use loose types */

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrace-cli-costs-'));
  return path.join(dir, 'agenttrace.db');
}

function rmrf(p: string): void {
  try {
    if (fs.existsSync(p)) {
      if (fs.statSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
        const d = path.dirname(p);
        if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      }
    }
  } catch (_) {
    /* ignore cleanup errors */
  }
}

describe('CLI cost commands (new tests)', () => {
  let tmpDb: string;
  let origArgv: string[];
  let origEnv: string | undefined;
  let logs: string[] = [];
  let errs: string[] = [];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    tmpDb = makeTempDbPath();
    origArgv = process.argv.slice();
    origEnv = process.env.AGENTTRACE_DB_PATH;
    process.env.AGENTTRACE_DB_PATH = tmpDb;

    // seed a db with costs using sdk (different models + run)
    const t = new AgentTrace({ dbPath: tmpDb, silent: true });
    t.startRun('cli-cost-run');
    // use sync? trace is async, so await in it() ok? beforeEach can't await easily, use IIFE sync no.
    // move seed into its, use beforeEach only setup
    t.close();

    logs = [];
    errs = [];
    origLog = console.log;
    origErr = console.error;
    console.log = (...args: any[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    console.error = (...args: any[]) => {
      errs.push(args.map((a) => String(a)).join(' '));
    };

    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.argv = origArgv;
    if (origEnv === undefined) {
      delete process.env.AGENTTRACE_DB_PATH;
    } else {
      process.env.AGENTTRACE_DB_PATH = origEnv;
    }
    vi.restoreAllMocks();
    if (tmpDb) rmrf(tmpDb);
  });

  async function seedCosts() {
    const t = new AgentTrace({ dbPath: tmpDb, silent: true });
    const runId = t.startRun('cli-costs-seed');
    await t.trace('seed-gpt', async () => 'ok', {
      tokens: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, model: 'gpt-4.1' },
      model: 'gpt-4.1',
    });
    await t.trace('seed-gem', async () => 'ok', {
      tokens: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, model: 'gemini-2.5-flash' },
      model: 'gemini-2.5-flash',
    });
    t.completeRun();
    // another run
    const run2 = t.startRun('cli-run2');
    await t.trace('seed-ll', async () => 'ok', {
      tokens: { promptTokens: 2000, completionTokens: 0, totalTokens: 2000, model: 'llama-4-scout' },
      model: 'llama-4-scout',
    });
    t.completeRun();
    t.close();
    return { runId, run2 };
  }


  it('exports package name and version unchanged', () => {
    expect(PACKAGE_NAME).toBe('@agenttrace/cli');
    expect(VERSION).toBe('0.1.0');
  });

  it('costs command prints breakdown by model (default)', async () => {
    await seedCosts();
    process.argv = ['node', 'agenttrace', 'costs'];
    try {
      main();
    } catch (e: any) {
      if (!String(e.message).includes('process.exit')) throw e;
    }
    const out = logs.join('\n');
    expect(out).toContain('Cost Breakdown by Model');
    expect(out).toContain('gpt-4.1');
    expect(out).toContain('gemini-2.5-flash');
    expect(out).toContain('Total:');
  });

  it('costs --daily prints daily breakdown', async () => {
    await seedCosts();
    process.argv = ['node', 'agenttrace', 'costs', '--daily'];
    try {
      main();
    } catch (e: any) {
      if (!String(e.message).includes('process.exit')) throw e;
    }
    const out = logs.join('\n');
    expect(out).toContain('Daily Cost Breakdown');
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/); // a date key
  });

  it('costs --run-id <id> shows only that run\'s costs', async () => {
    const { runId, run2 } = await seedCosts();
    process.argv = ['node', 'agenttrace', 'costs', '--run-id', runId];
    try {
      main();
    } catch (e: any) {
      if (!String(e.message).includes('process.exit')) throw e;
    }
    const out = logs.join('\n');
    expect(out).toContain('gpt-4.1');
    expect(out).toContain('gemini-2.5-flash');
    expect(out).not.toContain('llama-4-scout');

    // now for run2
    logs.length = 0;
    process.argv = ['node', 'agenttrace', 'costs', '--run-id', run2];
    try {
      main();
    } catch (e: any) {
      if (!String(e.message).includes('process.exit')) throw e;
    }
    const out2 = logs.join('\n');
    expect(out2).toContain('llama-4-scout');
    expect(out2).not.toContain('gpt-4.1');
  });

  it('costs --json emits JSON with costByModel and costByDay', async () => {
    await seedCosts();
    process.argv = ['node', 'agenttrace', 'costs', '--json'];
    try {
      main();
    } catch (e: any) {
      if (!String(e.message).includes('process.exit')) throw e;
    }
    const jsonLine = logs.find((l) => l.trim().startsWith('{'));
    expect(jsonLine).toBeTruthy();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed).toHaveProperty('totalCostUsd');
    expect(parsed).toHaveProperty('costByModel');
    expect(parsed).toHaveProperty('costByDay');
    expect(parsed.costByModel['gpt-4.1']).toBeGreaterThan(0);
  });
});
