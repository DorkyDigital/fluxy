import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../../src/api/routes/health';

jest.mock('pidusage', () => jest.fn().mockResolvedValue({ cpu: 12.3, memory: 100000000, elapsed: 5000 }));

function makeClient(overrides: Record<string, any> = {}) {
  return {
    user: { id: 'bot1', username: 'Fluxy' },
    readyAt: new Date('2025-01-01T00:00:00Z'),
    _ws: { ping: 42 },
    ...overrides,
  } as any;
}

function createApp(client = makeClient()) {
  const app = express();
  app.use(express.json());
  app.use('/api/health', createHealthRouter(client));
  return app;
}

describe('GET /api/health', () => {
  test('returns status ok with uptime and readyAt', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeGreaterThan(0);
    expect(res.body.readyAt).toBe('2025-01-01T00:00:00.000Z');
    expect(res.body.online).toBe(true);
  });

  test('returns online false when client.user is null', async () => {
    const app = createApp(makeClient({ user: null }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.online).toBe(false);
  });

  test('returns readyAt null when not ready', async () => {
    const app = createApp(makeClient({ readyAt: null }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.readyAt).toBeNull();
  });
});

describe('GET /api/health/latency', () => {
  test('returns wsPing from client websocket', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health/latency');
    expect(res.status).toBe(200);
    expect(res.body.wsPing).toBe(42);
    expect(res.body.timestamp).toEqual(expect.any(Number));
  });

  test('returns null wsPing when ws is unavailable', async () => {
    const app = createApp(makeClient({ _ws: null, ws: null }));
    const res = await request(app).get('/api/health/latency');
    expect(res.status).toBe(200);
    expect(res.body.wsPing).toBeNull();
  });
});

describe('GET /api/health/process', () => {
  test('returns cpu and memory stats', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health/process');
    expect(res.status).toBe(200);
    expect(res.body.cpu).toEqual(expect.any(Number));
    expect(res.body.memoryMB).toEqual(expect.any(Number));
    expect(res.body.memoryTotalMB).toEqual(expect.any(Number));
    expect(res.body.rssMB).toEqual(expect.any(Number));
    expect(res.body.uptime).toEqual(expect.any(Number));
    expect(res.body.pid).toBe(process.pid);
    expect(res.body.nodeVersion).toBe(process.version);
  });

  test('returns 500 when pidusage fails', async () => {
    const pidusage = require('pidusage');
    pidusage.mockRejectedValueOnce(new Error('pidusage failed'));

    const app = createApp();
    const res = await request(app).get('/api/health/process');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('GET /api/health/host', () => {
  test('returns host system info', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health/host');
    expect(res.status).toBe(200);
    expect(res.body.platform).toEqual(expect.any(String));
    expect(res.body.arch).toEqual(expect.any(String));
    expect(res.body.hostname).toEqual(expect.any(String));
    expect(res.body.cpuCores).toBeGreaterThan(0);
    expect(res.body.totalMemoryMB).toBeGreaterThan(0);
    expect(res.body.freeMemoryMB).toEqual(expect.any(Number));
    expect(res.body.usedMemoryMB).toEqual(expect.any(Number));
    expect(res.body.loadAvg).toHaveLength(3);
    expect(res.body.uptimeSeconds).toBeGreaterThan(0);
  });
});
