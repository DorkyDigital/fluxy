import { Routes } from '@erinjs/types';
import { PermissionFlags } from '@erinjs/core';
import isNetworkError from '../../utils/isNetworkError';
import * as moderationQueue from '../../utils/moderationQueue';
import * as messageDeleteQueue from '../../utils/messageDeleteQueue';
import * as embedQueue from '../../utils/embedQueue';
import { t, normalizeLocale } from '../../i18n';

const spamTracker = new Map<string, { timestamps: number[]; messageIds: string[] }>();
const violationTracker = new Map<string, { violations: number[] }>();
const processingLocks = new Set<string>();
const recentlyDeleted = new Map<string, number>();

const defaultConfig = {
  maxMessages: 5,
  timeWindow: 5000,
  timeoutDuration: 600000,
  violationThreshold: 3,
  violationWindow: 1800000
};

function antiSpamT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.antiSpam.${key}`, vars);
}

function markDeleted(msgId: string): void {
  recentlyDeleted.set(msgId, Date.now() + 60000);
}

function isAlreadyDeleted(msgId: string): boolean {
  const expiry = recentlyDeleted.get(msgId);
  if (!expiry) return false;
  if (Date.now() > expiry) { recentlyDeleted.delete(msgId); return false; }
  return true;
}

function pruneDeletedCache(): void {
  if (recentlyDeleted.size < 2000) return;
  const now = Date.now();
  for (const [id, expiry] of recentlyDeleted) {
    if (now > expiry) recentlyDeleted.delete(id);
  }
}

function checkSpam(guildId: string, userId: string, messageId: string, maxMessages: number, windowMs: number) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();

  let data = spamTracker.get(key);
  if (!data) {
    data = { timestamps: [], messageIds: [] };
    spamTracker.set(key, data);
  }

  let write = 0;
  for (let i = 0; i < data.timestamps.length; i++) {
    if (now - data.timestamps[i] < windowMs) {
      data.timestamps[write] = data.timestamps[i];
      data.messageIds[write] = data.messageIds[i];
      write++;
    }
  }
  data.timestamps.length = write;
  data.messageIds.length = write;

  data.timestamps.push(now);
  data.messageIds.push(messageId);

  const isSpam = data.timestamps.length >= maxMessages;

  let collectedIds: string[] | null = null;
  if (isSpam) {
    collectedIds = data.messageIds.slice();
    data.timestamps.length = 0;
    data.messageIds.length = 0;
  }

  if (spamTracker.size > 1000) cleanupTrackers(windowMs);

  return { isSpam, messageIds: collectedIds, count: data.timestamps.length };
}

function trackViolation(guildId: string, userId: string, config: any) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();
  const window = config.violationWindow || defaultConfig.violationWindow;

  let data = violationTracker.get(key);
  if (!data) {
    data = { violations: [] };
    violationTracker.set(key, data);
  }

  data.violations = data.violations.filter(v => now - v < window);
  data.violations.push(now);

  return {
    count: data.violations.length,
    shouldTimeout: data.violations.length >= config.violationThreshold
  };
}

function clearViolations(guildId: string, userId: string): void {
  violationTracker.delete(`${guildId}-${userId}`);
}

function resetSpamTracker(guildId: string, userId: string): void {
  spamTracker.delete(`${guildId}-${userId}`);
}

function cleanupTrackers(windowMs: number): void {
  const now = Date.now();
  for (const [key, data] of spamTracker) {
    data.timestamps = data.timestamps.filter(t => now - t < windowMs);
    if (data.timestamps.length === 0) spamTracker.delete(key);
  }
  for (const [key, data] of violationTracker) {
    data.violations = data.violations.filter(v => now - v < defaultConfig.violationWindow);
    if (data.violations.length === 0) violationTracker.delete(key);
  }
}


async function deleteSpamMessages(message: any, client: any, messageIds: string[] | null): Promise<number> {
  if (!messageIds || messageIds.length === 0) return 0;

  const channelId = message.channelId || message.channel?.id;
  const guild = message.guild;
  if (!channelId || !guild) return 0;

  const toDelete = messageIds.filter(id => !isAlreadyDeleted(id));
  if (toDelete.length === 0) return 0;

  toDelete.forEach(markDeleted);

  if (toDelete.length >= 2) {
    try {
      const channel = guild.channels?.get(channelId);
      if (channel?.bulkDeleteMessages) {
        await channel.bulkDeleteMessages(toDelete);
        pruneDeletedCache();
        return toDelete.length;
      }
    } catch {
    }
  }

  let deleted = 0;
  const promises = toDelete.map(msgId =>
    client.rest.delete(Routes.channelMessage(channelId, msgId))
      .then(() => { deleted++; })
      .catch((e: any) => {
        if (isNetworkError(e)) {
          messageDeleteQueue.enqueue(channelId, msgId);
        } else if (e.status !== 404) {
          console.error(`[antiSpam] Delete ${msgId}: ${e.message}`);
        }
      })
  );
  await Promise.allSettled(promises);

  pruneDeletedCache();
  return deleted;
}


async function applyTimeout(guild: any, userId: string, duration: number, locale: unknown): Promise<boolean> {
  try {
    let member = guild.members?.get(userId);
    if (!member) member = await guild.fetchMember(userId);
    if (!member) return false;
    if (member.permissions?.has?.(PermissionFlags.Administrator)) return false;

    const until = new Date(Date.now() + duration).toISOString();
    const reason = antiSpamT(locale, 'timeoutReason');
    await member.edit({
      communication_disabled_until: until,
      timeout_reason: reason
    });
    return true;
  } catch (error: any) {
    if (isNetworkError(error)) {
      const guildId = guild.id;
      if (guildId) moderationQueue.enqueue(guildId, userId, 'timeout', { durationMs: duration, reason: antiSpamT(locale, 'timeoutReason') });
      return true;
    }
    if (error.statusCode === 404 || error.code === 'MEMBER_NOT_FOUND') return false;
    console.error('[antiSpam] Timeout error:', error.message || error);
    return false;
  }
}

function getEffectiveConfig(automodSettings: any, settings: any) {
  const spam = settings?.automod?.spam || {};
  return {
    maxMessages:        spam.maxMessages        ?? defaultConfig.maxMessages,
    timeWindow:        (spam.timeWindow         ?? (defaultConfig.timeWindow / 1000)) * 1000,
    timeoutDuration:   (spam.timeoutDuration    ?? (defaultConfig.timeoutDuration / 60000)) * 60000,
    violationThreshold: spam.violationThreshold ?? defaultConfig.violationThreshold,
    violationWindow:    defaultConfig.violationWindow
  };
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs !== 1 ? 's' : ''}`;
}

const antiSpam = {
  name: 'antiSpam',
  description: 'Detects and prevents spam by tracking message frequency',

  async check(message: any, client: any, settings: any, automodSettings: any): Promise<boolean> {
    const userId = message.author.id;
    const guildId = message.guildId || message.guild?.id;
    if (!guildId) return false;

    const config = getEffectiveConfig(automodSettings, settings);
    const result = checkSpam(guildId, userId, message.id, config.maxMessages, config.timeWindow);

    if (!result.isSpam) return false;

    const lockKey = `${guildId}-${userId}`;
    if (processingLocks.has(lockKey)) return true;
    processingLocks.add(lockKey);

    try {
      await this.execute(message, client, settings, automodSettings, result, config);
    } finally {
      processingLocks.delete(lockKey);
    }
    return true;
  },

  async execute(message: any, client: any, settings: any, automodSettings: any, spamResult: any, config?: any): Promise<void> {
    const userId = message.author.id;
    const guildId = message.guildId || message.guild?.id;
    const guild = message.guild;

    if (!config) config = getEffectiveConfig(automodSettings, settings);

    try {
      const deletedCount = await deleteSpamMessages(message, client, spamResult.messageIds);

      const violation = trackViolation(guildId, userId, config);

      let content: string;
      let timedOut = false;

      if (violation.shouldTimeout) {
        timedOut = await applyTimeout(guild, userId, config.timeoutDuration, settings?.language);
        if (timedOut) {
          clearViolations(guildId, userId);
          content = antiSpamT(settings?.language, 'noticeTimedOut', {
            userId,
            duration: formatDuration(config.timeoutDuration),
          });
        } else {
          content = antiSpamT(settings?.language, 'noticeViolation', {
            userId,
            count: violation.count,
            threshold: config.violationThreshold,
          });
        }
      } else if (violation.count >= config.violationThreshold - 1) {
        content = antiSpamT(settings?.language, 'noticeFinalWarning', {
          userId,
          duration: formatDuration(config.timeoutDuration),
        });
      } else {
        content = antiSpamT(settings?.language, 'noticeViolation', {
          userId,
          count: violation.count,
          threshold: config.violationThreshold,
        });
      }

      const sent = await message.channel.send({ content }).catch(() => null);
      if (sent) {
        const deleteAfter = timedOut ? 8000 : 4000;
        setTimeout(() => sent.delete().catch(() => {}), deleteAfter);
      }

      const logChannelId = settings.moderation?.logChannelId || settings.logChannelId;
      if (logChannelId) {
        this.logAction(message, client, guild, logChannelId, {
          deletedCount,
          violation,
          config,
          timedOut,
          language: settings?.language,
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[antiSpam] Execute error:', error);
    }
  },

  async logAction(message: any, client: any, guild: any, logChannelId: string, info: any): Promise<void> {
    try {
      if (!guild) guild = await client.guilds.fetch(message.guildId);
      if (!guild) return;

      let logChannel = guild.channels?.get(logChannelId);
      if (!logChannel) {
        try { logChannel = await client.channels.fetch(logChannelId); } catch { return; }
      }
      if (!logChannel) return;

      const fields: any[] = [
        { name: antiSpamT(info.language, 'fieldUser'), value: `<@${message.author.id}> (${message.author.id})`, inline: true },
        { name: antiSpamT(info.language, 'fieldChannel'), value: `<#${message.channelId || message.channel?.id}>`, inline: true },
        { name: antiSpamT(info.language, 'fieldMessagesDeleted'), value: `${info.deletedCount}`, inline: true },
        { name: antiSpamT(info.language, 'fieldViolations'), value: `${info.violation.count}/${info.config.violationThreshold}`, inline: true }
      ];

      if (info.timedOut) {
        fields.push({
          name: antiSpamT(info.language, 'fieldAction'),
          value: antiSpamT(info.language, 'actionTimedOutFor', { duration: formatDuration(info.config.timeoutDuration) }),
          inline: true
        });
      }

      const embed = {
        title: info.timedOut ? antiSpamT(info.language, 'logTitleTimedOut') : antiSpamT(info.language, 'logTitleDetected'),
        description: info.timedOut
          ? antiSpamT(info.language, 'logDescriptionTimedOut')
          : antiSpamT(info.language, 'logDescriptionDetected'),
        fields,
        color: info.timedOut ? 0xf1c40f : 0xe74c3c,
        timestamp: new Date().toISOString()
      };
      try {
        await logChannel.send({ embeds: [embed] });
      } catch (sendErr: any) {
        if (isNetworkError(sendErr)) {
          embedQueue.enqueue(guild.id, logChannelId, embed);
        }
      }
    } catch (error) {
      console.error('[antiSpam] Log error:', error);
    }
  },

  checkSpam,
  resetSpamTracker,
  trackViolation,
  clearViolations,
  defaultConfig
};

export default antiSpam;
