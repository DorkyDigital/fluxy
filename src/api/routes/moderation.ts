import { Router, type RequestHandler } from 'express';
import type { AuthRequest } from '../middleware/auth';
import ModerationLog from '../../models/ModerationLog';
import Warning from '../../models/Warning';

export function createModerationRouter(requireGuildAccess: RequestHandler): Router {
  const router = Router();

  router.get('/:guildId/logs', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.guildId as string;
      const { limit, skip, action, userId, targetId } = req.query;

      const safeStr = (v: unknown): string | undefined =>
        typeof v === 'string' ? v : undefined;

      const logs = await ModerationLog.getGuildLogs(guildId, {
        limit: Math.min(parseInt(limit as string) || 50, 100),
        skip: parseInt(skip as string) || 0,
        action: safeStr(action) as any,
        userId: safeStr(userId),
        targetId: safeStr(targetId),
      });

      const total = await ModerationLog.countDocuments({ guildId });

      res.json({ logs, total });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId/logs/:caseNumber', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const caseNum = parseInt(req.params.caseNumber as string);
      if (isNaN(caseNum)) {
        res.status(400).json({ error: 'Invalid case number' });
        return;
      }

      const log = await ModerationLog.getCase(req.params.guildId as string, caseNum);
      if (!log) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      res.json(log);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId/stats', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);
      const stats = await ModerationLog.getGuildStats(req.params.guildId as string, days);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId/warnings/:userId', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const record = await Warning.getUserWarnings(req.params.guildId as string, req.params.userId as string);
      res.json({
        userId: req.params.userId,
        guildId: req.params.guildId,
        warnings: record.warnings,
        activeCount: record.getActiveCount(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:guildId/user/:userId/history', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const history = await ModerationLog.getUserHistory(req.params.guildId as string, req.params.userId as string, limit);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
