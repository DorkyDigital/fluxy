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
  name: 'ban',
  description: 'Permanently ban a user from the server by @mention or user ID \u2014 can ban users not currently in the server. Reason is logged',
  usage: '<@user or user ID> [reason]',
  category: 'moderation',
  permissions: ['BanMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.ban.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.ban.usage', { prefix }));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.ban.invalidUser'));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.moderation.ban.noReasonProvided');

    let moderator: any = guild.members?.get((message as any).author.id);
    if (!moderator) {
      moderator = await guild.fetchMember((message as any).author.id);
    }

    let targetMember: any = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        targetMember = null;
      }
    }

    if (targetMember) {
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
          return void await message.reply(t(lang, 'commands.moderation.ban.cannotBanRoleHierarchy'));
        }
      }
    }

    try {
      await guild.ban(userId, {
        reason: `${(message as any).author.username}: ${reason}`
      });

      let targetUser: any = targetMember?.user;
      if (!targetUser) {
        try {
          targetUser = await client.users.fetch(userId);
        } catch {
          targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
        }
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.ban.success', {
          username: displayName,
          userId: targetUser.id,
          reason
        })
      );

      await logModAction(guild, (message as any).author, targetUser, 'ban', reason, { client });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: (message as any).author.id,
        action: 'ban',
        reason
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ban (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'ban')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !ban: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.ban.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
