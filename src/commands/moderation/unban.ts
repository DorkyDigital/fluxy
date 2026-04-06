import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import { logModAction } from '../../utils/logger';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied, permMessage } from '../../utils/permError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'unban',
  description: 'Remove a ban from a previously banned user. Requires their user ID (right-click their name > Copy ID) also in logs',
  usage: '<user ID> [reason]',
  category: 'moderation',
  permissions: ['BanMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.unban.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.unban.usage', { prefix }));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.unban.invalidUser'));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.moderation.unban.noReasonProvided');

    try {
      let targetUser: any;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
      }

      await guild.unban(userId);

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.unban.success', { username: displayName, userId: targetUser.id, reason })
      );

      await logModAction(guild, (message as any).author, targetUser, 'unban', reason, { client });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: (message as any).author.id,
        action: 'unban',
        reason
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !unban (ECONNRESET)`);
      } else if (error.code === 10026) {
        message.reply(t(lang, 'commands.moderation.unban.notBanned')).catch(() => {});
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'unban')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !unban: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.unban.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
