import isNetworkError from '../../utils/isNetworkError';
import * as embedQueue from '../../utils/embedQueue';
import { Routes } from '@erinjs/types';
import { t, normalizeLocale } from '../../i18n';


export const DEFAULT_USER_THRESHOLD = 5;
export const DEFAULT_TIME_WINDOW = 10_000; // is ms
const MIN_CONTENT_LENGTH = 5;

function antiRaidT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.antiRaid.${key}`, vars);
}


export interface RaidEntry {
  userId: string;
  messageId: string;
  channelId: string;
  timestamp: number;
}

const raidTracker = new Map<string, Map<string, RaidEntry[]>>();

const activeRaids = new Map<string, Map<string, number>>();


export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\[[\w\d]{1,30}\]/g, '')
    .replace(/\([\w\d]{1,30}\)/g, '')
    .replace(/[^\w\s@#<>!?.,;:'"()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEffectiveConfig(settings: any) {
  const raid = settings?.automod?.raid || {};
  return {
    userThreshold: raid.userThreshold ?? DEFAULT_USER_THRESHOLD,
    timeWindow: (raid.timeWindow ?? (DEFAULT_TIME_WINDOW / 1000)) * 1000,
  };
}

export function trackRaidMessage(
  guildId: string,
  normalized: string,
  entry: RaidEntry,
  windowMs: number,
  threshold: number
): { isRaid: boolean; allEntries: RaidEntry[]; newRaid: boolean } {
  let guildMap = raidTracker.get(guildId);
  if (!guildMap) { guildMap = new Map(); raidTracker.set(guildId, guildMap); }

  const now = Date.now();
  const entries = (guildMap.get(normalized) ?? []).filter(e => now - e.timestamp < windowMs);
  entries.push(entry);
  guildMap.set(normalized, entries);

  const uniqueUsers = new Set(entries.map(e => e.userId));
  const isRaid = uniqueUsers.size >= threshold;

  let newRaid = false;
  if (isRaid) {
    let raidMap = activeRaids.get(guildId);
    if (!raidMap) { raidMap = new Map(); activeRaids.set(guildId, raidMap); }
    if (!raidMap.has(normalized)) newRaid = true;
    raidMap.set(normalized, now + windowMs * 2);
  }

  return { isRaid, allEntries: entries, newRaid };
}

export function isActiveRaid(guildId: string, normalized: string): boolean {
  const raidMap = activeRaids.get(guildId);
  if (!raidMap) return false;
  const expiry = raidMap.get(normalized);
  if (!expiry) return false;
  if (Date.now() > expiry) { raidMap.delete(normalized); return false; }
  return true;
}

export function clearRaidState(guildId: string): void {
  raidTracker.delete(guildId);
  activeRaids.delete(guildId);
}

async function deleteRaidMessages(client: any, guild: any, entries: RaidEntry[]): Promise<number> {
  const byChannel = new Map<string, string[]>();
  for (const e of entries) {
    const ids = byChannel.get(e.channelId) ?? [];
    ids.push(e.messageId);
    byChannel.set(e.channelId, ids);
  }

  let deleted = 0;
  const tasks: Promise<void>[] = [];

  for (const [channelId, messageIds] of byChannel) {
    const channel = guild?.channels?.get(channelId);

    if (channel?.bulkDeleteMessages && messageIds.length >= 2) {
      tasks.push(
        channel.bulkDeleteMessages(messageIds)
          .then(() => { deleted += messageIds.length; })
          .catch(() => {
            // Fall back to individual REST deletes
            for (const msgId of messageIds) {
              tasks.push(
                client.rest.delete(Routes.channelMessage(channelId, msgId))
                  .then(() => { deleted++; })
                  .catch(() => { })
              );
            }
          })
      );
    } else {
      for (const msgId of messageIds) {
        tasks.push(
          client.rest.delete(Routes.channelMessage(channelId, msgId))
            .then(() => { deleted++; })
            .catch(() => { })
        );
      }
    }
  }

  await Promise.allSettled(tasks);
  return deleted;
}


async function logRaidDetection(
  client: any,
  guild: any,
  logChannelId: string,
  locale: unknown,
  entries: RaidEntry[],
  normalized: string,
  deletedCount: number
): Promise<void> {
  try {
    let logChannel = guild?.channels?.get(logChannelId);
    if (!logChannel) {
      try { logChannel = await client.channels.fetch(logChannelId); } catch { return; }
    }
    if (!logChannel) return;

    const uniqueUsers = [...new Set(entries.map(e => e.userId))];
    const uniqueChannels = [...new Set(entries.map(e => e.channelId))];

    const embed = {
      title: antiRaidT(locale, 'logTitle'),
      description: antiRaidT(locale, 'logDescription', { userCount: uniqueUsers.length }),
      fields: [
        {
          name: antiRaidT(locale, 'fieldNormalizedContent'),
          value: `\`\`\`${normalized.slice(0, 200) || antiRaidT(locale, 'emptyAfterNormalization')}\`\`\``,
          inline: false
        },
        {
          name: antiRaidT(locale, 'fieldUsersInvolved', { userCount: uniqueUsers.length }),
          value: uniqueUsers.slice(0, 20).map(id => `<@${id}>`).join(', ') + (uniqueUsers.length > 20 ? antiRaidT(locale, 'usersMoreSuffix', { moreCount: uniqueUsers.length - 20 }) : ''),
          inline: false
        },
        { name: antiRaidT(locale, 'fieldMessagesDeleted'), value: `${deletedCount}`, inline: true },
        { name: antiRaidT(locale, 'fieldChannelsAffected'), value: uniqueChannels.map(id => `<#${id}>`).join(', ').slice(0, 200), inline: false },
      ],
      color: 0xff4444,
      timestamp: new Date().toISOString(),
    };

    try {
      await logChannel.send({ embeds: [embed] });
    } catch (err: any) {
      if (isNetworkError(err)) embedQueue.enqueue(guild.id, logChannelId, embed);
    }
  } catch (err) {
    console.error('[antiRaid] Log error:', err);
  }
}

const antiRaid = {
  name: 'antiRaid',
  description: 'Detects coordinated spam/raids by tracking similar messages across multiple users',

  async check(message: any, client: any, settings: any): Promise<boolean> {
    const content = message.content;
    if (!content || typeof content !== 'string') return false;

    const normalized = normalizeContent(content);
    if (normalized.length < MIN_CONTENT_LENGTH) return false;

    const guildId = message.guildId || message.guild?.id;
    if (!guildId) return false;

    const config = getEffectiveConfig(settings);

    const entry: RaidEntry = {
      userId: message.author.id,
      messageId: message.id,
      channelId: message.channelId || message.channel?.id,
      timestamp: Date.now(),
    };

    const { isRaid, allEntries, newRaid } = trackRaidMessage(
      guildId, normalized, entry, config.timeWindow, config.userThreshold
    );

    const alreadyActive = !isRaid && isActiveRaid(guildId, normalized);

    if (!isRaid && !alreadyActive) return false;

    const guild = message.guild || client.guilds?.get(guildId);

    const toDelete = isRaid ? allEntries : [entry];
    const deleted = await deleteRaidMessages(client, guild, toDelete);

    if (newRaid) {
      console.log(
        `[antiRaid] Raid detected in guild ${guildId}: ` +
        `"${normalized.slice(0, 80)}" ` +
        `from ${allEntries.length} msg(s) by ${new Set(allEntries.map(e => e.userId)).size} users`
      );

      const channelId = entry.channelId;
      const channel = guild?.channels?.get(channelId);
      if (channel) {
        channel.send({ content: t(normalizeLocale(settings?.language), 'auditCatalog.automod.modules.antiRaid.l224_send_content') })
          .then((m: any) => setTimeout(() => m.delete().catch(() => { }), 8_000))
          .catch(() => { });
      }

      const logChannelId = settings.moderation?.logChannelId || settings.logChannelId;
      if (logChannelId) {
        logRaidDetection(client, guild, logChannelId, settings?.language, allEntries, normalized, deleted).catch(() => { });
      }
    }

    return true;
  },

  normalizeContent,
  trackRaidMessage,
  isActiveRaid,
  clearRaidState,
  DEFAULT_USER_THRESHOLD,
  DEFAULT_TIME_WINDOW,
};

export default antiRaid;
