import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import Ticket from '../../models/Ticket';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { EmbedBuilder, PermissionFlags } from '@erinjs/core';
import { Routes } from '@erinjs/types';
import { encodeReactionForRoute } from '../../utils/encodeReactionForRoute';
import { generateTranscriptHtml } from '../../utils/transcriptGenerator';
import { t, normalizeLocale } from '../../i18n';

const ticketCooldowns = new Map<string, number>();
const TICKET_COOLDOWN_MS = 10 * 60 * 1000;

function checkTicketCooldown(guildId: string, userId: string): { allowed: boolean; remaining?: string } {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const lastCreated = ticketCooldowns.get(key);
  if (lastCreated && (now - lastCreated) < TICKET_COOLDOWN_MS) {
    const remaining = Math.ceil((TICKET_COOLDOWN_MS - (now - lastCreated)) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return { allowed: false, remaining: mins > 0 ? `${mins}m ${secs}s` : `${secs}s` };
  }
  return { allowed: true };
}

function setTicketCooldown(guildId: string, userId: string): void {
  const key = `${guildId}:${userId}`;
  ticketCooldowns.set(key, Date.now());
  setTimeout(() => ticketCooldowns.delete(key), TICKET_COOLDOWN_MS);
}

function getSupportRoleIds(settings: any): string[] {
  const ids = new Set<string>(settings.ticketSupportRoleIds || []);
  if (settings.ticketSupportRoleId) ids.add(settings.ticketSupportRoleId);
  return [...ids];
}

async function getMemberWithTicketAccess(message: any, guild: any, settings: any): Promise<{ ok: boolean; reason?: string; member?: any }> {
  const lang = normalizeLocale(settings?.language);
  let member = guild.members?.get(message.author.id);
  if (!member) {
    try { member = await guild.fetchMember(message.author.id); } catch {}
  }
  if (!member) {
    return { ok: false, reason: t(lang, 'commands.admin.ticket.access.couldNotVerifyPermissionsRightNow') };
  }

  const supportRoleIds = getSupportRoleIds(settings);
  const memberRoleIds = member.roles?.roleIds ?? [];
  const isSupport = supportRoleIds.some((id: string) => memberRoleIds.includes(id));
  const isAdmin = member.permissions?.has(PermissionFlags.ManageGuild) || member.permissions?.has(PermissionFlags.Administrator);

  if (!isSupport && !isAdmin) {
    return { ok: false, reason: t(lang, 'commands.admin.ticket.access.supportRoleOrManageServer') };
  }

  return { ok: true, member };
}

async function save(settings: any, guildId: string): Promise<void> {
  settings.markModified('ticketCategoryId');
  settings.markModified('ticketSetupChannelId');
  settings.markModified('ticketSetupMessageId');
  settings.markModified('ticketSupportRoleIds');
  settings.markModified('ticketLogChannelId');
  settings.markModified('ticketMaxOpen');
  settings.markModified('ticketOpenMessage');
  await settings.save();
  settingsCache.invalidate(guildId);
}

export async function createTicketForUser(guild: any, userId: string, settings: any, client: any, subject?: string, prefix = '!'): Promise<{ success: boolean; reason?: string; ticketNumber?: number; channelId?: string }> {
  const lang = normalizeLocale(settings?.language);
  const maxOpen = settings.ticketMaxOpen || 3;
  const openTickets = await Ticket.countDocuments({ guildId: guild.id, openedBy: userId, status: 'open' });
  if (openTickets >= maxOpen) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.maxOpenTickets', { openTickets, maxOpen }),
    };
  }

  const cooldown = checkTicketCooldown(guild.id, userId);
  if (!cooldown.allowed) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.waitCooldown', { remaining: cooldown.remaining }),
    };
  }

  const ticketNumber = await (Ticket as any).getNextNumber(guild.id);
  const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

  const botId = client.user?.id;
  const everyoneRoleId = guild.id;
  const overwrites: any[] = [
    { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
    { id: userId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages), deny: '0' },
  ];

  if (botId) {
    overwrites.push({ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.ReadMessageHistory), deny: '0' });
  }

  const supportRoleIds = getSupportRoleIds(settings);
  for (const roleId of supportRoleIds) {
    overwrites.push({ id: roleId, type: 0, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages), deny: '0' });
  }

  let channel: any;
  try {
    channel = await guild.createChannel({
      type: 0,
      name: channelName,
      parent_id: settings.ticketCategoryId,
      topic: subject ? `Ticket #${ticketNumber} - ${subject}` : `Ticket #${ticketNumber} - Opened by <@${userId}>`,
      permission_overwrites: overwrites,
    });
  } catch (err: any) {
    return {
      success: false,
      reason: t(lang, 'commands.admin.ticket.user.reasons.failedToCreateChannel', { error: err.message }),
    };
  }

  await Ticket.create({
    guildId: guild.id,
    channelId: channel.id,
    openedBy: userId,
    ticketNumber,
    subject: subject || null,
    participants: [userId],
  });

  const replaceVars = (text: string) => text
    .replace(/\{user\}/gi, `<@${userId}>`)
    .replace(/\{server\}/gi, guild.name)
    .replace(/\{ticket\}/gi, `#${ticketNumber}`)
    .replace(/\\n/g, '\n');

  let openMsg: string;
  if (settings.ticketOpenMessage) {
    openMsg = replaceVars(settings.ticketOpenMessage);
  } else {
    openMsg = t(lang, 'commands.admin.ticket.user.defaultOpenMessage', { userId, prefix });
  }

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.ticket.user.ticketEmbed.title', { ticketNumber }))
    .setDescription(openMsg)
    .setColor(0x5865F2)

  if (subject) {
    embed.addFields({ name: t(lang, 'commands.admin.ticket.user.ticketEmbed.subjectField'), value: subject, inline: false });
  }

  try {
    await channel.send({ embeds: [embed] });
  } catch { }

  if (supportRoleIds.length > 0) {
    try {
      const ping = await channel.send({ content: supportRoleIds.map((id: string) => `<@&${id}>`).join(' ') });
      setTimeout(() => ping.delete().catch(() => { }), 3000);
    } catch { }
  }

  setTicketCooldown(guild.id, userId);
  return { success: true, ticketNumber, channelId: channel.id };
}

async function postTicketPanel(targetChannel: any, guild: any, settings: any, client: any): Promise<any> {
  const lang = normalizeLocale(settings?.language);
  const emoji = settings.ticketEmoji || '\uD83C\uDFAB';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.ticket.user.panelEmbed.title'))
    .setDescription(t(lang, 'commands.admin.ticket.user.panelEmbed.description', { emoji }))
    .setColor(0x5865F2)
    .setFooter({ text: t(lang, 'commands.admin.ticket.user.panelEmbed.footer') });

  const panelMsg = await targetChannel.send({ embeds: [embed] });

  let emojiForReact = emoji;
  if (typeof client?.resolveEmoji === 'function') {
    try {
      const resolved = await client.resolveEmoji(emoji, guild.id);
      if (typeof resolved === 'string' && resolved.trim()) emojiForReact = resolved.trim();
    } catch { /* use raw */ }
  }

  const restPutReaction = async () => {
    const encoded = encodeReactionForRoute(emojiForReact);
    await client.rest.put(
      `${Routes.channelMessageReaction(targetChannel.id, panelMsg.id, encoded)}/@me`
    );
  };

  try {
    await panelMsg.react(emojiForReact);
  } catch (err: any) {
    console.warn(`[${guild.name}] ticket panel react() failed, trying REST: ${err.message}`);
    try {
      await restPutReaction();
    } catch (restErr: any) {
      console.warn(`[${guild.name}] Failed to add ticket reaction: ${restErr.message}`);
    }
  }

  settings.ticketSetupChannelId = targetChannel.id;
  settings.ticketSetupMessageId = panelMsg.id;
  await save(settings, guild.id);

  return panelMsg;
}

const subcommands: Record<string, (message: any, args: string[], guild: any, settings: any, client: any, prefix: string) => Promise<any>> = {

  async setup(message, args, guild, settings, client, prefix) {
    const sub = args[0]?.toLowerCase();
    const lang = normalizeLocale(settings?.language);

    if (sub === 'category') {
      const val = args[1];
      if (!val) return message.reply(t(lang, 'commands.admin.ticket.setup.category.usage', { prefix }));

      if (val.toLowerCase() === 'create') {
        try {
          const category = await guild.createChannel({
            type: 4,
            name: 'Tickets',
          });
          settings.ticketCategoryId = category.id;
          await save(settings, guild.id);
          return message.reply(t(lang, 'commands.admin.ticket.setup.category.created', { categoryId: category.id }));
        } catch (err: any) {
          return message.reply(t(lang, 'commands.admin.ticket.setup.category.failedToCreate', { error: err.message }));
        }
      }

      const categoryId = val.match(/^\d{17,19}$/)?.[0];
      if (!categoryId) return message.reply(t(lang, 'commands.admin.ticket.setup.category.invalidCategoryId'));
      settings.ticketCategoryId = categoryId;
      await save(settings, guild.id);
      return message.reply(t(lang, 'commands.admin.ticket.setup.category.setDone', { categoryId }));
    }

    if (sub === 'channel') {
      if (!settings.ticketCategoryId) {
        return message.reply(t(lang, 'commands.admin.ticket.setup.channel.setupFirst', { prefix }));
      }

      const val = args[1];

      if (!val || val.toLowerCase() === 'create') {
        try {
          const everyoneRoleId = guild.id;
          const botId = client.user?.id;

          const overwrites: any[] = [
            { id: everyoneRoleId, type: 0, allow: String(PermissionFlags.ViewChannel | PermissionFlags.AddReactions | PermissionFlags.ReadMessageHistory), deny: String(PermissionFlags.SendMessages) },
          ];

          if (botId) {
            overwrites.push({
              id: botId,
              type: 1,
              allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageMessages | PermissionFlags.ManageChannels | PermissionFlags.AddReactions | PermissionFlags.ReadMessageHistory | PermissionFlags.EmbedLinks),
              deny: '0',
            });
          }

          const ticketChannel = await guild.createChannel({
            type: 0,
            name: 'make-a-ticket',
            parent_id: settings.ticketCategoryId,
            topic: 'React to the message below to create a support ticket!',
            permission_overwrites: overwrites,
          });

          await postTicketPanel(ticketChannel, guild, settings, client);
          return message.reply(t(lang, 'commands.admin.ticket.setup.channel.created', { channelId: ticketChannel.id }));
        } catch (err: any) {
          return message.reply(t(lang, 'commands.admin.ticket.setup.channel.failedToCreate', { error: err.message }));
        }
      }

      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) return message.reply(t(lang, 'commands.admin.ticket.setup.channel.invalidChannelId'));

      let targetChannel = guild.channels?.get(channelId);
      if (!targetChannel) {
        targetChannel = await client.channels.fetch(channelId).catch(() => null);
      }
      if (!targetChannel) return message.reply(t(lang, 'commands.admin.ticket.setup.channel.couldNotFind'));

      const botId = client.user?.id;
      if (botId) {
        try {
          await targetChannel.editPermission(botId, {
            type: 1,
            allow: String(
              PermissionFlags.ViewChannel | PermissionFlags.SendMessages |
              PermissionFlags.ManageMessages | PermissionFlags.ManageChannels |
              PermissionFlags.AddReactions | PermissionFlags.ReadMessageHistory |
              PermissionFlags.EmbedLinks
            ),
          });
        } catch {
          return message.reply(t(lang, 'commands.admin.ticket.setup.channel.botPermissionUpdateFailed', { channelId }));
        }
      }

      try {
        await postTicketPanel(targetChannel, guild, settings, client);
        return message.reply(t(lang, 'commands.admin.ticket.setup.channel.panelPosted', { channelId }));
      } catch (err: any) {
        return message.reply(t(lang, 'commands.admin.ticket.setup.channel.failedToPostPanel', { error: err.message }));
      }
    }

    if (sub === 'role') {
      const action = args[1]?.toLowerCase();
      const val = args[2];

      if (!action) {
        const roleIds = getSupportRoleIds(settings);
        if (roleIds.length === 0) return message.reply(t(lang, 'commands.admin.ticket.setup.role.noSupportRoles', { prefix }));
        return message.reply(
          t(lang, 'commands.admin.ticket.setup.role.list', {
            count: roleIds.length,
            roleList: roleIds.map((id: string) => `<@&${id}>`).join(', '),
          })
        );
      }

      if (action === 'clear') {
        settings.ticketSupportRoleId = null;
        settings.ticketSupportRoleIds = [];
        await save(settings, guild.id);
        return message.reply(t(lang, 'commands.admin.ticket.setup.role.clearedAll'));
      }

      if (action === 'add') {
        if (!val) return message.reply(t(lang, 'commands.admin.ticket.setup.role.addUsage', { prefix }));
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return message.reply(t(lang, 'commands.admin.ticket.setup.role.invalidRoleId'));
        const current = getSupportRoleIds(settings);
        if (current.includes(roleId)) return message.reply(t(lang, 'commands.admin.ticket.setup.role.alreadySupportRole', { roleId }));
        if (current.length >= 10) return message.reply(t(lang, 'commands.admin.ticket.setup.role.maxSupportRoles'));
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId = settings.ticketSupportRoleIds[0];
        await save(settings, guild.id);
        return message.reply(
          t(lang, 'commands.admin.ticket.setup.role.added', { roleId, total: settings.ticketSupportRoleIds.length })
        );
      }

      if (action === 'remove') {
        if (!val) return message.reply(t(lang, 'commands.admin.ticket.setup.role.removeUsage', { prefix }));
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return message.reply(t(lang, 'commands.admin.ticket.setup.role.invalidRoleId'));
        const current = getSupportRoleIds(settings);
        if (!current.includes(roleId)) return message.reply(t(lang, 'commands.admin.ticket.setup.role.notSupportRole', { roleId }));
        const updated = current.filter((id: string) => id !== roleId);
        settings.ticketSupportRoleIds = updated;
        settings.ticketSupportRoleId = updated[0] || null;
        await save(settings, guild.id);
        return message.reply(
          t(lang, 'commands.admin.ticket.setup.role.removed', { roleId, remaining: updated.length })
        );
      }

      const roleId = action.match(/^<@&(\d{17,19})>$/)?.[1] ?? (action.match(/^\d{17,19}$/)?.[0] || null);
      if (roleId) {
        const current = getSupportRoleIds(settings);
        if (current.length >= 10) return message.reply(t(lang, 'commands.admin.ticket.setup.role.maxSupportRoles'));
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId = settings.ticketSupportRoleIds[0];
        await save(settings, guild.id);
        return message.reply(
          t(lang, 'commands.admin.ticket.setup.role.added', { roleId, total: settings.ticketSupportRoleIds.length })
        );
      }

      return message.reply(t(lang, 'commands.admin.ticket.setup.role.generalListUsage', { prefix }));
    }

    if (sub === 'log') {
      const val = args[1];
      if (!val) return message.reply(t(lang, 'commands.admin.ticket.setup.log.usage', { prefix }));
      if (val.toLowerCase() === 'clear') {
        settings.ticketLogChannelId = null;
        await save(settings, guild.id);
        return message.reply(t(lang, 'commands.admin.ticket.setup.log.cleared'));
      }
      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) return message.reply(t(lang, 'commands.admin.ticket.setup.log.invalidChannelId'));
      settings.ticketLogChannelId = channelId;
      await save(settings, guild.id);
      return message.reply(t(lang, 'commands.admin.ticket.setup.log.setDone', { channelId }));
    }

    if (sub === 'max') {
      const val = parseInt(args[1]);
      if (isNaN(val) || val < 1 || val > 10) return message.reply(t(lang, 'commands.admin.ticket.setup.max.usage', { prefix }));
      settings.ticketMaxOpen = val;
      await save(settings, guild.id);
      return message.reply(t(lang, 'commands.admin.ticket.setup.max.setDone', { maxOpen: val }));
    }

    if (sub === 'message') {
      const val = args.slice(1).join(' ').trim();
      if (!val) return message.reply(t(lang, 'commands.admin.ticket.setup.message.usage', { prefix }));
      if (val.toLowerCase() === 'clear') {
        settings.ticketOpenMessage = null;
        await save(settings, guild.id);
        return message.reply(t(lang, 'commands.admin.ticket.setup.message.cleared'));
      }
      if (val.length > 1000) return message.reply(t(lang, 'commands.admin.ticket.setup.message.tooLong'));
      settings.ticketOpenMessage = val;
      await save(settings, guild.id);
      return message.reply(t(lang, 'commands.admin.ticket.setup.message.setDone'));
    }

    const cat = settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const roleIds = getSupportRoleIds(settings);
    const role = roleIds.length > 0 ? roleIds.map((id: string) => `<@&${id}>`).join(', ') : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const log = settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : t(lang, 'commands.admin.ticket.setupEmbed.notSet');
    const setupCh = settings.ticketSetupChannelId ? `<#${settings.ticketSetupChannelId}>` : t(lang, 'commands.admin.ticket.setupEmbed.notSet');

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.setupEmbed.title'))
      .setColor(0x5865F2)
      .addFields(
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.category'), value: cat, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.ticketChannel'), value: setupCh, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.supportRole'), value: role, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.logChannel'), value: log, inline: true },
        { name: t(lang, 'commands.admin.ticket.setupEmbed.fields.maxOpen'), value: String(settings.ticketMaxOpen || 3), inline: true },
        {
          name: t(lang, 'commands.admin.ticket.setupEmbed.fields.customMessage'),
          value: settings.ticketOpenMessage
            ? t(lang, 'commands.admin.ticket.setupEmbed.customMessageValues.set')
            : t(lang, 'commands.admin.ticket.setupEmbed.customMessageValues.default'),
          inline: true,
        },
        {
          name: t(lang, 'commands.admin.ticket.setupEmbed.fields.setupCommands'),
          value: t(lang, 'commands.admin.ticket.setupEmbed.setupCommands', { prefix }),
          inline: false
        },
      )

    return message.reply({ embeds: [embed] });
  },

  async claim(message, args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply(t(lang, 'commands.admin.ticket.claim.ticketNotOpen'));

    if ((ticket as any).claimedBy) {
      return message.reply(t(lang, 'commands.admin.ticket.claim.alreadyClaimed', { claimedBy: (ticket as any).claimedBy }));
    }

    (ticket as any).claimedBy = message.author.id;
    (ticket as any).claimedAt = new Date();
    await ticket.save();

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.user.claimEmbed.title', { ticketNumber: (ticket as any).ticketNumber }))
      .setDescription(t(lang, 'commands.admin.ticket.user.claimEmbed.description', { userId: message.author.id }))
      .setColor(0x2ecc71)

    return message.reply({ embeds: [embed] });
  },

  async close(message, args, guild, settings, client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });

    if (!ticket) {
      return message.reply(t(lang, 'commands.admin.ticket.close.ticketNotOpen'));
    }

    const reason = args.join(' ').trim() || t(lang, 'commands.admin.ticket.close.noReasonProvided');

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.admin.ticket.user.closeEmbed.title', { ticketNumber: (ticket as any).ticketNumber }))
      .setDescription(t(lang, 'commands.admin.ticket.user.closeEmbed.description', { userId: message.author.id }))
      .setColor(0xED4245)
      .addFields({ name: t(lang, 'commands.admin.ticket.user.closeEmbed.reasonField'), value: reason, inline: false });

    if ((ticket as any).claimedBy) {
      embed.addFields({
        name: t(lang, 'commands.admin.ticket.user.closeEmbed.claimedByField'),
        value: `<@${(ticket as any).claimedBy}>`,
        inline: true,
      });
    }



    (ticket as any).status = 'closed';
    (ticket as any).closedBy = message.author.id;
    (ticket as any).closedAt = new Date();
    await ticket.save();

    try {
      await (message as any).channel.send({ embeds: [embed] });
    } catch { }

    if (settings.ticketLogChannelId) {
      try {
        let logChannel = guild.channels?.get(settings.ticketLogChannelId);
        if (!logChannel) try { logChannel = await client.channels.fetch(settings.ticketLogChannelId); } catch { }
        if (logChannel) {
          const transcriptMessages = ((ticket as any).transcript || []) as Array<{
            authorId: string; authorName: string; avatarURL?: string | null;
            content: string; attachments?: Array<{ url: string; name: string }>;
            timestamp: Date | string;
          }>;

          const logEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.admin.ticket.user.logEmbed.titleClosed', { ticketNumber: (ticket as any).ticketNumber }))
            .setColor(0xED4245)
            .addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.openedByField'), value: `<@${(ticket as any).openedBy}>`, inline: true })
            .addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.closedByField'), value: `<@${message.author.id}>`, inline: true });

          if ((ticket as any).claimedBy) {
            logEmbed.addFields({
              name: t(lang, 'commands.admin.ticket.user.logEmbed.claimedByField'),
              value: `<@${(ticket as any).claimedBy}>`,
              inline: true,
            });
          }

          logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.reasonField'), value: reason, inline: false });

          if ((ticket as any).subject) {
            logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.subjectField'), value: (ticket as any).subject, inline: false });
          }

          logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.messagesField'), value: String(transcriptMessages.length), inline: true })

          const sendOpts: any = { embeds: [logEmbed] };

          if (transcriptMessages.length > 0) {
            try {
              const nameCache = new Map<string, string>();
              for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);

              const resolveName = async (id: string): Promise<string> => {
                if (nameCache.has(id)) return nameCache.get(id)!;
                try {
                  const u = await client.users.fetch(id);
                  const name = (u as any).username || id;
                  nameCache.set(id, name);
                  return name;
                } catch { return id; }
              };

              const openedByName = await resolveName((ticket as any).openedBy);
              const closedByName = message.author.username || message.author.id;
              const claimedByName = (ticket as any).claimedBy ? await resolveName((ticket as any).claimedBy) : null;

              const html = generateTranscriptHtml({
                guildName: guild.name,
                ticketNumber: (ticket as any).ticketNumber,
                openedBy: openedByName,
                claimedBy: claimedByName,
                closedBy: closedByName,
                subject: (ticket as any).subject,
                createdAt: (ticket as any).createdAt,
                closedAt: new Date(),
                messages: transcriptMessages,
              });
              sendOpts.files = [{
                name: `transcript-${(ticket as any).ticketNumber}.html`,
                data: Buffer.from(html, 'utf-8'),
              }];
            } catch (err: any) {
              console.error(`[ticket] Failed to generate transcript: ${err.message}`);
            }
          }

          await logChannel.send(sendOpts);
        }
      } catch { }
    }

    const openedByUserId = (ticket as any).openedBy;
    if (openedByUserId) {
      try {
        const transcriptMessages = ((ticket as any).transcript || []) as Array<{
          authorId: string; authorName: string; avatarURL?: string | null;
          content: string; attachments?: Array<{ url: string; name: string }>;
          timestamp: Date | string;
        }>;
        const userEmbed = new EmbedBuilder()
          .setTitle(t(lang, 'commands.admin.ticket.user.dmEmbed.titleClosed', { ticketNumber: (ticket as any).ticketNumber }))
          .setDescription(t(lang, 'commands.admin.ticket.user.dmEmbed.description', { guildName: guild.name, userId: message.author.id }))
          .setColor(0xED4245)
          .addFields({ name: t(lang, 'commands.admin.ticket.user.dmEmbed.reasonField'), value: reason, inline: false })
        const userSendOpts: any = { embeds: [userEmbed] };
        if (transcriptMessages.length > 0) {
          try {
            const nameCache = new Map<string, string>();
            for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);
            const resolveName = async (id: string): Promise<string> => {
              if (nameCache.has(id)) return nameCache.get(id)!;
              try {
                const u = await client.users.fetch(id);
                const name = (u as any).username || id;
                nameCache.set(id, name);
                return name;
              } catch { return id; }
            };
            const openedByName = await resolveName(openedByUserId);
            const closedByName = message.author.username || message.author.id;
            const claimedByName = (ticket as any).claimedBy ? await resolveName((ticket as any).claimedBy) : null;
            const html = generateTranscriptHtml({
              guildName: guild.name,
              ticketNumber: (ticket as any).ticketNumber,
              openedBy: openedByName,
              claimedBy: claimedByName,
              closedBy: closedByName,
              subject: (ticket as any).subject,
              createdAt: (ticket as any).createdAt,
              closedAt: new Date(),
              messages: transcriptMessages,
            });
            userSendOpts.files = [{ name: `transcript-${(ticket as any).ticketNumber}.html`, data: Buffer.from(html, 'utf-8') }];
          } catch (err: any) {
            console.error(`[ticket] Failed to generate transcript for DM: ${err.message}`);
          }
        }
        const opener = await client.users.fetch(openedByUserId).catch(() => null);
        if (opener) await opener.send(userSendOpts);
      } catch { }
    }

    setTimeout(async () => {
      try {
        const ch = guild.channels?.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.delete();
      } catch { }
    }, 5000);
  },

  async add(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply(t(lang, 'commands.admin.ticket.add.ticketNotOpen'));

    const userId = args[0]?.match(/^<@!?(\d{17,19})>$/)?.[1] ?? (args[0]?.match(/^\d{17,19}$/)?.[0] || null);
    if (!userId) return message.reply(t(lang, 'commands.admin.ticket.add.usage', { prefix }));

    const channel = guild.channels?.get(channelId);
    if (!channel) return message.reply(t(lang, 'commands.admin.ticket.add.channelNotFound'));

    try {
      await channel.editPermission(userId, {
        type: 1,
        allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages),
      });

      if (!(ticket as any).participants.includes(userId)) {
        (ticket as any).participants.push(userId);
        await ticket.save();
      }

      return message.reply(t(lang, 'commands.admin.ticket.add.added', { userId }));
    } catch (err: any) {
      return message.reply(t(lang, 'commands.admin.ticket.add.failedToAddUser', { error: err.message }));
    }
  },

  async remove(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply(t(lang, 'commands.admin.ticket.remove.ticketNotOpen'));

    const userId = args[0]?.match(/^<@!?(\d{17,19})>$/)?.[1] ?? (args[0]?.match(/^\d{17,19}$/)?.[0] || null);
    if (!userId) return message.reply(t(lang, 'commands.admin.ticket.remove.usage', { prefix }));

    if (userId === (ticket as any).openedBy) return message.reply(t(lang, 'commands.admin.ticket.remove.openedByCannotRemove'));

    const channel = guild.channels?.get(channelId);
    if (!channel) return message.reply(t(lang, 'commands.admin.ticket.remove.channelNotFound'));

    try {
      await channel.deletePermission(userId);
      (ticket as any).participants = (ticket as any).participants.filter((id: string) => id !== userId);
      await ticket.save();
      return message.reply(t(lang, 'commands.admin.ticket.remove.removed', { userId }));
    } catch (err: any) {
      return message.reply(t(lang, 'commands.admin.ticket.remove.failedToRemoveUser', { error: err.message }));
    }
  },

  async panel(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    if (!settings.ticketCategoryId) {
      return message.reply(t(lang, 'commands.admin.ticket.panel.ticketNotSetup', { prefix }));
    }

    const channelMention = args[0];
    const channelId = (channelMention?.match(/^<#(\d{17,19})>$/)?.[1]
      ?? (channelMention?.match(/^\d{17,19}$/)?.[0] || null))
      || (message as any).channelId || (message as any).channel?.id;

    let targetChannel = guild.channels?.get(channelId);
    if (!targetChannel) {
      targetChannel = await client.channels.fetch(channelId).catch(() => null);
    }
    if (!targetChannel) return message.reply(t(lang, 'commands.admin.ticket.panel.channelNotFound'));

    try {
      await postTicketPanel(targetChannel, guild, settings, client);
      if (channelId !== ((message as any).channelId || (message as any).channel?.id)) {
        return message.reply(t(lang, 'commands.admin.ticket.panel.posted', { channelId }));
      }
    } catch (err: any) {
      return message.reply(t(lang, 'commands.admin.ticket.panel.failedToSend', { error: err.message }));
    }
  },
};

function showHelp(message: any, prefix = '!', lang = 'en') {
  return message.reply(
    t(lang, 'commands.admin.ticket.help.body', {
      prefix,
    })
  );
}

const command: Command = {
  name: 'ticket',
  description: 'Support ticket system - create, manage, and close tickets.',
  usage: '<close|add|remove|panel|setup> [options]',
  category: 'admin',
  permissions: [],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.admin.ticket.serverOnly'));

    const sub = args[0]?.toLowerCase();

    let settings: any;
    let lang = 'en';
    try {
      settings = await GuildSettings.getOrCreate(guild.id);
      lang = normalizeLocale(settings?.language);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ticket (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !ticket: ${error.message || error}`);
      }
      message.reply(t(lang, 'commands.admin.ticket.processingError')).catch(() => { });
      return;
    }

    if (sub === 'open') return void await message.reply(t(lang, 'commands.admin.ticket.openNotice', { prefix }));

    if (!sub || !subcommands[sub]) return showHelp(message, prefix, lang);

    if (sub === 'setup' || sub === 'panel') {
      let member = guild.members?.get(message.author.id);
      if (!member) try { member = await guild.fetchMember(message.author.id); } catch { }
      if (member) {
        const perms = member.permissions;
        if (!perms?.has(PermissionFlags.ManageGuild) && !perms?.has(PermissionFlags.Administrator)) {
          return void await message.reply(t(lang, 'commands.admin.ticket.missingManageServerPermission'));
        }
      }
    }

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ticket (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !ticket: ${error.message || error}`);
        message.reply(t(lang, 'commands.admin.ticket.processingError')).catch(() => { });
      }
    }
  }
};

export default command;
