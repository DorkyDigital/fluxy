import {
  RSS_DEFAULT_POLL_INTERVAL_MINUTES,
  RSS_MAX_FEEDS_PER_GUILD,
  RSS_MAX_ITEMS_PER_POLL,
  RSS_MIN_POLL_INTERVAL_MINUTES,
} from '../../utils/rssDefaults';
import { t } from '../../i18n';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_DEPTH = 5;
const CUSTOM_COMMAND_MAX_PER_GUILD = 5;
const CUSTOM_COMMAND_NAME_RE = /^[a-z0-9_-]{1,32}$/;
const CUSTOM_COMMAND_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;
const CUSTOM_COMMAND_PERMISSION_VALUES = new Set([
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
]);
const CUSTOM_COMMAND_ACTION_VALUES = new Set(['reply', 'toggleRole']);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function validatorT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.middleware.settingsValidator.${key}`, vars);
}

const validation = {
  mustBeObject: (field: string) => validatorT('mustBeObject', { field }),
  mustBeBoolean: (field: string) => validatorT('mustBeBoolean', { field }),
  mustBeArray: (field: string) => validatorT('mustBeArray', { field }),
  mustBeString: (field: string) => validatorT('mustBeString', { field }),
  mustBeValidLocaleCode: (field: string) => validatorT('mustBeValidLocaleCode', { field }),
  mustBeValidChannelId: (field: string) => validatorT('mustBeValidChannelId', { field }),
  mustBeValidRoleId: (field: string) => validatorT('mustBeValidRoleId', { field }),
  mustBeValidWebhookId: (field: string) => validatorT('mustBeValidWebhookId', { field }),
  mustBeValidMessageId: (field: string) => validatorT('mustBeValidMessageId', { field }),
  mustBeValidId: (field: string) => validatorT('mustBeValidId', { field }),
  maxAllowed: (label: string, max: number) => validatorT('maxAllowed', { label, max }),
  eachStringLengthRange: (label: string, min: number, max: number) => validatorT('eachStringLengthRange', { label, min, max }),
  mustBeRange: (field: string, min: number, max: number) => validatorT('mustBeRange', { field, min, max }),
  mustBeUnderCharacters: (field: string, max: number) => validatorT('mustBeUnderCharacters', { field, max }),
  mustBeArrayOfUpTo: (field: string, max: number, itemType: string) => validatorT('mustBeArrayOfUpTo', { field, max, itemType }),
  mustBeOneOf: (field: string, options: string) => validatorT('mustBeOneOf', { field, options }),
  mustBeHttpUrl: (field: string) => validatorT('mustBeHttpUrl', { field }),
  mustStartWithSlash: (field: string, context: string) => validatorT('mustStartWithSlash', { field, context }),
  eachItemMustBeObject: (label: string) => validatorT('eachItemMustBeObject', { label }),
  eachItemUnderCharacters: (label: string, max: number) => validatorT('eachItemUnderCharacters', { label, max }),
  mustBeNonEmptyString: (field: string) => validatorT('mustBeNonEmptyString', { field }),
  mustBeNonEmptyStringUnder: (field: string, max: number) => validatorT('mustBeNonEmptyStringUnder', { field, max }),
  mustBeValidHexColor: (field: string) => validatorT('mustBeValidHexColor', { field }),
  mustBeUnique: (field: string) => validatorT('mustBeUnique', { field }),
  isInvalid: (field: string) => validatorT('isInvalid', { field }),
  isRequiredForAction: (field: string, action: string) => validatorT('isRequiredForAction', { field, action }),
  canContainAtMost: (field: string, max: number, itemType: string) => validatorT('canContainAtMost', { field, max, itemType }),
  keyTooLong: (field: string) => validatorT('keyTooLong', { field }),
  customCommandNameInvalid: () => validatorT('customCommandNameInvalid'),
};

function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_OBJECT_DEPTH) return undefined;

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) return value.slice(0, MAX_STRING_LENGTH);
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      value = value.slice(0, MAX_ARRAY_LENGTH);
    }
    return (value as unknown[]).map((item: unknown) => deepSanitize(item, depth + 1)).filter((v: unknown) => v !== undefined);
  }

  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key.startsWith('$')) continue;

      const sanitized = deepSanitize((value as Record<string, unknown>)[key], depth + 1);
      if (sanitized !== undefined) {
        clean[key] = sanitized;
      }
    }
    return clean;
  }

  return undefined;
}

function isSnowflake(v: unknown): v is string {
  return typeof v === 'string' && SNOWFLAKE_RE.test(v);
}

function isSnowflakeOrNull(v: unknown): boolean {
  return v === null || v === '' || isSnowflake(v);
}

function isSnowflakeArray(v: unknown, maxLen = 50): boolean {
  if (!Array.isArray(v)) return false;
  if (v.length > maxLen) return false;
  return v.every(isSnowflake);
}

function isBoundedString(v: unknown, maxLen = 200): v is string {
  return typeof v === 'string' && v.length <= maxLen;
}

function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim().length === 0) return false;
  try {
    const parsed = new URL(v.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateStarboardEntry(value: unknown): true | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return validation.mustBeObject('starboard');
  const sb = value as Record<string, unknown>;
  if (sb.enabled !== undefined && typeof sb.enabled !== 'boolean') return validation.mustBeBoolean('starboard.enabled');
  if (sb.channelId !== undefined && !isSnowflakeOrNull(sb.channelId)) return validation.mustBeValidChannelId('starboard.channelId');
  if (sb.threshold !== undefined && !isBoundedInt(sb.threshold, 1, 100)) return validation.mustBeRange('starboard.threshold', 1, 100);
  if (sb.emoji !== undefined && !isBoundedString(sb.emoji, 64)) return validation.mustBeUnderCharacters('starboard.emoji', 64);
  if (sb.selfStarEnabled !== undefined && typeof sb.selfStarEnabled !== 'boolean') return validation.mustBeBoolean('starboard.selfStarEnabled');
  if (sb.ignoreBots !== undefined && typeof sb.ignoreBots !== 'boolean') return validation.mustBeBoolean('starboard.ignoreBots');
  if (sb.ignoredChannels !== undefined && !isSnowflakeArray(sb.ignoredChannels, 50)) return validation.mustBeArrayOfUpTo('starboard.ignoredChannels', 50, 'channel IDs');
  if (sb.ignoredRoles !== undefined && !isSnowflakeArray(sb.ignoredRoles, 50)) return validation.mustBeArrayOfUpTo('starboard.ignoredRoles', 50, 'role IDs');
  return true;
}

function validateRssFeedEntry(value: unknown): true | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return validation.eachItemMustBeObject('rss.feeds entries');
  }

  const feed = value as Record<string, unknown>;

  if (feed.id !== undefined && !isBoundedString(feed.id, 128)) {
    return validation.mustBeUnderCharacters('rss.feeds[].id', 128);
  }

  if (feed.name !== undefined && feed.name !== null && !isBoundedString(feed.name, 120)) {
    return validation.mustBeUnderCharacters('rss.feeds[].name', 120);
  }

  if (feed.sourceType !== undefined && feed.sourceType !== 'rss' && feed.sourceType !== 'rsshub') {
    return validation.mustBeOneOf('rss.feeds[].sourceType', 'rss or rsshub');
  }

  const sourceType = (feed.sourceType === 'rsshub' ? 'rsshub' : 'rss') as 'rss' | 'rsshub';
  if (sourceType === 'rss') {
    if (!isHttpUrl(feed.url)) {
      return validation.mustBeHttpUrl('rss.feeds[].url');
    }
  } else {
    if (!isBoundedString(feed.route, 500) || !(feed.route as string).startsWith('/')) {
      return validation.mustStartWithSlash('rss.feeds[].route', 'rsshub sources');
    }
  }

  if (!isSnowflake(feed.channelId)) {
    return validation.mustBeValidChannelId('rss.feeds[].channelId');
  }

  if (feed.mentionRoleId !== undefined && !isSnowflakeOrNull(feed.mentionRoleId)) {
    return validation.mustBeValidRoleId('rss.feeds[].mentionRoleId');
  }

  if (feed.webhookId !== undefined && !isSnowflakeOrNull(feed.webhookId)) {
    return validation.mustBeValidWebhookId('rss.feeds[].webhookId');
  }

  if (feed.webhookToken !== undefined && feed.webhookToken !== null && !isBoundedString(feed.webhookToken, 300)) {
    return validation.mustBeUnderCharacters('rss.feeds[].webhookToken', 300);
  }

  if (feed.webhookName !== undefined && feed.webhookName !== null && !isBoundedString(feed.webhookName, 80)) {
    return validation.mustBeUnderCharacters('rss.feeds[].webhookName', 80);
  }

  if (feed.enabled !== undefined && typeof feed.enabled !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].enabled');
  }

  if (feed.maxItemsPerPoll !== undefined && !isBoundedInt(feed.maxItemsPerPoll, 1, RSS_MAX_ITEMS_PER_POLL)) {
    return validation.mustBeRange('rss.feeds[].maxItemsPerPoll', 1, RSS_MAX_ITEMS_PER_POLL);
  }

  if (feed.includeSummary !== undefined && typeof feed.includeSummary !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].includeSummary');
  }

  if (feed.includeImage !== undefined && typeof feed.includeImage !== 'boolean') {
    return validation.mustBeBoolean('rss.feeds[].includeImage');
  }

  if (feed.format !== undefined && feed.format !== 'embed' && feed.format !== 'text') {
    return validation.mustBeOneOf('rss.feeds[].format', 'embed or text');
  }

  return true;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, unknown>;
}

const fieldValidators: Record<string, (value: unknown) => true | string> = {
  language(v) {
    if (typeof v !== 'string') return validation.mustBeString('language');
    const code = v.trim();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code) || code.length > 20) return validation.mustBeValidLocaleCode('language');
    return true;
  },

  prefixes(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('prefixes');
    if (v.length > 10) return validation.maxAllowed('prefixes', 10);
    if (!v.every(p => typeof p === 'string' && p.length > 0 && p.length <= 10)) {
      return validation.eachStringLengthRange('prefix', 1, 10);
    }
    return true;
  },

  prefix(v) {
    if (typeof v !== 'string') return validation.mustBeString('prefix');
    if (v.length < 1 || v.length > 10) return validation.mustBeRange('prefix length', 1, 10);
    return true;
  },

  logChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('logChannelId');
    return true;
  },

  serverLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('serverLogChannelId');
    return true;
  },

  muteRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('muteRoleId');
    return true;
  },

  autoroleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('autoroleId');
    return true;
  },

  staffChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('staffChannelId');
    return true;
  },

  staffRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('staffRoleId');
    return true;
  },

  staffInboxChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('staffInboxChannelId');
    return true;
  },

  honeypotAlertRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('honeypotAlertRoleId');
    return true;
  },

  ticketCategoryId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidId('ticketCategoryId');
    return true;
  },

  ticketSupportRoleId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidRoleId('ticketSupportRoleId');
    return true;
  },

  ticketLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('ticketLogChannelId');
    return true;
  },

  ticketSetupChannelId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidChannelId('ticketSetupChannelId');
    return true;
  },

  ticketSetupMessageId(v) {
    if (!isSnowflakeOrNull(v)) return validation.mustBeValidMessageId('ticketSetupMessageId');
    return true;
  },

  ticketMaxOpen(v) {
    if (!isBoundedInt(v, 1, 50)) return validation.mustBeRange('ticketMaxOpen', 1, 50);
    return true;
  },

  ticketOpenMessage(v) {
    if (v !== null && !isBoundedString(v, 1000)) return validation.mustBeUnderCharacters('ticketOpenMessage', 1000);
    return true;
  },

  ticketEmoji(v) {
    if (!isBoundedString(v, 64)) return validation.mustBeUnderCharacters('ticketEmoji', 64);
    return true;
  },

  ticketSupportRoleIds(v) {
    if (!isSnowflakeArray(v, 25)) return validation.mustBeArrayOfUpTo('ticketSupportRoleIds', 25, 'role IDs');
    return true;
  },

  blacklistedChannels(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('blacklistedChannels', 50, 'channel IDs');
    return true;
  },

  honeypotChannels(v) {
    if (!isSnowflakeArray(v, 20)) return validation.mustBeArrayOfUpTo('honeypotChannels', 20, 'channel IDs');
    return true;
  },

  lockdownRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownRoles', 50, 'role IDs');
    return true;
  },

  lockdownAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownAllowedRoles', 50, 'role IDs');
    return true;
  },

  lockdownAllowedUsers(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('lockdownAllowedUsers', 50, 'user IDs');
    return true;
  },

  slowmodeAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('slowmodeAllowedRoles', 50, 'role IDs');
    return true;
  },

  commandAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return validation.mustBeArrayOfUpTo('commandAllowedRoles', 50, 'role IDs');
    return true;
  },

  disabledCommands(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('disabledCommands');
    if (v.length > 100) return validation.maxAllowed('disabled commands', 100);
    if (!v.every(c => typeof c === 'string' && c.length <= 50)) {
      return validation.eachItemUnderCharacters('command name', 50);
    }
    return true;
  },

  globalBanEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('globalBanEnabled');
    return true;
  },

  globalBanAutoApply(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('globalBanAutoApply');
    return true;
  },

  automodEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('automodEnabled');
    return true;
  },

  raidDisableAutorole(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('raidDisableAutorole');
    return true;
  },

  reactionRoleDMEnabled(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('reactionRoleDMEnabled');
    return true;
  },

  onboardingComplete(v) {
    if (typeof v !== 'boolean') return validation.mustBeBoolean('onboardingComplete');
    return true;
  },

  onboardingStep(v) {
    if (!isBoundedInt(v, 0, 20)) return validation.mustBeRange('onboardingStep', 0, 20);
    return true;
  },

  starboard(v) {
    return validateStarboardEntry(v);
  },

  starboards(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('starboards');
    if (v.length > 3) return validation.maxAllowed('starboards', 3);
    for (const entry of v) {
      const res = validateStarboardEntry(entry);
      if (res !== true) return res;
    }
    return true;
  },

  welcomeMessage(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('welcomeMessage');
    const wm = v as Record<string, unknown>;
    if (wm.enabled !== undefined && typeof wm.enabled !== 'boolean') return validation.mustBeBoolean('welcomeMessage.enabled');
    if (wm.channelId !== undefined && !isSnowflakeOrNull(wm.channelId)) return validation.mustBeValidChannelId('welcomeMessage.channelId');
    if (wm.message !== undefined && !isBoundedString(wm.message, 2000)) return validation.mustBeUnderCharacters('welcomeMessage.message', 2000);
    if (wm.embed !== undefined && typeof wm.embed !== 'object') return validation.mustBeObject('welcomeMessage.embed');
    if (wm.dmEnabled !== undefined && typeof wm.dmEnabled !== 'boolean') return validation.mustBeBoolean('welcomeMessage.dmEnabled');
    if (wm.dmMessage !== undefined && !isBoundedString(wm.dmMessage, 2000)) return validation.mustBeUnderCharacters('welcomeMessage.dmMessage', 2000);
    return true;
  },

  goodbyeMessage(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('goodbyeMessage');
    const gm = v as Record<string, unknown>;
    if (gm.enabled !== undefined && typeof gm.enabled !== 'boolean') return validation.mustBeBoolean('goodbyeMessage.enabled');
    if (gm.channelId !== undefined && !isSnowflakeOrNull(gm.channelId)) return validation.mustBeValidChannelId('goodbyeMessage.channelId');
    if (gm.message !== undefined && !isBoundedString(gm.message, 2000)) return validation.mustBeUnderCharacters('goodbyeMessage.message', 2000);
    if (gm.embed !== undefined && typeof gm.embed !== 'object') return validation.mustBeObject('goodbyeMessage.embed');
    return true;
  },

  moderation(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('moderation');
    return true;  // deep-sanitized, Mongoose schema validates shape
  },

  automod(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('automod');
    return true;
  },

  antiLink(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('antiLink');
    return true;
  },

  antiSpam(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('antiSpam');
    return true;
  },

  antiGhostPing(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('antiGhostPing');
    return true;
  },

  verification(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('verification');
    return true;
  },

  rss(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('rss');
    const rss = v as Record<string, unknown>;

    if (rss.enabled !== undefined && typeof rss.enabled !== 'boolean') {
      return validation.mustBeBoolean('rss.enabled');
    }

    if (
      rss.pollIntervalMinutes !== undefined &&
      !isBoundedInt(rss.pollIntervalMinutes, RSS_MIN_POLL_INTERVAL_MINUTES, 1440)
    ) {
      return validation.mustBeRange('rss.pollIntervalMinutes', RSS_MIN_POLL_INTERVAL_MINUTES, 1440);
    }

    if (rss.feeds !== undefined) {
      if (!Array.isArray(rss.feeds)) return validation.mustBeArray('rss.feeds');
      if (rss.feeds.length > RSS_MAX_FEEDS_PER_GUILD) {
        return validation.canContainAtMost('rss.feeds', RSS_MAX_FEEDS_PER_GUILD, 'feeds');
      }

      for (const entry of rss.feeds) {
        const feedRes = validateRssFeedEntry(entry);
        if (feedRes !== true) return feedRes;
      }
    }

    if (rss.pollIntervalMinutes === undefined && rss.feeds !== undefined && rss.enabled === true) {
      if (!isBoundedInt(RSS_DEFAULT_POLL_INTERVAL_MINUTES, RSS_MIN_POLL_INTERVAL_MINUTES, 1440)) {
        return validation.isInvalid('rss.pollIntervalMinutes default');
      }
    }

    return true;
  },

  reactionRoles(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('reactionRoles');
    if (v.length > 50) return validation.maxAllowed('reaction role panels', 50);
    return true;
  },

  customCommands(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('customCommands');
    if (v.length > CUSTOM_COMMAND_MAX_PER_GUILD) {
      return validation.maxAllowed('custom commands', CUSTOM_COMMAND_MAX_PER_GUILD);
    }

    const names = new Set<string>();

    for (const cmd of v) {
      if (typeof cmd !== 'object' || cmd === null) return validation.eachItemMustBeObject('custom command');
      const c = cmd as Record<string, unknown>;

      if (typeof c.name !== 'string' || !CUSTOM_COMMAND_NAME_RE.test(c.name.trim().toLowerCase())) {
        return validation.customCommandNameInvalid();
      }

      const normalizedName = c.name.trim().toLowerCase();
      if (names.has(normalizedName)) {
        return validation.mustBeUnique('customCommands[].name');
      }
      names.add(normalizedName);

      if (typeof c.response !== 'string' || c.response.trim().length === 0) {
        return validation.mustBeNonEmptyString('customCommands[].response');
      }

      if (c.response.length > 2000) return validation.mustBeUnderCharacters('customCommands[].response', 2000);

      if (c.embed !== undefined && typeof c.embed !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].embed');
      }

      if (c.color !== undefined && c.color !== null) {
        if (typeof c.color !== 'string' || !CUSTOM_COMMAND_COLOR_RE.test(c.color)) {
          return validation.mustBeValidHexColor('customCommands[].color');
        }
      }

      if (c.title !== undefined && c.title !== null && !isBoundedString(c.title, 256)) {
        return validation.mustBeUnderCharacters('customCommands[].title', 256);
      }

      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].enabled');
      }

      const actionType = typeof c.actionType === 'string' ? c.actionType : 'reply';
      if (c.actionType !== undefined && !CUSTOM_COMMAND_ACTION_VALUES.has(actionType)) {
        return validation.mustBeOneOf('customCommands[].actionType', 'reply or toggleRole');
      }

      if (c.targetRoleId !== undefined && !isSnowflakeOrNull(c.targetRoleId)) {
        return validation.mustBeValidRoleId('customCommands[].targetRoleId');
      }

      if (actionType === 'toggleRole' && !isSnowflake(c.targetRoleId)) {
        return validation.isRequiredForAction('customCommands[].targetRoleId', 'toggleRole');
      }

      if (c.requiredRoleIds !== undefined && !isSnowflakeArray(c.requiredRoleIds, 10)) {
        return validation.mustBeArrayOfUpTo('customCommands[].requiredRoleIds', 10, 'role IDs');
      }

      if (c.allowedChannelIds !== undefined && !isSnowflakeArray(c.allowedChannelIds, 25)) {
        return validation.mustBeArrayOfUpTo('customCommands[].allowedChannelIds', 25, 'channel IDs');
      }

      if (c.requiredPermission !== undefined && c.requiredPermission !== null) {
        if (typeof c.requiredPermission !== 'string' || !CUSTOM_COMMAND_PERMISSION_VALUES.has(c.requiredPermission)) {
          return validation.isInvalid('customCommands[].requiredPermission');
        }
      }

      if (c.cooldownSeconds !== undefined && !isBoundedInt(c.cooldownSeconds, 0, 3600)) {
        return validation.mustBeRange('customCommands[].cooldownSeconds', 0, 3600);
      }

      if (c.deleteTrigger !== undefined && typeof c.deleteTrigger !== 'boolean') {
        return validation.mustBeBoolean('customCommands[].deleteTrigger');
      }
    }
    return true;
  },

  keywordWarnings(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return validation.mustBeObject('keywordWarnings');
    }

    const kw = v as Record<string, unknown>;

    if (kw.enabled !== undefined && typeof kw.enabled !== 'boolean') {
      return validation.mustBeBoolean('keywordWarnings.enabled');
    }

    if (
      kw.action !== undefined &&
      kw.action !== 'delete' &&
      kw.action !== 'warn' &&
      kw.action !== 'delete+warn'
    ) {
      return validation.mustBeOneOf('keywordWarnings.action', 'delete, warn, or delete+warn');
    }

    if (kw.keywords !== undefined) {
      if (!Array.isArray(kw.keywords)) return validation.mustBeArray('keywordWarnings.keywords');
      if (kw.keywords.length > 50) return validation.maxAllowed('keyword warnings', 50);

      for (const entry of kw.keywords) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          return validation.eachItemMustBeObject('keyword warning');
        }

        const keyword = entry as Record<string, unknown>;

        if (!isBoundedString(keyword.pattern, 200) || (keyword.pattern as string).trim().length === 0) {
          return validation.mustBeNonEmptyStringUnder('keywordWarnings.keywords[].pattern', 200);
        }

        if (keyword.isRegex !== undefined && typeof keyword.isRegex !== 'boolean') {
          return validation.mustBeBoolean('keywordWarnings.keywords[].isRegex');
        }

        if (keyword.label !== undefined && keyword.label !== null && !isBoundedString(keyword.label, 100)) {
          return validation.mustBeUnderCharacters('keywordWarnings.keywords[].label', 100);
        }

        if (keyword.addedBy !== undefined && keyword.addedBy !== null && !isBoundedString(keyword.addedBy, 64)) {
          return validation.mustBeUnderCharacters('keywordWarnings.keywords[].addedBy', 64);
        }
      }
    }

    return true;
  },

  logChannelOverrides(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return validation.mustBeObject('logChannelOverrides');
    const overrides = v as Record<string, unknown>;
    for (const [key, val] of Object.entries(overrides)) {
      if (key.length > 50) return validation.keyTooLong('logChannelOverrides');
      if (!isSnowflakeOrNull(val)) return validation.mustBeValidChannelId(`logChannelOverrides.${key}`);
    }
    return true;
  },

  disabledLogEvents(v) {
    if (!Array.isArray(v)) return validation.mustBeArray('disabledLogEvents');
    if (v.length > 50) return validation.maxAllowed('disabled log events', 50);
    if (!v.every(e => typeof e === 'string' && e.length <= 50)) return validation.eachItemUnderCharacters('event name', 50);
    return true;
  },
};

export function validateSettingsUpdate(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(raw)) {
    const value = deepSanitize(rawValue);

    const validator = fieldValidators[key];
    if (validator) {
      const result = validator(value);
      if (result !== true) {
        errors.push(result);
        continue;
      }
    }

    sanitized[key] = value;
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}
