import rateLimit from 'express-rate-limit';
import { t } from '../../i18n';

function rateLimitT(key: string): string {
  return t('en', `auditCatalog.api.middleware.rateLimit.${key}`);
}

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyRequests') },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyAuthRequests') },
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyWriteRequests') },
});
