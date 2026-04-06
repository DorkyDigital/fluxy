import { Routes } from '@erinjs/types';
import isNetworkError from '../../utils/isNetworkError';
import * as messageDeleteQueue from '../../utils/messageDeleteQueue';
import * as embedQueue from '../../utils/embedQueue';
import { t, normalizeLocale } from '../../i18n';

const linkRegex = /(https?:\/\/[^\s]+)/g;

const defaultAllowedDomains = [
  'discord.gg',
  'discord.com',
  'fluxer.app',
  'fluxer.gg',
  'fluxerstatic.com',
  'fluxerusercontent.com'
];

function antiLinkT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.antiLink.${key}`, vars);
}

const antiLink = {
  name: 'antiLink',
  description: 'Detects and removes URLs in messages',
  
  async check(message: any, client: any, settings: any, automodSettings: any): Promise<boolean> {
    if (!message.content) return false;
    
    const matches = message.content.match(linkRegex);
    if (!matches) return false;
    
    const guildDomains = settings?.automod?.allowedDomains || [];
    const allowedDomains = [...defaultAllowedDomains, ...guildDomains];
    
    const blockedLinks = matches.filter((link: string) => 
      !allowedDomains.some((domain: string) => link.toLowerCase().includes(domain.toLowerCase()))
    );
    
    if (blockedLinks.length === 0) return false;
    
    await this.execute(message, client, settings, automodSettings, blockedLinks);
    return true;
  },
  
  async execute(message: any, client: any, settings: any, _automodSettings: any, blockedLinks: string[]): Promise<void> {
    try {
      const channelId = message.channelId || message.channel?.id;
      const msgId = message.id;
      if (channelId && msgId) {
        try {
          await client.rest.delete(Routes.channelMessage(channelId, msgId));
        } catch (e: any) {
          if (isNetworkError(e)) {
            messageDeleteQueue.enqueue(channelId, msgId);
          } else if (e.status !== 404) {
            console.error(`[antiLink] Failed to delete message ${msgId}:`, e.message);
          }
        }
      }
      
	      const warningMsg = await message.channel.send({
	        content: t(normalizeLocale(settings?.language), 'auditCatalog.automod.modules.antiLink.l57_send_content', {
	          'message.author.id': message.author.id
	        })
	      }).catch(() => null);
      
      if (warningMsg) {
        setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
      }
      
      const logChannelId = settings.moderation?.logChannelId || settings.logChannelId;
      if (logChannelId) {
        await this.logAction(message, client, settings, blockedLinks, logChannelId);
      }
      
    } catch (error) {
      console.error('Error in anti-link module:', error);
    }
  },
  
  async logAction(message: any, client: any, settings: any, blockedLinks: string[], logChannelId: string): Promise<void> {
    try {
      const guild = message.guild || await client.guilds.fetch(message.guildId);
      if (!guild) return;
      
      const logChannel = guild.channels?.get(logChannelId);
      if (!logChannel) return;
      
      const embed = {
        title: antiLinkT(settings?.language, 'logTitle'),
        description: antiLinkT(settings?.language, 'logDescription'),
        fields: [
          { name: antiLinkT(settings?.language, 'fieldUser'), value: `<@${message.author.id}>`, inline: true },
          { name: antiLinkT(settings?.language, 'fieldChannel'), value: `<#${message.channelId || message.channel.id}>`, inline: true },
          { name: antiLinkT(settings?.language, 'fieldLinks'), value: blockedLinks.join('\n').substring(0, 1000) }
        ],
        color: 0xf39c12, // Orange
        timestamp: new Date().toISOString()
      };
      try {
        await logChannel.send({ embeds: [embed] });
      } catch (sendErr: any) {
        if (isNetworkError(sendErr)) {
          embedQueue.enqueue(guild.id, logChannelId, embed);
        }
      }
      
    } catch (error) {
      console.error('Error logging anti-link action:', error);
    }
  }
};

export default antiLink;
