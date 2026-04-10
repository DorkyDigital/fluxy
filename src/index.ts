import './instrument';

import * as GlitchTip from '@sentry/node';
import { Client, GatewayOpcodes, Events } from '@erinjs/core';
import { WebSocketShard, WebSocketManager } from '@erinjs/ws';
import mongoose from 'mongoose';
import config from './config';
import CommandHandler from './handlers/CommandHandler';
import EventHandler from './handlers/EventHandler';
import isNetworkError from './utils/isNetworkError';
import log from './utils/consoleLogger';
import GuildSettings from './models/GuildSettings';
import { getWorkerStats } from './utils/workerStats';

const origHandleHello = (WebSocketShard.prototype as any).handleHello;
(WebSocketShard.prototype as any).handleHello = function (this: any, data: any) {
  const origSend = this.send.bind(this);
  this.send = (payload: any) => {
    if (payload?.op === 2 && payload.d) {
      // GatewayOpcodes.Identify
      payload.d.shard = [this.options.shardId, this.options.numShards];
    }
    origSend(payload);
  };
  origHandleHello.call(this, data);
  this.send = origSend;
};

// Patch connect() for burst heartbeats
const origConnect = WebSocketShard.prototype.connect;
WebSocketShard.prototype.connect = function (this: any) {
  origConnect.call(this);
  const ws = this.ws;
  if (!ws) return;

  let burstEventCount = 0;
  let burstActive = true;
  const BURST_HB_EVERY = 100;
  const BURST_DURATION = 30_000;
  setTimeout(() => {
    burstActive = false;
  }, BURST_DURATION);

  const onBurstMessage = () => {
    if (!burstActive) return;
    burstEventCount++;
    if (burstEventCount % BURST_HB_EVERY === 0) {
      const seq = this.seq;
      if (seq !== null && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ op: 1, d: seq }));
        } catch {}
      }
    }
  };

  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener('message', onBurstMessage);
  } else if (typeof ws.on === 'function') {
    ws.on('message', onBurstMessage);
  }
};

const assignedShardIds = process.env.SHARD_IDS ? process.env.SHARD_IDS.split(',').map(Number) : undefined;
const assignedTotalShards = process.env.TOTAL_SHARDS ? parseInt(process.env.TOTAL_SHARDS, 10) : undefined;
const isManagedWorker = assignedShardIds !== undefined && assignedTotalShards !== undefined;

if (isManagedWorker) {
  const origWsConnect = WebSocketManager.prototype.connect;
  WebSocketManager.prototype.connect = async function (this: any) {
    this.options.shardCount = assignedTotalShards;
    this.options.shardIds = assignedShardIds;
    return origWsConnect.call(this);
  };
}

const shardIdSet = isManagedWorker ? new Set(assignedShardIds) : null;

function guildShard(guildId: string): number {
  return Number(BigInt(guildId) % BigInt(assignedTotalShards!));
}

function ownsGuild(guildId: string): boolean {
  if (!shardIdSet || !assignedTotalShards) return true;
  try {
    return shardIdSet.has(guildShard(guildId));
  } catch {
    return true;
  }
}

const GUILD_ID_IN_ROOT = new Set(['GUILD_CREATE', 'GUILD_UPDATE', 'GUILD_DELETE']);

function extractGuildId(d: any, t: string | undefined): string | undefined {
  if (d?.guild_id) return String(d.guild_id);
  if (d?.guild?.id) return String(d.guild.id);
  if (t && GUILD_ID_IN_ROOT.has(t)) {
    return String(d?.id ?? d?.properties?.id ?? '');
  }
  return undefined;
}

const { Guild, Role } = require('@erinjs/core');
if (Guild && Role) {
  Guild.prototype.fetchRoles = async function (this: any) {
    const data = await this.client.rest.get(`/guilds/${this.id}/roles`);
    const list = Array.isArray(data) ? data : Object.values(data ?? {});
    const roles = [];
    this.roles.clear();
    for (const r of list) {
      const role = new Role(this.client, r, this.id);
      this.roles.set(role.id, role);
      roles.push(role);
    }
    return roles;
  };
}

if (isManagedWorker) {
  const { prototype: wsmProto } = WebSocketManager;
  const origEmit = wsmProto.emit;
  wsmProto.emit = function (this: any, event: string, ...args: any[]): boolean {
    if (event === 'dispatch') {
      const payload = args[0]?.payload;
      const d = payload?.d;
      const t: string | undefined = payload?.t;
      const guildId = extractGuildId(d, t);
      if (guildId && guildId !== '' && guildId !== 'undefined' && !ownsGuild(guildId)) return false;
      if (!guildId && assignedShardIds && !assignedShardIds.includes(0)) return false;
    }
    return origEmit.call(this, event, ...args);
  };
}

try {
  config.validate();
} catch (error: any) {
  log.fatal('Config', error.message);
  process.exit(1);
}

if (config.glitchtip.dsn) {
  log.ok('GlitchTip', `Initialized (env: ${config.glitchtip.environment})`);

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    const err = args.find((a) => a instanceof Error);
    if (err) {
      GlitchTip.captureException(err);
    } else {
      const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      GlitchTip.captureMessage(message, 'error');
    }
  };
} else {
  log.info('GlitchTip', 'No DSN configured - error tracking disabled');
}

const BOT_PRESENCE = {
  status: 'online' as const,
  custom_status: { text: 'Starting up...' },
  afk: false,
};

const client = new Client({
  intents: 0,
  presence: BOT_PRESENCE,
  waitForGuilds: true,
});

// init handlers
const commandHandler = new CommandHandler(client);
const eventHandler = new EventHandler(client);

(client as any).commandHandler = commandHandler;
(client as any).eventHandler = eventHandler;
(client as any)._presenceRef = BOT_PRESENCE;

/**
 * if an error is a transient network/WebSocket error, bot will be okie
 */
function isTransientError(error: any): boolean {
  if (isNetworkError(error)) return true;

  const errorMessage = error?.message?.toLowerCase() || '';
  const errorName = error?.name?.toLowerCase() || '';

  // ws errors
  if (
    errorMessage.includes('websocket') ||
    errorMessage.includes('socket hang up') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('network') ||
    errorName.includes('websocketerror')
  ) {
    return true;
  }

  // da error codes yur
  const transientCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE'];
  if (error?.code && transientCodes.includes(error.code)) {
    return true;
  }

  return false;
}

let mongoReconnecting = false;
let isShuttingDown = false;

function setupMongoListeners(): void {
  mongoose.connection.on('connected', () => {
    log.ok('MongoDB', 'Connected');
    mongoReconnecting = false;
  });

  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB', 'Disconnected');
    if (!mongoReconnecting && !isShuttingDown) {
      mongoReconnecting = true;
      attemptMongoReconnect();
    }
  });

  mongoose.connection.on('error', (err) => {
    log.error('MongoDB', err.message);
  });
}

async function attemptMongoReconnect(): Promise<void> {
  const delays = [2000, 5000, 10000, 30000, 60000];
  let attempt = 0;

  while (!isShuttingDown) {
    const delay = delays[Math.min(attempt, delays.length - 1)];
    log.warn('MongoDB', `Reconnecting in ${delay / 1000}s (attempt ${attempt + 1})...`);
    await new Promise((r) => setTimeout(r, delay));

    if (isShuttingDown) break;
    if (mongoose.connection.readyState === 1) {
      log.ok('MongoDB', 'Already reconnected.');
      mongoReconnecting = false;
      return;
    }

    try {
      await mongoose.connect(config.mongoUri);
      log.ok('MongoDB', 'Reconnected successfully.');
      mongoReconnecting = false;
      return;
    } catch (err: any) {
      log.error('MongoDB', `Reconnect attempt ${attempt + 1} failed: ${err.message}`);
      attempt++;
    }
  }
}

async function connectDatabase(): Promise<void> {
  const MAX_INITIAL_RETRIES = 5;
  const mongoOptions = {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 15000,
    bufferCommands: false,
  };

  for (let attempt = 1; attempt <= MAX_INITIAL_RETRIES; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, mongoOptions);
      setupMongoListeners();
      return;
    } catch (error: any) {
      log.error('MongoDB', `Attempt ${attempt}/${MAX_INITIAL_RETRIES} failed: ${error.message}`);
      if (attempt === MAX_INITIAL_RETRIES) {
        log.fatal('MongoDB', 'Connection failed after all retries. Exiting.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/**
 * init the bob
 */
async function init(): Promise<void> {
  const initStart = Date.now();

  log.banner([`${log.c.bold}${log.c.bCyan}Fluxy${log.c.reset}  ${log.c.gray}v2.0.0${log.c.reset}`]);

  log.divider('Startup');

  try {
    const dbStart = Date.now();
    const dbPromise = connectDatabase();

    const loadStart = Date.now();
    await commandHandler.loadCommands();
    const cmdTime = Date.now() - loadStart;
    log.step(`Commands loaded (${commandHandler.commands.size})`, cmdTime);

    const evtStart = Date.now();
    await eventHandler.loadEvents();
    log.step(`Event handlers loaded`, Date.now() - evtStart);

    // Wait for DB if it hasn't finished yet
    await dbPromise;
    log.step('MongoDB connected', Date.now() - dbStart);

    try {
      let guildCount: number | null = null;
      try {
        client.rest.setToken(config.token);
        let total = 0;
        let after: string | undefined;
        let page: any[];
        do {
          const url = '/users/@me/guilds' + (after ? `?after=${after}&limit=200` : '?limit=200');
          const res = (await client.rest.get(url)) as any;
          page = Array.isArray(res) ? res : (res?.guilds ?? []);
          total += page.length;
          if (page.length === 200) after = page[page.length - 1].id;
        } while (page.length === 200);
        guildCount = total;
      } catch {}
      if (guildCount === null) {
        guildCount = await GuildSettings.countDocuments();
        log.warn('Presence', 'Using DB count (API unavailable)');
      }
      BOT_PRESENCE.custom_status.text = `Watching ${guildCount} servers`;
      log.step(`Presence set: Watching ${guildCount} servers`, null);
    } catch {}

    const loginStart = Date.now();
    await client.login(config.token);
    log.step('Gateway login', Date.now() - loginStart);

    if (config.api.enabled) {
      try {
        const { startApiServer } = await import('./api/server');
        await startApiServer(client, commandHandler);
        log.step(`API server started on :${config.api.port}`, null);
      } catch (err: any) {
        log.error('API', `Failed to start API server: ${err.message}`);
      }
    }

    console.log('');
    log.ok('Startup', `Init complete in ${Date.now() - initStart}ms`);
    console.log('');
  } catch (error: any) {
    log.fatal('Startup', `Initialization error: ${error.message || error}`);
    process.exit(1);
  }
}

const wsErrorTimestamps: number[] = [];
const WS_WATCHDOG_WINDOW_MS = 10 * 60 * 1000;
const WS_WATCHDOG_THRESHOLD = 100;
const MAX_OUTAGE_DURATION = 60 * 60 * 1000;
let glitchtipReportedAtCount = 0;
let outageStartedAt: number | null = null;
let lastSuccessfulConnection = Date.now();

client.on(Events.Error, (error: any) => {
  if (isTransientError(error)) {
    const now = Date.now();
    wsErrorTimestamps.push(now);

    while (wsErrorTimestamps.length && wsErrorTimestamps[0] < now - WS_WATCHDOG_WINDOW_MS) {
      wsErrorTimestamps.shift();
    }

    if (!outageStartedAt) outageStartedAt = now;

    if (wsErrorTimestamps.length >= WS_WATCHDOG_THRESHOLD && now - outageStartedAt > MAX_OUTAGE_DURATION) {
      log.fatal(
        'Watchdog',
        `${WS_WATCHDOG_THRESHOLD}+ errors over ${Math.round((now - outageStartedAt) / 60000)}min sustained outage. Restarting for PM2.`,
      );
      process.exit(1);
    }

    if (wsErrorTimestamps.length % 5 === 1 || wsErrorTimestamps.length <= 3) {
      log.warn(
        'Network',
        `Hiccup ${wsErrorTimestamps.length}/${WS_WATCHDOG_THRESHOLD} - ${error.message || error} - SDK retrying`,
      );
    }

    const glitchtipThresholds = [10, 20, 35, WS_WATCHDOG_THRESHOLD];
    const count = wsErrorTimestamps.length;
    const outageDuration = outageStartedAt ? Math.round((now - outageStartedAt) / 1000) : 0;
    for (const threshold of glitchtipThresholds) {
      if (count >= threshold && glitchtipReportedAtCount < threshold) {
        glitchtipReportedAtCount = threshold;
        GlitchTip.captureMessage(`Gateway connectivity degraded: ${count} WebSocket errors in ${outageDuration}s`, {
          level: 'warning',
          tags: { source: 'ws_watchdog', threshold: String(threshold) },
          extra: {
            errorCount: count,
            outageDurationSeconds: outageDuration,
            lastError: error.message || String(error),
          },
        });
        break;
      }
    }

    if (process.env.DEBUG && error.cause) {
      log.debug('Network', 'Cause:', error.cause);
    }
  } else {
    log.error('Client', `${error.message || error} (code: ${error.code || 'unknown'})`);
    GlitchTip.captureException(error, {
      tags: { source: 'client_error' },
    });
  }
});

let consecutiveInvalidSessions = 0;
const MAX_CONSECUTIVE_INVALID_SESSIONS = 8;
const invalidSessionTimestamps: number[] = [];

let consecutiveClosed4013 = 0;
const MAX_CONSECUTIVE_CLOSED_4013 = 6;

client.on(Events.Debug, (message: string) => {
  if (process.env.DEBUG) {
    log.debug('Gateway', message);
  }

  if (message.includes('Invalid session')) {
    const now = Date.now();
    consecutiveInvalidSessions++;
    invalidSessionTimestamps.push(now);

    while (invalidSessionTimestamps.length && invalidSessionTimestamps[0] < now - 5 * 60 * 1000) {
      invalidSessionTimestamps.shift();
    }

    log.warn(
      'Recovery',
      `Invalid session (${consecutiveInvalidSessions}/${MAX_CONSECUTIVE_INVALID_SESSIONS}) - patched SDK will close WS and reconnect`,
    );

    if (consecutiveInvalidSessions >= MAX_CONSECUTIVE_INVALID_SESSIONS) {
      log.fatal(
        'Recovery',
        `${consecutiveInvalidSessions} consecutive invalid sessions - token may be invalid. Exiting for PM2.`,
      );
      GlitchTip.captureMessage(`Invalid session circuit breaker: ${consecutiveInvalidSessions} consecutive`, 'fatal');
      GlitchTip.flush(2000).then(() => process.exit(1));
    }
    return;
  }

  if (message.includes('Closed: 4013')) {
    consecutiveClosed4013++;
    log.warn(
      'Recovery',
      `Gateway 4013 (${consecutiveClosed4013}/${MAX_CONSECUTIVE_CLOSED_4013}) - shard will auto-reconnect`,
    );

    if (consecutiveClosed4013 > MAX_CONSECUTIVE_CLOSED_4013) {
      log.fatal('Recovery', `${consecutiveClosed4013} consecutive 4013 closes. Exiting for PM2.`);
      GlitchTip.captureMessage(`Gateway 4013 circuit breaker: ${consecutiveClosed4013} consecutive`, 'fatal');
      GlitchTip.flush(2000).then(() => process.exit(1));
    }
  }
});

client.on(Events.Ready, () => {
  lastSuccessfulConnection = Date.now();
  outageStartedAt = null;
  wsErrorTimestamps.length = 0;
  glitchtipReportedAtCount = 0;

  if (consecutiveInvalidSessions > 0) {
    log.ok('Recovery', `Gateway accepted session after ${consecutiveInvalidSessions} invalid session(s)`);
    consecutiveInvalidSessions = 0;
  }
  if (consecutiveClosed4013 > 0) {
    log.ok('Recovery', `Gateway accepted session after ${consecutiveClosed4013} close 4013(s)`);
    consecutiveClosed4013 = 0;
  }

  if (isManagedWorker && process.send) {
    for (const sid of assignedShardIds ?? []) {
      process.send({ type: 'shardReady', shardId: sid });
    }
  }

  setTimeout(async () => {
    const count = isManagedWorker ? await fetchTotalGuildCount() : client.guilds?.size || 0;
    if (count > 0) {
      BOT_PRESENCE.custom_status.text = `Watching ${count} servers`;
      log.info('Presence', `Guild count: ${count} servers`);
    }

    if (!(client as any)._presenceInterval) {
      (client as any)._presenceInterval = setInterval(
        async () => {
          const c = isManagedWorker ? await fetchTotalGuildCount() : client.guilds?.size || 0;
          if (c > 0) BOT_PRESENCE.custom_status.text = `Watching ${c} servers`;
        },
        10 * 60 * 1000,
      );
    }
  }, 15000);

  setTimeout(() => {
    client.rest
      .get('/gateway/bot')
      .then((gw: any) => {
        const limit = gw?.session_start_limit;
        if (limit !== null && limit !== undefined) {
          const { remaining, total, reset_after, max_concurrency } = limit;
          const resetSec = typeof reset_after === 'number' ? Math.round(reset_after / 1000) : '?';
          log.info(
            'Gateway',
            `Session limit: ${remaining}/${total} remaining, resets in ${resetSec}s` +
              (max_concurrency !== null && max_concurrency !== undefined
                ? `, max_concurrency: ${max_concurrency}`
                : ''),
          );
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, 30000);
});

client.on(Events.Resumed, () => {
  const downtime = outageStartedAt ? Math.round((Date.now() - outageStartedAt) / 1000) : 0;
  if (downtime > 5) {
    log.ok('Reconnect', `Connection resumed after ~${downtime}s downtime`);
  } else {
    log.ok('Reconnect', 'Connection resumed');
  }
  lastSuccessfulConnection = Date.now();
  outageStartedAt = null;
  wsErrorTimestamps.length = 0;
  glitchtipReportedAtCount = 0;

  if (client.options.presence) {
    try {
      (client as any).ws?.send(0, {
        op: GatewayOpcodes.PresenceUpdate,
        d: client.options.presence,
      });
    } catch {}
  }
});

setInterval(
  () => {
    if (isShuttingDown) return;
    const now = Date.now();
    const sinceLastSuccess = now - lastSuccessfulConnection;

    if (sinceLastSuccess > 15 * 60 * 1000 && wsErrorTimestamps.length > 10) {
      log.warn(
        'Health',
        `No connection in ${Math.round(sinceLastSuccess / 60000)}min - ${wsErrorTimestamps.length} errors - SDK retrying`,
      );
      GlitchTip.captureMessage(
        `Sustained gateway outage: no connection in ${Math.round(sinceLastSuccess / 60000)}min`,
        {
          level: 'error',
          tags: { source: 'health_monitor' },
          extra: {
            minutesSinceLastSuccess: Math.round(sinceLastSuccess / 60000),
            errorCount: wsErrorTimestamps.length,
          },
        },
      );
    }
  },
  5 * 60 * 1000,
);

setInterval(
  () => {
    if (isShuttingDown) return;
    const botId = client.user?.id;
    let swept = 0;
    for (const guild of client.guilds.values()) {
      const size = (guild as any).members.size;
      if (size <= 1) continue; // only bot's own member or empty
      for (const [id] of (guild as any).members) {
        if (id !== botId) {
          (guild as any).members.delete(id);
          swept++;
        }
      }
    }
    if (swept > 0) {
      const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      log.info('Sweep', `Cleared ${swept.toLocaleString()} cached members - heap: ${memMB} MB`);
    }
  },
  10 * 60 * 1000,
); // every 10 min

process.on('unhandledRejection', (reason: any) => {
  if (reason instanceof Error && isTransientError(reason)) {
    log.warn('Rejection', `${reason.message} - continuing`);
    return;
  }
  GlitchTip.captureException(reason);
  log.error('Rejection', reason?.message || reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  if (isTransientError(error)) {
    log.warn('Exception', `${error.message} - continuing`);
    return;
  }
  GlitchTip.captureException(error);
  log.fatal('Exception', error.message || error);
  process.exit(1);
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.divider('Shutdown');
  log.info('Shutdown', `Received ${signal}`);

  try {
    client.destroy();
    log.step('Client destroyed', null);

    await mongoose.disconnect();
    log.step('MongoDB disconnected', null);

    // Flush pending GlitchTip events before exit
    await GlitchTip.close(2000);

    log.ok('Shutdown', 'Clean exit');
    process.exit(0);
  } catch (error: any) {
    log.error('Shutdown', error.message || error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const ipcPendingRequests = new Map<string, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();

async function fetchTotalGuildCount(): Promise<number> {
  if (!isManagedWorker || !process.send) return client.guilds?.size || 0;

  const requestId = `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      ipcPendingRequests.delete(requestId);
      resolve(client.guilds?.size || 0);
    }, 5000);
    ipcPendingRequests.set(requestId, { resolve, timer });
    process.send!({ type: 'requestGuildCount', requestId });
  });
}

async function fetchAllShardInfo(): Promise<any[]> {
  if (!isManagedWorker || !process.send) {
    return [
      {
        workerId: 0,
        shardIds: [0],
        status: 'online',
        guilds: client.guilds?.size || 0,
        memory: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
        uptime: Math.floor(process.uptime()),
        ping: null,
      },
    ];
  }

  const requestId = `si-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<any[]>((resolve) => {
    const timer = setTimeout(() => {
      ipcPendingRequests.delete(requestId);
      resolve([]);
    }, 8000);
    ipcPendingRequests.set(requestId, { resolve, timer });
    process.send!({ type: 'requestShardInfo', requestId });
  });
}

async function fetchAllGuildIds(): Promise<Set<string>> {
  if (!isManagedWorker || !process.send) {
    return new Set(client.guilds?.keys() || []);
  }

  const requestId = `gi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<Set<string>>((resolve) => {
    const timer = setTimeout(() => {
      ipcPendingRequests.delete(requestId);
      resolve(new Set(client.guilds?.keys() || []));
    }, 8000);
    ipcPendingRequests.set(requestId, { resolve: (ids: string[]) => resolve(new Set(ids)), timer });
    process.send!({ type: 'requestGuildIds', requestId });
  });
}

async function fetchAllStats(): Promise<{ guilds: number; members: number; memory: number; uptime: number }> {
  if (!isManagedWorker || !process.send) {
    const s = await getWorkerStats(client);
    return s;
  }

  const requestId = `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcPendingRequests.delete(requestId);
      getWorkerStats(client).then(resolve);
    }, 35000);
    ipcPendingRequests.set(requestId, { resolve, timer });
    process.send!({ type: 'requestStats', requestId });
  });
}

(client as any).fetchTotalGuildCount = fetchTotalGuildCount;
(client as any).fetchAllStats = fetchAllStats;
(client as any).fetchAllShardInfo = fetchAllShardInfo;
(client as any).fetchAllGuildIds = fetchAllGuildIds;

if (isManagedWorker) {
  process.on('message', (msg: any) => {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'requestGuildCount':
        process.send?.({
          type: 'guildCountResponse',
          requestId: msg.requestId,
          count: client.guilds?.size || 0,
        });
        break;

      case 'totalGuildCount': {
        const pending = ipcPendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          ipcPendingRequests.delete(msg.requestId);
          pending.resolve(msg.count || 0);
        }
        break;
      }

      case 'requestShardInfo':
        process.send?.({
          type: 'shardInfoResponse',
          requestId: msg.requestId,
          info: {
            shardIds: assignedShardIds,
            status: 'online',
            guilds: client.guilds?.size || 0,
            memory: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
            uptime: Math.floor(process.uptime()),
            ping: (client as any)._ws?.shards?.values()?.next()?.value?.heartbeatAt
              ? Date.now() - (client as any)._ws.shards.values().next().value.heartbeatAt
              : null,
          },
        });
        break;

      case 'allShardInfo': {
        const pending = ipcPendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          ipcPendingRequests.delete(msg.requestId);
          pending.resolve(msg.shards);
        }
        break;
      }

      case 'requestGuildIds':
        process.send?.({
          type: 'guildIdsResponse',
          requestId: msg.requestId,
          guildIds: Array.from(client.guilds?.keys() || []),
        });
        break;

      case 'allGuildIds': {
        const pending = ipcPendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          ipcPendingRequests.delete(msg.requestId);
          pending.resolve(msg.guildIds);
        }
        break;
      }

      case 'requestStats': {
        getWorkerStats(client).then((stats) => {
          process.send?.({
            type: 'statsResponse',
            requestId: msg.requestId,
            guilds: stats.guilds,
            members: stats.members,
            memory: stats.memory,
            uptime: stats.uptime,
          });
        });
        break;
      }

      case 'allStats': {
        const pending = ipcPendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          ipcPendingRequests.delete(msg.requestId);
          pending.resolve({
            guilds: msg.guilds ?? 0,
            members: msg.members ?? 0,
            memory: msg.memory ?? 0,
            uptime: msg.uptime ?? 0,
          });
        }
        break;
      }

      case 'requestEval': {
        let result: any;
        try {
          result = eval(msg.script);
        } catch (err: any) {
          result = { error: err.message };
        }
        process.send?.({ type: 'evalResponse', requestId: msg.requestId, result });
        break;
      }
    }
  });
}

export { client, commandHandler, eventHandler };

init();
