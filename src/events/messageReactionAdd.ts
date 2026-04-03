import type { BotEvent } from '../types';
import settingsCache from '../utils/settingsCache';
import { logServerEvent } from '../utils/logger';
import isNetworkError from '../utils/isNetworkError';
import * as roleQueue from '../utils/roleQueue';
import { createTicketForUser } from '../commands/admin/ticket';
import antiReactionSpam from '../automod/modules/antiReactionSpam';
import { Routes } from '@fluxerjs/types';
import GlobalBanPrompt from '../models/GlobalBanPrompt';
import StarboardMessage from '../models/StarboardMessage';
import { PermissionFlags, EmbedBuilder } from '@fluxerjs/core';
import { getActiveStarboards, getStarEmoji, getStarColor } from '../utils/starboardBoards';
import { t, normalizeLocale } from '../i18n';
import { handlePaginatorReaction } from '../utils/reactionPaginator';
import { isReactionOnBotMessage } from '../utils/reactionLogFilter';

const EMOJI_APPLY = '✅';
const EMOJI_DECLINE = '❌';

function isCheckmarkEmoji(emoji: any): boolean {
  const raw = String(emoji?.name ?? '').trim();
  return raw === '✅' || raw.toLowerCase() === 'white_check_mark';
}

function reactionEmojiParam(reaction: any): string {
  return reaction?.emoji?.id
    ? `${reaction.emoji.name}:${reaction.emoji.id}`
    : String(reaction?.emoji?.name ?? '');
}

function normalizeStarEmoji(emoji: any): string {
  if (!emoji) return '';
  if (emoji.id) return `${emoji.name}:${emoji.id}`;
  return String(emoji.name ?? '').replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
}

function isStarEmojiMatch(reactionEmoji: any, boardEmoji: string): boolean {
  const incoming = normalizeStarEmoji(reactionEmoji);
  const target = String(boardEmoji ?? '⭐').trim();
  if (reactionEmoji?.id) {
    return incoming === target || `<:${incoming}>` === target || `<a:${incoming}>` === target;
  }
  return incoming === target.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
}

const event: BotEvent = {
  name: 'messageReactionAdd',

  async execute(...args: any[]) {
    const client = args[args.length - 1];
    const [reaction, user] = args;

    try {
      let guildId = reaction.guildId;
      if (!guildId && reaction.channelId) {
        try {
          const channel = client.channels?.get(reaction.channelId) || await client.channels?.fetch(reaction.channelId).catch(() => null);
          if (channel) guildId = (channel as any).guildId || (channel as any).guild_id || (channel as any).guild?.id;
        } catch {
        }
      }
      if (!guildId || user.bot) return;

      const guild = client.guilds.get(guildId);
      if (!guild) return;

      if (await handlePaginatorReaction(client, reaction, user)) {
        return;
      }

      const settings: any = await settingsCache.get(guild.id);
      if (!settings) return;

      const emojiName = reaction.emoji.id ? reaction.emoji.name : reaction.emoji.name ?? '';
      if (emojiName === EMOJI_APPLY || emojiName === EMOJI_DECLINE) {
        const prompt = await GlobalBanPrompt.findOne({ messageId: reaction.messageId, status: 'pending' }).lean();
        if (prompt && prompt.guildId === guild.id) {
          const member = guild.members?.get(user.id) || await guild.fetchMember(user.id).catch(() => null);
          if (member && (member.permissions?.has?.(PermissionFlags.ManageGuild) || member.permissions?.has?.(PermissionFlags.Administrator))) {
            const apply = emojiName === EMOJI_APPLY;
            await GlobalBanPrompt.updateOne(
              { messageId: reaction.messageId },
              { $set: { status: apply ? 'applied' : 'declined', decidedBy: user.id, decidedAt: new Date() } }
            );

            if (apply) {
              try {
                await client.rest.put(Routes.guildBan(guild.id, (prompt as any).bannedUserId), {
                  body: { reason: (prompt as any).banReason },
                });
              } catch {
              }
            }

            let decidedByName = (user as any).username ?? (user as any).global_name ?? user.id;
            try {
              const fetched = await client.users.fetch(user.id).catch(() => null);
              if (fetched) decidedByName = (fetched as any).username ?? (fetched as any).global_name ?? decidedByName;
            } catch {
            }

            try {
              const newEmbed = new EmbedBuilder()
                .setTitle('Global Ban - Decision Recorded')
                .setDescription(
                  apply
                    ? `**${decidedByName}** chose to apply this ban. The user has been banned.`
                    : `**${decidedByName}** chose to skip this ban. The user will not be banned here.`
                )
                .addFields(
                  { name: 'User', value: `<@${(prompt as any).bannedUserId}>`, inline: true },
                  { name: 'Decision', value: apply ? `${EMOJI_APPLY} Applied` : `${EMOJI_DECLINE} Skipped`, inline: true },
                )
                .setColor(apply ? 0xe74c3c : 0x95a5a6)
                .setTimestamp(new Date());

              await client.rest.patch(Routes.channelMessage(reaction.channelId, reaction.messageId), {
                body: { embeds: [newEmbed.toJSON()] },
              }).catch(() => {});
              await client.rest.delete(Routes.channelMessageReactions(reaction.channelId, reaction.messageId)).catch(() => {});
            } catch {
            }
          }
          return;
        }
      }

      const targetMessageIsBotAuthored = await isReactionOnBotMessage(client, reaction);
      if (!targetMessageIsBotAuthored) {
        const emojiDisplay = reaction.emoji.id
          ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
          : reaction.emoji.name;

        await logServerEvent(
          guild,
          'Reaction Added',
          0x3498db,
          [
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Emoji', value: emojiDisplay, inline: true },
            { name: 'Channel', value: `<#${reaction.channelId}>`, inline: true },
          ],
          client,
          {
            description: `[Jump to message](https://fluxer.app/channels/${reaction.guildId}/${reaction.channelId}/${reaction.messageId})`,
            footer: `Message ID: ${reaction.messageId}`,
            eventType: 'reaction_add',
          }
        ).catch(() => {});
      }

      if (settings.automod?.antiReactionSpam && settings.automod?.level && settings.automod.level !== 'off') {
        if (!settings.automod.exemptChannels?.includes(reaction.channelId)) {
          let isExempt = false;
          if (settings.automod.exemptRoles?.length > 0) {
            let member = guild.members?.get(user.id);
            if (!member) try { member = await guild.fetchMember(user.id); } catch {
            }
            if (member) {
              const memberRoleIds = member.roles?.roleIds ?? [];
              isExempt = memberRoleIds.some((id: string) => settings.automod.exemptRoles.includes(id));
            }
          }
          if (!isExempt) {
            const spamDetected = await antiReactionSpam.check(guild, user.id, reaction, client, settings);
            if (spamDetected) return;
          }
        }
      }

      const verification = settings.verification;
      if (
        verification?.enabled &&
        verification.panelMessageId &&
        verification.panelChannelId &&
        String(reaction.messageId) === String(verification.panelMessageId) &&
        String(reaction.channelId) === String(verification.panelChannelId) &&
        isCheckmarkEmoji(reaction.emoji)
      ) {
        try {
          const emojiParam = reactionEmojiParam(reaction);
          await client.rest.delete(`${Routes.channelMessageReaction(reaction.channelId, reaction.messageId, emojiParam)}/${user.id}`);
        } catch {
        }

        if (verification.verifiedRoleId) {
          let member = guild.members?.get(user.id);
          if (!member) try { member = await guild.fetchMember(user.id); } catch {
          }
          if (member) {
            const memberRoleIds = member.roles?.roleIds ?? [];
            if (memberRoleIds.includes(verification.verifiedRoleId)) return;
          }
        }

        try {
          const { generateCaptcha } = await import('../utils/captchaCard');
          const { verificationSessions } = await import('../commands/admin/verify');

          const lang = normalizeLocale(settings.language);
          const botId = client.user?.id;
          const everyoneRoleId = guild.id;

          let username = 'user';
          try {
            const fetched = await client.users.fetch(user.id);
            username = (fetched as any).username || 'user';
          } catch {
          }
          const safeName = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';

          const overwrites: any[] = [
            { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
            { id: user.id, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ReadMessageHistory), deny: '0' },
          ];
          if (botId) {
            overwrites.push({ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageChannels | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory), deny: '0' });
          }

          const channel = await guild.createChannel({
            type: 0,
            name: `verify-${safeName}`,
            parent_id: verification.categoryId,
            permission_overwrites: overwrites,
          });

          const { code, image } = await generateCaptcha();
          const maxAttempts = verification.maxAttempts || 2;

          const captchaEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'verification.captcha.title'))
            .setDescription(t(lang, 'verification.captcha.description', { userId: user.id, maxAttempts }))
            .setColor(0x5865F2)
            .setTimestamp(new Date());

          await channel.send({
            embeds: [captchaEmbed],
            files: [{ name: 'captcha.png', data: image }],
          });

          const timeout = setTimeout(async () => {
            verificationSessions.delete(channel.id);
            try { await channel.delete(); } catch {
            }
            try {
              const emojiParam = reactionEmojiParam(reaction);
              await client.rest.delete(`${Routes.channelMessageReaction(reaction.channelId, reaction.messageId, emojiParam)}/${user.id}`);
            } catch {
            }
          }, 60_000);

          verificationSessions.set(channel.id, {
            userId: user.id,
            code,
            attempts: 0,
            maxAttempts,
            panelChannelId: verification.panelChannelId,
            panelMessageId: verification.panelMessageId,
            timeout,
          });

          if (verification.logChannelId) {
            try {
              const logChannel = guild.channels?.get(verification.logChannelId) || await client.channels.fetch(verification.logChannelId).catch(() => null);
              if (logChannel) {
                const logEmbed = new EmbedBuilder()
                  .setTitle(t(lang, 'verification.log.startedTitle'))
                  .setDescription(t(lang, 'verification.log.startedDescription', { userId: user.id }))
                  .setColor(0xf39c12)
                  .setTimestamp(new Date());
                const logMsg = await logChannel.send({ embeds: [logEmbed] });
                setTimeout(() => logMsg.delete().catch(() => {}), 2000);
              }
            } catch {
            }
          }
        } catch (err: any) {
          console.error(`[verification] Failed to create verification channel: ${err.message}`);
        }

        return;
      }

      if (
        settings.ticketSetupMessageId &&
        settings.ticketSetupChannelId &&
        settings.ticketCategoryId &&
        reaction.messageId === settings.ticketSetupMessageId &&
        reaction.channelId === settings.ticketSetupChannelId
      ) {
        try {
          const emojiParam = reaction.emoji.id
            ? `${reaction.emoji.name}:${reaction.emoji.id}`
            : reaction.emoji.name;
          await client.rest.delete(`${Routes.channelMessageReaction(reaction.channelId, reaction.messageId, emojiParam)}/${user.id}`);
        } catch {
        }

        const lang = normalizeLocale(settings.language);
        const result = await createTicketForUser(guild, user.id, settings, client, undefined);

        if (result.success) {
          try {
            let setupChannel = guild.channels?.get(settings.ticketSetupChannelId);
            if (!setupChannel) {
              setupChannel = await client.channels.fetch(settings.ticketSetupChannelId).catch(() => null);
            }
            if (setupChannel) {
              const notice = await setupChannel.send({
                content: `<@${user.id}> ${t(lang, 'commands.admin.ticket.user.createdNotice', { channelId: result.channelId, ticketNumber: result.ticketNumber })}`
              });
              setTimeout(() => notice.delete().catch(() => {}), 5000);
            }
          } catch {
          }
        } else {
          try {
            let setupChannel = guild.channels?.get(settings.ticketSetupChannelId);
            if (!setupChannel) {
              setupChannel = await client.channels.fetch(settings.ticketSetupChannelId).catch(() => null);
            }
            if (setupChannel) {
              const notice = await setupChannel.send({
                content: `<@${user.id}> ${result.reason}`
              });
              setTimeout(() => notice.delete().catch(() => {}), 5000);
            }
          } catch {
          }
        }

        return;
      }

      const starboards = getActiveStarboards(settings);
      if (starboards.length > 0) {
        const origMsg: any = await client.rest.get(Routes.channelMessage(reaction.channelId, reaction.messageId)).catch(() => null);
        if (origMsg) {
          for (const board of starboards) {
            if (!board.enabled || !board.channelId) continue;
            if (!isStarEmojiMatch(reaction.emoji, board.emoji ?? '⭐')) continue;
            if (board.ignoredChannels?.includes(reaction.channelId)) continue;

            try {
              const authorId = origMsg.author?.id;
              if (board.ignoreBots !== false && origMsg.author?.bot) continue;
              if (!board.selfStarEnabled && authorId === user.id) continue;

              let hasIgnoredRole = false;
              if (board.ignoredRoles?.length > 0) {
                let reactorMember = guild.members?.get(user.id);
                if (!reactorMember) try { reactorMember = await guild.fetchMember(user.id); } catch {
                }
                if (reactorMember) {
                  const roleIds = reactorMember.roles?.roleIds ?? [];
                  hasIgnoredRole = roleIds.some((id: string) => board.ignoredRoles.includes(id));
                }
              }
              if (hasIgnoredRole) continue;

              const entry = await StarboardMessage.findOneAndUpdate(
                { guildId: guild.id, messageId: reaction.messageId, starboardChannelId: board.channelId },
                {
                  $setOnInsert: {
                    channelId: reaction.channelId,
                    authorId: authorId ?? 'unknown',
                    starboardChannelId: board.channelId,
                  },
                  $addToSet: { reactors: user.id },
                },
                { upsert: true, returnDocument: 'after' }
              );

              if (!entry) continue;
              entry.starCount = entry.reactors.length;
              if (!entry.starboardChannelId) entry.starboardChannelId = board.channelId;
              await entry.save();

              const threshold = board.threshold ?? 3;
              if (entry.starCount < threshold) continue;

              const content = origMsg.content?.length > 1024
                ? origMsg.content.substring(0, 1021) + '...'
                : (origMsg.content || '');
              const starEmoji = getStarEmoji(entry.starCount);
              const starColor = getStarColor(entry.starCount);

              const starEmbed = new EmbedBuilder()
                .setAuthor({
                  name: origMsg.author?.username ?? 'Unknown User',
                  iconURL: origMsg.author?.avatar
                    ? `https://fluxerusercontent.com/avatars/${origMsg.author.id}/${origMsg.author.avatar}.png`
                    : undefined,
                })
                .setColor(starColor)
                .setTimestamp(new Date(origMsg.timestamp ?? Date.now()));

              if (content) starEmbed.setDescription(content);

              starEmbed.addFields(
                { name: 'Source', value: `[Jump to message](https://fluxer.app/channels/${guild.id}/${reaction.channelId}/${reaction.messageId})`, inline: true },
                { name: 'Channel', value: `<#${reaction.channelId}>`, inline: true },
              );

              starEmbed.setFooter({ text: `ID: ${reaction.messageId}` });

              if (origMsg.attachments?.length > 0) {
                const img = origMsg.attachments.find((a: any) => a.content_type?.startsWith('image/'));
                if (img?.url) starEmbed.setImage(img.url);
              }

              const msgContent = `${starEmoji} **${entry.starCount}** | <#${reaction.channelId}>`;

              if (entry.starboardMessageId) {
                try {
                  await client.rest.patch(Routes.channelMessage(board.channelId, entry.starboardMessageId), {
                    body: { content: msgContent, embeds: [starEmbed.toJSON()] },
                  });
                } catch (editErr: any) {
                  if (editErr?.statusCode === 404) {
                    const newMsg = await client.rest.post(Routes.channelMessages(board.channelId), {
                      body: { content: msgContent, embeds: [starEmbed.toJSON()] },
                    }) as any;
                    if (newMsg?.id) {
                      entry.starboardMessageId = newMsg.id;
                      entry.starboardChannelId = board.channelId;
                      await entry.save();
                    }
                  }
                }
              } else {
                const newMsg = await client.rest.post(Routes.channelMessages(board.channelId), {
                  body: { content: msgContent, embeds: [starEmbed.toJSON()] },
                }) as any;
                if (newMsg?.id) {
                  entry.starboardMessageId = newMsg.id;
                  entry.starboardChannelId = board.channelId;
                  await entry.save();
                }
              }
            } catch (sbErr: any) {
              console.error(`[starboard] Error processing reaction add in ${guild.name}: ${sbErr.message}`);
            }
          }
        }
      }

      const reactionRoles = settings.reactionRoles;
      if (!reactionRoles || reactionRoles.length === 0) return;

      const reactionConfig = reactionRoles.find(
        (rr: any) => rr.messageId === reaction.messageId && rr.channelId === reaction.channelId
      );
      if (!reactionConfig) return;

      const stripVariationSelectors = (s: string): string => s.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
      const emojiIdentifier = reaction.emoji.id
        ? `${reaction.emoji.name}:${reaction.emoji.id}`
        : stripVariationSelectors(String(reaction.emoji.name ?? ''));

      const roleMapping = reactionConfig.roles.find((r: any) => r.emoji === emojiIdentifier);
      if (!roleMapping) return;

      let member = guild.members?.get(user.id);
      if (!member) {
        try {
          member = await guild.fetchMember(user.id);
        } catch {
          return;
        }
      }
      if (!member) return;

      let role = guild.roles?.get(roleMapping.roleId);
      if (!role) {
        try { await guild.fetchRoles(); role = guild.roles?.get(roleMapping.roleId); } catch {
        }
      }
      if (!role) {
        try { role = await guild.fetchRole(roleMapping.roleId); } catch {
        }
      }
      if (!role) return;

      try {
        const botMember = guild.members?.me;
        const targetRole = guild.roles?.get(roleMapping.roleId);
        if (botMember && targetRole) {
          let freshRoles: Map<string, number> | null = null;
          try {
            const rolesData = await client.rest.get(Routes.guildRoles(guild.id)) as any[];
            if (Array.isArray(rolesData)) {
              freshRoles = new Map(rolesData.map((r: any) => [r.id, r.position ?? 0]));
            }
          } catch {
          }
          const getPos = (id: string) => freshRoles?.get(id) ?? guild.roles?.get(id)?.position ?? 0;
          const botHighest = Math.max(0, ...(botMember.roles?.roleIds ?? []).map((id: string) => getPos(id)));
          if (getPos(roleMapping.roleId) >= botHighest) {
            console.warn(`[rr] Skipping role add in ${guild.name}: bot role is below ${targetRole.name}`);
            return;
          }
        }

        if (roleMapping.removeRoleId) {
          try {
            await member.removeRole(roleMapping.removeRoleId);
          } catch (err: any) {
            if (isNetworkError(err)) {
              roleQueue.enqueue(guild.id, user.id, roleMapping.removeRoleId, 'remove');
            } else {
              console.error(`Failed to remove switched role: ${err.message}`);
            }
          }
        }

        const rolesToAdd: string[] = roleMapping.roleIds?.length ? roleMapping.roleIds : [roleMapping.roleId];
        for (const rid of rolesToAdd) {
          try {
            await member.addRole(rid);
          } catch (error: any) {
            if (isNetworkError(error)) {
              roleQueue.enqueue(guild.id, user.id, rid, 'add');
            } else {
              console.error(`Failed to add reaction role ${rid}: ${error.message}`);
            }
          }
        }
      } catch (error: any) {
        if (isNetworkError(error)) {
          roleQueue.enqueue(guild.id, user.id, roleMapping.roleId, 'add');
        } else {
          console.error(`Failed to add reaction role: ${error.message}`);
        }
        return;
      }

      if (settings.reactionRoleDMEnabled) {
        let dmMsg = `You've been given the **${role.name}** role in **${guild.name}**.`;
        if (roleMapping.removeRoleId) {
          const removedRole = guild.roles?.get(roleMapping.removeRoleId);
          const removedName = removedRole?.name || roleMapping.removeRoleId;
          dmMsg = `Your role has been switched from **${removedName}** to **${role.name}** in **${guild.name}**.`;
        }
        user.send(dmMsg).catch(() => {});
      }
    } catch (error) {
      console.error('Error in messageReactionAdd event:', error);
    }
  }
};

export default event;
