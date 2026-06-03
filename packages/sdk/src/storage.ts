/**
 * AgentTrace -- SQLite Storage Layer
 * Local storage for agent traces with zero cloud dependency
 */

import Database from 'better-sqlite3';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import {
  Trace,
  Run,
  TraceFilter,
  TraceStats,
  TokenUsage,
  CostBreakdown,
  AlertHistory,
  TraceTreeNode,
  AgentUsageRecord,
  AgentUsageFilter,
  UsageStats,
  AgentWho,
  AgentSession,
  WebhookConfig,
  ApiKey,
  Project,
} from './types.js';

export class TraceStorage {
  private db: Database;
  private dbPath: string;
  private _droppedTraces: number = 0;

  constructor(dbPath: string = './agenttrace.db') {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
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
        tenant_id TEXT,
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

      CREATE TABLE IF NOT EXISTS agent_usage (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        agent_name TEXT NOT NULL,
        agent_type TEXT,
        session_id TEXT,
        action TEXT NOT NULL,
        target TEXT,
        tokens_used INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_usage_agent_name ON agent_usage(agent_name);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_session_id ON agent_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_action ON agent_usage(action);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_status ON agent_usage(status);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_created_at ON agent_usage(created_at);

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        failure_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);
      CREATE INDEX IF NOT EXISTS idx_webhooks_created_at ON webhooks(created_at);

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_preview TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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
      this.db.prepare('INSERT INTO version (key, value) VALUES (?, ?)').run('schema_version', '3');
    }

    // v2+ migration for multi-agent tracing (parent_id + trace_links)
    const verRow = this.db
      .prepare('SELECT value FROM version WHERE key = ?')
      .get('schema_version') as unknown as { value: string } | undefined;
    const schemaVer = verRow ? parseInt(String(verRow.value), 10) : 0;
    if (schemaVer < 2) {
      try {
        this.db.exec('ALTER TABLE traces ADD COLUMN parent_id TEXT');
      } catch (_) {
        /* column may already exist (e.g. partial migration) */
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
      this.db
        .prepare('INSERT OR REPLACE INTO version (key, value) VALUES (?, ?)')
        .run('schema_version', '2');
    }

    // v3+ migration for multi-tenant (projects table + tenant_id on agent_usage)
    if (schemaVer < 3) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          api_key TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_api_key ON projects(api_key);
      `);
      try {
        this.db.exec('ALTER TABLE agent_usage ADD COLUMN tenant_id TEXT');
      } catch (_) {
        /* column may already exist */
      }
      try {
        this.db.exec('ALTER TABLE runs ADD COLUMN tenant_id TEXT');
      } catch (_) {
        /* column may already exist */
      }
      try {
        this.db.exec('ALTER TABLE traces ADD COLUMN tenant_id TEXT');
      } catch (_) {
        /* column may already exist */
      }
      this.db
        .prepare('INSERT OR REPLACE INTO version (key, value) VALUES (?, ?)')
        .run('schema_version', '3');
    }
  }

  // ---- Run operations ----

  createRun(run: Partial<Run> & { id: string; name: string; startedAt: number }): Run {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, tenant_id, name, status, started_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.tenantId || null,
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
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown;
    if (!row) return null;
    return this.rowToRun(row);
  }

  getRuns(limit: number = 100): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as unknown[];
    return rows.map((r) => this.rowToRun(r));
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
      INSERT INTO traces (id, run_id, name, status, input, output, prompt_tokens, completion_tokens, total_tokens, model, provider, latency_ms, cost_usd, error, metadata, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      trace.parentId || null,
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
    const row = this.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as unknown;
    if (!row) return null;
    return this.rowToTrace(row);
  }

  getTraces(filter: TraceFilter = {}): Trace[] {
    let sql = 'SELECT * FROM traces WHERE 1=1';
    const params: unknown[] = [];

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

    const rows = this.db.prepare(sql).all(...params) as unknown[];
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
    const params: unknown[] = [];
    if (traceId) {
      sql += ' WHERE trace_id = ?';
      params.push(traceId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as unknown[];
    return rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: rec.id as string,
        traceId: rec.trace_id as string,
        name: rec.name as string,
        value: Number(rec.value),
        createdAt: Number(rec.created_at),
      };
    });
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
    const rows = this.db
      .prepare('SELECT * FROM alerts ORDER BY created_at DESC')
      .all() as unknown[];
    return rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        name: rec.name as string,
        config: JSON.parse((rec.config as string) || '{}'),
        createdAt: Number(rec.created_at),
      };
    });
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
    const rows = this.db
      .prepare('SELECT * FROM alert_history ORDER BY triggered_at DESC')
      .all() as unknown[];
    return rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: rec.id as string,
        alertName: rec.alert_name as string,
        triggeredAt: Number(rec.triggered_at),
        stats: JSON.parse((rec.stats as string) || '{}'),
        delivered: rec.delivered === 1,
        error: (rec.error as string) || undefined,
      };
    });
  }

  // ---- Multi-agent tracing (parent/child + links) v0.2 ----

  setTraceParent(traceId: string, parentId: string): void {
    this.db
      .prepare('UPDATE traces SET parent_id = ?, updated_at = ? WHERE id = ?')
      .run(parentId, Date.now(), traceId);
  }

  getTraceParentId(traceId: string): string | null {
    const row = this.db
      .prepare('SELECT parent_id FROM traces WHERE id = ?')
      .get(traceId) as unknown;
    const rec = row as Record<string, unknown> | undefined;
    return rec && rec.parent_id ? String(rec.parent_id) : null;
  }

  getChildTraceIds(parentId: string): string[] {
    const rows = this.db
      .prepare('SELECT id FROM traces WHERE parent_id = ? ORDER BY created_at ASC')
      .all(parentId) as unknown[];
    return rows.map((r) => String((r as Record<string, unknown>).id));
  }

  getLinkedTraceIds(traceId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT target_trace_id AS id FROM trace_links WHERE source_trace_id = ? AND relation = 'related'
        UNION
        SELECT DISTINCT source_trace_id AS id FROM trace_links WHERE target_trace_id = ? AND relation = 'related'
      `,
      )
      .all(traceId, traceId) as unknown[];
    return rows
      .map((r) => String((r as Record<string, unknown>).id))
      .filter((id) => id !== traceId);
  }

  linkTraces(traceIds: string[]): void {
    if (!traceIds || traceIds.length < 2) return;
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO trace_links (id, source_trace_id, target_trace_id, relation, created_at)
      VALUES (?, ?, ?, 'related', ?)
    `);
    for (let i = 0; i < traceIds.length; i++) {
      for (let j = i + 1; j < traceIds.length; j++) {
        stmt.run(randomUUID(), traceIds[i], traceIds[j], now);
      }
    }
  }

  getTraceTree(traceId: string): TraceTreeNode {
    // Walk up parent chain to find ultimate root (cycle safe)
    let rootId = traceId;
    const upSeen = new Set<string>();
    while (true) {
      if (upSeen.has(rootId)) break;
      upSeen.add(rootId);
      const p = this.getTraceParentId(rootId);
      if (!p) break;
      rootId = p;
    }

    const visited = new Set<string>();
    const build = (id: string): TraceTreeNode | null => {
      if (visited.has(id)) return null;
      visited.add(id);
      const trace = this.getTrace(id);
      if (!trace) return null;
      const childIdSet = new Set<string>();
      for (const c of this.getChildTraceIds(id)) childIdSet.add(c);
      for (const l of this.getLinkedTraceIds(id)) childIdSet.add(l);
      const children: TraceTreeNode[] = [];
      // sort for deterministic tree order
      const sortedChildren = Array.from(childIdSet).sort();
      for (const cid of sortedChildren) {
        const node = build(cid);
        if (node) children.push(node);
      }
      return { trace, children };
    };

    const rootNode = build(rootId);
    if (rootNode) return rootNode;

    // fallback for the requested id itself
    const t = this.getTrace(traceId);
    if (!t) {
      throw new Error(`Trace ${traceId} not found`);
    }
    return { trace: t, children: [] };
  }

  // ---- Agent usage tracking ----

  recordAgentUsage(params: AgentUsageRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO agent_usage (id, agent_name, agent_type, session_id, action, target, tokens_used, cost_usd, duration_ms, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.id,
        params.agentName,
        params.agentType || null,
        params.sessionId || null,
        params.action,
        params.target || null,
        params.tokensUsed ?? 0,
        params.costUsd ?? 0,
        params.durationMs ?? 0,
        params.status || 'success',
        JSON.stringify(params.metadata || {}),
        params.createdAt || Date.now(),
      );
  }

  getAgentUsage(filter: AgentUsageFilter = {}): AgentUsageRecord[] {
    let sql = 'SELECT * FROM agent_usage WHERE 1=1';
    const params: unknown[] = [];

    if (filter.agentName) {
      sql += ' AND agent_name = ?';
      params.push(filter.agentName);
    }
    if (filter.agentType) {
      sql += ' AND agent_type = ?';
      params.push(filter.agentType);
    }
    if (filter.action) {
      sql += ' AND action = ?';
      params.push(filter.action);
    }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        sql += ` AND status IN (${filter.status.map(() => '?').join(',')})`;
        params.push(...filter.status);
      } else {
        sql += ' AND status = ?';
        params.push(filter.status);
      }
    }
    if (filter.fromDate) {
      sql += ' AND created_at >= ?';
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      sql += ' AND created_at <= ?';
      params.push(filter.toDate);
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

    const rows = this.db.prepare(sql).all(...params) as unknown[];
    return rows.map((r) => this.rowToAgentUsage(r));
  }

  getUsageStats(agentName?: string, fromDate?: number, toDate?: number): UsageStats {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (agentName) {
      whereParts.push('agent_name = ?');
      params.push(agentName);
    }
    if (fromDate) {
      whereParts.push('created_at >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      whereParts.push('created_at <= ?');
      params.push(toDate);
    }
    const where = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

    const totalActionsRow = this.db
      .prepare(`SELECT COUNT(*) as c FROM agent_usage${where}`)
      .get(...params) as unknown as { c: number };
    const totalActions = totalActionsRow ? totalActionsRow.c : 0;

    const totalAgentsRow = this.db
      .prepare(`SELECT COUNT(DISTINCT agent_name) as c FROM agent_usage${where}`)
      .get(...params) as unknown as { c: number };
    const totalAgents = totalAgentsRow ? totalAgentsRow.c : 0;

    const totals = this.db
      .prepare(
        `SELECT 
          COALESCE(SUM(tokens_used), 0) as tokens,
          COALESCE(SUM(cost_usd), 0) as cost,
          COALESCE(AVG(duration_ms), 0) as avgDur
         FROM agent_usage${where}`,
      )
      .get(...params) as unknown as { tokens: number; cost: number; avgDur: number };

    const totalTokens = totals ? Number(totals.tokens) : 0;
    const totalCostUsd = totals ? Number(totals.cost) : 0;
    const avgDurationMs = totals ? Number(totals.avgDur) : 0;

    const byTypeRows = this.db
      .prepare(
        `SELECT action, COUNT(*) as count FROM agent_usage${where} GROUP BY action ORDER BY count DESC`,
      )
      .all(...params) as unknown[];
    const actionsByType: Record<string, number> = {};
    for (const row of byTypeRows) {
      const rec = row as Record<string, unknown>;
      actionsByType[String(rec.action)] = Number(rec.count);
    }

    const topRows = this.db
      .prepare(
        `SELECT 
          agent_name,
          COUNT(*) as actions,
          COALESCE(SUM(tokens_used), 0) as tokens,
          COALESCE(SUM(cost_usd), 0) as cost
         FROM agent_usage${where} 
         GROUP BY agent_name 
         ORDER BY actions DESC, cost DESC 
         LIMIT 10`,
      )
      .all(...params) as unknown[];
    const topAgents = topRows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        agentName: String(rec.agent_name),
        actions: Number(rec.actions),
        tokens: Number(rec.tokens),
        costUsd: Number(rec.cost),
      };
    });

    return {
      totalAgents,
      totalActions,
      totalTokens,
      totalCostUsd,
      avgDurationMs,
      actionsByType,
      topAgents,
    };
  }

  getActiveAgents(): { agentName: string; lastActive: string; totalActions: number }[] {
    const rows = this.db
      .prepare(
        `
      SELECT agent_name, MAX(created_at) as last_ts, COUNT(*) as total
      FROM agent_usage
      GROUP BY agent_name
      ORDER BY last_ts DESC
    `,
      )
      .all() as unknown[];
    return rows.map((r) => {
      const rec = r as Record<string, unknown>;
      const lastTs = Number(rec.last_ts) || Date.now();
      return {
        agentName: String(rec.agent_name),
        lastActive: new Date(lastTs).toISOString(),
        totalActions: Number(rec.total),
      };
    });
  }

  // ---- Agent usage query helpers for CLI (who / sessions / cost) ----

  getAgentWho(filter: { activeOnly?: boolean; agentType?: string; limit?: number } = {}): AgentWho[] {
    const f: AgentUsageFilter = {};
    if (filter.agentType) f.agentType = filter.agentType;
    if (filter.activeOnly) {
      f.fromDate = Date.now() - 30 * 60 * 1000;
    }
    const recs = this.getAgentUsage({ ...f, limit: 20000 });
    const map = new Map<
      string,
      {
        type?: string;
        lastSession?: string;
        lastAction: string;
        lastTs: number;
        actions: number;
        tokens: number;
        cost: number;
      }
    >();
    for (const r of recs) {
      let g = map.get(r.agentName);
      if (!g) {
        g = {
          type: r.agentType,
          lastAction: r.action,
          lastTs: r.createdAt,
          actions: 0,
          tokens: 0,
          cost: 0,
        };
        map.set(r.agentName, g);
      }
      if (r.agentType && !g.type) g.type = r.agentType;
      if (r.createdAt >= g.lastTs) {
        g.lastTs = r.createdAt;
        g.lastAction = r.action;
        if (r.sessionId) g.lastSession = r.sessionId;
      }
      g.actions += 1;
      g.tokens += r.tokensUsed || 0;
      g.cost += r.costUsd || 0;
    }
    const list: Array<AgentWho & { lastActive: number }> = Array.from(map.entries()).map(([name, g]) => ({
      agentName: name,
      agentType: g.type,
      sessionId: g.lastSession,
      lastAction: g.lastAction,
      actions: g.actions,
      tokens: g.tokens,
      costUsd: g.cost,
      lastActive: g.lastTs,
    }));
    list.sort((a, b) => b.lastActive - a.lastActive);
    const lim = filter.limit && filter.limit > 0 ? filter.limit : 100;
    return list.slice(0, lim).map(({ lastActive, ...rest }) => rest as AgentWho);
  }

  getAgentSessions(filter: { agentName?: string; activeOnly?: boolean; limit?: number } = {}): AgentSession[] {
    const f: AgentUsageFilter = {};
    if (filter.agentName) f.agentName = filter.agentName;
    if (filter.activeOnly) {
      f.fromDate = Date.now() - 30 * 60 * 1000;
    }
    const recs = this.getAgentUsage({ ...f, limit: 20000 });
    // group by agent + sessionId (synthetic for missing sessionId)
    type SessGroup = {
      agentName: string;
      ts: number[];
      actions: number;
      tokens: number;
      cost: number;
      statuses: AgentSession['status'][];
      lastStatus: AgentSession['status'];
      lastTs: number;
    };
    const groups = new Map<string, SessGroup>();
    for (const r of recs) {
      const sid = r.sessionId || '';
      const key = `${r.agentName}::${sid}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          agentName: r.agentName,
          ts: [],
          actions: 0,
          tokens: 0,
          cost: 0,
          statuses: [],
          lastStatus: r.status,
          lastTs: r.createdAt,
        };
        groups.set(key, g);
      }
      g.ts.push(r.createdAt);
      g.actions += 1;
      g.tokens += r.tokensUsed || 0;
      g.cost += r.costUsd || 0;
      g.statuses.push(r.status);
      if (r.createdAt >= g.lastTs) {
        g.lastTs = r.createdAt;
        g.lastStatus = r.status;
      }
    }
    let list: AgentSession[] = Array.from(groups.entries()).map(([key, g]) => {
      const sorted = [...g.ts].sort((a, b) => a - b);
      const startedAt = sorted[0] ?? g.lastTs;
      const last = sorted[sorted.length - 1] ?? g.lastTs;
      const dur = Math.max(0, last - startedAt);
      // session status: use last action's status, or 'failure' if any bad
      let status = g.lastStatus;
      if (g.statuses.some((s) => s === 'failure' || s === 'timeout')) {
        status = g.statuses.includes('failure') ? 'failure' : 'timeout';
      }
      const sid = key.split('::')[1] || 'n/a';
      return {
        sessionId: sid,
        agentName: g.agentName,
        startedAt,
        durationMs: dur,
        actions: g.actions,
        tokens: g.tokens,
        costUsd: g.cost,
        status,
      };
    });
    if (filter.activeOnly) {
      const cutoff = Date.now() - 30 * 60 * 1000;
      list = list.filter((s) => s.startedAt + s.durationMs >= cutoff || s.startedAt >= cutoff);
    }
    list.sort((a, b) => b.startedAt - a.startedAt);
    const lim = filter.limit && filter.limit > 0 ? filter.limit : 100;
    return list.slice(0, lim);
  }

  getAgentCostSummary(filter: { agentName?: string; fromDate?: number; toDate?: number } = {}): {
    totalCostUsd: number;
    costByAgent: Record<string, number>;
    costByModel: Record<string, number>;
  } {
    const recs = this.getAgentUsage({
      agentName: filter.agentName,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      limit: 100000,
    });
    let totalCostUsd = 0;
    const costByAgent: Record<string, number> = {};
    const costByModel: Record<string, number> = {};
    for (const r of recs) {
      const c = r.costUsd || 0;
      totalCostUsd += c;
      costByAgent[r.agentName] = (costByAgent[r.agentName] || 0) + c;
      const meta = r.metadata || {};
      const model = typeof (meta as Record<string, unknown>).model === 'string'
        ? ((meta as Record<string, unknown>).model as string)
        : 'unknown';
      costByModel[model] = (costByModel[model] || 0) + c;
    }
    return { totalCostUsd, costByAgent, costByModel };
  }

  // ---- API Key management (stored hashed with SHA-256) ----

  // ---- Stats ----

  getStats(): TraceStats {
    const totalRuns = this.db.prepare('SELECT COUNT(*) as c FROM runs').get() as unknown as {
      c: number;
    };
    const totalTraces = this.db.prepare('SELECT COUNT(*) as c FROM traces').get() as unknown as {
      c: number;
    };
    const successCount = this.db
      .prepare("SELECT COUNT(*) as c FROM traces WHERE status = 'success'")
      .get() as unknown as { c: number };
    const avgLatency = this.db
      .prepare('SELECT AVG(latency_ms) as v FROM traces')
      .get() as unknown as { v: number };
    const totalCost = this.db.prepare('SELECT SUM(cost_usd) as v FROM traces').get() as unknown as {
      v: number;
    };
    const totalTokens = this.db
      .prepare('SELECT SUM(total_tokens) as v FROM traces')
      .get() as unknown as { v: number };

    const topTools = this.db
      .prepare(
        `
      SELECT name, COUNT(*) as count, AVG(latency_ms) as avgLatencyMs
      FROM tool_calls GROUP BY name ORDER BY count DESC LIMIT 10
    `,
      )
      .all() as unknown[];
    const topToolsMapped = topTools.map((t) => {
      const rec = t as Record<string, unknown>;
      return {
        name: rec.name as string,
        count: Number(rec.count),
        avgLatencyMs: Number(rec.avgLatencyMs),
      };
    });

    const topErrors = this.db
      .prepare(
        `
      SELECT error, COUNT(*) as count FROM traces
      WHERE error IS NOT NULL AND error != ''
      GROUP BY error ORDER BY count DESC LIMIT 10
    `,
      )
      .all() as unknown[];
    const topErrorsMapped = topErrors.map((e) => {
      const rec = e as Record<string, unknown>;
      return { error: rec.error as string, count: Number(rec.count) };
    });

    const costByModelRows = this.db
      .prepare(
        `
      SELECT COALESCE(model, 'unknown') as model, SUM(cost_usd) as cost
      FROM traces GROUP BY model
    `,
      )
      .all() as unknown[];
    const costByModel: Record<string, number> = {};
    for (const r of costByModelRows) {
      const rec = r as Record<string, unknown>;
      costByModel[rec.model as string] = Number(rec.cost) || 0;
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
      topTools: topToolsMapped,
      topErrors: topErrorsMapped,
      droppedTraces: this._droppedTraces || 0,
    };
  }

  getCostBreakdown(runId?: string): CostBreakdown {
    const where = runId ? ' WHERE run_id = ?' : '';
    const params: unknown[] = runId ? [runId] : [];

    const totalCost = this.db
      .prepare(`SELECT SUM(cost_usd) as v FROM traces${where}`)
      .get(...params) as unknown as { v: number };

    const costByModelRows = this.db
      .prepare(
        `SELECT COALESCE(model, 'unknown') as model, SUM(cost_usd) as cost FROM traces${where} GROUP BY model`,
      )
      .all(...params) as unknown[];
    const costByModel: Record<string, number> = {};
    for (const r of costByModelRows) {
      const rec = r as Record<string, unknown>;
      costByModel[rec.model as string] = Number(rec.cost) || 0;
    }

    const byDayRows = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as day, SUM(cost_usd) as cost FROM traces${where} GROUP BY day ORDER BY day`,
      )
      .all(...params) as unknown[];
    const costByDay: Record<string, number> = {};
    for (const r of byDayRows) {
      const rec = r as Record<string, unknown>;
      if (rec.day) {
        costByDay[rec.day as string] = Number(rec.cost) || 0;
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
    const count = this.db.prepare('SELECT COUNT(*) as c FROM traces').get() as unknown as {
      c: number;
    };
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

  cleanupOldTraces(before: number): number {
    if (!before || before <= 0) return 0;
    // Clean dependents that do not have ON DELETE CASCADE (scores, trace_links)
    this.db
      .prepare(
        `DELETE FROM scores WHERE trace_id IN (SELECT id FROM traces WHERE created_at < ?)`,
      )
      .run(before);
    this.db
      .prepare(
        `
        DELETE FROM trace_links
        WHERE source_trace_id IN (SELECT id FROM traces WHERE created_at < ?)
           OR target_trace_id IN (SELECT id FROM traces WHERE created_at < ?)
      `,
      )
      .run(before, before);
    const res = this.db.prepare('DELETE FROM traces WHERE created_at < ?').run(before);
    return res.changes ?? 0;
  }

  cleanupOldRuns(before: number): number {
    if (!before || before <= 0) return 0;
    // CASCADE will delete associated traces + their tool_calls
    const res = this.db.prepare('DELETE FROM runs WHERE started_at < ?').run(before);
    return res.changes ?? 0;
  }

  cleanupOldAgentUsage(before: number): number {
    if (!before || before <= 0) return 0;
    const res = this.db.prepare('DELETE FROM agent_usage WHERE created_at < ?').run(before);
    return res.changes ?? 0;
  }

  // ---- Retention policy (persisted) ----

  getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as unknown as { value?: string } | undefined;
    return row && typeof row.value === 'string' ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  getRetentionPolicy(): { retentionDays: number; cleanupIntervalHours: number } {
    const rdStr = this.getSetting('retentionDays');
    const ciStr = this.getSetting('cleanupIntervalHours');
    return {
      retentionDays: rdStr !== null ? Math.max(0, parseInt(rdStr, 10) || 0) : 30,
      cleanupIntervalHours: ciStr !== null ? Math.max(1, parseInt(ciStr, 10) || 24) : 24,
    };
  }

  setRetentionPolicy(retentionDays: number, cleanupIntervalHours?: number): void {
    const days = Math.max(0, Math.floor(Number(retentionDays) || 0));
    this.setSetting('retentionDays', String(days));
    if (cleanupIntervalHours !== undefined) {
      const hrs = Math.max(1, Math.floor(Number(cleanupIntervalHours) || 24));
      this.setSetting('cleanupIntervalHours', String(hrs));
    }
  }

  // ---- Health / Integrity ----

  getHealthInfo(): {
    dbPath: string;
    traceCount: number;
    dbSize: number;
    integrity: { tablesExist: boolean; noOrphans: boolean; details?: string };
  } {
    const traceCountRow = this.db.prepare('SELECT COUNT(*) as c FROM traces').get() as unknown as {
      c: number;
    };
    const traceCount = traceCountRow ? traceCountRow.c : 0;
    const dbSize = this.getDbSize();

    const integrity = this.checkIntegrity();

    return {
      dbPath: this.dbPath,
      traceCount,
      dbSize,
      integrity,
    };
  }

  private getDbSize(): number {
    if (!this.dbPath || this.dbPath === ':memory:') {
      return 0;
    }
    try {
      return statSync(this.dbPath).size;
    } catch (_) {
      return 0;
    }
  }

  private checkIntegrity(): { tablesExist: boolean; noOrphans: boolean; details?: string } {
    const required = [
      'runs',
      'traces',
      'tool_calls',
      'scores',
      'alerts',
      'alert_history',
      'trace_links',
      'agent_usage',
      'webhooks',
      'api_keys',
      'version',
    ];

    const existingRows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const existing = new Set(existingRows.map((r) => r.name));
    const missing = required.filter((t) => !existing.has(t));
    const tablesExist = missing.length === 0;

    // PRAGMA integrity_check
    let pragmaMsg = '';
    try {
      const res = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const ok = Array.isArray(res) && res.length === 1 && res[0]?.integrity_check === 'ok';
      if (!ok) {
        pragmaMsg = res && res[0] ? String(res[0].integrity_check) : 'failed';
      }
    } catch (e) {
      pragmaMsg = String(e);
    }

    let orphanCount = 0;
    const orphanDetails: string[] = [];

    if (tablesExist) {
      const ot = this.db
        .prepare('SELECT COUNT(*) as c FROM traces WHERE run_id NOT IN (SELECT id FROM runs)')
        .get() as unknown as { c: number };
      if (ot && ot.c > 0) {
        orphanCount += ot.c;
        orphanDetails.push(`traces without run: ${ot.c}`);
      }

      const otc = this.db
        .prepare(
          'SELECT COUNT(*) as c FROM tool_calls WHERE trace_id NOT IN (SELECT id FROM traces)',
        )
        .get() as unknown as { c: number };
      if (otc && otc.c > 0) {
        orphanCount += otc.c;
        orphanDetails.push(`tool_calls without trace: ${otc.c}`);
      }

      const osc = this.db
        .prepare('SELECT COUNT(*) as c FROM scores WHERE trace_id NOT IN (SELECT id FROM traces)')
        .get() as unknown as { c: number };
      if (osc && osc.c > 0) {
        orphanCount += osc.c;
        orphanDetails.push(`scores without trace: ${osc.c}`);
      }

      const ol = this.db
        .prepare(
          `
          SELECT COUNT(*) as c FROM trace_links
          WHERE source_trace_id NOT IN (SELECT id FROM traces)
             OR target_trace_id NOT IN (SELECT id FROM traces)
        `,
        )
        .get() as unknown as { c: number };
      if (ol && ol.c > 0) {
        orphanCount += ol.c;
        orphanDetails.push(`trace_links orphaned: ${ol.c}`);
      }
    }

    const noOrphans = orphanCount === 0;
    const detailsParts: string[] = [];
    if (pragmaMsg) detailsParts.push(`pragma: ${pragmaMsg}`);
    if (orphanDetails.length) detailsParts.push(...orphanDetails);
    const details = detailsParts.length ? detailsParts.join('; ') : undefined;

    return {
      tablesExist,
      noOrphans,
      details,
    };
  }

  // ---- Helpers ----

  private rowToRun(row: unknown): Run {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      tenantId: (r.tenant_id as string) || undefined,
      name: r.name as string,
      status: r.status as Run['status'],
      traceCount: Number(r.trace_count),
      totalTokens: {
        promptTokens: Number(r.total_prompt_tokens),
        completionTokens: Number(r.total_completion_tokens),
        totalTokens: Number(r.total_tokens),
      },
      totalToolCalls: Number(r.total_tool_calls),
      totalLatencyMs: Number(r.total_latency_ms),
      totalCostUsd: Number(r.total_cost_usd),
      errorCount: Number(r.error_count),
      startedAt: Number(r.started_at),
      completedAt: r.completed_at != null ? Number(r.completed_at) : undefined,
      metadata: JSON.parse((r.metadata as string) || '{}'),
    };
  }

  private rowToTrace(row: unknown): Trace {
    const r = row as Record<string, unknown>;
    const toolCallsRows = this.db
      .prepare('SELECT * FROM tool_calls WHERE trace_id = ? ORDER BY timestamp')
      .all(r.id) as unknown[];
    return {
      id: r.id as string,
      runId: r.run_id as string,
      name: r.name as string,
      status: r.status as Trace['status'],
      input: JSON.parse((r.input as string) || 'null'),
      output: JSON.parse((r.output as string) || 'null'),
      tokens: {
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        totalTokens: Number(r.total_tokens),
        model: r.model as string | undefined,
        provider: r.provider as string | undefined,
      },
      toolCalls: toolCallsRows.map((tc) => {
        const t = tc as Record<string, unknown>;
        return {
          id: t.id as string,
          name: t.name as string,
          input: JSON.parse((t.input as string) || 'null'),
          output: JSON.parse((t.output as string) || 'null'),
          latencyMs: Number(t.latency_ms),
          success: t.success === 1,
          error: t.error as string | undefined,
          timestamp: Number(t.timestamp),
        };
      }),
      latencyMs: Number(r.latency_ms),
      costUsd: Number(r.cost_usd),
      error: r.error as string | undefined,
      metadata: JSON.parse((r.metadata as string) || '{}'),
      parentId: (r.parent_id as string) || undefined,
      tenantId: (r.tenant_id as string) || undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  private rowToAgentUsage(row: unknown): AgentUsageRecord {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      agentName: r.agent_name as string,
      agentType: (r.agent_type as string) || undefined,
      sessionId: (r.session_id as string) || undefined,
      action: r.action as string,
      target: (r.target as string) || undefined,
      tokensUsed: Number(r.tokens_used) || 0,
      costUsd: Number(r.cost_usd) || 0,
      durationMs: Number(r.duration_ms) || 0,
      status: (r.status as string as AgentUsageRecord['status']) || 'success',
      metadata: JSON.parse((r.metadata as string) || '{}'),
      createdAt: Number(r.created_at),
    };
  }

  // ── Webhook Management ──────────────────────────────────────────

  registerWebhook(url: string, events: string[], secret?: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO webhooks (id, url, secret, events, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, url, secret || null, JSON.stringify(events), Date.now());
    return id;
  }

  getWebhooks(): WebhookConfig[] {
    const rows = this.db.prepare(`
      SELECT id, url, secret, events, enabled, created_at, last_triggered_at, failure_count
      FROM webhooks ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      url: r.url as string,
      secret: (r.secret as string) || undefined,
      events: JSON.parse((r.events as string) || '[]'),
      enabled: !!(r.enabled as number),
      createdAt: Number(r.created_at),
      lastTriggeredAt: (r.last_triggered_at as number) || undefined,
      failureCount: Number(r.failure_count) || 0,
    }));
  }

  deleteWebhook(id: string): void {
    this.db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);
  }

  updateWebhookLastTriggered(id: string): void {
    this.db.prepare(`
      UPDATE webhooks SET last_triggered_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  incrementWebhookFailures(id: string): void {
    this.db.prepare(`
      UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?
    `).run(id);
  }

  resetWebhookFailures(id: string): void {
    this.db.prepare(`
      UPDATE webhooks SET failure_count = 0 WHERE id = ?
    `).run(id);
  }

  getEnabledWebhooksForEvent(event: string): WebhookConfig[] {
    const rows = this.db.prepare(`
      SELECT id, url, secret, events, enabled, created_at, last_triggered_at, failure_count
      FROM webhooks WHERE enabled = 1
    `).all() as Record<string, unknown>[];
    return rows
      .map(r => ({
        id: r.id as string,
        url: r.url as string,
        secret: (r.secret as string) || undefined,
        events: JSON.parse((r.events as string) || '[]'),
        enabled: !!(r.enabled as number),
        createdAt: Number(r.created_at),
        lastTriggeredAt: (r.last_triggered_at as number) || undefined,
        failureCount: Number(r.failure_count) || 0,
      }))
      .filter((w) => w.events.includes(event));
  }

  // ── API Key Management ──────────────────────────────────────────

  createApiKey(name: string, permissions: string[] = ['read', 'write']): { id: string; name: string; key: string; preview: string; createdAt: number } {
    const id = randomUUID();
    const key = randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(key).digest('hex');
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO api_keys (id, name, key_hash, permissions, created_at, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, name, keyHash, JSON.stringify(permissions), now);
    return { id, name, key, preview: key.slice(0, 8) + '****', createdAt: now };
  }

  getApiKeys(): { id: string; name: string; createdAt: number; lastUsedAt: number | null; enabled: boolean }[] {
    const rows = this.db.prepare(`
      SELECT id, name, created_at, last_used_at, enabled
      FROM api_keys ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      createdAt: Number(r.created_at),
      lastUsedAt: (r.last_used_at as number) || null,
      enabled: !!(r.enabled as number),
    }));
  }

  validateApiKey(key: string): { valid: boolean; permissions: string[] } {
    const keyHash = createHash('sha256').update(key).digest('hex');
    const row = this.db.prepare(`
      SELECT id, permissions, enabled FROM api_keys WHERE key_hash = ?
    `).get(keyHash) as Record<string, unknown> | undefined;
    if (!row || !row.enabled) return { valid: false, permissions: [] };
    this.db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`).run(Date.now(), keyHash);
    return { valid: true, permissions: JSON.parse((row.permissions as string) || '[]') };
  }

  revokeApiKey(id: string): void {
    this.db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
  }

  // ── Storage Stats ───────────────────────────────────────────────

  getStorageStats(): { totalSizeBytes: number; traceCount: number; runCount: number; oldestTrace: number | null; newestTrace: number | null } {
    const stat = statSync(this.dbPath);
    const traceCount = this.db.prepare(`SELECT COUNT(*) as c FROM traces`).get() as { c: number };
    const runCount = this.db.prepare(`SELECT COUNT(*) as c FROM runs`).get() as { c: number };
    const oldest = this.db.prepare(`SELECT MIN(created_at) as v FROM traces`).get() as { v: number | null };
    const newest = this.db.prepare(`SELECT MAX(created_at) as v FROM traces`).get() as { v: number | null };
    return {
      totalSizeBytes: stat.size,
      traceCount: traceCount.c,
      runCount: runCount.c,
      oldestTrace: oldest.v,
      newestTrace: newest.v,
    };
  }

  close(): void {
    this.db.close();
  }
}
