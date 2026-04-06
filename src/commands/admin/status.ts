import type { Command } from '../../types';
import { EmbedBuilder } from '@erinjs/core';
import GuildSettings from '../../models/GuildSettings';
import isNetworkError from '../../utils/isNetworkError';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'status',
  description: 'Show all bot settings for this server, automod, anti-link, anti-spam, ghost ping, log channel, autorole, and more',
  usage: '',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }
    
    if (!guild) {
      return void await message.reply(t('en', 'commands.admin.status.serverOnly'));
    }

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.admin.status.title', { guildName: guild.name }))
        .setColor(0x3498db)

      const am = settings.automod || {};
      const automodStatus = am.level && am.level !== 'off'
        ? t(lang, 'commands.admin.status.enabled', { value: am.level })
        : t(lang, 'commands.admin.status.disabled');
      const antiLinkStatus = am.antiLink ? t(lang, 'commands.admin.status.enabledSimple') : t(lang, 'commands.admin.status.disabledSimple');
      const antiSpamStatus = am.antiSpam ? t(lang, 'commands.admin.status.enabledSimple') : t(lang, 'commands.admin.status.disabledSimple');
      const antiReactionSpamStatus = am.antiReactionSpam ? t(lang, 'commands.admin.status.enabledSimple') : t(lang, 'commands.admin.status.disabledSimple');
      const antiGhostPingStatus = am.ghostPing ? t(lang, 'commands.admin.status.enabledSimple') : t(lang, 'commands.admin.status.disabledSimple');

      embed.addFields(
        { 
          name: t(lang, 'commands.admin.status.automodSystemField'),
          value: t(lang, 'auditCatalog.commands.admin.status.l45_addFields_value', { automodStatus }),
          inline: false 
        },
        { 
          name: t(lang, 'commands.admin.status.antiLinkField'),
          value: antiLinkStatus, 
          inline: true 
        },
        { 
          name: t(lang, 'commands.admin.status.antiSpamField'),
          value: antiSpamStatus, 
          inline: true 
        },
        {
          name: t(lang, 'commands.admin.status.antiReactionSpamField'),
          value: antiReactionSpamStatus,
          inline: true
        },
        { 
          name: t(lang, 'commands.admin.status.antiGhostPingField'),
          value: antiGhostPingStatus, 
          inline: true 
        }
      );

      const modLogChannelId = settings.moderation?.logChannelId || settings.logChannelId;
      const logChannel = modLogChannelId 
        ? `<#${modLogChannelId}>` 
        : t(lang, 'commands.admin.status.logNotSet');

      embed.addFields(
        { 
          name: t(lang, 'commands.admin.status.logChannelField'),
          value: logChannel, 
          inline: true 
        }
      );

      const muteRole = settings.muteRoleId 
        ? `<@&${settings.muteRoleId}>` 
        : t(lang, 'commands.admin.status.muteNotSet');

      embed.addFields(
        { 
          name: t(lang, 'commands.admin.status.muteRoleField'),
          value: muteRole, 
          inline: true 
        }
      );

      const prefix = settings.prefix || process.env.PREFIX || '!';
      const defaultPrefix = process.env.PREFIX || '!';

      embed.addFields(
        { 
          name: t(lang, 'commands.admin.status.customPrefixField'),
          value: settings.prefix ? `\`${prefix}\`` : t(lang, 'commands.admin.status.customPrefixDefaultValue', { defaultPrefix }),
          inline: true 
        }
      );

      embed.setFooter({ text: t(lang, 'commands.admin.status.footer') });

      await message.reply({ embeds: [embed] });

    } catch (error: any) {
      if (isNetworkError(error)) {
        console.warn(`[${(message as any).guild?.name || 'Unknown Server'}] Fluxer API unreachable during !status (ECONNRESET)`);
      } else {
        console.error(`[${(message as any).guild?.name || 'Unknown Server'}] Error in !status:`, error);
        message.reply(t('en', 'commands.admin.status.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
