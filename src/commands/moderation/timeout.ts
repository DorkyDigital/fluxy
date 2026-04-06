import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import parseDuration from '../../utils/parseDuration';
import formatDuration from '../../utils/formatDuration';
import { canModerate } from '../../utils/permissions';
import { logModAction } from '../../utils/logger';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied, permMessage } from '../../utils/permError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;

const command: Command = {
  name: 'timeout',
  description: 'Apply a custom-length timeout to a member. Duration format: 1m, 30m, 2h, 7d \u2014 max 28 days',
  usage: '<@user or user ID> <duration> [reason]',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.timeout.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.usage', { prefix }));
    }

    if (!args[1]) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.missingDuration'));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.invalidUser'));
    }

    const duration = parseDuration(args[1]);
    if (!duration) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.invalidDurationFormat'));
    }

    if (duration > MAX_TIMEOUT) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.durationTooLong'));
    }

    const reason = args.slice(2).join(' ').trim() || t(lang, 'commands.moderation.timeout.noReasonProvided');

    let moderator: any = guild.members?.get((message as any).author.id);
    if (!moderator) {
      moderator = await guild.fetchMember((message as any).author.id);
    }

    let targetMember: any = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        return void await message.reply(t(lang, 'commands.moderation.timeout.userNotInServer'));
      }
    }

    if (!targetMember) {
      return void await message.reply(t(lang, 'commands.moderation.timeout.userNotInServer'));
    }

    const modCheck = canModerate(moderator, targetMember);
    if (!modCheck.canModerate) {
      return void await message.reply(`${modCheck.reason}`);
    }

    const botUserId = client.user?.id;
    let botMember: any = null;
    if (botUserId) {
      try {
        await guild.fetchRoles?.();
        botMember = await guild.fetchMember(botUserId);
      } catch {}
      if (!botMember) botMember = guild.members?.get?.(botUserId) ?? guild.members?.me;
    }
    if (botMember) {
      const botCheck = canModerate(botMember as any, targetMember);
      if (!botCheck.canModerate) {
        return void await message.reply(t(lang, 'commands.moderation.timeout.cannotTimeoutRoleHierarchy'));
      }
    }

    if (targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date()) {
      const remaining = new Date(targetMember.communicationDisabledUntil).getTime() - Date.now();
      return void await message.reply(
        t(lang, 'commands.moderation.timeout.alreadyTimedOutRemaining', { remaining: formatDuration(remaining) })
      );
    }

    try {
      const timeoutUntil = new Date(Date.now() + duration);
      await targetMember.edit({
        communication_disabled_until: timeoutUntil.toISOString(),
        timeout_reason: `${(message as any).author.username}: ${reason}`
      });

      const displayName = targetMember.user?.username || targetMember.id;
      await message.reply(
        t(lang, 'commands.moderation.timeout.successTimedOut', {
          username: displayName,
          userId: targetMember.id,
          duration: formatDuration(duration),
          reason
        })
      );

      await logModAction(guild, (message as any).author, targetMember.user || targetMember, 'timeout', reason, {
        fields: [
          { name: 'Duration', value: formatDuration(duration), inline: true }
        ],
        client
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: targetMember.id,
        userId: (message as any).author.id,
        action: 'timeout',
        reason,
        duration
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !timeout (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'timeout')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !timeout: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.timeout.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
