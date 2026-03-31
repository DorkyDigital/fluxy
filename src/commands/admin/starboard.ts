import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import StarboardMessage from '../../models/StarboardMessage';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { EmbedBuilder } from '@fluxerjs/core';

function getStarEmoji(count: number): string {
  if (count >= 25) return '💫';
  if (count >= 10) return '🌟';
  return '⭐';
}

function getStarColor(count: number): number {
  if (count >= 25) return 0xe74c3c;
  if (count >= 10) return 0xe67e22;
  return 0xf1c40f;
}

const command: Command = {
  name: 'starboard',
  description: [
    'Configure the starboard system for your server.',
    'Subcommands: setup, threshold, emoji, toggle, selfstar, ignorechannel, ignorerole, settings, leaderboard, top, stats, force, remove',
  ],
  usage: '<subcommand> [args]',
  category: 'admin',
  aliases: ['sb'],
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply('This command can only be used in a server.');

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('⭐ Starboard Commands')
        .setColor(0xf1c40f)
        .setDescription(
          `Manage the starboard system that highlights popular messages.\n\n` +
          `**Configuration**\n` +
          `\`${prefix}starboard setup #channel\` - Set the starboard channel\n` +
          `\`${prefix}starboard threshold <number>\` - Set required star count\n` +
          `\`${prefix}starboard emoji <emoji>\` - Set the tracked emoji\n` +
          `\`${prefix}starboard toggle\` - Enable or disable starboard\n` +
          `\`${prefix}starboard selfstar\` - Toggle self-starring\n` +
          `\`${prefix}starboard ignorechannel #channel\` - Add/remove ignored channel\n` +
          `\`${prefix}starboard ignorerole @role\` - Add/remove ignored role\n` +
          `\`${prefix}starboard settings\` - View current configuration\n\n` +
          `**Stats & Leaderboard**\n` +
          `\`${prefix}starboard leaderboard\` - Top 10 most-starred messages\n` +
          `\`${prefix}starboard top\` - Top 10 users by total stars\n` +
          `\`${prefix}starboard stats\` - Overall starboard statistics\n\n` +
          `**Admin**\n` +
          `\`${prefix}starboard force <messageLink|messageId>\` - Force-add a message\n` +
          `\`${prefix}starboard remove <messageId>\` - Remove a message from starboard`
        )
        .setTimestamp(new Date());
      return void await message.reply({ embeds: [embed] });
    }

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);

      switch (sub) {
        case 'setup':
        case 'setchannel':
        case 'channel': {
          if (!args[1]) return void await message.reply(`Usage: \`${prefix}starboard setup #channel\``);

          const channelMention = args[1].match(/^<#(\d{17,19})>$/);
          let channelId: string;
          if (channelMention) channelId = channelMention[1];
          else if (/^\d{17,19}$/.test(args[1])) channelId = args[1];
          else return void await message.reply('Please provide a valid channel mention or ID.');

          let channel: any = guild.channels?.get(channelId);
          if (!channel) {
            try { channel = await client.channels.fetch(channelId); } catch {
              return void await message.reply('That channel does not exist in this server.');
            }
          }
          if (!channel) return void await message.reply('That channel does not exist in this server.');

          if (!settings.starboard) settings.starboard = {};
          settings.starboard.channelId = channelId;
          settings.starboard.enabled = true;
          settings.markModified('starboard');
          await settings.save();
          settingsCache.invalidate(guild.id);

          const embed = new EmbedBuilder()
            .setTitle('⭐ Starboard Channel Set')
            .setDescription(`Starboard channel has been set to <#${channelId}> and the starboard is now **enabled**.`)
            .setColor(0xf1c40f)
            .addFields(
              { name: 'Threshold', value: `${settings.starboard.threshold ?? 3} reactions`, inline: true },
              { name: 'Emoji', value: settings.starboard.emoji ?? '⭐', inline: true },
            )
            .setTimestamp(new Date());
          return void await message.reply({ embeds: [embed] });
        }

        case 'threshold': {
          const num = parseInt(args[1], 10);
          if (!args[1] || isNaN(num) || num < 1 || num > 100) {
            return void await message.reply(`Usage: \`${prefix}starboard threshold <1-100>\`\nCurrent: **${settings.starboard?.threshold ?? 3}**`);
          }
          if (!settings.starboard) settings.starboard = {};
          settings.starboard.threshold = num;
          settings.markModified('starboard');
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(`⭐ Starboard threshold set to **${num}** reaction(s).`);
        }

        case 'emoji': {
          if (!args[1]) {
            return void await message.reply(`Usage: \`${prefix}starboard emoji <emoji>\`\nCurrent: **${settings.starboard?.emoji ?? '⭐'}**`);
          }
          const rawEmoji = args[1].trim();
          if (!settings.starboard) settings.starboard = {};
          settings.starboard.emoji = rawEmoji;
          settings.markModified('starboard');
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(`⭐ Starboard emoji set to ${rawEmoji}`);
        }

        case 'toggle':
        case 'enable':
        case 'disable': {
          if (!settings.starboard) settings.starboard = {};
          if (sub === 'enable') {
            settings.starboard.enabled = true;
          } else if (sub === 'disable') {
            settings.starboard.enabled = false;
          } else {
            settings.starboard.enabled = !settings.starboard.enabled;
          }
          settings.markModified('starboard');
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(`⭐ Starboard is now **${settings.starboard.enabled ? 'enabled' : 'disabled'}**.`);
        }

        case 'selfstar': {
          if (!settings.starboard) settings.starboard = {};
          settings.starboard.selfStarEnabled = !settings.starboard.selfStarEnabled;
          settings.markModified('starboard');
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(`⭐ Self-starring is now **${settings.starboard.selfStarEnabled ? 'enabled' : 'disabled'}**.`);
        }

        case 'ignorechannel': {
          if (!args[1]) return void await message.reply(`Usage: \`${prefix}starboard ignorechannel #channel\``);
          const channelMention = args[1].match(/^<#(\d{17,19})>$/);
          let channelId: string;
          if (channelMention) channelId = channelMention[1];
          else if (/^\d{17,19}$/.test(args[1])) channelId = args[1];
          else return void await message.reply('Please provide a valid channel mention or ID.');

          if (!settings.starboard) settings.starboard = {};
          if (!settings.starboard.ignoredChannels) settings.starboard.ignoredChannels = [];

          const idx = settings.starboard.ignoredChannels.indexOf(channelId);
          if (idx === -1) {
            settings.starboard.ignoredChannels.push(channelId);
            settings.markModified('starboard');
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(`⭐ <#${channelId}> is now **ignored** by the starboard.`);
          } else {
            settings.starboard.ignoredChannels.splice(idx, 1);
            settings.markModified('starboard');
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(`⭐ <#${channelId}> is no longer ignored by the starboard.`);
          }
        }

        case 'ignorerole': {
          if (!args[1]) return void await message.reply(`Usage: \`${prefix}starboard ignorerole @role\``);
          const roleMention = args[1].match(/^<@&(\d{17,19})>$/);
          let roleId: string;
          if (roleMention) roleId = roleMention[1];
          else if (/^\d{17,19}$/.test(args[1])) roleId = args[1];
          else return void await message.reply('Please provide a valid role mention or ID.');

          if (!settings.starboard) settings.starboard = {};
          if (!settings.starboard.ignoredRoles) settings.starboard.ignoredRoles = [];

          const idx = settings.starboard.ignoredRoles.indexOf(roleId);
          if (idx === -1) {
            settings.starboard.ignoredRoles.push(roleId);
            settings.markModified('starboard');
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(`⭐ <@&${roleId}> is now **excluded** from starring.`);
          } else {
            settings.starboard.ignoredRoles.splice(idx, 1);
            settings.markModified('starboard');
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(`⭐ <@&${roleId}> can now star messages again.`);
          }
        }

        case 'settings':
        case 'config':
        case 'info': {
          const sb = settings.starboard || {};
          const embed = new EmbedBuilder()
            .setTitle('⭐ Starboard Configuration')
            .setColor(0xf1c40f)
            .addFields(
              { name: 'Status', value: sb.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
              { name: 'Channel', value: sb.channelId ? `<#${sb.channelId}>` : 'Not set', inline: true },
              { name: 'Threshold', value: `${sb.threshold ?? 3} reactions`, inline: true },
              { name: 'Emoji', value: sb.emoji ?? '⭐', inline: true },
              { name: 'Self-Star', value: sb.selfStarEnabled ? 'Allowed' : 'Not allowed', inline: true },
              { name: 'Ignore Bots', value: sb.ignoreBots !== false ? 'Yes' : 'No', inline: true },
              {
                name: 'Ignored Channels',
                value: sb.ignoredChannels?.length > 0
                  ? sb.ignoredChannels.map((id: string) => `<#${id}>`).join(', ')
                  : 'None',
              },
              {
                name: 'Ignored Roles',
                value: sb.ignoredRoles?.length > 0
                  ? sb.ignoredRoles.map((id: string) => `<@&${id}>`).join(', ')
                  : 'None',
              },
            )
            .setTimestamp(new Date());
          return void await message.reply({ embeds: [embed] });
        }

        case 'leaderboard':
        case 'lb': {
          const entries = await StarboardMessage.find({ guildId: guild.id, starCount: { $gt: 0 } })
            .sort({ starCount: -1 })
            .limit(10)
            .lean();

          if (entries.length === 0) {
            return void await message.reply('No starred messages yet!');
          }

          const lines = entries.map((e: any, i: number) => {
            const emoji = getStarEmoji(e.starCount);
            return `**${i + 1}.** ${emoji} **${e.starCount}** - <@${e.authorId}> in <#${e.channelId}>\n[Jump to message](https://fluxer.app/channels/${guild.id}/${e.channelId}/${e.messageId})`;
          });

          const embed = new EmbedBuilder()
            .setTitle('⭐ Starboard Leaderboard')
            .setDescription(lines.join('\n\n'))
            .setColor(0xf1c40f)
            .setFooter({ text: `Top ${entries.length} starred messages` })
            .setTimestamp(new Date());
          return void await message.reply({ embeds: [embed] });
        }

        case 'top':
        case 'topusers': {
          const pipeline = await StarboardMessage.aggregate([
            { $match: { guildId: guild.id, starCount: { $gt: 0 } } },
            { $group: { _id: '$authorId', totalStars: { $sum: '$starCount' }, messageCount: { $sum: 1 } } },
            { $sort: { totalStars: -1 } },
            { $limit: 10 },
          ]);

          if (pipeline.length === 0) {
            return void await message.reply('No starred messages yet!');
          }

          const lines = pipeline.map((e: any, i: number) => {
            const emoji = getStarEmoji(e.totalStars);
            return `**${i + 1}.** ${emoji} **${e.totalStars}** stars across **${e.messageCount}** message(s) - <@${e._id}>`;
          });

          const embed = new EmbedBuilder()
            .setTitle('⭐ Top Starred Users')
            .setDescription(lines.join('\n'))
            .setColor(0xf1c40f)
            .setFooter({ text: `Top ${pipeline.length} users by total stars received` })
            .setTimestamp(new Date());
          return void await message.reply({ embeds: [embed] });
        }

        case 'stats': {
          const totalEntries = await StarboardMessage.countDocuments({ guildId: guild.id });
          const totalStarsResult = await StarboardMessage.aggregate([
            { $match: { guildId: guild.id } },
            { $group: { _id: null, total: { $sum: '$starCount' } } },
          ]);
          const totalStars = totalStarsResult[0]?.total ?? 0;
          const postedCount = await StarboardMessage.countDocuments({ guildId: guild.id, starboardMessageId: { $ne: null } });

          const embed = new EmbedBuilder()
            .setTitle('⭐ Starboard Statistics')
            .setColor(0xf1c40f)
            .addFields(
              { name: 'Tracked Messages', value: `${totalEntries}`, inline: true },
              { name: 'Total Stars', value: `${totalStars}`, inline: true },
              { name: 'Posted to Starboard', value: `${postedCount}`, inline: true },
            )
            .setTimestamp(new Date());
          return void await message.reply({ embeds: [embed] });
        }

        case 'force': {
          if (!args[1]) return void await message.reply(`Usage: \`${prefix}starboard force <messageLink|messageId> [channelId]\``);

          const sb = settings.starboard || {};
          if (!sb.channelId) return void await message.reply('No starboard channel is set. Use `' + prefix + 'starboard setup #channel` first.');

          let targetChannelId: string | null = null;
          let targetMessageId: string;

          const linkMatch = args[1].match(/channels\/(\d{17,19})\/(\d{17,19})\/(\d{17,19})$/);
          if (linkMatch) {
            targetChannelId = linkMatch[2];
            targetMessageId = linkMatch[3];
          } else if (/^\d{17,19}$/.test(args[1])) {
            targetMessageId = args[1];
            targetChannelId = args[2]?.match(/^<#(\d{17,19})>$/)?.[1] || args[2] || (message as any).channelId;
          } else {
            return void await message.reply('Please provide a valid message link or message ID.');
          }

          if (!targetChannelId) return void await message.reply('Could not determine the channel. Provide a message link or include the channel.');

          try {
            const { Routes } = await import('@fluxerjs/types');
            const msgData = await client.rest.get(Routes.channelMessage(targetChannelId, targetMessageId)) as any;
            if (!msgData?.id) return void await message.reply('Could not fetch that message.');

            const content = msgData.content?.length > 1024
              ? msgData.content.substring(0, 1021) + '...'
              : (msgData.content || '*(no text content)*');

            const starEmoji = getStarEmoji(sb.threshold ?? 3);
            const starColor = getStarColor(sb.threshold ?? 3);

            const starEmbed = new EmbedBuilder()
              .setAuthor({
                name: msgData.author?.username ?? 'Unknown User',
                iconURL: msgData.author?.avatar
                  ? `https://fluxerusercontent.com/avatars/${msgData.author.id}/${msgData.author.avatar}.png`
                  : undefined,
              })
              .setDescription(content)
              .addFields(
                { name: 'Source', value: `[Jump to message](https://fluxer.app/channels/${guild.id}/${targetChannelId}/${targetMessageId})`, inline: true },
                { name: 'Channel', value: `<#${targetChannelId}>`, inline: true },
              )
              .setColor(starColor)
              .setFooter({ text: `${starEmoji} Manually added | ID: ${targetMessageId}` })
              .setTimestamp(new Date(msgData.timestamp ?? Date.now()));

            if (msgData.attachments?.length > 0) {
              const img = msgData.attachments.find((a: any) => a.content_type?.startsWith('image/'));
              if (img?.url) starEmbed.setImage(img.url);
            }

            const starboardMsg = await client.rest.post(Routes.channelMessages(sb.channelId), {
              body: {
                content: `${starEmoji} **Manually Added** | <#${targetChannelId}>`,
                embeds: [starEmbed.toJSON()],
              },
            }) as any;

            await StarboardMessage.findOneAndUpdate(
              { guildId: guild.id, messageId: targetMessageId },
              {
                $set: {
                  channelId: targetChannelId,
                  authorId: msgData.author?.id ?? 'unknown',
                  starboardMessageId: starboardMsg?.id ?? null,
                  starCount: sb.threshold ?? 3,
                },
                $setOnInsert: { reactors: [] },
              },
              { upsert: true, returnDocument: 'after' }
            );

            return void await message.reply(`⭐ Message has been force-added to the starboard!`);
          } catch (err: any) {
            return void await message.reply(`Failed to force-add message: ${err.message || 'Unknown error'}`);
          }
        }

        case 'remove':
        case 'delete': {
          if (!args[1]) return void await message.reply(`Usage: \`${prefix}starboard remove <messageId>\``);
          if (!/^\d{17,19}$/.test(args[1])) return void await message.reply('Please provide a valid message ID.');

          const entry = await StarboardMessage.findOne({ guildId: guild.id, messageId: args[1] });
          if (!entry) return void await message.reply('That message is not in the starboard.');

          if (entry.starboardMessageId && settings.starboard?.channelId) {
            try {
              const { Routes } = await import('@fluxerjs/types');
              await client.rest.delete(Routes.channelMessage(settings.starboard.channelId, entry.starboardMessageId));
            } catch { }
          }

          await StarboardMessage.deleteOne({ _id: entry._id });
          return void await message.reply('⭐ Message has been removed from the starboard.');
        }

        default:
          return void await message.reply(`Unknown subcommand. Use \`${prefix}starboard help\` for a list of commands.`);
      }
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !starboard (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !starboard: ${error.message || error}`);
        message.reply('An error occurred while executing the starboard command.').catch(() => { });
      }
    }
  }
};

export default command;
