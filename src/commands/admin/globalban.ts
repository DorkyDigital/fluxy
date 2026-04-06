import type { Command } from '../../types';
import GlobalBan from '../../models/GlobalBan';
import GlobalBanPrompt from '../../models/GlobalBanPrompt';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import parseUserId from '../../utils/parseUserId';
import isNetworkError from '../../utils/isNetworkError';
import config from '../../config';
import { EmbedBuilder } from '@erinjs/core';
import { Routes } from '@erinjs/types';
import * as messageDeleteQueue from '../../utils/messageDeleteQueue';
import { t, normalizeLocale } from '../../i18n';

const EMOJI_APPLY = '✅';
const EMOJI_DECLINE = '❌';

const command: Command = {
  name: 'globalban',
  description: 'Toggle the global ban system for your server, or manage the global ban list',
  usage: '<on|off|status|list> | <add|remove|check> (owner only)',
  category: 'admin',
  permissions: ['ManageGuild'],
  aliases: ['gban'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.admin.keywords.serverOnly'));

    const sub = args[0]?.toLowerCase();
    const isOwner = config.ownerId && (message as any).author.id === config.ownerId;
    const guildSettings: any = await GuildSettings.getOrCreate(guild.id);
    const lang = normalizeLocale(guildSettings?.language);


    if (sub === 'on' || sub === 'off') {
      try {
        const settings: any = guildSettings;
        settings.globalBanEnabled = sub === 'on';
        await settings.save();
        settingsCache.invalidate(guild.id);

        const status = sub === 'on' ? 'enabled' : 'disabled';
        return void await message.reply(
          `Global ban protection has been **${status}** for this server.` +
          (sub === 'on'
            ? ' When new global bans are added, you\'ll get a prompt (✅/❌) to apply or skip-or use `globalban autoban on` to skip prompts and auto-ban.'
            : ' Users on the global ban list will no longer be auto-banned on join.')
        );
      } catch (error: any) {
        if (isNetworkError(error)) {
          console.warn(`[${guild.name}] Fluxer API unreachable during !globalban ${sub}`);
        } else {
          console.error(`[${guild.name}] Error in !globalban ${sub}: ${error.message || error}`);
          message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l53_reply')).catch(() => { });
        }
        return;
      }
    }

    if (sub === 'status') {
      try {
        const settings = await settingsCache.get(guild.id);
        const enabled = (settings as any)?.globalBanEnabled === true;
        const autoApply = (settings as any)?.globalBanAutoApply === true;
        return void await message.reply(
          `Global ban protection is **${enabled ? 'enabled' : 'disabled'}** for this server.` +
          (enabled ? `\nAuto-apply (skip prompt): **${autoApply ? 'on' : 'off'}**` : '')
        );
      } catch {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l69_reply'));
      }
    }

    if (sub === 'autoban') {
      const autobanSub = args[1]?.toLowerCase();
      if (autobanSub !== 'on' && autobanSub !== 'off') {
        try {
          const settings = await settingsCache.get(guild.id);
          const autoApply = (settings as any)?.globalBanAutoApply === true;
          return void await message.reply(
            t(lang, 'auditCatalog.commands.admin.globalban.l80_reply', { autoApply, prefix })
          );
        } catch {
          return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l83_reply'));
        }
      }
      try {
        const settings: any = guildSettings;
        if (!settings.globalBanEnabled) {
          return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l89_reply'));
        }
        settings.globalBanAutoApply = autobanSub === 'on';
        await settings.save();
        settingsCache.invalidate(guild.id);
        return void await message.reply(
          `Auto-apply is now **${autobanSub === 'on' ? 'on' : 'off'}**. ` +
          (autobanSub === 'on'
            ? 'New global bans will be applied immediately without a prompt.'
            : 'You\'ll receive prompts (✅/❌) for new global bans.')
        );
      } catch (error: any) {
        if (isNetworkError(error)) {
          console.warn(`[${guild.name}] Fluxer API unreachable during !globalban autoban ${autobanSub}`);
        } else {
          console.error(`[${guild.name}] Error in !globalban autoban: ${error.message || error}`);
          message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l105_reply')).catch(() => { });
        }
        return;
      }
    }

    if (sub === 'list') {
      const bans = await GlobalBan.find().sort({ addedAt: -1 }).lean();
      if (bans.length === 0) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l114_reply'));
      }
      const payload = bans.map((b: any) => ({
        userId: b.userId,
        reason: b.reason,
        evidence: b.evidence ?? null,
        addedBy: b.addedBy,
        addedAt: b.addedAt instanceof Date ? b.addedAt.toISOString() : String(b.addedAt),
      }));
      const json = JSON.stringify(payload, null, 2);
      const buffer = Buffer.from(json, 'utf-8');
      const filename = `fluxy-globalban-${new Date().toISOString().slice(0, 10)}.json`;
      return void await message.reply({
        content: t(lang, 'auditCatalog.commands.admin.globalban.l127_reply_content', { 'bans.length': bans.length }),
        files: [{ name: filename, data: buffer }],
      });
    }

    if (!isOwner) {
      return void await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l135_setTitle'))
          .setColor(0x5865F2)
          .setDescription(
            `**Server commands** (admin):\n` +
            `\`${prefix}globalban on\` - enable global ban protection\n` +
            `\`${prefix}globalban off\` - disable global ban protection\n` +
            `\`${prefix}globalban autoban on/off\` - auto-ban without prompt (default: off)\n` +
            `\`${prefix}globalban status\` - check current setting\n` +
            `\`${prefix}globalban list\` - download ban list as JSON (anyone)`
          )
          .toJSON()]
      });
    }

    const BATCH_SIZE = 10;
    const MESSAGE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

    async function fetchAllGuildIds(): Promise<string[]> {
      try {
        const guildIds: string[] = [];
        let after: string | undefined;
        let page: any[];
        do {
          const route = `${Routes.currentUserGuilds()}?limit=200${after ? `&after=${after}` : ''}`;
          const response = await client.rest.get(route) as any;
          page = Array.isArray(response) ? response : (response?.guilds ?? []);
          guildIds.push(...page.map((entry: any) => String(entry?.id)).filter(Boolean));
          if (page.length === 200) after = page[page.length - 1]?.id;
        } while (page.length === 200);
        return guildIds;
      } catch {
        return [...client.guilds.keys()];
      }
    }

    async function getOptedInGuildIds(guildIds: string[]): Promise<string[]> {
      if (guildIds.length === 0) return [];
      const docs = await GuildSettings.find({
        guildId: { $in: guildIds },
        globalBanEnabled: true,
      }).select('guildId').lean();
      return docs.map((doc: any) => String(doc.guildId)).filter(Boolean);
    }

    function getMessageTimestamp(messageData: any): number {
      const raw = messageData?.timestamp || messageData?.createdAt || messageData?.created_at;
      const parsed = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    }

    async function deleteMessagesInChannel(channelId: string, messageIds: string[]): Promise<number> {
      if (messageIds.length === 0) return 0;

      let deleted = 0;
      const deletions = messageIds.map(messageId =>
        client.rest.delete(Routes.channelMessage(channelId, messageId))
          .then(() => { deleted++; })
          .catch((error: any) => {
            if (isNetworkError(error)) {
              messageDeleteQueue.enqueue(channelId, messageId);
            } else if (error.status !== 404) {
              console.warn(`[globalban] Failed to delete message ${messageId} in ${channelId}: ${error.message || error}`);
            }
          })
      );
      await Promise.allSettled(deletions);
      return deleted;
    }

    async function purgeRecentMessages(guildIds: string[], userIds: string[]): Promise<{ deleted: number; serversChecked: number; channelsScanned: number }> {
      const optedInGuildIds = await getOptedInGuildIds(guildIds);
      const userIdSet = new Set(userIds);
      const cutoff = Date.now() - MESSAGE_LOOKBACK_MS;
      let deleted = 0;
      let channelsScanned = 0;

      for (const guildId of optedInGuildIds) {
        let channels: any[] = [];
        try {
          const rawChannels = await client.rest.get(Routes.guildChannels(guildId)) as any[];
          if (Array.isArray(rawChannels)) channels = rawChannels;
        } catch { }

        const textChannels = channels.filter((channel: any) => channel?.type === 0);

        for (const textChannel of textChannels) {
          channelsScanned++;
          const channelId = textChannel.id;
          let before: string | null = null;

          while (true) {
            let messagesData: any;
            try {
              messagesData = await client.rest.get(`${Routes.channelMessages(channelId)}?limit=100${before ? `&before=${before}` : ''}`);
            } catch (error: any) {
              if (isNetworkError(error)) {
                console.warn(`[globalban] Message fetch failed for ${channelId}: ${error.message || error}`);
              }
              break;
            }

            const messages = Array.isArray(messagesData) ? messagesData : [];
            if (messages.length === 0) break;

            const messageIds = messages
              .filter((messageData: any) => userIdSet.has(String(messageData?.author?.id)) && getMessageTimestamp(messageData) >= cutoff)
              .map((messageData: any) => messageData.id);

            deleted += await deleteMessagesInChannel(channelId, messageIds);

            const oldestMessage = messages[messages.length - 1];
            const oldestTimestamp = getMessageTimestamp(oldestMessage);
            if (messages.length < 100 || oldestTimestamp < cutoff) break;
            before = oldestMessage.id;
          }
        }
      }

      return { deleted, serversChecked: optedInGuildIds.length, channelsScanned };
    }

    async function retroactiveBan(guildIds: string[], userIds: string[], banReason: string): Promise<{ banned: number; serversChecked: number }> {
      let banned = 0;
      const optedInGuildIds = await getOptedInGuildIds(guildIds);

      for (let i = 0; i < optedInGuildIds.length; i += BATCH_SIZE) {
        const batch = optedInGuildIds.slice(i, i + BATCH_SIZE);
        const tasks = batch.flatMap(guildId =>
          userIds.map(uid =>
            client.rest.put(Routes.guildBan(guildId, uid), { body: { reason: banReason } }).then(() => { banned++; }).catch(() => { })
          )
        );
        await Promise.allSettled(tasks);
      }

      return { banned, serversChecked: optedInGuildIds.length };
    }

    async function sendGlobalBanNotifications(
      guildIds: string[],
      userId: string,
      reason: string,
      evidence: string | null,
      _addedBy: string
    ): Promise<{ notified: number; dmFallback: number; skipped: number; autoApplied: number }> {
      const optedInGuildIds = await getOptedInGuildIds(guildIds);
      let notified = 0;
      let dmFallback = 0;
      let skipped = 0;
      let autoApplied = 0;
      const banReason = `[Fluxy Global Ban] ${reason}`;

      const buildPromptEmbed = () =>
        new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l289_setTitle'))
          .setDescription(
            `A user has been added to the Fluxy global ban list.\n\n` +
            `**Do you want to apply this ban in your server?**\n\n` +
            `${EMOJI_APPLY} – Apply ban (ban them here)\n` +
            `${EMOJI_DECLINE} – Skip (don't ban them here)`
          )
          .addFields(
            { name: t(lang, 'auditCatalog.commands.admin.globalban.l297_addFields_name'), value: `<@${userId}> (\`${userId}\`)`, inline: true },
            { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false },
            ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] as any[] : []),
          )
          .setColor(0xe74c3c)
          .setFooter({ text: t(lang, 'auditCatalog.commands.admin.globalban.l302_setFooter') })

      for (const guildId of optedInGuildIds) {
        try {
          const settings: any = await GuildSettings.findOne({ guildId }).lean();
          if (settings?.globalBanAutoApply === true) {
            try {
              await client.rest.put(Routes.guildBan(guildId, userId), { body: { reason: banReason } });
              autoApplied++;
            } catch (err: any) {
              if (!isNetworkError(err)) {
                console.warn(`[globalban] Auto-apply ban failed for ${guildId}: ${err.message}`);
              }
              skipped++;
            }
            continue;
          }

          const channelId = settings?.moderation?.logChannelId || settings?.logChannelId;
          const channel = channelId ? (client.channels?.get(channelId) || await client.channels.fetch(channelId).catch(() => null)) : null;

          if (channel && (channel as any).send) {
            const embed = buildPromptEmbed();
            const msg = await (channel as any).send({ embeds: [embed.toJSON()] });
            try {
              await msg.react(EMOJI_APPLY);
              await msg.react(EMOJI_DECLINE);
            } catch { }
            await GlobalBanPrompt.create({
              messageId: msg.id,
              channelId: channel.id,
              guildId,
              bannedUserId: userId,
              banReason,
              status: 'pending',
            });
            notified++;
            continue;
          }

          const guildData = await client.rest.get(Routes.guild(guildId)).catch(() => null) as any;
          const ownerId = guildData?.owner_id ?? guildData?.ownerId;
          const guildName = guildData?.name ?? guildId;
          if (ownerId) {
            try {
              const owner = await client.users.fetch(ownerId).catch(() => null);
              if (owner) {
                const dmEmbed = new EmbedBuilder()
                  .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l350_setTitle'))
                  .setDescription(
                    `**${guildName}** doesn't have a log channel configured, so we couldn't send the apply/skip prompt there. This notification was sent to you instead.\n\n` +
                    `**The user will be auto-banned if they join your server.** To receive future prompts in a channel (with ${EMOJI_APPLY}/${EMOJI_DECLINE} to choose), run \`setlog #your-log-channel\` in your server.`
                  )
                  .addFields(
                    { name: t(lang, 'auditCatalog.commands.admin.globalban.l356_addFields_name'), value: `<@${userId}> (\`${userId}\`)`, inline: true },
                    { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false },
                    ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] as any[] : []),
                  )
                  .setColor(0xe74c3c)
                  .setFooter({ text: t(lang, 'auditCatalog.commands.admin.globalban.l361_setFooter') })
                await owner.send({ embeds: [dmEmbed.toJSON()] });
                dmFallback++;
                continue;
              }
            } catch { }
          }
          skipped++;
        } catch (err: any) {
          skipped++;
          if (!isNetworkError(err)) {
            console.warn(`[globalban] Failed to send notification to guild ${guildId}: ${err.message}`);
          }
        }
      }

      return { notified, dmFallback, skipped, autoApplied };
    }

    if (sub === 'remove' || sub === 'unban') {
      const userId = args[1] ? parseUserId(args[1]) : null;
      if (!userId) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l383_reply', { prefix }));
      }

      const wasOnList = await GlobalBan.removeBan(userId);
      const guildIds = await fetchAllGuildIds();

      await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l391_setTitle'))
          .setDescription(
            (wasOnList ? `<@${userId}> (\`${userId}\`) removed from the ban list.\n` : `User \`${userId}\` was not on the ban list.\n`) +
            `Unbanning across ${guildIds.length} servers...`
          )
          .setColor(0x2ecc71)
          .toJSON()]
      });

      let unbanned = 0;

      for (let i = 0; i < guildIds.length; i += BATCH_SIZE) {
        const batch = guildIds.slice(i, i + BATCH_SIZE);
        const tasks = batch.map(guildId =>
          client.rest.delete(Routes.guildBan(guildId, userId)).then(() => { unbanned++; }).catch(() => { })
        );
        await Promise.allSettled(tasks);
      }

      return void await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l412_setTitle'))
          .setDescription(t(lang, 'auditCatalog.commands.admin.globalban.l413_setDescription', { unbanned, 'guildIds.length': guildIds.length }))
          .setColor(0x2ecc71)
          .toJSON()]
      });
    }

    if (sub === 'check') {
      const userId = args[1] ? parseUserId(args[1]) : null;
      if (!userId) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l422_reply', { prefix }));
      }

      const ban = await GlobalBan.isGlobalBanned(userId);
      if (!ban) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l427_reply', { userId }));
      }

      return void await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l432_setTitle'))
          .setDescription(`<@${ban.userId}> (\`${ban.userId}\`)`)
          .addFields(
            { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: ban.reason, inline: false },
            ...(ban.evidence ? [{ name: 'Evidence', value: ban.evidence, inline: false }] : []),
            { name: t(lang, 'auditCatalog.commands.admin.globalban.l437_addFields_name'), value: `<t:${Math.floor(new Date(ban.addedAt).getTime() / 1000)}:R>`, inline: true },
          )
          .setColor(0xe74c3c)
          .toJSON()]
      });
    }

    const rawIds = args[0] || '';
    const isMassBan = rawIds.includes(',');

    if (!rawIds || (!isMassBan && !parseUserId(rawIds))) {
      return void await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l450_setTitle'))
          .setColor(0xe74c3c)
          .setDescription(
            `**Server commands** (admin):\n` +
            `\`${prefix}globalban on\` - enable global ban protection\n` +
            `\`${prefix}globalban off\` - disable global ban protection\n` +
            `\`${prefix}globalban status\` - check current setting\n\n` +
            `**Ban list management** (bot owner only):\n` +
            `\`${prefix}globalban <userId> <reason> [--evidence <url>]\` - add to global ban list\n` +
            `\`${prefix}globalban <id1,id2,id3,...> <reason> [--evidence <url>]\` - mass ban\n` +
            `\`${prefix}globalban remove <userId>\` - remove from list\n` +
            `\`${prefix}globalban check <userId>\` - check if a user is banned\n` +
            `\`${prefix}globalban list\` - download ban list as JSON`
          )
          .toJSON()]
      });
    }

    const remaining = args.slice(1);
    let evidence: string | null = null;
    const evidenceIdx = remaining.findIndex(a => a === '--evidence');
    if (evidenceIdx !== -1) {
      evidence = remaining.slice(evidenceIdx + 1).join(' ') || null;
      remaining.splice(evidenceIdx);
    }
    const reason = remaining.join(' ') || 'Spam/Scam account';

    if (isMassBan) {
      const userIds = rawIds.split(',').map(id => id.trim()).filter(id => /^\d{17,20}$/.test(id));
      if (userIds.length === 0) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l480_reply'));
      }
      if (userIds.length > 100) {
        return void await message.reply(t(lang, 'auditCatalog.commands.admin.globalban.l483_reply'));
      }

      await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l488_setTitle'))
          .setDescription(t(lang, 'auditCatalog.commands.admin.globalban.l489_setDescription', { 'userIds.length': userIds.length }))
          .addFields(
            { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false },
            ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] : []),
          )
          .setColor(0xe74c3c)
          .toJSON()]
      });

      const guildIds = await fetchAllGuildIds();

      const checks = await Promise.all(userIds.map(uid => GlobalBan.isGlobalBanned(uid)));
      const newIds = userIds.filter((_, i) => !checks[i]);
      const existingIds = userIds.filter((_, i) => !!checks[i]);

      if (newIds.length > 0) {
        await Promise.allSettled(
          newIds.map(uid => GlobalBan.addBan({ userId: uid, reason, evidence, addedBy: (message as any).author.id }))
        );
      }

      const { banned, serversChecked } = await retroactiveBan(guildIds, userIds, `[Fluxy Global Ban] ${reason}`);
      const { deleted } = await purgeRecentMessages(guildIds, userIds);

      const parts = [];
      if (newIds.length > 0) parts.push(`**${newIds.length}** new user(s) added to the ban list.`);
      if (existingIds.length > 0) parts.push(`**${existingIds.length}** already on the list (re-scanned).`);
      parts.push(`Retroactive: **${banned}** ban(s) applied across **${serversChecked}** opted-in server(s).`);
      parts.push(`Recent messages deleted: **${deleted}** from the last 7 days.`);

      await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l521_setTitle'))
          .setDescription(parts.join('\n'))
          .setColor(0xe74c3c)
          .toJSON()]
      });
      return;
    }

    const userId = parseUserId(rawIds)!;

    const existing = await GlobalBan.isGlobalBanned(userId);
    if (!existing) {
      await GlobalBan.addBan({
        userId,
        reason,
        evidence,
        addedBy: (message as any).author.id,
      });
    }

    const guildIds = await fetchAllGuildIds();

    if (existing) {
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l545_setTitle'))
        .setDescription(t(lang, 'auditCatalog.commands.admin.globalban.l546_setDescription', { userId }))
        .addFields(
          { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false },
          ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] : []),
        )
        .setColor(0xe74c3c)
      await message.reply({ embeds: [embed.toJSON()] });

      const { banned, serversChecked } = await retroactiveBan(guildIds, [userId], `[Fluxy Global Ban] ${reason}`);
      const { deleted } = await purgeRecentMessages(guildIds, [userId]);

      await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l559_setTitle'))
          .setDescription(t(lang, 'auditCatalog.commands.admin.globalban.l560_setDescription', { banned, serversChecked, deleted }))
          .setColor(0xe74c3c)
          .toJSON()]
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l568_setTitle'))
      .setDescription(
        `<@${userId}> (\`${userId}\`) has been added to the global ban list.\n\n` +
        `Opted-in servers will receive a notification to choose whether to apply this ban.`
      )
      .addFields(
        { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false },
        ...(evidence ? [{ name: 'Evidence', value: evidence, inline: false }] : []),
      )
      .setColor(0xe74c3c)

    await message.reply({ embeds: [embed.toJSON()] });

    const { notified, dmFallback, skipped, autoApplied } = await sendGlobalBanNotifications(
      guildIds,
      userId,
      reason,
      evidence,
      (message as any).author.id
    );

    const lines: string[] = [
      autoApplied > 0 ? `**${autoApplied}** server(s) auto-banned (autoban on).` : '',
      `**${notified}** server(s) received the ban prompt (${EMOJI_APPLY} apply / ${EMOJI_DECLINE} skip).`,
      dmFallback > 0 ? `**${dmFallback}** server owner(s) DMed (no log channel-told them to set one up).` : '',
      skipped > 0 ? `**${skipped}** server(s) could not be reached.` : '',
      `\nIf they join before anyone responds, they'll be auto-banned unless the server chose ${EMOJI_DECLINE}.`,
    ].filter(Boolean);

    await message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(t(lang, 'auditCatalog.commands.admin.globalban.l599_setTitle'))
        .setDescription(lines.join('\n'))
        .setColor(0xe74c3c)
        .toJSON()]
    });
    return;
  }
};

export default command;
