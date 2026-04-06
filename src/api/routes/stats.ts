import { Router } from 'express';
import type { Client } from '@erinjs/core';
import Stat from '../../models/Stat';
import ModerationLog from '../../models/ModerationLog';
import { t } from '../../i18n';

function statsT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.routes.stats.${key}`, vars);
}

export function createStatsRouter(client: Client): Router {
  const router = Router();

  router.get('/totals', async (_req, res) => {
    try {
      const [commandCount, modActionCount] = await Promise.all([
        Stat.countDocuments({ type: 'command' }),
        ModerationLog.countDocuments(),
      ]);

      res.json({
        totalCommands: commandCount,
        totalModActions: modActionCount,
      });
    } catch {
      res.status(500).json({ error: statsT('internalServerError') });
    }
  });

  router.get('/commands/daily', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const daily = await Stat.aggregate([
        { $match: { type: 'command', createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      res.json(daily.map(d => ({ date: d._id, count: d.count })));
    } catch {
      res.status(500).json({ error: statsT('internalServerError') });
    }
  });

  router.get('/commands/top', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    try {
      const top = await Stat.aggregate([
        { $match: { type: 'command' } },
        { $group: { _id: '$value', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);

      res.json(top.map(t => ({ command: t._id, count: t.count })));
    } catch {
      res.status(500).json({ error: statsT('internalServerError') });
    }
  });

  router.get('/guilds/top', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    try {
      const top = await Stat.aggregate([
        { $match: { type: 'command', 'additionalData.guildId': { $exists: true } } },
        { $group: { _id: '$additionalData.guildId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);

      res.json(top.map(t => {
        const guild = client.guilds.get(t._id);
        return {
          guildId: t._id,
          name: guild?.name ?? statsT('unknownGuild', { guildId: t._id }),
          count: t.count,
        };
      }));
    } catch {
      res.status(500).json({ error: statsT('internalServerError') });
    }
  });

  return router;
}
