import type { Command } from '../../types';
import { canModerate } from '../../utils/permissions';
import { logModAction } from '../../utils/logger';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import { isPermDenied } from '../../utils/permError';
import { EmbedBuilder } from '@erinjs/core';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'massban',
  description: 'Ban all unique message authors between two boundary messages in the current channel',
  usage: '<startMessageId> <endMessageId> [reason]',
  category: 'moderation',
  permissions: ['BanMembers'],
  cooldown: 10,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.massban.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (args.length < 2) {
      return void await message.reply(t(lang, 'commands.moderation.massban.usage', { prefix }));
    }

    const startId = args[0];
    const endId = args[1];
    const reason = args.slice(2).join(' ').trim() || t(lang, 'commands.moderation.massban.noReasonProvided');

    if (!/^\d{17,22}$/.test(startId) || !/^\d{17,22}$/.test(endId)) {
      return void await message.reply(t(lang, 'commands.moderation.massban.invalidMessageIds'));
    }

    const channelId = (message as any).channelId || (message as any).channel?.id;
    if (!channelId) {
      return void await message.reply(t(lang, 'commands.moderation.massban.couldNotDetermineChannel'));
    }

    const channel = guild.channels?.get(channelId)
      || await guild.fetchChannel?.(channelId).catch(() => null);
    if (!channel) {
      return void await message.reply(t(lang, 'commands.moderation.massban.couldNotAccessChannel'));
    }

    let startMsg: any, endMsg: any;
    try {
      startMsg = await channel.messages.fetch(startId);
    } catch {
      return void await message.reply(
        t(lang, 'commands.moderation.massban.couldNotFindStartMessage', { startId })
      );
    }
    try {
      endMsg = await channel.messages.fetch(endId);
    } catch {
      return void await message.reply(
        t(lang, 'commands.moderation.massban.couldNotFindEndMessage', { endId })
      );
    }

    const [lowId, highId] = BigInt(startId) <= BigInt(endId) ? [startId, endId] : [endId, startId];

    const statusMsg = await message.reply(t(lang, 'commands.moderation.massban.statusFetching'));

    const allMessages: any[] = [];
    let lastFetchedId: string | undefined = undefined;
    let reachedEnd = false;

    while (!reachedEnd) {
      try {
        const fetchOptions: any = { limit: 100 };
        if (lastFetchedId) {
          fetchOptions.after = lastFetchedId;
        } else {
          fetchOptions.after = lowId;
        }

        const fetched = await channel.messages.fetch(fetchOptions);
        const msgs = Array.isArray(fetched) ? fetched : [...(fetched.values?.() ?? [])];

        if (msgs.length === 0) {
          reachedEnd = true;
          break;
        }

        for (const msg of msgs) {
          const msgIdBig = BigInt(msg.id);
          if (msgIdBig >= BigInt(lowId) && msgIdBig <= BigInt(highId)) {
            allMessages.push(msg);
          }
          if (msgIdBig > BigInt(highId)) {
            reachedEnd = true;
            break;
          }
        }

        const sortedMsgs = msgs.sort((a: any, b: any) => {
          const diff = BigInt(a.id) - BigInt(b.id);
          return diff < 0n ? -1 : diff > 0n ? 1 : 0;
        });
        lastFetchedId = sortedMsgs[sortedMsgs.length - 1].id;

        if (msgs.length < 100) reachedEnd = true;
      } catch {
        reachedEnd = true;
      }
    }

    const messageMap = new Map<string, any>();
    for (const msg of allMessages) {
      messageMap.set(msg.id, msg);
    }
    messageMap.set(startMsg.id, startMsg);
    messageMap.set(endMsg.id, endMsg);

    const authorIds = new Set<string>();
    const botUserId = client.user?.id;
    const invokerId = (message as any).author.id;

    for (const [, msg] of messageMap) {
      const authorId = msg.author?.id;
      if (!authorId) continue;
      if (msg.author.bot) continue;
      if (authorId === invokerId) continue;
      if (authorId === botUserId) continue;
      authorIds.add(authorId);
    }

    if (authorIds.size === 0) {
      return void await statusMsg.edit({ content: t(lang, 'commands.moderation.massban.noBannableUsersFound') });
    }

    const confirmEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.moderation.massban.confirmTitle'))
      .setColor(0xFF4444)
      .setDescription(
        t(lang, 'commands.moderation.massban.confirmDescription', {
          authorCount: authorIds.size,
          messageCount: messageMap.size,
          reason
        })
      );

    const confirmMsg = await statusMsg.edit({ content: undefined, embeds: [confirmEmbed] });

    try {
      await confirmMsg.react('✅');
      await confirmMsg.react('❌');
    } catch {
      return void await confirmMsg.edit({
        content: t(lang, 'commands.moderation.massban.confirmationReactionsFailed'),
        embeds: []
      });
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        client.off?.('messageReactionAdd', handler);
        resolve(false);
      }, 30_000);

      const handler = (...handlerArgs: any[]) => {
        const [reaction, reactor] = handlerArgs;
        if (reaction.messageId !== confirmMsg.id) return;
        if (reactor.id !== invokerId) return;

        const emoji = reaction.emoji?.name;
        if (emoji === '✅') {
          clearTimeout(timeout);
          client.off?.('messageReactionAdd', handler);
          resolve(true);
        } else if (emoji === '❌') {
          clearTimeout(timeout);
          client.off?.('messageReactionAdd', handler);
          resolve(false);
        }
      };

      client.on?.('messageReactionAdd', handler);
    });

    if (!confirmed) {
      return void await confirmMsg.edit({ content: t(lang, 'commands.moderation.massban.cancelled'), embeds: [] });
    }

    await confirmMsg.edit({
      content: t(lang, 'commands.moderation.massban.statusBanning', { authorCount: authorIds.size }),
      embeds: []
    });

    let moderator: any = guild.members?.get(invokerId);
    if (!moderator) {
      moderator = await guild.fetchMember(invokerId);
    }

    let banned = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const userId of authorIds) {
      try {
        let targetMember: any = guild.members?.get(userId);
        if (!targetMember) {
          try { targetMember = await guild.fetchMember(userId); } catch { targetMember = null; }
        }

        if (targetMember && moderator) {
          const modCheck = canModerate(moderator, targetMember);
          if (!modCheck.canModerate) {
            failed++;
            failures.push(`<@${userId}>: ${modCheck.reason}`);
            continue;
          }
        }

        await guild.ban(userId, {
          reason: `[massban] ${(message as any).author.username}: ${reason}`,
          deleteMessageSeconds: 86400,
        });

        banned++;

        let targetUser: any = targetMember?.user;
        if (!targetUser) {
          try { targetUser = await client.users.fetch(userId); } catch {
            targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
          }
        }

        await logModAction(guild, (message as any).author, targetUser, 'ban', `[massban] ${reason}`, { client }).catch(() => {});

        await ModerationLog.logAction({
          guildId: guild.id,
          targetId: userId,
          userId: invokerId,
          action: 'ban',
          reason: `[massban] ${reason}`
        }).catch(() => {});

        if (authorIds.size > 5) await new Promise(r => setTimeout(r, 300));

      } catch (error: any) {
        failed++;
        if (isNetworkError(error)) {
          failures.push(
            `<@${userId}>: ${t(lang, 'commands.moderation.massban.failures.networkError')}`
          );
        } else if (isPermDenied(error)) {
          failures.push(
            `<@${userId}>: ${t(lang, 'commands.moderation.massban.failures.missingPermissions')}`
          );
        } else {
          failures.push(
            `<@${userId}>: ${
              error.message || t(lang, 'commands.moderation.massban.failures.unknownError')
            }`
          );
        }
      }
    }

    const failuresBlock = failures.length > 0
      ? t(lang, 'commands.moderation.massban.failuresBlock', {
        failuresPreview: failures.slice(0, 10).join('\n'),
        moreSuffix: failures.length > 10
          ? t(lang, 'commands.moderation.massban.failuresMoreSuffix', { moreCount: failures.length - 10 })
          : ''
      })
      : '';

    const resultEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.moderation.massban.resultTitle'))
      .setColor(banned > 0 ? 0x43B581 : 0xFF4444)
      .setDescription(
        t(lang, 'commands.moderation.massban.resultDescription', {
          banned,
          total: authorIds.size,
          failed,
          reason,
          failuresBlock
        })
      );

    await confirmMsg.edit({ content: undefined, embeds: [resultEmbed] });
  }
};

export default command;
