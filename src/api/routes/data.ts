import { Router } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { collectUserData, deleteUserData } from '../../services/UserDataService';
import { t } from '../../i18n';

function dataT(key: string): string {
  return t('en', `auditCatalog.api.routes.data.${key}`);
}

export function createDataRouter(): Router {
  const router = Router();

  router.get('/me', async (req: AuthRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: dataT('notAuthenticated') });
      return;
    }

    try {
      const data = await collectUserData(userId);
      res.json(data);
    } catch {
      res.status(500).json({ error: dataT('collectFailed') });
    }
  });

  router.delete('/me', async (req: AuthRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: dataT('notAuthenticated') });
      return;
    }

    try {
      const result = await deleteUserData(userId);
      res.json({ success: true, result });
    } catch {
      res.status(500).json({ error: dataT('deleteFailed') });
    }
  });

  return router;
}
