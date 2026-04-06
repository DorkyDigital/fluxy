import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import Warning from '../../models/Warning';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'warnings',
  description: 'View the warning history for a user \u2014 shows who issued each warning and the reason. Leave blank to see your own',
  usage: '[@user or user ID]',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.warnings.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    let userId: string;
    let targetUser: any;

    if (args[0]) {
      const parsed = parseUserId(args[0]);
      if (!parsed) {
        return void await message.reply(t(lang, 'commands.moderation.warnings.invalidUser'));
      }
      userId = parsed;
    } else {
      userId = (message as any).author.id;
    }

    try {
      targetUser = await client.users.fetch(userId);
    } catch {
      targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
    }

    try {
      const warningRecord = await Warning.getUserWarnings(guild.id, userId);
      const warnings = warningRecord.warnings || [];

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.moderation.warnings.title', { username: targetUser.username || targetUser.id }))
        .setColor(0xf39c12);

      if (warnings.length === 0) {
        embed.setDescription(t(lang, 'commands.moderation.warnings.noWarnings'));
      } else {
        const displayWarnings = warnings.slice(-10);
        const totalWarnings = warnings.length;

        embed.setDescription(
          t(lang, 'commands.moderation.warnings.showing', { shownCount: displayWarnings.length, totalWarnings })
        );

        const warningList: string[] = [];
        for (let i = 0; i < displayWarnings.length; i++) {
          const warning = displayWarnings[i];
          const date = warning.date
            ? new Date(warning.date).toLocaleDateString()
            : t(lang, 'commands.moderation.warnings.unknownDate');
          const modMention = warning.modId ? `<@${warning.modId}>` : t(lang, 'commands.moderation.warnings.unknown');

          warningList.push(`**${i + 1}.** ${warning.reason}`);
          warningList.push(
            `   \u2514 ${t(lang, 'commands.moderation.warnings.moderatorLabel')}: ${modMention} | ${t(lang, 'commands.moderation.warnings.dateLabel')}: ${date}`
          );
        }

        embed.addFields({
          name: t(lang, 'commands.moderation.warnings.fieldRecentWarnings'),
          value: warningList.join('\n') || t(lang, 'commands.moderation.warnings.none')
        });

        embed.setFooter({ text: t(lang, 'commands.moderation.warnings.footerTotalWarnings', { totalWarnings }) });
      }

      await message.reply({ embeds: [embed] });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !warnings (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !warnings: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.warnings.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
