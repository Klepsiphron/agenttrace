/**
 * AgentTrace Webhook Tests
 * Tests: registerWebhook, getWebhooks, deleteWebhook, triggerWebhook,
 *        event emission on trace.complete / run.error
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { AgentTrace } from './index.js';
import { TraceStorage } from './storage.js';
import type { WebhookConfig, WebhookEvent, WebhookDelivery } from './types.js';

const TEST_URL = 'https://example.com/webhook';
const TEST_EVENTS: WebhookEvent[] = ['trace.complete', 'trace.error', 'run.complete', 'run.error'];

// ── Helpers ──────────────────────────────────────────────────────────

function tempDb(): string {
  return `./test-webhook-${randomUUID()}.db`;
}

function cleanupDb(dbPath: string): void {
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    try { unlinkSync(p); } catch (_) { /* ok */ }
  }
}

/** Create a Response-like object for mocking fetch */
function mockResponse(ok: boolean, status: number): Response {
  return { ok, status } as unknown as Response;
}

// ── Test Suite ───────────────────────────────────────────────────────

describe('AgentTrace Webhooks', () => {
  let dbPath: string;
  let agent: AgentTrace;

  beforeEach(() => {
    dbPath = tempDb();
    agent = new AgentTrace({ dbPath, silent: true });
  });

  afterEach(() => {
    agent.close();
    cleanupDb(dbPath);
  });

  // ── registerWebhook / addWebhook ─────────────────────────────────

  describe('registerWebhook', () => {
    it('should register a webhook and return a UUID id', () => {
      const id = agent.registerWebhook(TEST_URL, TEST_EVENTS);
      expect(id).toBeDefined();
      expect(id.length).toBe(36); // UUID format
      expect(/^[0-9a-f-]{36}$/.test(id)).toBe(true);
    });

    it('should register a webhook with a secret', () => {
      const id = agent.registerWebhook(TEST_URL, TEST_EVENTS, 'my-secret');
      const webhooks = agent.getWebhooks();
      expect(webhooks.length).toBe(1);
      expect(webhooks[0].id).toBe(id);
      expect(webhooks[0].secret).toBe('my-secret');
    });

    it('should register a webhook without a secret', () => {
      const id = agent.registerWebhook(TEST_URL, TEST_EVENTS);
      const webhooks = agent.getWebhooks();
      expect(webhooks[0].secret).toBeUndefined();
    });

    it('should register multiple webhooks', () => {
      agent.registerWebhook('https://hooks.slack.com/1', ['trace.complete']);
      agent.registerWebhook('https://hooks.slack.com/2', ['run.complete']);
      agent.registerWebhook('https://hooks.slack.com/3', ['trace.error', 'run.error']);

      const webhooks = agent.getWebhooks();
      expect(webhooks.length).toBe(3);
    });

    it('should store the correct event list', () => {
      agent.registerWebhook(TEST_URL, ['trace.complete', 'run.error']);
      const webhooks = agent.getWebhooks();
      expect(webhooks[0].events).toEqual(['trace.complete', 'run.error']);
    });

    it('addWebhook should be an alias for registerWebhook', () => {
      const id1 = agent.registerWebhook(TEST_URL, ['trace.complete']);
      const id2 = agent.addWebhook(TEST_URL, ['trace.complete']);
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(agent.getWebhooks().length).toBe(2);
    });
  });

  // ── getWebhooks ──────────────────────────────────────────────────

  describe('getWebhooks', () => {
    it('should return empty array when no webhooks registered', () => {
      const webhooks = agent.getWebhooks();
      expect(webhooks).toEqual([]);
    });

    it('should return all registered webhooks with correct shape', () => {
      agent.registerWebhook(TEST_URL, TEST_EVENTS, 'sec123');
      const webhooks = agent.getWebhooks();

      expect(webhooks.length).toBe(1);
      const wh = webhooks[0];
      expect(wh).toMatchObject({
        url: TEST_URL,
        secret: 'sec123',
        events: TEST_EVENTS,
        enabled: true,
        failureCount: 0,
      });
      expect(wh.id).toBeDefined();
      expect(wh.createdAt).toBeDefined();
      expect(typeof wh.createdAt).toBe('number');
    });

    it('should return webhooks ordered by created_at DESC (newest first)', () => {
      agent.registerWebhook('https://old.example.com', ['trace.complete']);
      // Small delay to ensure different timestamps
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(agent.registerWebhook(`https://hooks${i}.example.com`, ['run.complete']));
      }

      const webhooks = agent.getWebhooks();
      // The most recently created should be first
      expect(webhooks[0].url).toBe('https://hooks2.example.com');
    });
  });

  // ── deleteWebhook / removeWebhook ────────────────────────────────

  describe('deleteWebhook', () => {
    it('should delete a webhook by id', () => {
      const id = agent.registerWebhook(TEST_URL, TEST_EVENTS);
      expect(agent.getWebhooks().length).toBe(1);

      agent.deleteWebhook(id);
      expect(agent.getWebhooks().length).toBe(0);
    });

    it('should only delete the specified webhook', () => {
      const id1 = agent.registerWebhook('https://a.example.com', ['trace.complete']);
      const id2 = agent.registerWebhook('https://b.example.com', ['run.complete']);
      const id3 = agent.registerWebhook('https://c.example.com', ['trace.error']);

      agent.deleteWebhook(id2);
      const remaining = agent.getWebhooks();
      expect(remaining.length).toBe(2);
      expect(remaining.map(w => w.id)).toContain(id1);
      expect(remaining.map(w => w.id)).toContain(id3);
      expect(remaining.map(w => w.id)).not.toContain(id2);
    });

    it('should not throw when deleting a non-existent webhook', () => {
      expect(() => agent.deleteWebhook('non-existent-id')).not.toThrow();
    });

    it('removeWebhook should be an alias for deleteWebhook', () => {
      const id = agent.registerWebhook(TEST_URL, TEST_EVENTS);
      agent.removeWebhook(id);
      expect(agent.getWebhooks().length).toBe(0);
    });
  });

  // ── triggerWebhook (mocked HTTP) ─────────────────────────────────

  describe('triggerWebhook', () => {
    it('should call fetch for each enabled matching webhook', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      await agent.triggerWebhook('trace.complete', { traceId: 't1' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(TEST_URL);
      expect(opts.method).toBe('POST');
      expect(opts.headers).toMatchObject({ 'Content-Type': 'application/json' });

      vi.unstubAllGlobals();
    });

    it('should include event and timestamp in payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      const before = Date.now();
      await agent.triggerWebhook('trace.complete', { traceId: 't1' });
      const after = Date.now();

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body.event).toBe('trace.complete');
      expect(body.traceId).toBe('t1');
      expect(body.timestamp).toBeGreaterThanOrEqual(before);
      expect(body.timestamp).toBeLessThanOrEqual(after);

      vi.unstubAllGlobals();
    });

    it('should add HMAC signature header when webhook has a secret', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete'], 'my-secret');
      await agent.triggerWebhook('trace.complete', { traceId: 't1' });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-AgentTrace-Signature']).toBeDefined();
      expect(headers['X-AgentTrace-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

      vi.unstubAllGlobals();
    });

    it('should NOT add signature header when webhook has no secret', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      await agent.triggerWebhook('trace.complete', { traceId: 't1' });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-AgentTrace-Signature']).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('should return success delivery result for 200 response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      const results = await agent.triggerWebhook('trace.complete', { traceId: 't1' });

      expect(results.length).toBe(1);
      const delivery = results[0];
      expect(delivery.id).toBeDefined();
      expect(delivery.event).toBe('trace.complete');
      expect(delivery.status).toBe('success');
      expect(delivery.httpStatus).toBe(200);
      expect(delivery.error).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('should return failure delivery result for non-2xx response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(false, 500));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      const results = await agent.triggerWebhook('trace.complete', { traceId: 't1' });

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('failure');
      expect(results[0].httpStatus).toBe(500);
      expect(results[0].error).toContain('500');

      vi.unstubAllGlobals();
    });

    it('should return failure delivery when fetch throws', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['trace.complete']);
      const results = await agent.triggerWebhook('trace.complete', {});

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('failure');
      expect(results[0].error).toContain('connection refused');

      vi.unstubAllGlobals();
    });

    it('should not call fetch for disabled webhooks', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      // Register a webhook then disable it via storage
      const id = agent.registerWebhook(TEST_URL, ['trace.complete']);
      // @ts-expect-error - access storage for test setup
      agent.storage.db.prepare('UPDATE webhooks SET enabled = 0 WHERE id = ?').run(id);

      const results = await agent.triggerWebhook('trace.complete', {});
      expect(fetchMock).not.toHaveBeenCalled();
      expect(results.length).toBe(0);

      vi.unstubAllGlobals();
    });

    it('should only trigger webhooks registered for the given event', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook('https://a.example.com', ['trace.complete']);
      agent.registerWebhook('https://b.example.com', ['run.complete']);

      await agent.triggerWebhook('trace.complete', {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://a.example.com');

      vi.unstubAllGlobals();
    });

    it('should trigger multiple matching webhooks', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook('https://a.example.com', ['trace.complete', 'trace.error']);
      agent.registerWebhook('https://b.example.com', ['trace.complete']);

      const results = await agent.triggerWebhook('trace.complete', {});
      expect(results.length).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });

    it('should reset failure count on success', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(false, 500))
        .mockResolvedValueOnce(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      const id = agent.registerWebhook(TEST_URL, ['trace.complete']);

      // First call fails, increments failure_count
      await agent.triggerWebhook('trace.complete', {});
      // @ts-expect-error - access storage for assertion
      const wh1 = agent.storage.getWebhooks().find(w => w.id === id);
      expect(wh1!.failureCount).toBe(1);

      // Second call succeeds, resets failure_count
      await agent.triggerWebhook('trace.complete', {});
      // @ts-expect-error - access storage for assertion
      const wh2 = agent.storage.getWebhooks().find(w => w.id === id);
      expect(wh2!.failureCount).toBe(0);

      vi.unstubAllGlobals();
    });
  });

  // ── Event emission on run.complete / run.error ───────────────────

  describe('run lifecycle webhook events', () => {
    it('should trigger run.complete webhook when completeRun is called with success', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['run.complete']);
      const runId = agent.startRun('test-run');
      agent.completeRun('success');

      // Allow the fire-and-forget promise to resolve
      await new Promise(r => setTimeout(r, 50));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body.event).toBe('run.complete');
      expect(body.runId).toBe(runId);

      vi.unstubAllGlobals();
    });

    it('should trigger run.error webhook when completeRun is called with error status', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['run.error']);
      agent.startRun('failing-run');
      agent.completeRun('error');

      await new Promise(r => setTimeout(r, 50));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body.event).toBe('run.error');

      vi.unstubAllGlobals();
    });

    it('should NOT trigger webhook when no current run', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(true, 200));
      vi.stubGlobal('fetch', fetchMock);

      agent.registerWebhook(TEST_URL, ['run.complete']);
      // Call completeRun without starting a run
      agent.completeRun('success');

      await new Promise(r => setTimeout(r, 50));
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // ── Storage-level webhook CRUD (TraceStorage) ────────────────────

  describe('TraceStorage webhook methods', () => {
    let storage: TraceStorage;

    beforeEach(() => {
      storage = new TraceStorage(dbPath);
    });

    afterEach(() => {
      storage.close();
    });

    it('registerWebhook returns a valid UUID', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete'], 's3cr3t');
      expect(/^[0-9a-f-]{36}$/.test(id)).toBe(true);
    });

    it('getWebhooks returns parsed event arrays', () => {
      storage.registerWebhook(TEST_URL, ['trace.complete', 'run.error']);
      const webhooks = storage.getWebhooks();
      expect(webhooks[0].events).toEqual(['trace.complete', 'run.error']);
    });

    it('deleteWebhook removes the row', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete']);
      expect(storage.getWebhooks().length).toBe(1);
      storage.deleteWebhook(id);
      expect(storage.getWebhooks().length).toBe(0);
    });

    it('getEnabledWebhooksForEvent filters by event and enabled flag', () => {
      storage.registerWebhook('https://a.example.com', ['trace.complete']);
      storage.registerWebhook('https://b.example.com', ['run.complete']);
      storage.registerWebhook('https://c.example.com', ['trace.complete', 'run.complete']);

      const matched = storage.getEnabledWebhooksForEvent('trace.complete');
      expect(matched.length).toBe(2);
      expect(matched.map(w => w.url)).toContain('https://a.example.com');
      expect(matched.map(w => w.url)).toContain('https://c.example.com');
    });

    it('getEnabledWebhooksForEvent excludes disabled webhooks', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete']);
      storage.deleteWebhook(id); // easier: just re-register and disable
      const id2 = storage.registerWebhook(TEST_URL, ['trace.complete']);
      storage.db.prepare('UPDATE webhooks SET enabled = 0 WHERE id = ?').run(id2);

      const matched = storage.getEnabledWebhooksForEvent('trace.complete');
      expect(matched.length).toBe(0);
    });

    it('updateWebhookLastTriggered sets the timestamp', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete']);
      const before = Date.now();
      storage.updateWebhookLastTriggered(id);

      const wh = storage.getWebhooks()[0];
      expect(wh.lastTriggeredAt).toBeDefined();
      expect(wh.lastTriggeredAt).toBeGreaterThanOrEqual(before);
    });

    it('incrementWebhookFailures increments failure_count', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete']);
      storage.incrementWebhookFailures(id);
      storage.incrementWebhookFailures(id);

      const wh = storage.getWebhooks()[0];
      expect(wh.failureCount).toBe(2);
    });

    it('resetWebhookFailures sets failure_count to 0', () => {
      const id = storage.registerWebhook(TEST_URL, ['trace.complete']);
      storage.incrementWebhookFailures(id);
      storage.incrementWebhookFailures(id);
      storage.incrementWebhookFailures(id);
      storage.resetWebhookFailures(id);

      const wh = storage.getWebhooks()[0];
      expect(wh.failureCount).toBe(0);
    });
  });

  // ── All webhook event types ──────────────────────────────────────

  describe('webhook event type coverage', () => {
    const allEvents: WebhookEvent[] = [
      'trace.complete',
      'trace.error',
      'run.complete',
      'run.error',
      'cost.threshold',
      'agent.inactive',
    ];

    it.each(allEvents)('should support registering webhook for event "%s"', (event) => {
      const id = agent.registerWebhook(TEST_URL, [event]);
      const webhooks = agent.getWebhooks();
      expect(webhooks[0].events).toContain(event);
    });
  });
});
