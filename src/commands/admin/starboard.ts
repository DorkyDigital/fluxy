import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import StarboardMessage from '../../models/StarboardMessage';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { EmbedBuilder, PermissionFlags } from '@erinjs/core';
import { t, normalizeLocale } from '../../i18n';
import { getStarboards, getStarEmoji, getStarColor } from '../../utils/starboardBoards';

async function isStarboardAdmin(message: any, guild: any): Promise<boolean> {
  let member = guild.members?.get(message.author.id);
  if (!member) {
    try { member = await guild.fetchMember(message.author.id); } catch {}
  }
  if (!member) return false;
  return Boolean(
    member.permissions?.has(PermissionFlags.ManageGuild) ||
    member.permissions?.has(PermissionFlags.Administrator)
  );
}

function parseChannelId(raw?: string): string | null {
  if (!raw) return null;
  const mention = raw.match(/^<#(\d{17,19})>$/);
  if (mention) return mention[1];
  if (/^\d{17,19}$/.test(raw)) return raw;
  return null;
}

function normalizeBoards(settings: any) {
  const boards = getStarboards(settings);
  settings.starboards = boards;
  settings.starboard = boards[0] || {};
  return boards;
}

function saveBoards(settings: any, boards: any[]) {
  settings.starboards = boards.slice(0, 3);
  settings.starboard = settings.starboards[0] || {};
  settings.markModified('starboards');
  settings.markModified('starboard');
}

function findBoard(boards: any[], channelId?: string | null) {
  if (channelId) return boards.find(b => b.channelId === channelId) || null;
  if (boards.length === 1) return boards[0];
  return null;
}

const command: Command = {
  name: 'starboard',
  description: [
    'Configure up to three starboards for your server.',
    'Subcommands: setup, threshold, emoji, toggle, selfstar, ignorechannel, ignorerole, settings, leaderboard, top, stats, force, remove',
  ],
  usage: '<subcommand> [args]',
  category: 'info',
  aliases: ['sb'],
  permissions: [],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.admin.starboard.serverOnly'));

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'help') {
      const usageStr = `\`${prefix}starboard <subcommand> [args]\``;
      const publicSubs = [
        `\`${prefix}starboard leaderboard [#board]\``,
        `\`${prefix}starboard top [#board]\``,
        `\`${prefix}starboard stats [#board]\``,
      ];
      const adminSubs = [
        `\`${prefix}starboard setup #channel\``,
        `\`${prefix}starboard threshold <1-100> [#board]\``,
        `\`${prefix}starboard emoji <emoji> [#board]\``,
        `\`${prefix}starboard toggle [#board]\``,
        `\`${prefix}starboard selfstar [#board]\``,
        `\`${prefix}starboard ignorechannel #channel [#board]\``,
        `\`${prefix}starboard ignorerole @role [#board]\``,
        `\`${prefix}starboard settings\``,
        `\`${prefix}starboard force <messageLink|messageId> [channelId]\``,
        `\`${prefix}starboard remove <messageId> [#board]\``,
      ];

      const embed = new EmbedBuilder()
        .setTitle(t('en', 'commands.admin.starboard.help.title'))
        .setColor(0xf1c40f)
        .setDescription(t('en', 'commands.admin.starboard.help.description'))
        .addFields(
          { name: t('en', 'commands.admin.starboard.help.fieldUsage'), value: usageStr, inline: false },
          { name: t('en', 'commands.admin.starboard.help.fieldAliases'), value: t('en', 'auditCatalog.commands.admin.starboard.l95_addFields_value'), inline: true },
          { name: t('en', 'commands.admin.starboard.help.fieldCooldown'), value: t('en', 'auditCatalog.commands.admin.starboard.l96_addFields_value'), inline: true },
          { name: t('en', 'commands.admin.starboard.help.fieldPublic'), value: publicSubs.join('\n'), inline: false },
          { name: t('en', 'commands.admin.starboard.help.fieldAdmin'), value: adminSubs.join('\n'), inline: false },
        )
      return void await message.reply({ embeds: [embed] });
    }

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);
      let boards = normalizeBoards(settings);
      const needsAdmin = ![
        'leaderboard',
        'lb',
        'top',
        'topusers',
        'stats',
      ].includes(sub);

      if (needsAdmin) {
        const ok = await isStarboardAdmin(message, guild);
        if (!ok) {
          return void await message.reply(t(lang, 'commands.admin.starboard.adminRequired'));
        }
      }

      switch (sub) {
        case 'setup':
        case 'setchannel':
        case 'channel': {
          const channelId = parseChannelId(args[1]);
          if (!channelId) return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));

          let channel: any = guild.channels?.get(channelId);
          if (!channel) {
            try { channel = await client.channels.fetch(channelId); } catch {
              return void await message.reply(t(lang, 'commands.admin.starboard.setup.channelDoesNotExist'));
            }
          }
          if (!channel) return void await message.reply(t(lang, 'commands.admin.starboard.setup.channelDoesNotExist'));

          const existing = boards.find((b: any) => b.channelId === channelId);
          if (!existing && boards.length >= 3) {
            return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l139_reply'));
          }

          if (existing) {
            existing.channelId = channelId;
            existing.enabled = true;
          } else {
            const defaults = boards[0] || settings.starboard || {};
            boards.push({
              enabled: true,
              channelId,
              threshold: defaults.threshold ?? 3,
              emoji: defaults.emoji ?? '⭐',
              selfStarEnabled: defaults.selfStarEnabled ?? false,
              ignoreBots: defaults.ignoreBots ?? true,
              ignoredChannels: [],
              ignoredRoles: [],
            });
          }

          saveBoards(settings, boards);
          await settings.save();
          settingsCache.invalidate(guild.id);
          boards = normalizeBoards(settings);

          const board = boards.find((b: any) => b.channelId === channelId) || boards[0];

          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.starboard.setup.title'))
            .setDescription(t(lang, 'commands.admin.starboard.setup.description', { channelId }))
            .setColor(0xf1c40f)
            .addFields(
              { name: t(lang, 'commands.admin.starboard.setup.fieldThreshold'), value: t(lang, 'commands.admin.starboard.setup.thresholdReactions', { threshold: board?.threshold ?? 3 }), inline: true },
              { name: t(lang, 'commands.admin.starboard.setup.fieldEmoji'), value: board?.emoji ?? '⭐', inline: true },
            )
          return void await message.reply({ embeds: [embed] });
        }

        case 'threshold': {
          const tokens = args.slice(1);
          let targetChannelId: string | null = null;
          let thresholdInput: string | undefined;

          for (const token of tokens) {
            const cid = parseChannelId(token);
            if (cid) {
              targetChannelId = cid;
              continue;
            }
            if (!thresholdInput) thresholdInput = token;
          }

          const num = parseInt(thresholdInput ?? '', 10);
          const currentBoard = findBoard(boards, targetChannelId);

          if (!thresholdInput || isNaN(num) || num < 1 || num > 100) {
            const current = currentBoard?.threshold ?? boards[0]?.threshold ?? 3;
            return void await message.reply(t(lang, 'commands.admin.starboard.threshold.usage', { prefix, current }));
          }

          const board = findBoard(boards, targetChannelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          board.threshold = num;
          saveBoards(settings, boards);
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(t(lang, 'commands.admin.starboard.threshold.setDone', { threshold: num }));
        }

        case 'emoji': {
          const tokens = args.slice(1);
          let targetChannelId: string | null = null;
          let rawEmoji: string | undefined;

          for (const token of tokens) {
            const cid = parseChannelId(token);
            if (cid) {
              targetChannelId = cid;
              continue;
            }
            if (!rawEmoji) rawEmoji = token;
          }

          if (!rawEmoji) {
            const current = findBoard(boards, targetChannelId)?.emoji ?? boards[0]?.emoji ?? '⭐';
            return void await message.reply(t(lang, 'commands.admin.starboard.emoji.usage', { prefix, currentEmoji: current }));
          }

          const board = findBoard(boards, targetChannelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          board.emoji = rawEmoji.trim();
          saveBoards(settings, boards);
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(t(lang, 'commands.admin.starboard.emoji.setDone', { emoji: board.emoji }));
        }

        case 'toggle':
        case 'enable':
        case 'disable': {
          const channelId = parseChannelId(args[1]);
          const board = findBoard(boards, channelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          if (sub === 'enable') board.enabled = true;
          else if (sub === 'disable') board.enabled = false;
          else board.enabled = !board.enabled;

          saveBoards(settings, boards);
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(t(lang, 'commands.admin.starboard.toggle.setDone', { status: board.enabled ? 'enabled' : 'disabled' }));
        }

        case 'selfstar': {
          const channelId = parseChannelId(args[1]);
          const board = findBoard(boards, channelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          board.selfStarEnabled = !board.selfStarEnabled;
          saveBoards(settings, boards);
          await settings.save();
          settingsCache.invalidate(guild.id);
          return void await message.reply(t(lang, 'commands.admin.starboard.selfstar.setDone', { status: board.selfStarEnabled ? 'enabled' : 'disabled' }));
        }

        case 'ignorechannel': {
          const targetChannelId = parseChannelId(args[1]);
          const boardChannelId = parseChannelId(args[2]);
          if (!targetChannelId) return void await message.reply(t(lang, 'commands.admin.starboard.ignorechannel.usage', { prefix }));

          const board = findBoard(boards, boardChannelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          if (!board.ignoredChannels) board.ignoredChannels = [];

          const idx = board.ignoredChannels.indexOf(targetChannelId);
          if (idx === -1) {
            board.ignoredChannels.push(targetChannelId);
            saveBoards(settings, boards);
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(t(lang, 'commands.admin.starboard.ignorechannel.nowIgnored', { channelId: targetChannelId }));
          } else {
            board.ignoredChannels.splice(idx, 1);
            saveBoards(settings, boards);
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(t(lang, 'commands.admin.starboard.ignorechannel.noLongerIgnored', { channelId: targetChannelId }));
          }
        }

        case 'ignorerole': {
          if (!args[1]) return void await message.reply(t(lang, 'commands.admin.starboard.ignorerole.usage', { prefix }));
          const roleMention = args[1].match(/^<@&(\d{17,19})>$/);
          let roleId: string;
          if (roleMention) roleId = roleMention[1];
          else if (/^\d{17,19}$/.test(args[1])) roleId = args[1];
          else return void await message.reply(t(lang, 'commands.admin.starboard.ignorerole.invalidRole'));

          const boardChannelId = parseChannelId(args[2]);
          const board = findBoard(boards, boardChannelId);
          if (!board) {
            if (boards.length > 1) return void await message.reply(t(lang, 'auditCatalog.commands.admin.starboard.l201_reply'));
            return void await message.reply(t(lang, 'commands.admin.starboard.setup.usage', { prefix }));
          }

          if (!board.ignoredRoles) board.ignoredRoles = [];

          const idx = board.ignoredRoles.indexOf(roleId);
          if (idx === -1) {
            board.ignoredRoles.push(roleId);
            saveBoards(settings, boards);
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(t(lang, 'commands.admin.starboard.ignorerole.nowExcluded', { roleId }));
          } else {
            board.ignoredRoles.splice(idx, 1);
            saveBoards(settings, boards);
            await settings.save();
            settingsCache.invalidate(guild.id);
            return void await message.reply(t(lang, 'commands.admin.starboard.ignorerole.canStarAgain', { roleId }));
          }
        }

        case 'settings':
        case 'config':
        case 'info': {
          if (boards.length === 0) {
            return void await message.reply(t(lang, 'commands.admin.starboard.settings.notSet'));
          }

          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.starboard.settings.title'))
            .setColor(0xf1c40f)

          for (const board of boards) {
            const ignoredChannels = board.ignoredChannels?.length
              ? board.ignoredChannels.map((id: string) => `<#${id}>`).join(', ')
              : t(lang, 'commands.admin.starboard.settings.none');
            const ignoredRoles = board.ignoredRoles?.length
              ? board.ignoredRoles.map((id: string) => `<@&${id}>`).join(', ')
              : t(lang, 'commands.admin.starboard.settings.none');

            const lines = [
              `${t(lang, 'commands.admin.starboard.settings.status')}: ${board.enabled ? t(lang, 'commands.admin.starboard.settings.enabled') : t(lang, 'commands.admin.starboard.settings.disabled')}`,
              `${t(lang, 'commands.admin.starboard.settings.channel')}: ${board.channelId ? `<#${board.channelId}>` : t(lang, 'commands.admin.starboard.settings.notSet')}`,
              `${t(lang, 'commands.admin.starboard.settings.threshold')}: ${t(lang, 'commands.admin.starboard.settings.thresholdReactions', { threshold: board.threshold ?? 3 })}`,
              `${t(lang, 'commands.admin.starboard.settings.emoji')}: ${board.emoji ?? '⭐'}`,
              `${t(lang, 'commands.admin.starboard.settings.selfStar')}: ${board.selfStarEnabled ? t(lang, 'commands.admin.starboard.settings.allowed') : t(lang, 'commands.admin.starboard.settings.notAllowed')}`,
              `${t(lang, 'commands.admin.starboard.settings.ignoreBots')}: ${board.ignoreBots !== false ? t(lang, 'commands.admin.starboard.settings.yes') : t(lang, 'commands.admin.starboard.settings.no')}`,
              `${t(lang, 'commands.admin.starboard.settings.ignoredChannels')}: ${ignoredChannels}`,
              `${t(lang, 'commands.admin.starboard.settings.ignoredRoles')}: ${ignoredRoles}`,
            ].join('\n');

            embed.addFields({
              name: board.channelId ? `<#${board.channelId}>` : t(lang, 'commands.admin.starboard.settings.notSet'),
              value: lines,
              inline: false,
            });
          }

          return void await message.reply({ embeds: [embed] });
        }

        case 'leaderboard':
        case 'lb': {
          const boardChannelId = parseChannelId(args[1]);
          const query: any = { guildId: guild.id, starCount: { $gt: 0 } };
          if (boardChannelId) query.starboardChannelId = boardChannelId;

          const entries = await StarboardMessage.find(query)
            .sort({ starCount: -1 })
            .limit(10)
            .lean();

          if (entries.length === 0) {
            return void await message.reply(t(lang, 'commands.admin.starboard.leaderboard.none'));
          }

          const lines = entries.map((e: any, i: number) => {
            const emoji = getStarEmoji(e.starCount);
            const boardLabel = e.starboardChannelId ? ` in <#${e.starboardChannelId}>` : '';
            return `**${i + 1}.** ${emoji} **${e.starCount}** - <@${e.authorId}> in <#${e.channelId}>${boardLabel}\n[Jump to message](https://fluxer.app/channels/${guild.id}/${e.channelId}/${e.messageId})`;
          });

          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.starboard.leaderboard.title'))
            .setDescription(lines.join('\n\n'))
            .setColor(0xf1c40f)
            .setFooter({ text: t(lang, 'commands.admin.starboard.leaderboard.footer', { count: entries.length }) })
          return void await message.reply({ embeds: [embed] });
        }

        case 'top':
        case 'topusers': {
          const boardChannelId = parseChannelId(args[1]);
          const match: any = { guildId: guild.id, starCount: { $gt: 0 } };
          if (boardChannelId) match.starboardChannelId = boardChannelId;

          const pipeline = await StarboardMessage.aggregate([
            { $match: match },
            { $group: { _id: '$authorId', totalStars: { $sum: '$starCount' }, messageCount: { $sum: 1 } } },
            { $sort: { totalStars: -1 } },
            { $limit: 10 },
          ]);

          if (pipeline.length === 0) {
            return void await message.reply(t(lang, 'commands.admin.starboard.topusers.none'));
          }

          const lines = pipeline.map((e: any, i: number) => {
            const emoji = getStarEmoji(e.totalStars);
            return `**${i + 1}.** ${emoji} **${e.totalStars}** stars across **${e.messageCount}** message(s) - <@${e._id}>`;
          });

          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.starboard.topusers.title'))
            .setDescription(lines.join('\n'))
            .setColor(0xf1c40f)
            .setFooter({ text: t(lang, 'commands.admin.starboard.topusers.footer', { count: pipeline.length }) })
          return void await message.reply({ embeds: [embed] });
        }

        case 'stats': {
          const boardChannelId = parseChannelId(args[1]);
          const match: any = { guildId: guild.id };
          if (boardChannelId) match.starboardChannelId = boardChannelId;

          const totalEntries = await StarboardMessage.countDocuments({ ...match });
          const totalStarsResult = await StarboardMessage.aggregate([
            { $match: match },
            { $group: { _id: null, total: { $sum: '$starCount' } } },
          ]);
          const totalStars = totalStarsResult[0]?.total ?? 0;
          const postedCount = await StarboardMessage.countDocuments({ ...match, starboardMessageId: { $ne: null } });

          const boardBreakdown = await StarboardMessage.aggregate([
            { $match: { guildId: guild.id } },
            {
              $group: {
                _id: '$starboardChannelId',
                stars: { $sum: '$starCount' },
                messages: { $sum: 1 },
              },
            },
            { $sort: { stars: -1 } },
          ]);

          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.starboard.stats.title'))
            .setColor(0xf1c40f)
            .addFields(
              { name: t(lang, 'commands.admin.starboard.stats.trackedMessages'), value: `${totalEntries}`, inline: true },
              { name: t(lang, 'commands.admin.starboard.stats.totalStars'), value: `${totalStars}`, inline: true },
              { name: t(lang, 'commands.admin.starboard.stats.postedToStarboard'), value: `${postedCount}`, inline: true },
            )

          if (boardBreakdown.length > 0) {
            const lines = boardBreakdown.map((b: any) => {
              const ch = b._id ? `<#${b._id}>` : 'Unknown board';
              return `${ch}: ${b.stars} stars across ${b.messages} message(s)`;
            });
            embed.addFields({ name: t(lang, 'auditCatalog.commands.admin.starboard.l479_addFields_name'), value: lines.join('\n'), inline: false });
          }

          return void await message.reply({ embeds: [embed] });
        }

        case 'force': {
          if (!args[1]) return void await message.reply(t(lang, 'commands.admin.starboard.force.usage', { prefix }));

          let targetChannelId: string | null = null;
          let targetMessageId: string;

          const linkMatch = args[1].match(/channels\/(\d{17,19})\/(\d{17,19})\/(\d{17,19})$/);
          if (linkMatch) {
            targetChannelId = linkMatch[2];
            targetMessageId = linkMatch[3];
          } else if (/^\d{17,19}$/.test(args[1])) {
            targetMessageId = args[1];
            targetChannelId = parseChannelId(args[2]) || (message as any).channelId;
          } else {
            return void await message.reply(t(lang, 'commands.admin.starboard.force.invalidMessageLinkOrId'));
          }

          if (!targetChannelId) return void await message.reply(t(lang, 'commands.admin.starboard.force.couldNotDetermineChannel'));

          const boardArg = linkMatch ? args[2] : args[3];
          const boardChannelId = parseChannelId(boardArg);
          const board = findBoard(boards, boardChannelId) || boards[0];

          if (!board || !board.channelId) return void await message.reply(t(lang, 'commands.admin.starboard.force.noStarboardChannel', { prefix }));

          try {
            const { Routes } = await import('@erinjs/types');
            const msgData = await client.rest.get(Routes.channelMessage(targetChannelId, targetMessageId)) as any;
            if (!msgData?.id) return void await message.reply(t(lang, 'commands.admin.starboard.force.couldNotFetchMessage'));

            const content = msgData.content?.length > 1024
              ? msgData.content.substring(0, 1021) + '...'
              : (msgData.content || '*(no text content)*');

            const starEmoji = getStarEmoji(board.threshold ?? 3);
            const starColor = getStarColor(board.threshold ?? 3);

            const starEmbed = new EmbedBuilder()
              .setAuthor({
                name: msgData.author?.username ?? t(lang, 'commands.userinfo.unknown'),
                iconURL: msgData.author?.avatar
                  ? `https://fluxerusercontent.com/avatars/${msgData.author.id}/${msgData.author.avatar}.png`
                  : undefined,
              })
              .setDescription(content)
              .addFields(
                {
                  name: t(lang, 'auditCatalog.commands.admin.starboard.l531_addFields_name'),
                  value: t(lang, 'auditCatalog.commands.admin.starboard.l531_addFields_value', {
                    guildId: guild.id,
                    channelId: targetChannelId,
                    messageId: targetMessageId,
                  }),
                  inline: true
                },
                { name: t(lang, 'commands.report.fieldChannel'), value: `<#${targetChannelId}>`, inline: true },
              )
              .setColor(starColor)
              .setFooter({ text: t(lang, 'auditCatalog.commands.admin.starboard.l535_setFooter', { starEmoji, targetMessageId }) })

            if (msgData.attachments?.length > 0) {
              const img = msgData.attachments.find((a: any) => a.content_type?.startsWith('image/'));
              if (img?.url) starEmbed.setImage(img.url);
            }

            const starboardMsg = await client.rest.post(Routes.channelMessages(board.channelId), {
              body: {
                content: `${starEmoji} **Manually Added** | <#${targetChannelId}>`,
                embeds: [starEmbed.toJSON()],
              },
            }) as any;

            await StarboardMessage.findOneAndUpdate(
              { guildId: guild.id, messageId: targetMessageId, starboardChannelId: board.channelId },
              {
                $set: {
                  channelId: targetChannelId,
                  authorId: msgData.author?.id ?? 'unknown',
                  starboardChannelId: board.channelId,
                  starboardMessageId: starboardMsg?.id ?? null,
                  starCount: board.threshold ?? 3,
                },
                $setOnInsert: { reactors: [] },
              },
              { upsert: true, returnDocument: 'after' }
            );

            return void await message.reply(t(lang, 'commands.admin.starboard.force.forceAdded'));
          } catch (err: any) {
            return void await message.reply(t(lang, 'commands.admin.starboard.force.failed', { error: err.message || t(lang, 'commands.admin.starboard.force.unknownError') }));
          }
        }

        case 'remove':
        case 'delete': {
          if (!args[1]) return void await message.reply(t(lang, 'commands.admin.starboard.remove.usage', { prefix }));
          if (!/^\d{17,19}$/.test(args[1])) return void await message.reply(t(lang, 'commands.admin.starboard.remove.invalidMessageId'));

          const boardChannelId = parseChannelId(args[2]);
          const query: any = { guildId: guild.id, messageId: args[1] };
          if (boardChannelId) query.starboardChannelId = { $in: [boardChannelId, null] };

          const entries = await StarboardMessage.find(query);
          if (!entries || entries.length === 0) return void await message.reply(t(lang, 'commands.admin.starboard.remove.notInStarboard'));

          for (const entry of entries) {
            const channelId = entry.starboardChannelId || boardChannelId || boards[0]?.channelId;
            if (entry.starboardMessageId && channelId) {
              try {
                const { Routes } = await import('@erinjs/types');
                await client.rest.delete(Routes.channelMessage(channelId, entry.starboardMessageId));
              } catch {}
            }

            await StarboardMessage.deleteOne({ _id: entry._id });
          }

          return void await message.reply(t(lang, 'commands.admin.starboard.remove.done'));
        }

        default:
          return void await message.reply(t(lang, 'commands.admin.starboard.unknownSubcommand', { prefix }));
      }
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !starboard (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !starboard: ${error.message || error}`);
        const cached: any = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.starboard.errors.generic')).catch(() => { });
      }
    }
  }
};

export default command;
