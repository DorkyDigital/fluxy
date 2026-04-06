import ModerationLog from '../../models/ModerationLog';
import { logToChannel } from '../../utils/logger';
import { hasAnyPermission } from '../../utils/permissions';
import isNetworkError from '../../utils/isNetworkError';
import * as moderationQueue from '../../utils/moderationQueue';
import * as roleQueue from '../../utils/roleQueue';
import * as messageDeleteQueue from '../../utils/messageDeleteQueue';
import { t, normalizeLocale } from '../../i18n';

function honeypotT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.honeypot.${key}`, vars);
}

function honeypotReason(locale: unknown): string {
  return honeypotT(locale, 'reason');
}

async function check(message: any, client: any, settings: any): Promise<boolean> {
  const honeypots = settings?.honeypotChannels;
  if (!honeypots?.length) return false;

  const channelId = message.channelId || message.channel?.id;
  const entry = honeypots.find((h: any) => h.channelId === channelId);
  if (!entry) return false;

  if (entry.enabled === false) return false;

  const guild = message.guild || await client.guilds.fetch(message.guildId).catch(() => null);
  if (!guild) return false;

  const author = message.author;

  let member = guild.members?.get(author.id);
  if (!member) {
    try {
      member = await guild.fetchMember(author.id);
    } catch {
      return false;
    }
  }

  if (hasAnyPermission(member, ['ManageMessages', 'Administrator'])) return false;

  try {
    await message.delete();
  } catch (delErr: any) {
    if (isNetworkError(delErr)) {
      const msgId = message.id;
      if (msgId && channelId) messageDeleteQueue.enqueue(channelId, msgId);
    }
  }

  const action = entry.action || 'ban';

  try {
    if (action === 'ban') {
      await guild.ban(author.id, {
        reason: honeypotReason(settings?.language),
        delete_message_days: entry.banDeleteDays ?? 1
      });

    } else if (action === 'kick') {
      await guild.kick(author.id);

    } else if (action === 'timeout') {
      const durationMs = (entry.timeoutHours ?? 24) * 3600000;
      await member.edit({
        communication_disabled_until: new Date(Date.now() + durationMs).toISOString(),
        timeout_reason: honeypotReason(settings?.language)
      });

    } else if (action === 'role') {
      if (!entry.roleId) {
        console.error(`[${guild.name}] Honeypot role action in <#${channelId}> has no roleId configured - skipping.`);
        return true;
      }
      await member.addRole(entry.roleId);
    }

    const embedAction = action === 'role' ? 'warn' : action;
    await logToChannel(guild, null, {
      action: embedAction,
      title: honeypotT(settings?.language, 'logTitle', { username: author.username || author.id }),
      description: honeypotT(settings?.language, 'logDescription', { userId: author.id }),
      fields: [
        { name: honeypotT(settings?.language, 'fieldUser'), value: `<@${author.id}> (${author.id})`, inline: true },
        { name: honeypotT(settings?.language, 'fieldChannel'), value: `<#${channelId}>`, inline: true },
        { name: honeypotT(settings?.language, 'fieldAction'), value: formatAction(entry, settings?.language), inline: true },
      ],
      footer: honeypotT(settings?.language, 'footerUserId', { userId: author.id }),
      client,
    }).catch(() => {});

    const alertRoleId  = settings.honeypotAlertRoleId;
    const logChannelId = settings.logChannelId;
    if (alertRoleId && logChannelId) {
      const logChannel = guild.channels?.get(logChannelId);
      if (logChannel) {
        logChannel.send(`<@&${alertRoleId}>`).catch(() => {});
      }
    }

    await ModerationLog.logAction({
      guildId:  guild.id,
      targetId: author.id,
      userId:   'automod',
      action,
      reason:   honeypotReason(settings?.language),
      metadata: { honeypotChannelId: channelId } as any
    });

  } catch (err: any) {
    if (isNetworkError(err)) {
      if (action === 'ban') {
        moderationQueue.enqueue(guild.id, author.id, 'ban', { reason: honeypotReason(settings?.language), deleteDays: entry.banDeleteDays ?? 1 });
      } else if (action === 'kick') {
        moderationQueue.enqueue(guild.id, author.id, 'kick', { reason: honeypotReason(settings?.language) });
      } else if (action === 'timeout') {
        const durationMs = (entry.timeoutHours ?? 24) * 3600000;
        moderationQueue.enqueue(guild.id, author.id, 'timeout', { durationMs, reason: honeypotReason(settings?.language) });
      } else if (action === 'role' && entry.roleId) {
        roleQueue.enqueue(guild.id, author.id, entry.roleId, 'add');
      }
    } else {
      console.error(`[${guild.name}] Honeypot ${action} failed for ${author.id}: ${err.message || err}`);
    }
  }

  return true;
}

function formatAction(entry: any, locale: unknown): string {
  switch (entry.action) {
    case 'ban':
      return honeypotT(locale, 'actionBan', { days: entry.banDeleteDays ?? 1 });
    case 'kick':
      return honeypotT(locale, 'actionKick');
    case 'timeout':
      return honeypotT(locale, 'actionTimeout', { hours: entry.timeoutHours ?? 24 });
    case 'role':
      return entry.roleId
        ? honeypotT(locale, 'actionRole', { roleId: entry.roleId })
        : honeypotT(locale, 'actionRoleUnconfigured');
    default:        return entry.action;
  }
}

export default { check };
