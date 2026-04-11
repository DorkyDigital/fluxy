import './instrument';

import * as GlitchTip from '@sentry/node';
import { Client, GatewayOpcodes, Events } from '@erinjs/core';
import { WebSocketShard } from '@erinjs/ws';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import config from './config';
import CommandHandler from './handlers/CommandHandler';
import EventHandler from './handlers/EventHandler';
import isNetworkError from './utils/isNetworkError';
import log from './utils/consoleLogger';
import GuildSettings from './models/GuildSettings';
import { getWorkerStats } from './utils/workerStats';

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

const IGNORED_GATEWAY_EVENTS = [
  'PRESENCE_UPDATE',
  'TYPING_START',
  'USER_UPDATE',
  'GUILD_INTEGRATIONS_UPDATE',
  'VOICE_STATE_UPDATE',
  'CHANNEL_PINS_UPDATE',
  'WEBHOOKS_UPDATE',
  'GUILD_EMOJIS_UPDATE',
  'INVITE_CREATE',
  'INVITE_DELETE',
];

const FAST_HEARTBEAT_MS = 500;
const FAST_HEARTBEAT_DURATION_MS = 30_000;

const wsProto = WebSocketShard.prototype as any;
if (!wsProto.__fluxyIdentifyPatched) {
  wsProto.__fluxyIdentifyPatched = true;
  const origHello = wsProto.handleHello;
  wsProto.handleHello = function (this: any, data: any) {
    const origSend = this.send.bind(this);
    this.send = (payload: any) => {
      if (payload?.op === GatewayOpcodes.Identify && payload.d) {
        payload.d.ignored_events = IGNORED_GATEWAY_EVENTS;
        delete payload.d.intents;
        delete payload.d.presence;
        if (!payload.d.token.startsWith('Bot ')) {
          payload.d.token = `Bot ${payload.d.token}`;
        }
        log.info('Gateway', `Identify → ignored_events=${IGNORED_GATEWAY_EVENTS.join(',')}`);
      }
      if (payload?.op === GatewayOpcodes.Resume && payload.d?.token) {
        if (!payload.d.token.startsWith('Bot ')) {
          payload.d.token = `Bot ${payload.d.token}`;
        }
        log.info('Gateway', `Resume → session=${payload.d.session_id}, seq=${payload.d.seq}`);
      }
      origSend(payload);
    };
    origHello.call(this, data);
    this.send = origSend;

    // Pump heartbeats aggressively to drain the server's 4096-event ack buffer. this is a horrible way to go about it but i genuinely have no idea what else to fuckin do
    const shard = this;
    let hbCount = 0;
    const sendHb = () => {
      if (shard.ws?.readyState === 1) {
        shard.send({ op: GatewayOpcodes.Heartbeat, d: shard.seq ?? null });
        if (++hbCount % 20 === 0) {
          log.debug('Gateway', `Fast HB × ${hbCount}, seq=${shard.seq ?? 'null'}`);
        }
      }
    };
    setTimeout(sendHb, 250);
    const fastHb = setInterval(sendHb, FAST_HEARTBEAT_MS);
    setTimeout(() => {
      clearInterval(fastHb);
      log.info('Gateway', `Fast heartbeat phase done (${hbCount} beats, seq=${shard.seq ?? 'null'})`);
    }, FAST_HEARTBEAT_DURATION_MS);
  };
}

try {
  config.validate();
} catch (error: any) {
  log.fatal('Config', error.message);
  process.exit(1);
}

function logTokenFingerprint(): void {
  try {
    const token = config.token || '';
    const trimmed = token.trim();
    if (trimmed !== token) {
      log.warn('Config', 'TOKEN has leading/trailing whitespace; trimming is recommended.');
    }
    const fingerprint = createHash('sha256').update(trimmed).digest('hex').slice(0, 10);
    log.info('Config', `TOKEN fingerprint: ${fingerprint} (len=${trimmed.length})`);
  } catch (error: any) {
    log.warn('Config', `Failed to compute TOKEN fingerprint: ${error?.message || error}`);
  }
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

logTokenFingerprint();

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
  if (process.env.SKIP_MONGO === '1') {
    log.warn('MongoDB', 'Skipped (SKIP_MONGO=1)');
    return;
  }

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
let sustainedOutageReported = false;

async function refreshPresence(logGuildCount = false): Promise<void> {
  try {
    const count = await fetchTotalGuildCount();
    if (count <= 0) return;

    BOT_PRESENCE.custom_status.text = `Watching ${count} servers`;
    pushPresenceUpdate();
    if (logGuildCount) {
      log.info('Presence', `Guild count: ${count} servers`);
    }
  } catch (error: any) {
    log.warn('Presence', `Failed to refresh guild count: ${error?.message || error}`);
  }
}

function pushPresenceUpdate(): void {
  try {
    (client as any).ws?.send(0, {
      op: GatewayOpcodes.PresenceUpdate,
      d: BOT_PRESENCE,
    });
  } catch {}
}

client.on(Events.Error, (error: any) => {
  if (isTransientError(error)) {
    const now = Date.now();
    wsErrorTimestamps.push(now);

    while (wsErrorTimestamps.length && wsErrorTimestamps[0] < now - WS_WATCHDOG_WINDOW_MS) {
      wsErrorTimestamps.shift();
    }

    if (!outageStartedAt) outageStartedAt = now;

    if (wsErrorTimestamps.length >= WS_WATCHDOG_THRESHOLD && now - outageStartedAt > MAX_OUTAGE_DURATION) {
      if (!sustainedOutageReported) {
        sustainedOutageReported = true;
        log.error(
          'Watchdog',
          `${WS_WATCHDOG_THRESHOLD}+ errors over ${Math.round((now - outageStartedAt) / 60000)}min sustained outage. Keeping the process alive and letting the gateway retry.`,
        );
        GlitchTip.captureMessage(
          `Gateway outage persisted past watchdog threshold: ${wsErrorTimestamps.length} errors over ${Math.round((now - outageStartedAt) / 1000)}s`,
          {
            level: 'error',
            tags: { source: 'ws_watchdog', action: 'continue' },
            extra: {
              errorCount: wsErrorTimestamps.length,
              outageDurationSeconds: Math.round((now - outageStartedAt) / 1000),
              lastError: error.message || String(error),
            },
          },
        );
      }
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

client.on(Events.Debug, (message: string) => {
  if (process.env.DEBUG) {
    log.debug('Gateway', message);
  }

  if (message.includes('Invalid session')) {
    log.warn('Recovery', 'Invalid session — SDK will reconnect');
  }

  if (message.includes('Closed: 4013')) {
    log.warn('Recovery', 'Gateway 4013 (ack backpressure) — restarting process');
    GlitchTip.captureMessage('Gateway 4013 (ack backpressure)', {
      level: 'warning',
      tags: { source: 'gateway_4013' },
    });
    GlitchTip.close(2000).finally(() => process.exit(1));
    return;
  }

  if (message.includes('Closed: 4004')) {
    log.error('Recovery', 'Gateway 4004 — auth failed, cannot reconnect in-process');
    GlitchTip.captureMessage('Gateway 4004 (auth failed on reconnect)', {
      level: 'error',
      tags: { source: 'gateway_4004' },
    });
  }
});

client.on(Events.Ready, () => {
  lastSuccessfulConnection = Date.now();
  outageStartedAt = null;
  wsErrorTimestamps.length = 0;
  glitchtipReportedAtCount = 0;
  sustainedOutageReported = false;

  setTimeout(() => {
    void refreshPresence(true);
    if (!(client as any)._presenceInterval) {
      (client as any)._presenceInterval = setInterval(
        () => {
          void refreshPresence();
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
  sustainedOutageReported = false;

  pushPresenceUpdate();
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

async function fetchTotalGuildCount(): Promise<number> {
  return client.guilds?.size || 0;
}

async function fetchAllShardInfo(): Promise<any[]> {
  return [
    {
      workerId: 0,
      shardIds: [0],
      status: 'online',
      guilds: client.guilds?.size || 0,
      memory: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
      uptime: Math.floor(process.uptime()),
      ping: (client as any)._ws?.shards?.values()?.next()?.value?.heartbeatAt
        ? Date.now() - (client as any)._ws.shards.values().next().value.heartbeatAt
        : null,
    },
  ];
}

async function fetchAllGuildIds(): Promise<Set<string>> {
  return new Set(client.guilds?.keys() || []);
}

async function fetchAllStats(): Promise<{ guilds: number; members: number; memory: number; uptime: number }> {
  return getWorkerStats(client);
}

(client as any).fetchTotalGuildCount = fetchTotalGuildCount;
(client as any).fetchAllStats = fetchAllStats;
(client as any).fetchAllShardInfo = fetchAllShardInfo;
(client as any).fetchAllGuildIds = fetchAllGuildIds;

export { client, commandHandler, eventHandler };

init();

let gatewayWasReady = false;
client.on(Events.Ready, () => {
  gatewayWasReady = true;
});
setInterval(() => {
  if (isShuttingDown || !gatewayWasReady) return;

  const shard: any = (client as any)._ws?.shards?.values()?.next()?.value;
  if (!shard) return;

  const connected = shard.ws?.readyState === 1;
  const reconnecting = shard.reconnectTimeout !== null;

  if (!connected && !reconnecting && !shard.destroying) {
    log.error('Watchdog', 'Gateway dead, no reconnect pending — restarting');
    GlitchTip.close(2000).finally(() => process.exit(1));
  }
}, 15_000);
