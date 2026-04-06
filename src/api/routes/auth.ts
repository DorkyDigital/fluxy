import { Router, type Request } from 'express';
import crypto from 'crypto';
import config from '../../config';
import { invalidateTokenCache } from '../middleware/auth';
import { t } from '../../i18n';

const pendingStates = new Map<string, { createdAt: number }>();
const STATE_TTL = 5 * 60 * 1000;

function authRouteT(key: string): string {
  return t('en', `auditCatalog.api.routes.auth.${key}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > STATE_TTL) pendingStates.delete(key);
  }
}, 2 * 60 * 1000).unref();

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/login', (_req, res) => {
    const { clientId, redirectUri } = config.fluxerOAuth;
    if (!clientId || !redirectUri) {
      res.status(500).json({ error: authRouteT('oauthNotConfigured') });
      return;
    }

    const state = crypto.randomBytes(32).toString('hex');
    pendingStates.set(state, { createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });

    res.json({
      url: `https://web.fluxer.app/oauth2/authorize?${params.toString()}`,
      state,
    });
  });

  router.post('/callback', async (req, res) => {
    const { code, state } = req.body;
    if (!code) {
      res.status(400).json({ error: authRouteT('missingAuthorizationCode') });
      return;
    }

    if (!state || !pendingStates.has(state)) {
      res.status(400).json({ error: authRouteT('invalidOrExpiredState') });
      return;
    }
    pendingStates.delete(state);

    const { clientId, clientSecret, redirectUri } = config.fluxerOAuth;
    if (!clientId || !clientSecret || !redirectUri) {
      res.status(500).json({ error: authRouteT('oauthNotConfigured') });
      return;
    }

    try {
      const tokenRes = await fetch('https://api.fluxer.app/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        res.status(400).json({ error: authRouteT('tokenExchangeFailed') });
        return;
      }

      const tokenData = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (tokenData.access_token) {
        res.cookie('fluxy_token', tokenData.access_token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          path: '/',
        });
      }

      if (tokenData.refresh_token) {
        res.cookie('fluxy_refresh', tokenData.refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          path: '/',
        });
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: authRouteT('tokenExchangeError') });
    }
  });

  async function tryRefreshToken(req: Request): Promise<string | null> {
    const refreshToken = (req as any).cookies?.fluxy_refresh;
    if (!refreshToken) return null;

    const { clientId, clientSecret } = config.fluxerOAuth;
    if (!clientId || !clientSecret) return null;

    try {
      const tokenRes = await fetch('https://api.fluxer.app/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!tokenRes.ok) return null;

      const data = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
      };
      return data.access_token ?? null;
    } catch {
      return null;
    }
  }

  router.get('/me', async (req, res) => {
    let token: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if ((req as any).cookies?.fluxy_token) {
      token = (req as any).cookies.fluxy_token;
    }

    if (!token) {
      res.status(401).json({ error: authRouteT('missingToken') });
      return;
    }

    try {
      let userRes = await fetch('https://api.fluxer.app/users/@me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!userRes.ok && userRes.status === 401) {
        const newToken = await tryRefreshToken(req);
        if (newToken) {
          res.cookie('fluxy_token', newToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
          });
          userRes = await fetch('https://api.fluxer.app/users/@me', {
            headers: { Authorization: `Bearer ${newToken}` },
          });
        }
      }

      if (!userRes.ok) {
        res.status(401).json({ error: authRouteT('invalidToken') });
        return;
      }

      const user = await userRes.json();
      const responseData: Record<string, unknown> = {
        ...user as object,
        isOwner: config.ownerId ? (user as any).id === config.ownerId : false,
      };
      res.json(responseData);
    } catch {
      res.status(500).json({ error: authRouteT('internalServerError') });
    }
  });

  router.post('/logout', (req, res) => {
    // Invalidate the token from the server-side cache immediately
    const token = (req as any).cookies?.fluxy_token;
    if (token) {
      invalidateTokenCache(token);
    }
    res.clearCookie('fluxy_token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.clearCookie('fluxy_refresh', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.json({ success: true });
  });

  return router;
}
