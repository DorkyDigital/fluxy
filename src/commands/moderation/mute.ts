// legacy atp

import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import { canModerate, getMemberHighestRolePosition } from '../../utils/permissions';
import { logModAction } from '../../utils/logger';
import formatDuration from '../../utils/formatDuration';
import settingsCache from '../../utils/settingsCache';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied, permMessage } from '../../utils/permError';
import { t, normalizeLocale } from '../../i18n';

const DEFAULT_MUTE_DURATION = 10 * 60 * 1000; // default mute, change if you would like :)

const command: Command = {
  name: 'mute',
  description: 'Apply a 10-minute timeout to a member \u2014 they cannot send messages or join voice. Use !timeout for a custom duration',
  usage: '<@user or user ID> [reason]',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.mute.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.mute.usage', { prefix }));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.mute.invalidUser'));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.moderation.mute.noReasonProvided');

    let moderator: any = guild.members?.get((message as any).author.id);
    if (!moderator) {
      moderator = await guild.fetchMember((message as any).author.id);
    }

    let targetMember: any = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        return void await message.reply(t(lang, 'commands.moderation.mute.userNotInServer'));
      }
    }

    if (!targetMember) {
      return void await message.reply(t(lang, 'commands.moderation.mute.userNotInServer'));
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
      if (!(botMember as any).guild) (botMember as any).guild = guild;
      if (!(targetMember as any).guild) (targetMember as any).guild = guild;
      const botCheck = canModerate(botMember as any, targetMember);
      if (!botCheck.canModerate) {
        return void await message.reply(t(lang, 'commands.moderation.mute.cannotMuteRoleHierarchy'));
      }
    }

    if (targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date()) {
      return void await message.reply(t(lang, 'commands.moderation.mute.alreadyMuted'));
    }

    const settings = guildSettings;
    const muteRoleId = settings?.moderation?.muteRoleId || settings?.muteRoleId;
    const muteMethod: 'auto' | 'timeout' | 'mute_role' = settings?.moderation?.muteMethod || 'auto';

    try {
      const timeoutUntil = new Date(Date.now() + DEFAULT_MUTE_DURATION);

      let useMuteRole = false;
      if (muteRoleId && botMember) {
        const muteRole = guild.roles?.get(muteRoleId) ?? (guild.roles as any)?.cache?.get?.(muteRoleId);
        if (muteRole) {
          const muteRolePos = typeof (muteRole as any).position === 'number' ? (muteRole as any).position : 0;
          const botHighest = getMemberHighestRolePosition(botMember, guild);
          if (botHighest >= 0 && muteRolePos < botHighest) {
            useMuteRole = true;
          }
        }
      }

      if (muteMethod === 'mute_role' && !useMuteRole) {
          return void await message.reply(t(lang, 'commands.moderation.mute.muteRoleOnlyCannotApply'));
      }

      const shouldUseRole = muteMethod === 'mute_role' || (muteMethod === 'auto' && useMuteRole);
      if (shouldUseRole && muteRoleId) {
          await targetMember.addRole(muteRoleId);

          const displayName = targetMember.user?.username || targetMember.id;
          await message.reply(
            t(lang, 'commands.moderation.mute.successMutedRole', {
              username: displayName,
              userId: targetMember.id,
              reason
            })
          );

          await logModAction(guild, (message as any).author, targetMember.user || targetMember, 'mute', reason, {
            fields: [
              { name: 'Method', value: 'Mute Role', inline: true },
            ],
            client
          });

          await ModerationLog.logAction({
            guildId: guild.id,
            targetId: targetMember.id,
            userId: (message as any).author.id,
            action: 'mute',
            reason,
            duration: DEFAULT_MUTE_DURATION
          });

          return;
      }

      if (muteMethod === 'mute_role') {
        return void await message.reply(t(lang, 'commands.moderation.mute.muteRoleNotConfigured'));
      }

      await targetMember.edit({
        communication_disabled_until: timeoutUntil.toISOString(),
        timeout_reason: `${(message as any).author.username}: ${reason}`
      });

      const displayName = targetMember.user?.username || targetMember.id;
      await message.reply(
        t(lang, 'commands.moderation.mute.successMutedDuration', {
          username: displayName,
          userId: targetMember.id,
          duration: formatDuration(DEFAULT_MUTE_DURATION),
          reason
        })
      );

      await logModAction(guild, (message as any).author, targetMember.user || targetMember, 'mute', reason, {
        fields: [
          { name: 'Duration', value: formatDuration(DEFAULT_MUTE_DURATION), inline: true }
        ],
        client
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: targetMember.id,
        userId: (message as any).author.id,
        action: 'mute',
        reason,
        duration: DEFAULT_MUTE_DURATION
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !mute (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'mute')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !mute: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.mute.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
