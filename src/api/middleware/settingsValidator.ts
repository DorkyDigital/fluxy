const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_DEPTH = 5;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, unknown>;
}

const fieldValidators: Record<string, (value: unknown) => true | string> = {
  prefixes(v) {
    if (!Array.isArray(v)) return 'prefixes must be an array';
    if (v.length > 10) return 'Maximum 10 prefixes allowed';
    if (!v.every(p => typeof p === 'string' && p.length > 0 && p.length <= 10)) {
      return 'Each prefix must be a string between 1-10 characters';
    }
    return true;
  },

  prefix(v) {
    if (typeof v !== 'string') return 'prefix must be a string';
    if (v.length < 1 || v.length > 10) return 'prefix must be 1-10 characters';
    return true;
  },

  logChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'logChannelId must be a valid channel ID';
    return true;
  },

  serverLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'serverLogChannelId must be a valid channel ID';
    return true;
  },

  muteRoleId(v) {
    if (!isSnowflakeOrNull(v)) return 'muteRoleId must be a valid role ID';
    return true;
  },

  autoroleId(v) {
    if (!isSnowflakeOrNull(v)) return 'autoroleId must be a valid role ID';
    return true;
  },

  staffChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'staffChannelId must be a valid channel ID';
    return true;
  },

  staffRoleId(v) {
    if (!isSnowflakeOrNull(v)) return 'staffRoleId must be a valid role ID';
    return true;
  },

  staffInboxChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'staffInboxChannelId must be a valid channel ID';
    return true;
  },

  honeypotAlertRoleId(v) {
    if (!isSnowflakeOrNull(v)) return 'honeypotAlertRoleId must be a valid role ID';
    return true;
  },

  ticketCategoryId(v) {
    if (!isSnowflakeOrNull(v)) return 'ticketCategoryId must be a valid ID';
    return true;
  },

  ticketSupportRoleId(v) {
    if (!isSnowflakeOrNull(v)) return 'ticketSupportRoleId must be a valid role ID';
    return true;
  },

  ticketLogChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'ticketLogChannelId must be a valid channel ID';
    return true;
  },

  ticketSetupChannelId(v) {
    if (!isSnowflakeOrNull(v)) return 'ticketSetupChannelId must be a valid channel ID';
    return true;
  },

  ticketSetupMessageId(v) {
    if (!isSnowflakeOrNull(v)) return 'ticketSetupMessageId must be a valid message ID';
    return true;
  },

  ticketMaxOpen(v) {
    if (!isBoundedInt(v, 1, 50)) return 'ticketMaxOpen must be 1-50';
    return true;
  },

  ticketOpenMessage(v) {
    if (v !== null && !isBoundedString(v, 1000)) return 'ticketOpenMessage must be under 1000 characters';
    return true;
  },

  ticketEmoji(v) {
    if (!isBoundedString(v, 64)) return 'ticketEmoji must be under 64 characters';
    return true;
  },

  ticketSupportRoleIds(v) {
    if (!isSnowflakeArray(v, 25)) return 'ticketSupportRoleIds must be an array of up to 25 role IDs';
    return true;
  },

  blacklistedChannels(v) {
    if (!isSnowflakeArray(v, 50)) return 'blacklistedChannels must be an array of channel IDs';
    return true;
  },

  honeypotChannels(v) {
    if (!isSnowflakeArray(v, 20)) return 'honeypotChannels must be an array of channel IDs';
    return true;
  },

  lockdownRoles(v) {
    if (!isSnowflakeArray(v, 50)) return 'lockdownRoles must be an array of role IDs';
    return true;
  },

  lockdownAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return 'lockdownAllowedRoles must be an array of role IDs';
    return true;
  },

  lockdownAllowedUsers(v) {
    if (!isSnowflakeArray(v, 50)) return 'lockdownAllowedUsers must be an array of user IDs';
    return true;
  },

  slowmodeAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return 'slowmodeAllowedRoles must be an array of role IDs';
    return true;
  },

  commandAllowedRoles(v) {
    if (!isSnowflakeArray(v, 50)) return 'commandAllowedRoles must be an array of role IDs';
    return true;
  },

  disabledCommands(v) {
    if (!Array.isArray(v)) return 'disabledCommands must be an array';
    if (v.length > 100) return 'Maximum 100 disabled commands';
    if (!v.every(c => typeof c === 'string' && c.length <= 50)) {
      return 'Each command name must be under 50 characters';
    }
    return true;
  },

  globalBanEnabled(v) {
    if (typeof v !== 'boolean') return 'globalBanEnabled must be a boolean';
    return true;
  },

  globalBanAutoApply(v) {
    if (typeof v !== 'boolean') return 'globalBanAutoApply must be a boolean';
    return true;
  },

  automodEnabled(v) {
    if (typeof v !== 'boolean') return 'automodEnabled must be a boolean';
    return true;
  },

  raidDisableAutorole(v) {
    if (typeof v !== 'boolean') return 'raidDisableAutorole must be a boolean';
    return true;
  },

  reactionRoleDMEnabled(v) {
    if (typeof v !== 'boolean') return 'reactionRoleDMEnabled must be a boolean';
    return true;
  },

  onboardingComplete(v) {
    if (typeof v !== 'boolean') return 'onboardingComplete must be a boolean';
    return true;
  },

  onboardingStep(v) {
    if (!isBoundedInt(v, 0, 20)) return 'onboardingStep must be 0-20';
    return true;
  },

  starboard(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'starboard must be an object';
    const sb = v as Record<string, unknown>;
    if (sb.enabled !== undefined && typeof sb.enabled !== 'boolean') return 'starboard.enabled must be boolean';
    if (sb.channelId !== undefined && !isSnowflakeOrNull(sb.channelId)) return 'starboard.channelId must be a valid channel ID';
    if (sb.threshold !== undefined && !isBoundedInt(sb.threshold, 1, 100)) return 'starboard.threshold must be 1-100';
    if (sb.emoji !== undefined && !isBoundedString(sb.emoji, 64)) return 'starboard.emoji must be under 64 characters';
    if (sb.selfStarEnabled !== undefined && typeof sb.selfStarEnabled !== 'boolean') return 'starboard.selfStarEnabled must be boolean';
    if (sb.ignoreBots !== undefined && typeof sb.ignoreBots !== 'boolean') return 'starboard.ignoreBots must be boolean';
    if (sb.ignoredChannels !== undefined && !isSnowflakeArray(sb.ignoredChannels, 50)) return 'starboard.ignoredChannels must be channel IDs';
    if (sb.ignoredRoles !== undefined && !isSnowflakeArray(sb.ignoredRoles, 50)) return 'starboard.ignoredRoles must be role IDs';
    return true;
  },

  welcomeMessage(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'welcomeMessage must be an object';
    const wm = v as Record<string, unknown>;
    if (wm.enabled !== undefined && typeof wm.enabled !== 'boolean') return 'welcomeMessage.enabled must be boolean';
    if (wm.channelId !== undefined && !isSnowflakeOrNull(wm.channelId)) return 'welcomeMessage.channelId must be a channel ID';
    if (wm.message !== undefined && !isBoundedString(wm.message, 2000)) return 'welcomeMessage.message must be under 2000 characters';
    if (wm.embed !== undefined && typeof wm.embed !== 'object') return 'welcomeMessage.embed must be an object';
    if (wm.dmEnabled !== undefined && typeof wm.dmEnabled !== 'boolean') return 'welcomeMessage.dmEnabled must be boolean';
    if (wm.dmMessage !== undefined && !isBoundedString(wm.dmMessage, 2000)) return 'welcomeMessage.dmMessage must be under 2000 characters';
    return true;
  },

  goodbyeMessage(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'goodbyeMessage must be an object';
    const gm = v as Record<string, unknown>;
    if (gm.enabled !== undefined && typeof gm.enabled !== 'boolean') return 'goodbyeMessage.enabled must be boolean';
    if (gm.channelId !== undefined && !isSnowflakeOrNull(gm.channelId)) return 'goodbyeMessage.channelId must be a channel ID';
    if (gm.message !== undefined && !isBoundedString(gm.message, 2000)) return 'goodbyeMessage.message must be under 2000 characters';
    if (gm.embed !== undefined && typeof gm.embed !== 'object') return 'goodbyeMessage.embed must be an object';
    return true;
  },

  moderation(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'moderation must be an object';
    return true;  // deep-sanitized, Mongoose schema validates shape
  },

  automod(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'automod must be an object';
    return true;
  },

  antiLink(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'antiLink must be an object';
    return true;
  },

  antiSpam(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'antiSpam must be an object';
    return true;
  },

  antiGhostPing(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'antiGhostPing must be an object';
    return true;
  },

  verification(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'verification must be an object';
    return true;
  },

  reactionRoles(v) {
    if (!Array.isArray(v)) return 'reactionRoles must be an array';
    if (v.length > 50) return 'Maximum 50 reaction role panels';
    return true;
  },

  customCommands(v) {
    if (!Array.isArray(v)) return 'customCommands must be an array';
    if (v.length > 100) return 'Maximum 100 custom commands';
    for (const cmd of v) {
      if (typeof cmd !== 'object' || cmd === null) return 'Each custom command must be an object';
      const c = cmd as Record<string, unknown>;
      if (typeof c.name !== 'string' || c.name.length > 50) return 'Custom command name must be under 50 characters';
      if (c.response !== undefined && typeof c.response !== 'string') return 'Custom command response must be a string';
      if (typeof c.response === 'string' && c.response.length > 2000) return 'Custom command response must be under 2000 characters';
    }
    return true;
  },

  keywordWarnings(v) {
    if (!Array.isArray(v)) return 'keywordWarnings must be an array';
    if (v.length > 50) return 'Maximum 50 keyword warnings';
    return true;
  },

  logChannelOverrides(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'logChannelOverrides must be an object';
    const overrides = v as Record<string, unknown>;
    for (const [key, val] of Object.entries(overrides)) {
      if (key.length > 50) return 'logChannelOverrides key too long';
      if (!isSnowflakeOrNull(val)) return `logChannelOverrides.${key} must be a valid channel ID`;
    }
    return true;
  },

  disabledLogEvents(v) {
    if (!Array.isArray(v)) return 'disabledLogEvents must be an array';
    if (v.length > 50) return 'Maximum 50 disabled log events';
    if (!v.every(e => typeof e === 'string' && e.length <= 50)) return 'Each event name must be under 50 characters';
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
