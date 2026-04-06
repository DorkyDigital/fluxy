import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import { canModerate } from '../../utils/permissions';
import { logModAction } from '../../utils/logger';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied, permMessage } from '../../utils/permError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'kick',
  description: 'Remove a member from the server \u2014 they can rejoin with an invite. Reason is logged to the mod log channel',
  usage: '<@user or user ID> [reason]',
  category: 'moderation',
  permissions: ['KickMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.kick.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.kick.usage', { prefix }));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.kick.invalidUser'));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.moderation.kick.noReasonProvided');

    let moderator: any = guild.members?.get((message as any).author.id);
    if (!moderator) {
      moderator = await guild.fetchMember((message as any).author.id);
    }

    let targetMember: any = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        return void await message.reply(t(lang, 'commands.moderation.kick.userNotInServer'));
      }
    }

    if (!targetMember) {
      return void await message.reply(t(lang, 'commands.moderation.kick.userNotInServer'));
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
        return void await message.reply(t(lang, 'commands.moderation.kick.cannotKickRoleHierarchy'));
      }
    }

    try {
      await guild.kick(targetMember.id);

      const displayName = targetMember.user?.username || targetMember.id;
      await message.reply(
        t(lang, 'commands.moderation.kick.success', {
          username: displayName,
          userId: targetMember.id,
          reason
        })
      );

      await logModAction(guild, (message as any).author, targetMember.user || targetMember, 'kick', reason, { client });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: targetMember.id,
        userId: (message as any).author.id,
        action: 'kick',
        reason
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !kick (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'kick')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !kick: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.kick.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
