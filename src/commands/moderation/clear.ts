import { Routes } from '@erinjs/types';
import type { Command } from '../../types';
import { logModAction } from '../../utils/logger';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied, permMessage } from '../../utils/permError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'clear',
  description: 'Bulk delete messages in the current channel \u2014 the command message is also deleted. Max 100 messages at a time',
  usage: '<amount 1\u2013100>',
  category: 'moderation',
  permissions: ['ManageMessages'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.clear.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.clear.usage', { prefix }));
    }

    const amount = parseInt(args[0], 10);

    if (isNaN(amount)) {
      return void await message.reply(t(lang, 'commands.moderation.clear.invalidNumber'));
    }

    if (amount < 1 || amount > 100) {
      return void await message.reply(t(lang, 'commands.moderation.clear.amountRange'));
    }

    try {
      const fetchLimit = Math.min(amount + 1, 100);
      const messagesData: any = await client.rest.get(
        `${Routes.channelMessages((message as any).channel.id)}?limit=${fetchLimit}`
      );

      const messages = Array.isArray(messagesData) ? messagesData : [];

      if (messages.length === 0) {
        return void await message.reply(t(lang, 'commands.moderation.clear.noMessages'));
      }

      const messageIds = messages.map((msg: any) => msg.id).slice(0, 100);

      let deletedCount = 0;

      if (messageIds.length >= 2) {
        try {
          await (message as any).channel.bulkDeleteMessages(messageIds);
          deletedCount = messageIds.length;
        } catch (bulkError: any) {
          console.warn(`[${guild?.name || 'Unknown Server'}] Bulk delete failed, falling back to individual deletion: ${bulkError.message}`);
          for (const id of messageIds) {
            try {
              await client.rest.delete(Routes.channelMessage((message as any).channel.id, id));
              deletedCount++;
            } catch (e: any) {
              console.warn(`[${guild?.name || 'Unknown Server'}] Failed to delete message ${id}: ${e.message}`);
            }
          }
        }
      } else {
        for (const id of messageIds) {
          try {
            await client.rest.delete(Routes.channelMessage((message as any).channel.id, id));
            deletedCount++;
          } catch (e: any) {
            console.warn(`[${guild?.name || 'Unknown Server'}] Failed to delete message ${id}: ${e.message}`);
          }
        }
      }

      const userCount = Math.max(0, deletedCount - 1);
      const confirmMsg = await (message as any).channel.send(
        t(lang, 'commands.moderation.clear.successDeleted', { userCount })
      );

      setTimeout(() => {
        confirmMsg.delete().catch(() => {});
      }, 5000);

      await logModAction(guild, (message as any).author, null, 'clear', `Deleted ${userCount} messages in #${(message as any).channel.name}`, {
        fields: [
          { name: 'Channel', value: `<#${(message as any).channel.id}>`, inline: true },
          { name: 'Messages Deleted', value: `${userCount}`, inline: true }
        ],
        client
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !clear (ECONNRESET)`);
      } else if (error.code === 50034) {
        message.reply(t(lang, 'commands.moderation.clear.errors.cannotDeleteOlderThan14Days')).catch(() => {});
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'clear')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !clear: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.clear.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
