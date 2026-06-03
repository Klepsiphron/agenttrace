/**
 * AgentTrace Dashboard
 * Local web UI + REST API for viewing agent traces
 */
import express, { Request, Response, Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentTrace, DashboardConfig, ExportFormat } from '@agenttrace/sdk';

export const VERSION = '0.0.0';
export const PACKAGE_NAME = '@agenttrace/dashboard';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Public assets are sibling to dist/ in the published package
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export interface DashboardApp {
  app: Express;
  trace: AgentTrace;
  close: () => void;
}

/**
 * Create an Express app with the AgentTrace dashboard API + static frontend.
 * Does not start the listener (useful for testing).
 */
export function createDashboardApp(dbPath?: string): DashboardApp {
  const app = express();
  const trace = new AgentTrace({
    dbPath: dbPath || './agenttrace.db',
    silent: true,
  });

  // Parse JSON bodies (for future POST if needed)
  app.use(express.json());

  // Serve the static frontend (index.html, style.css, app.js)
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  // ---------- API Routes ----------

  app.get('/api/stats', (_req: Request, res: Response) => {
    try {
      const stats = trace.getStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/costs', (req: Request, res: Response) => {
    try {
      const runId = (req.query['run-id'] || req.query.runId || req.query['runId']) as string | undefined;
      const breakdown = trace.getCostBreakdown({ runId: runId ? String(runId) : undefined });
      res.json(breakdown);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/runs', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 200;
      let runs = trace.getRuns(Math.max(1, Math.min(1000, limit || 200)));

      const status = req.query.status as string | undefined;
      if (status) {
        const allowed = status.split(',').filter(Boolean);
        if (allowed.length) {
          runs = runs.filter((r) => allowed.includes(r.status));
        }
      }

      res.json(runs);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/runs/:id', (req: Request, res: Response) => {
    try {
      const run = trace.getRun(String(req.params.id || ''));
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(run);
      return;
    } catch (err) {
      res.status(500).json({ error: String(err) });
      return;
    }
  });

  app.get('/api/traces', (req: Request, res: Response) => {
    try {
      const filter: Record<string, unknown> = {};

      if (req.query.runId) {
        filter.runId = String(req.query.runId);
      }
      if (req.query.status) {
        filter.status = String(req.query.status).split(',').filter(Boolean);
      }
      if (req.query.name) {
        filter.name = String(req.query.name);
      }
      if (req.query.limit) {
        filter.limit = parseInt(String(req.query.limit), 10);
      }
      if (req.query.offset) {
        filter.offset = parseInt(String(req.query.offset), 10);
      }

      const traces = trace.getTraces(filter);
      res.json(traces);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/traces/:id', (req: Request, res: Response) => {
    try {
      const t = trace.getTrace(String(req.params.id || ''));
      if (!t) {
        res.status(404).json({ error: 'Trace not found' });
        return;
      }
      res.json(t);
      return;
    } catch (err) {
      res.status(500).json({ error: String(err) });
      return;
    }
  });

  app.get('/api/export', (req: Request, res: Response) => {
    try {
      const format = (req.query.format === 'csv' ? 'csv' : 'json') as ExportFormat;

      // Use SDK export (traces). Could be extended to include runs.
      const data = trace.export(format);

      const mime = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
      const filename = `agenttrace-export.${format}`;

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Simple health check (useful for readiness)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, version: VERSION, package: PACKAGE_NAME });
  });

  // Fallback: serve index.html for unknown GET paths (SPA-friendly client routing).
  // Placed after static + API routes. Compatible with Express 5 / path-to-regexp v8.
  app.use((req: Request, res: Response, _next?: unknown) => {
    if (req.method === 'GET' && !req.path.includes('.') && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    }
    // Let other cases 404 naturally
    if (!res.headersSent) {
      res.status(404).send('Not found');
    }
  });

  const close = () => {
    trace.close();
  };

  return { app, trace, close };
}

/**
 * Start the dashboard HTTP server and return the listening server instance.
 */
export function startDashboard(config: DashboardConfig = {}) {
  const { port = 4317, host = '127.0.0.1', dbPath } = config;

  const { app, close } = createDashboardApp(dbPath);

  const server = app.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`[agenttrace] Dashboard running at ${url}`);
    console.log(`[agenttrace] Open in browser: ${url}`);
    console.log(`[agenttrace] Press Ctrl+C to stop`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[agenttrace] Shutting down dashboard...');
    server.close(() => {
      close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export default startDashboard;
