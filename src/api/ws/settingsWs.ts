import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { verifyWsToken, getWsFluxerToken } from '../middleware/wsAuth';

let wss: WebSocketServer | null = null;

const clientSubscriptions = new WeakMap<WebSocket, Set<string>>();
const clientTokens = new WeakMap<WebSocket, string>();

export interface SettingsEvent {
  event: 'settings_updated';
  guildId: string;
  timestamp: number;
}

export function broadcastSettingsUpdate(guildId: string): void {
  if (!wss || wss.clients.size === 0) return;

  const payload: SettingsEvent = {
    event: 'settings_updated',
    guildId,
    timestamp: Date.now(),
  };

  const data = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      const subs = clientSubscriptions.get(ws);
      if (subs && subs.has(guildId)) {
        ws.send(data);
      }
    }
  }
}

async function verifyGuildAccess(token: string, guildId: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.fluxer.app/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const guilds = await res.json() as Array<{ id: string; owner_id?: string; permissions?: string | null }>;
    const guild = guilds.find(g => g.id === guildId);
    if (!guild) return false;

    const perms = guild.permissions ? BigInt(guild.permissions) : 0n;
    const isOwner = !!guild.owner_id;
    const hasAdmin = (perms & 0x8n) === 0x8n;
    const hasManageGuild = (perms & 0x20n) === 0x20n;

    return isOwner || hasAdmin || hasManageGuild;
  } catch {
    return false;
  }
}

export function setupSettingsWebSocket(httpServer: HttpServer): void {
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/settings',
    verifyClient: async ({ req }, done) => {
      const userId = await verifyWsToken(req, false);
      done(!!userId);
    },
  });

  wss.on('connection', (ws, req: IncomingMessage) => {
    clientSubscriptions.set(ws, new Set());

    const token = getWsFluxerToken(req);
    if (token) {
      clientTokens.set(ws, token);
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.subscribe && typeof msg.subscribe === 'string') {
          if (!/^\d{17,20}$/.test(msg.subscribe)) return;

          const subs = clientSubscriptions.get(ws);
          if (!subs || subs.size >= 50) return; // cap subscriptions

          if (subs.has(msg.subscribe)) return;

          const userToken = clientTokens.get(ws);
          if (!userToken) return;

          const hasAccess = await verifyGuildAccess(userToken, msg.subscribe);
          if (hasAccess) {
            subs.add(msg.subscribe);
          }
        }
        if (msg.unsubscribe && typeof msg.unsubscribe === 'string') {
          const subs = clientSubscriptions.get(ws);
          subs?.delete(msg.unsubscribe);
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
      clientTokens.delete(ws);
    });

    ws.on('error', () => {});
  });
}

export function teardownSettingsWebSocket(): void {
  if (wss) {
    for (const ws of wss.clients) ws.close();
    wss.close();
    wss = null;
  }
}
