import { EmbedBuilder } from '@erinjs/core';
import config from '../config';
import { logServerEvent } from './logger';
import { t } from '../i18n';

const DEFAULT_JOIN_THRESHOLD = 10;
const DEFAULT_TIME_WINDOW_MS = 15_000;
const ALERT_COOLDOWN = 5 * 60_000;
const RAID_ACTIVE_DURATION = 5 * 60_000;

const joinTimestamps = new Map<string, { times: number[]; userIds: string[] }>();
const lastAlert = new Map<string, number>();
const activeRaids = new Map<string, number>();

export function isRaidActive(guildId: string): boolean {
  const ts = activeRaids.get(guildId);
  if (!ts) return false;
  if (Date.now() - ts > RAID_ACTIVE_DURATION) {
    activeRaids.delete(guildId);
    return false;
  }
  return true;
}

export function recordJoin(
  guildId: string,
  userId: string,
  settings?: any,
): {
  detected: boolean;
  joinCount: number;
  userIds: string[];
} | null {
  const now = Date.now();

  const raidConfig = settings?.automod?.raid;
  const joinThreshold = raidConfig?.userThreshold || DEFAULT_JOIN_THRESHOLD;
  const timeWindowMs = (raidConfig?.timeWindow || DEFAULT_TIME_WINDOW_MS / 1000) * 1000;

  let tracking = joinTimestamps.get(guildId);
  if (!tracking) {
    tracking = { times: [], userIds: [] };
    joinTimestamps.set(guildId, tracking);
  }

  tracking.times.push(now);
  tracking.userIds.push(userId);

  const cutoff = now - timeWindowMs;
  while (tracking.times.length > 0 && tracking.times[0] < cutoff) {
    tracking.times.shift();
    tracking.userIds.shift();
  }

  if (tracking.times.length >= joinThreshold) {
    const lastAlertTime = lastAlert.get(guildId);
    if (lastAlertTime && now - lastAlertTime < ALERT_COOLDOWN) {
      return null;
    }

    lastAlert.set(guildId, now);
    activeRaids.set(guildId, now);

    const result = {
      detected: true,
      joinCount: tracking.times.length,
      userIds: [...tracking.userIds],
    };

    tracking.times = [];
    tracking.userIds = [];

    return result;
  }

  return null;
}

export async function sendRaidAlert(client: any, guild: any, joinCount: number, userIds: string[]): Promise<void> {
  const idList = userIds.map((id) => `\`${id}\``).join(', ');
  const idListForBan = userIds.join(',');
  const mentionList = userIds
    .slice(0, 20)
    .map((id) => `<@${id}>`)
    .join(' ');

  const embed = new EmbedBuilder()
    .setTitle(t('en', 'auditCatalog.utils.raidDetector.l85_setTitle'))
    .setDescription(
      `**${joinCount}** users joined **${guild.name}** within a short time window.\n\n` +
        `This may be a raid. Review the user(s) below and take action if needed.`,
    )
    .addFields(
      {
        name: t('en', 'auditCatalog.utils.raidDetector.l91_addFields_name'),
        value: `${guild.name} (\`${guild.id}\`)`,
        inline: false,
      },
      {
        name: t('en', 'auditCatalog.utils.raidDetector.l92_addFields_name', { 'userIds.length': userIds.length }),
        value: idList.length > 1024 ? idList.slice(0, 1000) + '...' : idList,
        inline: false,
      },
      {
        name: t('en', 'auditCatalog.utils.raidDetector.l93_addFields_name'),
        value: t('en', 'auditCatalog.utils.raidDetector.l93_addFields_value', {
          userIds: idListForBan.length > 900 ? idListForBan.slice(0, 900) + '...' : idListForBan,
        }),
        inline: false,
      },
    )
    .setColor(0xff0000)
    .setTimestamp(new Date());

  const alertPayload = { embeds: [embed] };

  try {
    await logServerEvent(
      guild,
      '🚨 Raid Detected',
      0xff0000,
      [
        { name: 'Joins', value: `**${joinCount}** in rapid succession`, inline: true },
        {
          name: 'Users',
          value: mentionList + (userIds.length > 20 ? `\n...and ${userIds.length - 20} more` : ''),
          inline: false,
        },
        {
          name: 'User IDs (copyable)',
          value: `\`\`\`\n${idListForBan.length > 900 ? idListForBan.slice(0, 900) + '...' : idListForBan}\n\`\`\``,
          inline: false,
        },
      ],
      client,
      {
        description: 'A possible raid has been detected. Review the accounts below and take action.',
        footer: 'Fluxy Anti-Raid • Configure thresholds in the dashboard under Automod',
        eventType: 'raid_detected',
      },
    );
  } catch {}

  if (config.ownerId) {
    try {
      const ownerDM = await client.users.createDM?.(config.ownerId);
      if (ownerDM) await ownerDM.send(alertPayload);
    } catch {}
  }

  const guildOwnerId = guild.ownerId || (guild as any).owner_id;
  if (guildOwnerId && guildOwnerId !== config.ownerId) {
    try {
      const guildOwnerDM = await client.users.createDM?.(guildOwnerId);
      if (guildOwnerDM) {
        await guildOwnerDM.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(t('en', 'auditCatalog.utils.raidDetector.l133_setTitle'))
              .setDescription(
                `**${joinCount}** users joined **${guild.name}** in rapid succession.\n\n` +
                  `This may be a raid. Check your server and consider enabling lockdown if needed.`,
              )
              .addFields({
                name: t('en', 'auditCatalog.utils.raidDetector.l139_addFields_name', {
                  'userIds.length': userIds.length,
                }),
                value: idList.length > 1024 ? idList.slice(0, 1000) + '...' : idList,
                inline: false,
              })
              .setColor(0xff0000)
              .setTimestamp(new Date()),
          ],
        });
      }
    } catch {}
  }

  console.warn(`[raid-detect] ALERT: ${joinCount} joins in ${guild.name} (${guild.id})`);
}
