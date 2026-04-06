import type { Request, Response, NextFunction } from 'express';
import { t } from '../../i18n';

function errorT(key: string): string {
  return t('en', `auditCatalog.api.middleware.errorHandler.${key}`);
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[API Error]', err.message || err);

  const status = err.status || err.statusCode || 500;
  const message = status >= 500
    ? errorT('internalServerError')
    : (err.message || errorT('genericError'));
  res.status(status).json({ error: message });
}
