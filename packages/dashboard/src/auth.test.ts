import { describe, it, expect, afterEach } from 'vitest';
import { createDashboardApp, createApiKey, apiKeyStore } from './index.ts';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createHash } from 'node:crypto';

function getServerPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === 'object' && 'port' in addr) {
    return ((addr as AddressInfo).port as number) || 0;
  }
  return 0;
}

describe('API key authentication', () => {
  let servers: http.Server[] = [];
  let closes: Array<() => void> = [];

  afterEach(() => {
    servers.forEach((s) => {
      try {
        s.close();
      } catch (_) {
        /* ignore */
      }
    });
    closes.forEach((c) => {
      try {
        c();
      } catch (_) {
        /* ignore */
      }
    });
    servers = [];
    closes = [];
    // Clear the shared key store between tests
    apiKeyStore.clear();
  });

  async function startTemp(app: Express): Promise<{ port: number; base: string }> {
    const server = app.listen(0);
    servers.push(server);
    const port = getServerPort(server);
    await new Promise((r) => setTimeout(r, 5));
    return { port, base: `http://127.0.0.1:${port}` };
  }

  describe('auth middleware', () => {
    it('GET /api/health works without API key', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);
      const res = await fetch(`${base}/api/health`);
      // Should NOT require auth — status depends on real system resources
      expect(res.status).not.toBe(401);
      const data = await res.json();
      expect(data.status).toMatch(/healthy|degraded|unhealthy/);
      expect(data.checks).toBeTruthy();
    });

    it('GET /api/stats returns 401 without API key', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);
      const res = await fetch(`${base}/api/stats`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/stats returns 200 with valid API key', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { plaintextKey } = createApiKey('test-key');
      const { base } = await startTemp(app);
      const res = await fetch(`${base}/api/stats`, {
        headers: { 'X-API-Key': plaintextKey },
      });
      expect(res.status).toBe(200);
    });

    it('returns 401 with invalid API key', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);
      const res = await fetch(`${base}/api/stats`, {
        headers: { 'X-API-Key': 'totally-invalid-key' },
      });
      expect(res.status).toBe(401);
    });

    it('static assets are served without auth', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);
      // index.html should be accessible without auth (static middleware runs first)
      const res = await fetch(`${base}/`);
      // 200 or 404 depending on whether public dir exists, but NOT 401
      expect(res.status).not.toBe(401);
    });
  });

  describe('POST /api/v1/keys (create)', () => {
    it('creates a new API key and returns plaintext once', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      // Create a bootstrap key first
      const bootstrap = createApiKey('bootstrap');
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': bootstrap.plaintextKey,
        },
        body: JSON.stringify({ name: 'my-test-key' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeTruthy();
      expect(data.name).toBe('my-test-key');
      expect(data.key).toBeTruthy();
      expect(data.key.length).toBe(64); // 32 bytes hex
      expect(data.prefix).toBe(data.key.slice(0, 8));
      expect(typeof data.createdAt).toBe('number');
    });

    it('creates key with default name when name is omitted', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': bootstrap.plaintextKey,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe('default');
    });

    it('newly created key works for authentication', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      const { base } = await startTemp(app);

      // Create a new key
      const createRes = await fetch(`${base}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': bootstrap.plaintextKey,
        },
        body: JSON.stringify({ name: 'child-key' }),
      });
      const created = await createRes.json();

      // Use the new key
      const statsRes = await fetch(`${base}/api/stats`, {
        headers: { 'X-API-Key': created.key },
      });
      expect(statsRes.status).toBe(200);
    });

    it('requires auth to create keys', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'unauthorized' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/keys (list)', () => {
    it('lists all keys without exposing hashes', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      createApiKey('second-key');
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys`, {
        headers: { 'X-API-Key': bootstrap.plaintextKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.keys).toBeTruthy();
      expect(data.keys.length).toBe(2);
      // Each key should have id, name, prefix, createdAt — but NOT hash or plaintext
      for (const key of data.keys) {
        expect(key.id).toBeTruthy();
        expect(key.name).toBeTruthy();
        expect(key.prefix).toBeTruthy();
        expect(key.prefix.length).toBe(8);
        expect(typeof key.createdAt).toBe('number');
        expect(key.hash).toBeUndefined();
        expect(key.key).toBeUndefined();
      }
    });

    it('requires auth to list keys', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const { base } = await startTemp(app);
      const res = await fetch(`${base}/api/v1/keys`);
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/keys/:id (revoke)', () => {
    it('revokes an existing key', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      const target = createApiKey('to-be-revoked');
      const { base } = await startTemp(app);

      // Verify target key works
      const beforeRes = await fetch(`${base}/api/stats`, {
        headers: { 'X-API-Key': target.plaintextKey },
      });
      expect(beforeRes.status).toBe(200);

      // Revoke it
      const deleteRes = await fetch(`${base}/api/v1/keys/${target.record.id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': bootstrap.plaintextKey },
      });
      expect(deleteRes.status).toBe(204);

      // Key should no longer work
      const afterRes = await fetch(`${base}/api/stats`, {
        headers: { 'X-API-Key': target.plaintextKey },
      });
      expect(afterRes.status).toBe(401);
    });

    it('returns 404 for non-existent key id', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys/nonexistent-id`, {
        method: 'DELETE',
        headers: { 'X-API-Key': bootstrap.plaintextKey },
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.code).toBe('NOT_FOUND');
    });

    it('requires auth to revoke keys', async () => {
      const { app, close } = createDashboardApp(':memory:');
      closes.push(close);
      const bootstrap = createApiKey('bootstrap');
      const { base } = await startTemp(app);

      const res = await fetch(`${base}/api/v1/keys/${bootstrap.record.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('key storage', () => {
    it('keys are stored as SHA-256 hashes, not plaintext', () => {
      const { record, plaintextKey } = createApiKey('hash-test');
      // The record hash should be the SHA-256 of the plaintext key
      const expectedHash = createHash('sha256').update(plaintextKey).digest('hex');
      expect(record.hash).toBe(expectedHash);
      // The store should use the hash as the key
      expect(apiKeyStore.get(expectedHash)).toBe(record);
      // The plaintext key should NOT be stored anywhere in the record
      expect(record.hash).not.toBe(plaintextKey);
    });

    it('prefix is first 8 characters of the key', () => {
      const { record, plaintextKey } = createApiKey('prefix-test');
      expect(record.prefix).toBe(plaintextKey.slice(0, 8));
    });
  });
});
