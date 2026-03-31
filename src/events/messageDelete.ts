import type { BotEvent } from '../types';
import automod from '../automod';
import { logServerEvent } from '../utils/logger';
import * as messageCache from '../utils/messageCache';
import StarboardMessage from '../models/StarboardMessage';
import settingsCache from '../utils/settingsCache';
import { Routes } from '@fluxerjs/types';

const event: BotEvent = {
  name: 'messageDelete',

  async execute(message: any, client: any) {

    const guildId = message.channel?.guildId;
    if (!guildId) return;

    await automod.handleGhostPing(message, client);

    const guild = client.guilds.get(guildId);
    if (!guild) return;

    const channelId = message.channelId || message.channel?.id;

    const cachedContent = message.id ? messageCache.get(message.id) : null;
    const rawContent = cachedContent || message.content;
    const content = rawContent
      ? (rawContent.length > 1024 ? rawContent.substring(0, 1021) + '...' : rawContent)
      : '*(content not cached)*';

    if (message.id) messageCache.remove(message.id);

    const fields = [
      { name: 'Author', value: message.authorId ? `<@${message.authorId}>` : '*(unknown)*', inline: true },
      { name: 'Channel', value: channelId ? `<#${channelId}>` : '*(unknown)*', inline: true },
      { name: 'Content', value: content },
    ];

    await logServerEvent(
      guild,
      'Message Deleted',
      0x99aab5,
      fields,
      client,
      message.id ? { footer: `Message ID: ${message.id}`, eventType: 'message_delete' } : { eventType: 'message_delete' }
    );

    // ─── Starboard cleanup ───
    if (message.id) {
      try {
        const settings = await settingsCache.get(guildId);
        const starboard = (settings as any)?.starboard;
        if (starboard?.enabled && starboard?.channelId) {
          // Check if the deleted message is an original tracked message
          const asOriginal = await StarboardMessage.findOne({ guildId, messageId: message.id });
          if (asOriginal) {
            // Original was deleted - remove the starboard post
            if (asOriginal.starboardMessageId) {
              try {
                await client.rest.delete(Routes.channelMessage(starboard.channelId, asOriginal.starboardMessageId));
              } catch { }
            }
            await StarboardMessage.deleteOne({ _id: asOriginal._id });
          } else {
            // Check if the deleted message is a starboard post
            const asStarboard = await StarboardMessage.findOne({ guildId, starboardMessageId: message.id });
            if (asStarboard) {
              asStarboard.starboardMessageId = null;
              await asStarboard.save();
            }
          }
        }
      } catch (sbErr: any) {
        console.error(`[starboard] Error in message delete cleanup: ${sbErr.message}`);
      }
    }
  }
};

export default event;
