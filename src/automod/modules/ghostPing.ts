import isNetworkError from '../../utils/isNetworkError';
import * as embedQueue from '../../utils/embedQueue';
import { t, normalizeLocale } from '../../i18n';

const recentMessages = new Map<string, any>();

const mentionRegex = /<@!?(\d{17,19})>/g;
const roleMentionRegex = /<@&(\d{17,19})>/g;
const everyoneRegex = /@everyone/gi;
const hereRegex = /@here/gi;

function ghostPingT(locale: unknown, key: string, vars?: Record<string, string | number>): string {
  return t(normalizeLocale(locale), `auditCatalog.automod.modules.ghostPing.${key}`, vars);
}

function extractUserMentions(content: string): string[] {
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    if (!mentions.includes(match[1])) {
      mentions.push(match[1]);
    }
  }
  
  if (everyoneRegex.test(content)) {
    mentions.push('everyone');
  }
  if (hereRegex.test(content)) {
    mentions.push('here');
  }
  
  return mentions;
}

function extractRoleMentions(content: string): string[] {
  const mentions: string[] = [];
  let match;
  
  while ((match = roleMentionRegex.exec(content)) !== null) {
    if (!mentions.includes(match[1])) {
      mentions.push(match[1]);
    }
  }
  
  return mentions;
}

function storeMessage(message: any): void {
  if (!message.content || message.author?.bot) return;
  
  const userMentions = extractUserMentions(message.content);
  const roleMentions = extractRoleMentions(message.content);
  
  if (userMentions.length === 0 && roleMentions.length === 0) return;
  
  const messageData = {
    content: message.content,
    author: message.author,
    authorId: message.author.id,
    userMentions,
    roleMentions,
    channelId: message.channelId || message.channel?.id,
    guildId: message.guildId || message.guild?.id,
    timestamp: Date.now()
  };
  
  recentMessages.set(message.id, messageData);
  
  setTimeout(() => {
    recentMessages.delete(message.id);
  }, 30000);
}

function getCachedMessage(messageId: string): any {
  return recentMessages.get(messageId) || null;
}


function clearCachedMessage(messageId: string): void {
  recentMessages.delete(messageId);
}

const ghostPing = {
  name: 'ghostPing',
  description: 'Detects deleted messages that contained mentions',
  

  async check(message: any, client: any, settings: any): Promise<boolean> {
    if (!message.content || message.author?.bot || (!message.guild && !message.guildId)) {
      return false;
    }
    
    const ghostPingEnabled = settings?.automod?.ghostPing ?? settings?.antiGhostPing ?? false;
    if (!ghostPingEnabled) return false;
    
    let cachedData = getCachedMessage(message.id);
    
    if (!cachedData) {
      const userMentions = extractUserMentions(message.content);
      const roleMentions = extractRoleMentions(message.content);
      
      if (userMentions.length === 0 && roleMentions.length === 0) {
        return false;
      }
      
      cachedData = {
        content: message.content,
        author: message.author,
        authorId: message.author?.id,
        userMentions,
        roleMentions,
        channelId: message.channelId || message.channel?.id,
        guildId: message.guildId || message.guild?.id
      };
    }
    
    if (cachedData.userMentions.length === 0 && cachedData.roleMentions.length === 0) {
      return false;
    }
    
    await this.execute(message, client, settings, cachedData);
    return true;
  },
  
  async execute(message: any, client: any, settings: any, cachedData: any): Promise<void> {
    try {
      const userMentionList = cachedData.userMentions.map((id: string) => {
        if (id === 'everyone') return '@everyone';
        if (id === 'here') return '@here';
        return `<@${id}>`;
      }).join(', ');
      
      const roleMentionList = cachedData.roleMentions.map((id: string) => `<@&${id}>`).join(', ');
      
      const allMentions = [userMentionList, roleMentionList].filter(Boolean).join(', ');
      
      const alertMsg = await message.channel.send({
        content: ghostPingT(settings?.language, 'alertMessage', {
          authorId: cachedData.authorId,
          mentions: allMentions,
        })
      }).catch(() => null);
      
      if (alertMsg) {
        setTimeout(() => alertMsg.delete().catch(() => {}), 30000);
      }
      
      if (settings && settings.logChannelId) {
        await this.logAction(message, client, settings, cachedData, allMentions);
      }
      
      clearCachedMessage(message.id);
      
    } catch (error) {
      console.error('Error in ghost ping detection:', error);
    }
  },
  
  async logAction(message: any, client: any, settings: any, cachedData: any, allMentions: string): Promise<void> {
    try {
      const guildId = cachedData.guildId || message.guildId;
      const guild = message.guild || await client.guilds.fetch(guildId);
      if (!guild) return;
      
      const logChannel = guild.channels?.get(settings.logChannelId);
      if (!logChannel) return;
      
      const embed = {
        title: ghostPingT(settings?.language, 'logTitle'),
        description: ghostPingT(settings?.language, 'logDescription'),
        fields: [
          { name: ghostPingT(settings?.language, 'fieldSender'), value: `<@${cachedData.authorId}>`, inline: true },
          { name: ghostPingT(settings?.language, 'fieldChannel'), value: `<#${cachedData.channelId}>`, inline: true },
          { name: ghostPingT(settings?.language, 'fieldMentioned'), value: allMentions },
          {
            name: ghostPingT(settings?.language, 'fieldMessageContent'),
            value: cachedData.content.substring(0, 1000) || ghostPingT(settings?.language, 'noContent')
          }
        ],
        color: 0x9b59b6, // Purple
        timestamp: new Date().toISOString()
      };
      try {
        await logChannel.send({ embeds: [embed] });
      } catch (sendErr: any) {
        if (isNetworkError(sendErr)) {
          const gId = cachedData.guildId || message.guildId;
          embedQueue.enqueue(gId, settings.logChannelId, embed);
        }
      }
      
    } catch (error) {
      console.error('Error logging ghost ping:', error);
    }
  },
  
  storeMessage,
  getCachedMessage,
  clearCachedMessage,
  extractUserMentions,
  extractRoleMentions
};

export default ghostPing;
