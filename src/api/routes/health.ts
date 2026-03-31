import { Router } from 'express';
import os from 'os';
import type { Client } from '@fluxerjs/core';
import pidusage from 'pidusage';
import logBuffer from '../../services/LogBuffer';

export function createHealthRouter(client: Client): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      readyAt: client.readyAt?.toISOString() || null,
      online: !!client.user,
    });
  });

  router.get('/latency', (_req, res) => {
    const ws = (client as any)._ws || (client as any).ws;
    const ping = ws?.ping ?? null;

    res.json({
      wsPing: ping,
      timestamp: Date.now(),
    });
  });

  router.get('/process', async (_req, res) => {
    try {
      const usage = await pidusage(process.pid);
      const mem = process.memoryUsage();

      res.json({
        cpu: +usage.cpu.toFixed(1),
        memoryMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/host', (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    res.json({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model || 'unknown',
      cpuCores: cpus.length,
      totalMemoryMB: +(totalMem / 1024 / 1024).toFixed(0),
      freeMemoryMB: +(freeMem / 1024 / 1024).toFixed(0),
      usedMemoryMB: +((totalMem - freeMem) / 1024 / 1024).toFixed(0),
      loadAvg: os.loadavg(),
      uptimeSeconds: os.uptime(),
    });
  });

  router.get('/metrics', async (_req, res) => {
    try {
      const usage = await pidusage(process.pid);
      const mem = process.memoryUsage();
      const ws = (client as any)._ws || (client as any).ws;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      res.json({
        timestamp: Date.now(),
        uptime: process.uptime(),
        online: !!client.user,
        wsPing: ws?.ping ?? null,
        cpu: +usage.cpu.toFixed(1),
        memoryMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        hostUsedMemoryMB: +((totalMem - freeMem) / 1024 / 1024).toFixed(0),
        hostTotalMemoryMB: +(totalMem / 1024 / 1024).toFixed(0),
        loadAvg: os.loadavg(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const level = req.query.level as string | undefined;
    const since = parseInt(req.query.since as string) || 0;

    let entries = since > 0 ? logBuffer.getSince(since) : logBuffer.getRecent(limit);

    if (level) {
      entries = entries.filter(e => e.level === level);
    }

    if (!since) {
      entries = entries.slice(-limit);
    }

    res.json({
      entries,
      total: logBuffer.size,
    });
  });

  return router;
}
