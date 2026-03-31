import type { Request, Response, NextFunction } from 'express';
import type { Client } from '@fluxerjs/core';
import crypto from 'crypto';
import config from '../../config';

const tokenCache = new Map<string, { userId: string; expiresAt: number }>();
const TOKEN_CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenCache) {
    if (val.expiresAt <= now) tokenCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

function cacheToken(token: string, userId: string): void {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }
  tokenCache.set(token, { userId, expiresAt: Date.now() + TOKEN_CACHE_TTL });
}

export function invalidateTokenCache(token: string): void {
  tokenCache.delete(token);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export interface AuthRequest extends Request {
  userId?: string;
  isOwner?: boolean;
  fluxerToken?: string | null;
}

export async function validateFluxerToken(token: string): Promise<string | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  try {
    const res = await fetch('https://api.fluxer.app/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return null;

    const user = await res.json() as { id: string };
    if (!user?.id) return null;

    cacheToken(token, user.id);

    return user.id;
  } catch {
    return null;
  }
}

export function createAuthMiddleware(_client: Client) {
  async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    let token: string | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token && (req as any).cookies?.fluxy_token) {
      token = (req as any).cookies.fluxy_token;
    }

    if (!token) {
      res.status(401).json({ error: 'Missing or invalid authorization' });
      return;
    }

    if (config.api.adminToken && safeCompare(token, config.api.adminToken)) {
      req.userId = config.ownerId || 'admin';
      req.isOwner = true;
      req.fluxerToken = null;
      return next();
    }

    const userId = await validateFluxerToken(token);
    if (!userId) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.userId = userId;
    req.isOwner = config.ownerId ? userId === config.ownerId : false;
    req.fluxerToken = token;
    next();
  }

  function requireOwner(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.isOwner) {
      res.status(403).json({ error: 'This endpoint is restricted to the bot owner' });
      return;
    }
    next();
  }

  function requireGuildAccess(paramName: 'id' | 'guildId' = 'id') {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      const guildId = req.params[paramName];
      if (!guildId) {
        res.status(400).json({ error: 'Missing guild ID' });
        return;
      }

      const token = req.fluxerToken;
      if (!token) {
        res.status(403).json({ error: 'Guild access requires Fluxer OAuth authentication' });
        return;
      }

      try {
        const userGuildsRes = await fetch('https://api.fluxer.app/users/@me/guilds', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!userGuildsRes.ok) {
          res.status(502).json({ error: 'Failed to verify guild access' });
          return;
        }

        const userGuilds = await userGuildsRes.json() as Array<{ id: string; owner_id?: string; permissions?: string | null }>;
        const guild = userGuilds.find(g => g.id === guildId);

        if (!guild) {
          res.status(403).json({ error: 'You are not a member of this guild' });
          return;
        }

        const isOwner = guild.owner_id && guild.owner_id === req.userId;
        const perms = guild.permissions ? BigInt(guild.permissions) : 0n;
        const hasAdmin = (perms & 0x8n) === 0x8n;
        const hasManageGuild = (perms & 0x20n) === 0x20n;

        if (!isOwner && !hasAdmin && !hasManageGuild) {
          res.status(403).json({ error: 'You need Administrator or Manage Server permission to manage this guild' });
          return;
        }

        next();
      } catch {
        res.status(502).json({ error: 'Failed to verify guild access' });
      }
    };
  }

  return { authenticate, requireOwner, requireGuildAccess };
}
