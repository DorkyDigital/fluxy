import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const INVITE_URL = 'https://web.fluxer.app/oauth2/authorize?client_id=1474069931333816428&scope=bot&permissions=4504699474930806';

const command: Command = {
  name: 'invite-me',
  description: 'Get the bot invite link to add Fluxy to your server.',
  usage: '',
  category: 'general',
  aliases: ['inv'],
  cooldown: 5,

  async execute(message, _args, _client) {
    try {
      const guildId = (message as any).guildId || (message as any).guild?.id;
      const settings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(settings?.language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.invite.title'))
        .setDescription(t(lang, 'auditCatalog.commands.general.invite_me.l24_setDescription', { INVITE_URL }))
        .setColor(0x6c72f8);

      await message.reply({ embeds: [embed] });
    } catch (error: any) {
      if (isNetworkError(error)) {
        console.warn('Fluxer API unreachable during !invite-me (ECONNRESET)');
      } else {
        console.error(`Error in !invite-me: ${error.message || error}`);
        await message.reply(t('en', 'commands.invite.fallback', { inviteUrl: INVITE_URL })).catch(() => { });
      }
    }
  }
};

export default command;
