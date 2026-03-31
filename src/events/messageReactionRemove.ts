import type { BotEvent } from '../types';
import settingsCache from '../utils/settingsCache';
import { logServerEvent } from '../utils/logger';
import isNetworkError from '../utils/isNetworkError';
import * as roleQueue from '../utils/roleQueue';
import StarboardMessage from '../models/StarboardMessage';
import { Routes } from '@fluxerjs/types';
import { EmbedBuilder } from '@fluxerjs/core';

const event: BotEvent = {
  name: 'messageReactionRemove',

  async execute(...args: any[]) {
    const client = args[args.length - 1];
    const [reaction, user] = args;
    try {
      if (!reaction.guildId) return;
      if (user.bot) return;

      const guild = client.guilds.get(reaction.guildId);
      if (!guild) return;

      const settings: any = await settingsCache.get(guild.id);
      if (!settings) return;

      const emojiDisplay = reaction.emoji.id
        ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
        : reaction.emoji.name;

      await logServerEvent(
        guild,
        'Reaction Removed',
        0x95a5a6,
        [
          { name: 'User', value: `<@${user.id}>`, inline: true },
          { name: 'Emoji', value: emojiDisplay, inline: true },
          { name: 'Channel', value: `<#${reaction.channelId}>`, inline: true },
        ],
        client,
        {
          description: `[Jump to message](https://fluxer.app/channels/${reaction.guildId}/${reaction.channelId}/${reaction.messageId})`,
          footer: `Message ID: ${reaction.messageId}`,
          eventType: 'reaction_remove',
        }
      ).catch(() => { });

      const starboard = (settings as any).starboard;
      if (starboard?.enabled && starboard?.channelId) {
        const starEmojiRaw = reaction.emoji.id
          ? `${reaction.emoji.name}:${reaction.emoji.id}`
          : String(reaction.emoji.name ?? '');
        const configEmoji = starboard.emoji ?? '⭐';
        const stripVS = (s: string) => s.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();

        const emojiMatches = reaction.emoji.id
          ? (starEmojiRaw === configEmoji || `<:${starEmojiRaw}>` === configEmoji || `<a:${starEmojiRaw}>` === configEmoji)
          : (stripVS(starEmojiRaw) === stripVS(configEmoji));

        if (emojiMatches) {
          try {
            const entry = await StarboardMessage.findOne({ guildId: guild.id, messageId: reaction.messageId });
            if (entry) {
              entry.reactors = entry.reactors.filter((id: string) => id !== user.id);
              entry.starCount = entry.reactors.length;
              await entry.save();

              const threshold = starboard.threshold ?? 3;
              if (entry.starCount < threshold) {
                if (entry.starboardMessageId) {
                  try {
                    await client.rest.delete(Routes.channelMessage(starboard.channelId, entry.starboardMessageId));
                  } catch { }
                  entry.starboardMessageId = null;
                  await entry.save();
                }
              } else if (entry.starboardMessageId) {
                try {
                  const origMsg = await client.rest.get(Routes.channelMessage(reaction.channelId, reaction.messageId)) as any;
                  if (origMsg) {
                    const getStarEmoji = (c: number) => c >= 25 ? '💫' : c >= 10 ? '🌟' : '⭐';
                    const getStarColor = (c: number) => c >= 25 ? 0xe74c3c : c >= 10 ? 0xe67e22 : 0xf1c40f;

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

                    await client.rest.patch(Routes.channelMessage(starboard.channelId, entry.starboardMessageId), {
                      body: {
                        content: `${starEmoji} **${entry.starCount}** | <#${reaction.channelId}>`,
                        embeds: [starEmbed.toJSON()],
                      },
                    });
                  }
                } catch { }
              }
            }
          } catch (sbErr: any) {
            console.error(`[starboard] Error processing reaction remove in ${guild.name}: ${sbErr.message}`);
          }
        }
      }

      const reactionRoles = settings.reactionRoles;
      if (!reactionRoles || reactionRoles.length === 0) return;

      const reactionConfig = reactionRoles.find(
        (rr: any) => rr.messageId === reaction.messageId && rr.channelId === reaction.channelId
      );
      if (!reactionConfig) return;

      const emojiIdentifier = reaction.emoji.id
        ? `${reaction.emoji.name}:${reaction.emoji.id}`
        : reaction.emoji.name;

      const roleMapping = reactionConfig.roles.find(
        (r: any) => r.emoji === emojiIdentifier
      );
      if (!roleMapping) return;

      let member = guild.members?.get(user.id);
      if (!member) {
        try {
          member = await guild.fetchMember(user.id);
        } catch (error: any) {
          if (error?.code === 'MEMBER_NOT_FOUND' || error?.cause?.code === 'UNKNOWN_MEMBER') return;
          console.error('Failed to fetch member:', error);
          return;
        }
      }
      if (!member) return;

      const role = guild.roles?.get(roleMapping.roleId);

      try {
        if (roleMapping.removeRoleId) {
          try {
            await member.addRole(roleMapping.removeRoleId);
          } catch (err: any) {
            if (isNetworkError(err)) {
              roleQueue.enqueue(guild.id, user.id, roleMapping.removeRoleId, 'add');
            } else {
              console.error(`Failed to re-add switched role: ${err.message}`);
            }
          }
        }

        const rolesToRemove: string[] = roleMapping.roleIds?.length ? roleMapping.roleIds : [roleMapping.roleId];
        for (const rid of rolesToRemove) {
          try {
            await member.removeRole(rid);
          } catch (error: any) {
            if (isNetworkError(error)) {
              roleQueue.enqueue(guild.id, user.id, rid, 'remove');
            } else {
              console.error(`Failed to remove reaction role ${rid}: ${error.message}`);
            }
          }
        }
      } catch (error: any) {
        if (isNetworkError(error)) {
          roleQueue.enqueue(guild.id, user.id, roleMapping.roleId, 'remove');
        } else {
          console.error(`Failed to remove reaction role: ${error.message}`);
        }
        return;
      }

      if (settings.reactionRoleDMEnabled) {
        const roleName = role ? role.name : roleMapping.roleId;
        let dmMsg = `The **${roleName}** role has been removed in **${guild.name}**.`;
        if (roleMapping.removeRoleId) {
          const restoredRole = guild.roles?.get(roleMapping.removeRoleId);
          const restoredName = restoredRole?.name || roleMapping.removeRoleId;
          dmMsg = `Your role has been switched back from **${roleName}** to **${restoredName}** in **${guild.name}**.`;
        }
        user.send(dmMsg).catch(() => { });
      }

    } catch (error) {
      console.error('Error in messageReactionRemove event:', error);
    }
  }
};

export default event;
