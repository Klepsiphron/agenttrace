/**
 * AgentTrace -- SQLite Storage Layer
 * Local storage for agent traces with zero cloud dependency
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite row mapping uses loose any (pre-existing pattern in file) */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { Trace, Run, TraceFilter, TraceStats, TokenUsage, CostBreakdown, AlertHistory, TraceTreeNode } from './types.js';

export class TraceStorage {
  private db: Database;

  constructor(dbPath: string = './agenttrace.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        trace_count INTEGER DEFAULT 0,
        total_prompt_tokens INTEGER DEFAULT 0,
        total_completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_tool_calls INTEGER DEFAULT 0,
        total_latency_ms INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT,
        output TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        model TEXT,
        provider TEXT,
        latency_ms INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        error TEXT,
        metadata TEXT DEFAULT '{}',
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        input TEXT,
        output TEXT,
        latency_ms INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1,
        error TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id);
      CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
      CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);
      CREATE INDEX IF NOT EXISTS idx_traces_cost ON traces(cost_usd);
      CREATE INDEX IF NOT EXISTS idx_traces_parent_id ON traces(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_trace_id ON tool_calls(trace_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(name);

      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL REFERENCES traces(id),
        name TEXT NOT NULL,
        value REAL NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scores_trace_id ON scores(trace_id);
      CREATE INDEX IF NOT EXISTS idx_scores_name ON scores(name);

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        config TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alert_history (
        id TEXT PRIMARY KEY,
        alert_name TEXT NOT NULL,
        triggered_at INTEGER NOT NULL,
        stats TEXT NOT NULL,
        delivered INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_name ON alerts(name);
      CREATE INDEX IF NOT EXISTS idx_alert_history_alert_name ON alert_history(alert_name);
      CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history(triggered_at);

      CREATE TABLE IF NOT EXISTS version (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migration tracking
    const version = this.db
      .prepare('SELECT value FROM version WHERE key = ?')
      .get('schema_version');
    if (!version) {
      this.db.prepare('INSERT INTO version (key, value) VALUES (?, ?)').run('schema_version', '2');
    }

    // v2+ migration for multi-agent tracing (parent_id + trace_links)
    const verRow = this.db
      .prepare('SELECT value FROM version WHERE key = ?')
      .get('schema_version') as any;
    const schemaVer = verRow ? parseInt(String(verRow.value), 10) : 0;
    if (schemaVer < 2) {
      try {
        this.db.exec('ALTER TABLE traces ADD COLUMN parent_id TEXT');
      } catch {
        // column may already exist (e.g. partial migration)
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trace_links (
          id TEXT PRIMARY KEY,
          source_trace_id TEXT NOT NULL,
          target_trace_id TEXT NOT NULL,
          relation TEXT NOT NULL DEFAULT 'related',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (source_trace_id) REFERENCES traces(id) ON DELETE CASCADE,
          FOREIGN KEY (target_trace_id) REFERENCES traces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_trace_links_source ON trace_links(source_trace_id);
        CREATE INDEX IF NOT EXISTS idx_trace_links_target ON trace_links(target_trace_id);
      `);
      this.db.prepare('INSERT OR REPLACE INTO version (key, value) VALUES (?, ?)').run('schema_version', '2');
    }
  }

  // ---- Run operations ----

  createRun(run: Partial<Run> & { id: string; name: string; startedAt: number }): Run {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, name, status, started_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.name,
      'running',
      run.startedAt,
      JSON.stringify(run.metadata || {}),
      now,
      now,
    );
    return this.getRun(run.id)!;
  }

  getRun(id: string): Run | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToRun(row);
  }

  getRuns(limit: number = 100): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((r: any) => this.rowToRun(r));
  }

  completeRun(id: string, status: Run['status']): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      UPDATE runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `,
      )
      .run(status, now, now, id);
  }

  updateRunStats(
    runId: string,
    tokens: TokenUsage,
    toolCalls: number,
    latencyMs: number,
    costUsd: number,
  ): void {
    this.db
      .prepare(
        `
      UPDATE runs SET
        total_prompt_tokens = total_prompt_tokens + ?,
        total_completion_tokens = total_completion_tokens + ?,
        total_tokens = total_tokens + ?,
        total_tool_calls = total_tool_calls + ?,
        total_latency_ms = total_latency_ms + ?,
        total_cost_usd = total_cost_usd + ?,
        trace_count = trace_count + 1,
        updated_at = ?
      WHERE id = ?
    `,
      )
      .run(
        tokens.promptTokens,
        tokens.completionTokens,
        tokens.totalTokens,
        toolCalls,
        latencyMs,
        costUsd,
        Date.now(),
        runId,
      );
  }

  // ---- Trace operations ----

  createTrace(trace: Omit<Trace, 'createdAt' | 'updatedAt'>): Trace {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO traces (id, run_id, name, status, input, output, prompt_tokens, completion_tokens, total_tokens, model, provider, latency_ms, cost_usd, error, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      trace.id,
      trace.runId,
      trace.name,
      trace.status,
      JSON.stringify(trace.input),
      JSON.stringify(trace.output),
      trace.tokens.promptTokens,
      trace.tokens.completionTokens,
      trace.tokens.totalTokens,
      trace.tokens.model || null,
      trace.tokens.provider || null,
      trace.latencyMs,
      trace.costUsd,
      trace.error || null,
      JSON.stringify(trace.metadata),
      now,
      now,
    );

    // Insert tool calls
    const toolStmt = this.db.prepare(`
      INSERT INTO tool_calls (id, trace_id, name, input, output, latency_ms, success, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const tc of trace.toolCalls) {
      toolStmt.run(
        tc.id,
        trace.id,
        tc.name,
        JSON.stringify(tc.input),
        JSON.stringify(tc.output),
        tc.latencyMs,
        tc.success ? 1 : 0,
        tc.error || null,
        tc.timestamp,
      );
    }

    // Update run stats
    this.updateRunStats(
      trace.runId,
      trace.tokens,
      trace.toolCalls.length,
      trace.latencyMs,
      trace.costUsd,
    );

    return this.getTrace(trace.id)!;
  }

  getTrace(id: string): Trace | null {
    const row = this.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToTrace(row);
  }

  getTraces(filter: TraceFilter = {}): Trace[] {
    let sql = 'SELECT * FROM traces WHERE 1=1';
    const params: any[] = [];

    if (filter.runId) {
      sql += ' AND run_id = ?';
      params.push(filter.runId);
    }
    if (filter.status?.length) {
      sql += ` AND status IN (${filter.status.map(() => '?').join(',')})`;
      params.push(...filter.status);
    }
    if (filter.name) {
      sql += ' AND name LIKE ?';
      params.push(`%${filter.name}%`);
    }
    if (filter.fromDate) {
      sql += ' AND created_at >= ?';
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      sql += ' AND created_at <= ?';
      params.push(filter.toDate);
    }
    if (filter.minCost !== undefined) {
      sql += ' AND cost_usd >= ?';
      params.push(filter.minCost);
    }
    if (filter.maxCost !== undefined) {
      sql += ' AND cost_usd <= ?';
      params.push(filter.maxCost);
    }
    if (filter.minLatency !== undefined) {
      sql += ' AND latency_ms >= ?';
      params.push(filter.minLatency);
    }
    if (filter.maxLatency !== undefined) {
      sql += ' AND latency_ms <= ?';
      params.push(filter.maxLatency);
    }

    sql += ' ORDER BY created_at DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.rowToTrace(r));
  }

  // ---- Score operations (for evaluation framework) ----

  createScore(id: string, traceId: string, name: string, value: number): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO scores (id, trace_id, name, value, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(id, traceId, name, value, now);
  }

  getScores(
    traceId?: string,
  ): Array<{ id: string; traceId: string; name: string; value: number; createdAt: number }> {
    let sql = 'SELECT * FROM scores';
    const params: any[] = [];
    if (traceId) {
      sql += ' WHERE trace_id = ?';
      params.push(traceId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      traceId: r.trace_id,
      name: r.name,
      value: r.value,
      createdAt: r.created_at,
    }));
  }

  // ---- Alert operations (v0.2 alerting & webhooks) ----

  saveAlert(name: string, config: Record<string, unknown>): void {
    const now = Date.now();
    const id = name;
    this.db
      .prepare(
        `
      INSERT INTO alerts (id, name, config, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET config = excluded.config
    `,
      )
      .run(id, name, JSON.stringify(config), now);
  }

  getStoredAlerts(): Array<{
    name: string;
    config: { webhook?: string; email?: string; cooldown: number; lastTriggered?: number };
    createdAt: number;
  }> {
    const rows = this.db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all() as any[];
    return rows.map((r: any) => ({
      name: r.name,
      config: JSON.parse(r.config || '{}'),
      createdAt: r.created_at,
    }));
  }

  insertAlertHistory(entry: AlertHistory): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO alert_history (id, alert_name, triggered_at, stats, delivered, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        entry.id,
        entry.alertName,
        entry.triggeredAt,
        JSON.stringify(entry.stats || {}),
        entry.delivered ? 1 : 0,
        entry.error || null,
        now,
      );
  }

  getAlertHistory(): AlertHistory[] {
    const rows = this.db.prepare('SELECT * FROM alert_history ORDER BY triggered_at DESC').all() as any[];
    return rows.map((r: any) => ({
      id: r.id,
      alertName: r.alert_name,
      triggeredAt: r.triggered_at,
      stats: JSON.parse(r.stats || '{}'),
      delivered: r.delivered === 1,
      error: r.error || undefined,
    }));
  }

  // ---- Stats ----

  getStats(): TraceStats {
    const totalRuns = this.db.prepare('SELECT COUNT(*) as c FROM runs').get() as any;
    const totalTraces = this.db.prepare('SELECT COUNT(*) as c FROM traces').get() as any;
    const successCount = this.db
      .prepare("SELECT COUNT(*) as c FROM traces WHERE status = 'success'")
      .get() as any;
    const avgLatency = this.db.prepare('SELECT AVG(latency_ms) as v FROM traces').get() as any;
    const totalCost = this.db.prepare('SELECT SUM(cost_usd) as v FROM traces').get() as any;
    const totalTokens = this.db.prepare('SELECT SUM(total_tokens) as v FROM traces').get() as any;

    const topTools = this.db
      .prepare(
        `
      SELECT name, COUNT(*) as count, AVG(latency_ms) as avgLatencyMs
      FROM tool_calls GROUP BY name ORDER BY count DESC LIMIT 10
    `,
      )
      .all() as any[];

    const topErrors = this.db
      .prepare(
        `
      SELECT error, COUNT(*) as count FROM traces
      WHERE error IS NOT NULL AND error != ''
      GROUP BY error ORDER BY count DESC LIMIT 10
    `,
      )
      .all() as any[];

    const costByModelRows = this.db
      .prepare(
        `
      SELECT COALESCE(model, 'unknown') as model, SUM(cost_usd) as cost
      FROM traces GROUP BY model
    `,
      )
      .all() as any[];
    const costByModel: Record<string, number> = {};
    for (const r of costByModelRows) {
      costByModel[r.model] = r.cost || 0;
    }

    return {
      totalRuns: totalRuns.c,
      totalTraces: totalTraces.c,
      successRate: totalTraces.c > 0 ? successCount.c / totalTraces.c : 0,
      avgLatencyMs: avgLatency.v || 0,
      totalCostUsd: totalCost.v || 0,
      costByModel,
      totalTokens: totalTokens.v || 0,
      avgTokensPerTrace: totalTraces.c > 0 ? totalTokens.v / totalTraces.c : 0,
      topTools: topTools.map((t) => ({
        name: t.name,
        count: t.count,
        avgLatencyMs: t.avgLatencyMs,
      })),
      topErrors: topErrors.map((e) => ({ error: e.error, count: e.count })),
    };
  }

  getCostBreakdown(runId?: string): CostBreakdown {
    let where = '';
    const params: any[] = [];
    if (runId) {
      where = ' WHERE run_id = ?';
      params.push(runId);
    }

    const totalCost = this.db
      .prepare(`SELECT SUM(cost_usd) as v FROM traces${where}`)
      .get(...params) as any;

    const costByModelRows = this.db
      .prepare(
        `SELECT COALESCE(model, 'unknown') as model, SUM(cost_usd) as cost FROM traces${where} GROUP BY model`,
      )
      .all(...params) as any[];
    const costByModel: Record<string, number> = {};
    for (const r of costByModelRows) {
      costByModel[r.model] = r.cost || 0;
    }

    const byDayRows = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as day, SUM(cost_usd) as cost FROM traces${where} GROUP BY day ORDER BY day`,
      )
      .all(...params) as any[];
    const costByDay: Record<string, number> = {};
    for (const r of byDayRows) {
      if (r.day) {
        costByDay[r.day] = r.cost || 0;
      }
    }

    return {
      totalCostUsd: totalCost.v || 0,
      costByModel,
      costByDay,
    };
  }

  // ---- Cleanup ----

  cleanup(maxTraces: number = 10000): number {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM traces').get() as any;
    if (count.c <= maxTraces) return 0;

    const toDelete = count.c - maxTraces;
    this.db
      .prepare(
        `
      DELETE FROM traces WHERE id IN (
        SELECT id FROM traces ORDER BY created_at ASC LIMIT ?
      )
    `,
      )
      .run(toDelete);

    return toDelete;
  }

  // ---- Helpers ----

  private rowToRun(row: any): Run {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      traceCount: row.trace_count,
      totalTokens: {
        promptTokens: row.total_prompt_tokens,
        completionTokens: row.total_completion_tokens,
        totalTokens: row.total_tokens,
      },
      totalToolCalls: row.total_tool_calls,
      totalLatencyMs: row.total_latency_ms,
      totalCostUsd: row.total_cost_usd,
      errorCount: row.error_count,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  private rowToTrace(row: any): Trace {
    const toolCalls = this.db
      .prepare('SELECT * FROM tool_calls WHERE trace_id = ? ORDER BY timestamp')
      .all(row.id) as any[];
    return {
      id: row.id,
      runId: row.run_id,
      name: row.name,
      status: row.status,
      input: JSON.parse(row.input || 'null'),
      output: JSON.parse(row.output || 'null'),
      tokens: {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        model: row.model,
        provider: row.provider,
      },
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: JSON.parse(tc.input || 'null'),
        output: JSON.parse(tc.output || 'null'),
        latencyMs: tc.latency_ms,
        success: tc.success === 1,
        error: tc.error,
        timestamp: tc.timestamp,
      })),
      latencyMs: row.latency_ms,
      costUsd: row.cost_usd,
      error: row.error,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
