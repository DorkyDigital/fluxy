import { Sentry } from './sentry';

const API_BASE = '/api';

const responseCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function getCached<T>(key: string): T | undefined {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  if (entry) responseCache.delete(key);
  return undefined;
}

function setCache(key: string, data: unknown): void {
  responseCache.set(key, { data, ts: Date.now() });
  if (responseCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (now - v.ts > CACHE_TTL) responseCache.delete(k);
    }
  }
}

export function invalidateCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.startsWith(pathPrefix)) responseCache.delete(key);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(body.error || `HTTP ${res.status}`);

    if (res.status !== 401 && res.status !== 403) {
      Sentry.captureException(error, {
        tags: { api_path: path, status: res.status },
        contexts: { response: { status: res.status, body } },
      });
    }

    throw error;
  }

  return res.json();
}

export const api = {
  get: <T>(path: string, { skipCache = false }: { skipCache?: boolean } = {}) => {
    if (!skipCache) {
      const cached = getCached<T>(path);
      if (cached !== undefined) return Promise.resolve(cached);
    }
    return request<T>(path).then(data => {
      setCache(path, data);
      return data;
    });
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }).then(data => {
      const base = path.replace(/\/[^/]+$/, '');
      invalidateCache(base);
      return data;
    }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }).then(data => {
      const base = path.replace(/\/[^/]+$/, '');
      invalidateCache(base);
      return data;
    }),
};

export interface BotInfo {
  id: string | null;
  username: string | null;
  avatar: string | null;
  guilds: number;
  uptime: number;
  readyAt: string | null;
  memoryMB: number;
}

export interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  botPresent?: boolean;
}

export interface GuildDetail extends GuildSummary {
  ownerId: string | null;
  channels: Array<{ id: string; name: string; type: number; parent_id: string | null; position: number }>;
  roles: Array<{ id: string; name: string; color: number; position: number }>;
  emojis: Array<{ id: string; name: string; animated: boolean; url?: string | null }>;
}

export interface HealthInfo {
  status: string;
  uptime: number;
  readyAt: string | null;
  online: boolean;
}

export interface ProcessInfo {
  cpu: number;
  memoryMB: number;
  memoryTotalMB: number;
  rssMB: number;
  uptime: number;
  pid: number;
  nodeVersion: string;
}

export interface UserInfo {
  id: string;
  username: string;
  avatar: string | null;
  isOwner: boolean;
}

export interface LogEntry {
  level: string;
  tag: string;
  message: string;
  timestamp: number;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
}

export interface KeywordEntry {
  pattern: string;
  isRegex: boolean;
  label: string | null;
  addedBy: string | null;
}

export interface KeywordWarnings {
  enabled: boolean;
  action: 'delete' | 'warn' | 'delete+warn';
  keywords: KeywordEntry[];
}

export interface HoneypotEntry {
  channelId: string;
  action: 'ban' | 'kick' | 'timeout' | 'role';
  enabled: boolean;
  banDeleteDays: number;
  timeoutHours: number;
  roleId: string | null;
}

export interface WelcomeCard {
  preset: string | null;
  bgColor1: string | null;
  bgColor2: string | null;
  bgColor3: string | null;
  accentColor: string | null;
  textColor: string | null;
  subtextColor: string | null;
  countColor: string | null;
  greetingText: string | null;
  subtitle: string | null;
  showMemberCount: boolean;
  bgImageURL: string | null;
}

export interface WelcomeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
  thumbnail: boolean;
}

export interface WelcomeDM {
  enabled: boolean;
  message: string | null;
  imageEnabled: boolean;
}

export interface WelcomeMessage {
  enabled: boolean;
  type: 'none' | 'preset' | 'custom';
  channelId: string | null;
  message: string | null;
  preset: string | null;
  imageEnabled: boolean;
  card: WelcomeCard;
  embed: WelcomeEmbed;
  dm: WelcomeDM;
  showRole: boolean;
  trigger: 'join' | 'role';
}

export interface ReactionRoleEntry {
  emoji: string;
  roleId: string;
  removeRoleId?: string | null;
}

export interface ReactionRole {
  messageId: string;
  channelId: string;
  roles: ReactionRoleEntry[];
}

export interface Moderation {
  muteRoleId: string | null;
  logChannelId: string | null;
  autoMute: boolean;
  autoMuteThreshold: number;
  muteMethod: 'auto' | 'timeout' | 'mute_role';
}

export interface CustomCommand {
  name: string;
  response: string;
  embed: boolean;
  color: string | null;
  title: string | null;
}

export interface AutomodSpam {
  maxMessages: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
}

export interface AutomodRaid {
  userThreshold: number;
  timeWindow: number;
}

export type AutomodLevel = 'off' | 'minimal' | 'medium' | 'high';

export interface Automod {
  level: AutomodLevel;
  antiSpam: boolean;
  antiLink: boolean;
  antiReactionSpam: boolean;
  ghostPing: boolean;
  maxMentions: number;
  maxLines: number;
  spam: AutomodSpam;
  raid: AutomodRaid;
  allowedDomains: string[];
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface GoodbyeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
}

export interface GoodbyeMessage {
  enabled: boolean;
  channelId: string | null;
  message: string | null;
  embed: GoodbyeEmbed;
}

export interface LogChannelOverrides {
  member: string | null;
  voice: string | null;
  message: string | null;
  role: string | null;
  channel: string | null;
  reaction: string | null;
  server: string | null;
}

export interface Verification {
  enabled: boolean;
  categoryId: string | null;
  verifiedRoleId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  maxAttempts: number;
}

export interface Starboard {
  enabled: boolean;
  channelId: string | null;
  threshold: number;
  emoji: string;
  selfStarEnabled: boolean;
  ignoreBots: boolean;
  ignoredChannels: string[];
  ignoredRoles: string[];
}

export interface GuildSettings {
  guildId: string;
  prefixes: string[];
  welcomeMessage: WelcomeMessage;
  reactionRoles: ReactionRole[];
  moderation: Moderation;
  automod: Automod;
  logChannelId: string | null;
  muteRoleId: string | null;
  prefix: string | null;
  autoroleId: string | null;
  raidDisableAutorole: boolean;
  staffChannelId: string | null;
  staffRoleId: string | null;
  staffInboxChannelId: string | null;
  keywordWarnings: KeywordWarnings;
  honeypotChannels: HoneypotEntry[];
  honeypotAlertRoleId: string | null;
  serverLogChannelId: string | null;
  logChannelOverrides: LogChannelOverrides;
  disabledLogEvents: string[];
  blacklistedChannels: string[];
  ticketCategoryId: string | null;
  ticketSupportRoleId: string | null;
  ticketSupportRoleIds: string[];
  ticketLogChannelId: string | null;
  ticketMaxOpen: number;
  ticketOpenMessage: string | null;
  ticketSetupChannelId: string | null;
  ticketSetupMessageId: string | null;
  ticketEmoji: string;
  customCommands: CustomCommand[];
  reactionRoleDMEnabled: boolean;
  goodbyeMessage: GoodbyeMessage;
  lockdownRoles: string[];
  lockdownAllowedRoles: string[];
  lockdownAllowedUsers: string[];
  slowmodeAllowedRoles: string[];
  commandAllowedRoles: string[];
  disabledCommands: string[];
  verification: Verification;
  starboard: Starboard;
}

export function normalizeSettings(s: Partial<GuildSettings> & { guildId: string }): GuildSettings {
  const wm = (s.welcomeMessage ?? {}) as Partial<WelcomeMessage>;
  const am = (s.automod ?? {}) as Partial<Automod>;
  const mod = (s.moderation ?? {}) as Partial<Moderation>;
  const kw = (s.keywordWarnings ?? {}) as Partial<KeywordWarnings>;
  const gm = (s.goodbyeMessage ?? {}) as Partial<GoodbyeMessage>;

  return {
    guildId: s.guildId,
    prefixes: s.prefixes ?? [],
    prefix: s.prefix ?? null,
    logChannelId: s.logChannelId ?? null,
    muteRoleId: s.muteRoleId ?? null,
    autoroleId: s.autoroleId ?? null,
    raidDisableAutorole: s.raidDisableAutorole ?? false,
    staffChannelId: s.staffChannelId ?? null,
    staffRoleId: s.staffRoleId ?? null,
    staffInboxChannelId: s.staffInboxChannelId ?? null,
    serverLogChannelId: s.serverLogChannelId ?? null,
    logChannelOverrides: {
      member: (s as any).logChannelOverrides?.member ?? null,
      voice: (s as any).logChannelOverrides?.voice ?? null,
      message: (s as any).logChannelOverrides?.message ?? null,
      role: (s as any).logChannelOverrides?.role ?? null,
      channel: (s as any).logChannelOverrides?.channel ?? null,
      reaction: (s as any).logChannelOverrides?.reaction ?? null,
      server: (s as any).logChannelOverrides?.server ?? null,
    },
    disabledLogEvents: s.disabledLogEvents ?? [],
    blacklistedChannels: s.blacklistedChannels ?? [],
    honeypotChannels: s.honeypotChannels ?? [],
    honeypotAlertRoleId: s.honeypotAlertRoleId ?? null,
    reactionRoles: s.reactionRoles ?? [],
    reactionRoleDMEnabled: s.reactionRoleDMEnabled ?? false,
    customCommands: s.customCommands ?? [],
    goodbyeMessage: {
      enabled: gm.enabled ?? false,
      channelId: gm.channelId ?? null,
      message: gm.message ?? null,
      embed: {
        enabled: gm.embed?.enabled ?? false,
        title: gm.embed?.title ?? null,
        description: gm.embed?.description ?? null,
        color: gm.embed?.color ?? null,
        footer: gm.embed?.footer ?? null,
      },
    },

    lockdownRoles: s.lockdownRoles ?? [],
    lockdownAllowedRoles: s.lockdownAllowedRoles ?? [],
    lockdownAllowedUsers: s.lockdownAllowedUsers ?? [],
    slowmodeAllowedRoles: s.slowmodeAllowedRoles ?? [],
    commandAllowedRoles: s.commandAllowedRoles ?? [],
    disabledCommands: (s as any).disabledCommands ?? [],
    ticketCategoryId: s.ticketCategoryId ?? null,
    ticketSupportRoleId: s.ticketSupportRoleId ?? null,
    ticketSupportRoleIds: s.ticketSupportRoleIds ?? [],
    ticketLogChannelId: s.ticketLogChannelId ?? null,
    ticketMaxOpen: s.ticketMaxOpen ?? 3,
    ticketOpenMessage: s.ticketOpenMessage ?? null,
    ticketSetupChannelId: s.ticketSetupChannelId ?? null,
    ticketSetupMessageId: s.ticketSetupMessageId ?? null,
    ticketEmoji: s.ticketEmoji ?? '🎫',

    welcomeMessage: {
      enabled: wm.enabled ?? false,
      type: wm.type ?? 'none',
      channelId: wm.channelId ?? null,
      message: wm.message ?? null,
      preset: wm.preset ?? null,
      imageEnabled: wm.imageEnabled ?? false,
      showRole: wm.showRole ?? false,
      trigger: wm.trigger ?? 'join',
      card: {
        preset: wm.card?.preset ?? null,
        bgColor1: wm.card?.bgColor1 ?? null,
        bgColor2: wm.card?.bgColor2 ?? null,
        bgColor3: wm.card?.bgColor3 ?? null,
        accentColor: wm.card?.accentColor ?? null,
        textColor: wm.card?.textColor ?? null,
        subtextColor: wm.card?.subtextColor ?? null,
        countColor: wm.card?.countColor ?? null,
        greetingText: wm.card?.greetingText ?? null,
        subtitle: wm.card?.subtitle ?? null,
        showMemberCount: wm.card?.showMemberCount ?? true,
        bgImageURL: wm.card?.bgImageURL ?? null,
      },
      embed: {
        enabled: wm.embed?.enabled ?? false,
        title: wm.embed?.title ?? null,
        description: wm.embed?.description ?? null,
        color: wm.embed?.color ?? null,
        footer: wm.embed?.footer ?? null,
        thumbnail: wm.embed?.thumbnail ?? false,
      },
      dm: {
        enabled: wm.dm?.enabled ?? false,
        message: wm.dm?.message ?? null,
        imageEnabled: wm.dm?.imageEnabled ?? false,
      },
    },

    automod: {
      level: am.level ?? 'off',
      antiSpam: am.antiSpam ?? false,
      antiLink: am.antiLink ?? false,
      antiReactionSpam: am.antiReactionSpam ?? false,
      ghostPing: am.ghostPing ?? false,
      maxMentions: am.maxMentions ?? 0,
      maxLines: am.maxLines ?? 0,
      allowedDomains: am.allowedDomains ?? [],
      exemptRoles: am.exemptRoles ?? [],
      exemptChannels: am.exemptChannels ?? [],
      spam: {
        maxMessages: am.spam?.maxMessages ?? 5,
        timeWindow: am.spam?.timeWindow ?? 5,
        timeoutDuration: am.spam?.timeoutDuration ?? 10,
        violationThreshold: am.spam?.violationThreshold ?? 3,
      },
      raid: {
        userThreshold: (am as any).raid?.userThreshold ?? 5,
        timeWindow: (am as any).raid?.timeWindow ?? 10,
      },
    },

    moderation: {
      muteRoleId: mod.muteRoleId ?? null,
      logChannelId: mod.logChannelId ?? null,
      autoMute: mod.autoMute ?? false,
      autoMuteThreshold: mod.autoMuteThreshold ?? 3,
      muteMethod: (mod.muteMethod as any) ?? 'auto',
    },

    keywordWarnings: {
      enabled: kw.enabled ?? false,
      action: kw.action ?? 'delete',
      keywords: kw.keywords ?? [],
    },

    verification: {
      enabled: (s as any).verification?.enabled ?? false,
      categoryId: (s as any).verification?.categoryId ?? null,
      verifiedRoleId: (s as any).verification?.verifiedRoleId ?? null,
      panelChannelId: (s as any).verification?.panelChannelId ?? null,
      panelMessageId: (s as any).verification?.panelMessageId ?? null,
      logChannelId: (s as any).verification?.logChannelId ?? null,
      maxAttempts: (s as any).verification?.maxAttempts ?? 2,
    },

    starboard: {
      enabled: (s as any).starboard?.enabled ?? false,
      channelId: (s as any).starboard?.channelId ?? null,
      threshold: (s as any).starboard?.threshold ?? 3,
      emoji: (s as any).starboard?.emoji ?? '⭐',
      selfStarEnabled: (s as any).starboard?.selfStarEnabled ?? false,
      ignoreBots: (s as any).starboard?.ignoreBots ?? true,
      ignoredChannels: (s as any).starboard?.ignoredChannels ?? [],
      ignoredRoles: (s as any).starboard?.ignoredRoles ?? [],
    },
  };
}

export interface DailyStat {
  date: string;
  count: number;
}

export interface TopCommand {
  command: string;
  count: number;
}

export interface TopGuild {
  guildId: string;
  name: string;
  count: number;
}

export interface StatsTotals {
  totalCommands: number;
  totalModActions: number;
}

export interface ModerationLogEntry {
  _id: string;
  guildId: string;
  userId: string;
  targetId: string;
  action: string;
  reason: string;
  duration: number | null;
  metadata: Record<string, unknown>;
  timestamp: string;
  caseNumber?: number;
}

export interface ModerationLogsResponse {
  logs: ModerationLogEntry[];
  total: number;
}
