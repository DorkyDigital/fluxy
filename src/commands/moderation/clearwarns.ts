import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import { logModAction } from '../../utils/logger';
import Warning from '../../models/Warning';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'clearwarns',
  description: "Clear all recorded warnings from a user's history",
  usage: '<@user or user ID>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.clearwarns.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.clearwarns.usage', { prefix }));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.clearwarns.invalidUser'));
    }

    try {
      const warningRecord = await Warning.getUserWarnings(guild.id, userId);
      const currentCount = warningRecord.warnings?.length || 0;

      if (currentCount === 0) {
        return void await message.reply(t(lang, 'commands.moderation.clearwarns.noWarningsToClear'));
      }

      await Warning.clearWarnings(guild.id, userId);

      let targetUser: any;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.clearwarns.success', {
          currentCount,
          username: displayName,
          userId: targetUser.id
        })
      );

      await logModAction(guild, (message as any).author, targetUser, 'clearwarns', `Cleared ${currentCount} warnings`, { client });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !clearwarns (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !clearwarns: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.clearwarns.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
