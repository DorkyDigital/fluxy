import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import { validateFluxerToken } from './auth';
import config from '../../config';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) result[key.trim()] = decodeURIComponent(rest.join('=').trim());
  }
  return result;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function verifyWsToken(
  req: IncomingMessage,
  requireOwner = false,
): Promise<string | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['fluxy_token'] || null;

  if (!token) return null;

  if (config.api.adminToken && safeCompare(token, config.api.adminToken)) {
    return config.ownerId || 'admin';
  }

  const userId = await validateFluxerToken(token);
  if (!userId) return null;

  if (requireOwner) {
    const isOwner = config.ownerId ? userId === config.ownerId : false;
    if (!isOwner) return null;
  }

  return userId;
}

export function getWsFluxerToken(req: IncomingMessage): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['fluxy_token'] || null;
  if (!token) return null;
  if (config.api.adminToken && safeCompare(token, config.api.adminToken)) return null;
  return token;
}
