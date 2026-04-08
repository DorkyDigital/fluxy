import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import type { Client } from '@erinjs/core';
import type CommandHandler from '../handlers/CommandHandler';
import config from '../config';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter, authLimiter, writeLimiter } from './middleware/rateLimit';
import { createAuthMiddleware } from './middleware/auth';
import { createBotRouter } from './routes/bot';
import { createGuildsRouter } from './routes/guilds';
import { createStatsRouter } from './routes/stats';
import { createHealthRouter } from './routes/health';
import { createModerationRouter } from './routes/moderation';
import { createAuthRouter } from './routes/auth';
import { createDataRouter } from './routes/data';
import { createPublicRouter } from './routes/public';
import { setupHealthWebSocket, teardownHealthWebSocket } from './ws/healthWs';
import { setupSettingsWebSocket, teardownSettingsWebSocket } from './ws/settingsWs';
import { t } from '../i18n';

let httpServer: HttpServer | null = null;

function serverT(key: string): string {
  return t('en', `auditCatalog.api.server.${key}`);
}

export async function startApiServer(client: Client, commandHandler: CommandHandler): Promise<void> {
  const app = express();

  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'payment=(self "https://ko-fi.com" "https://storage.ko-fi.com" "https://www.paypal.com" "https://paypal.com" "https://js.stripe.com" "https://b.stripecdn.com" "https://challenges.cloudflare.com")',
    );
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://storage.ko-fi.com',
            'https://static.cloudflareinsights.com',
            'https://meow.dorcus.digital',
            'blob:',
          ],
          scriptSrcElem: [
            "'self'",
            "'unsafe-inline'",
            'https://storage.ko-fi.com',
            'https://static.cloudflareinsights.com',
            'https://meow.dorcus.digital',
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://storage.ko-fi.com',
            'https://static.cloudflareinsights.com',
            'https://fonts.googleapis.com',
          ],
          styleSrcElem: [
            "'self'",
            "'unsafe-inline'",
            'https://storage.ko-fi.com',
            'https://static.cloudflareinsights.com',
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: [
            "'self'",
            'https://fluxerusercontent.com',
            'https://cdn.jsdelivr.net',
            'https://storage.ko-fi.com',
            'data:',
          ],
          connectSrc: [
            "'self'",
            'wss:',
            'https://api.fluxer.app',
            'https://meow.dorcus.digital',
            'https://*.posthog.com',
            'https://bugs.fluxy.gay',
          ],
          frameSrc: ["'self'", 'https://ko-fi.com', 'https://storage.ko-fi.com'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(compression());
  app.use(
    cors({
      origin: config.api.dashboardUrl || false,
      credentials: true,
    }),
  );
  app.use('/api/guilds', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/', apiLimiter);
  app.use('/api/auth', authLimiter);

  const { authenticate, requireOwner, requireGuildAccess } = createAuthMiddleware(client);

  const authRouter = createAuthRouter();

  app.use('/api/public', createPublicRouter(client));

  app.use('/api/auth', authRouter);
  app.use('/api/bot', authenticate, createBotRouter(client, commandHandler, requireOwner));
  app.use('/api/guilds', authenticate, writeLimiter, createGuildsRouter(client, requireGuildAccess('id')));
  app.use('/api/stats', authenticate, requireOwner, createStatsRouter(client));
  app.use('/api/health', authenticate, requireOwner, createHealthRouter(client));
  app.use('/api/moderation', authenticate, createModerationRouter(requireGuildAccess('guildId')));
  app.use('/api/data', authenticate, createDataRouter());

  const dashboardPath = path.join(__dirname, '..', '..', 'dashboard', 'dist');
  app.use(
    '/assets',
    express.static(path.join(dashboardPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }),
  );
  app.use(
    express.static(dashboardPath, {
      maxAge: '5m',
      index: false,
    }),
  );

  app.get('/{*path}', apiLimiter, (_req, res) => {
    const indexPath = path.join(dashboardPath, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: serverT('dashboardNotBuilt') });
      }
    });
  });

  app.use(errorHandler);

  httpServer = createServer(app);

  setupHealthWebSocket(httpServer, client);
  setupSettingsWebSocket(httpServer);

  return new Promise((resolve) => {
    httpServer!.listen(config.api.port, () => {
      resolve();
    });
  });
}

export function stopApiServer(): Promise<void> {
  teardownHealthWebSocket();
  teardownSettingsWebSocket();
  return new Promise((resolve, reject) => {
    if (!httpServer) return resolve();
    httpServer.close((err: any) => {
      if (err) return reject(err);
      httpServer = null;
      resolve();
    });
  });
}
