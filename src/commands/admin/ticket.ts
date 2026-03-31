import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import Ticket from '../../models/Ticket';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { generateTranscriptHtml } from '../../utils/transcriptGenerator';

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
  let member = guild.members?.get(message.author.id);
  if (!member) {
    try { member = await guild.fetchMember(message.author.id); } catch {}
  }
  if (!member) {
    return { ok: false, reason: 'Could not verify your permissions right now. Please try again.' };
  }

  const supportRoleIds = getSupportRoleIds(settings);
  const memberRoleIds = member.roles?.roleIds ?? [];
  const isSupport = supportRoleIds.some((id: string) => memberRoleIds.includes(id));
  const isAdmin = member.permissions?.has(PermissionFlags.ManageGuild) || member.permissions?.has(PermissionFlags.Administrator);

  if (!isSupport && !isAdmin) {
    return { ok: false, reason: 'You need a **support role** or **Manage Server** permission to manage tickets.' };
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
  const maxOpen = settings.ticketMaxOpen || 3;
  const openTickets = await Ticket.countDocuments({ guildId: guild.id, openedBy: userId, status: 'open' });
  if (openTickets >= maxOpen) {
    return { success: false, reason: `You already have **${openTickets}** open ticket(s). Maximum is **${maxOpen}**. Please close an existing ticket first.` };
  }

  const cooldown = checkTicketCooldown(guild.id, userId);
  if (!cooldown.allowed) {
    return { success: false, reason: `Please wait **${cooldown.remaining}** before creating another ticket.` };
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
    return { success: false, reason: `Failed to create ticket channel: ${err.message}` };
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
    openMsg = `Welcome <@${userId}>! A staff member will be with you shortly.\n\nUse \`${prefix}ticket close\` to close this ticket when your issue is resolved.`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticketNumber}`)
    .setDescription(openMsg)
    .setColor(0x5865F2)
    .setTimestamp(new Date());

  if (subject) {
    embed.addFields({ name: 'Subject', value: subject, inline: false });
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

async function postTicketPanel(targetChannel: any, guild: any, settings: any, _client: any): Promise<any> {
  const emoji = settings.ticketEmoji || '\uD83C\uDFAB';

  const embed = new EmbedBuilder()
    .setTitle('Support Tickets')
    .setDescription(
      `Need help? React with ${emoji} below to create a ticket!\n\n` +
      'A private channel will be created for you and a staff member will assist you as soon as possible.\n\n' +
      '*You can only create one ticket every 10 minutes.*'
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'React below to open a ticket' });

  const panelMsg = await targetChannel.send({ embeds: [embed] });

  try {
    await panelMsg.react(emoji);
  } catch (err: any) {
    console.warn(`[${guild.name}] Failed to add ticket reaction: ${err.message}`);
  }

  settings.ticketSetupChannelId = targetChannel.id;
  settings.ticketSetupMessageId = panelMsg.id;
  await save(settings, guild.id);

  return panelMsg;
}

const subcommands: Record<string, (message: any, args: string[], guild: any, settings: any, client: any, prefix: string) => Promise<any>> = {

  async setup(message, args, guild, settings, client, prefix) {
    const sub = args[0]?.toLowerCase();

    if (sub === 'category') {
      const val = args[1];
      if (!val) return message.reply(`Usage: \`${prefix}ticket setup category <categoryId>\`\nProvide the ID of an existing category channel, or \`create\` to make one.`);

      if (val.toLowerCase() === 'create') {
        try {
          const category = await guild.createChannel({
            type: 4,
            name: 'Tickets',
          });
          settings.ticketCategoryId = category.id;
          await save(settings, guild.id);
          return message.reply(`Ticket category created: **Tickets** (<#${category.id}>)`);
        } catch (err: any) {
          return message.reply(`Failed to create category: ${err.message}`);
        }
      }

      const categoryId = val.match(/^\d{17,19}$/)?.[0];
      if (!categoryId) return message.reply('Please provide a valid category channel ID.');
      settings.ticketCategoryId = categoryId;
      await save(settings, guild.id);
      return message.reply(`Ticket category set to <#${categoryId}>.`);
    }

    if (sub === 'channel') {
      if (!settings.ticketCategoryId) {
        return message.reply(`Set up a ticket category first: \`${prefix}ticket setup category <id|create>\``);
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
          return message.reply(`Ticket channel created: <#${ticketChannel.id}> - users can now react to create tickets!`);
        } catch (err: any) {
          return message.reply(`Failed to create ticket channel: ${err.message}`);
        }
      }

      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) return message.reply('Please mention a valid channel or provide a channel ID.');

      let targetChannel = guild.channels?.get(channelId);
      if (!targetChannel) {
        targetChannel = await client.channels.fetch(channelId).catch(() => null);
      }
      if (!targetChannel) return message.reply('Could not find that channel.');

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
          return message.reply(
            `I couldn't update my permissions in <#${channelId}>. ` +
            `Make sure I have **Manage Channels** or manually grant me ` +
            `**Send Messages** and **Add Reactions** in that channel.`
          );
        }
      }

      try {
        await postTicketPanel(targetChannel, guild, settings, client);
        return message.reply(`Ticket panel posted in <#${channelId}> - users can now react to create tickets!`);
      } catch (err: any) {
        return message.reply(`Failed to post ticket panel: ${err.message}`);
      }
    }

    if (sub === 'role') {
      const action = args[1]?.toLowerCase();
      const val = args[2];

      if (!action) {
        const roleIds = getSupportRoleIds(settings);
        if (roleIds.length === 0) return message.reply(`No support roles configured.\n\n\`${prefix}ticket setup role add <@role>\` - add a support role\n\`${prefix}ticket setup role remove <@role>\` - remove a support role\n\`${prefix}ticket setup role clear\` - remove all support roles`);
        return message.reply(`**Support Roles (${roleIds.length}):** ${roleIds.map((id: string) => `<@&${id}>`).join(', ')}`);
      }

      if (action === 'clear') {
        settings.ticketSupportRoleId = null;
        settings.ticketSupportRoleIds = [];
        await save(settings, guild.id);
        return message.reply('All ticket support roles cleared.');
      }

      if (action === 'add') {
        if (!val) return message.reply(`Usage: \`${prefix}ticket setup role add <@role>\``);
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return message.reply('Please mention a valid role or provide a role ID.');
        const current = getSupportRoleIds(settings);
        if (current.includes(roleId)) return message.reply(`<@&${roleId}> is already a support role.`);
        if (current.length >= 10) return message.reply('Maximum of 10 support roles allowed.');
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId = settings.ticketSupportRoleIds[0];
        await save(settings, guild.id);
        return message.reply(`<@&${roleId}> added as a ticket support role. (${settings.ticketSupportRoleIds.length} total)`);
      }

      if (action === 'remove') {
        if (!val) return message.reply(`Usage: \`${prefix}ticket setup role remove <@role>\``);
        const roleId = val.match(/^<@&(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
        if (!roleId) return message.reply('Please mention a valid role or provide a role ID.');
        const current = getSupportRoleIds(settings);
        if (!current.includes(roleId)) return message.reply(`<@&${roleId}> is not a support role.`);
        const updated = current.filter((id: string) => id !== roleId);
        settings.ticketSupportRoleIds = updated;
        settings.ticketSupportRoleId = updated[0] || null;
        await save(settings, guild.id);
        return message.reply(`<@&${roleId}> removed from ticket support roles. (${updated.length} remaining)`);
      }

      const roleId = action.match(/^<@&(\d{17,19})>$/)?.[1] ?? (action.match(/^\d{17,19}$/)?.[0] || null);
      if (roleId) {
        const current = getSupportRoleIds(settings);
        if (current.length >= 10) return message.reply('Maximum of 10 support roles allowed.');
        settings.ticketSupportRoleIds = [...new Set([...current, roleId])];
        settings.ticketSupportRoleId = settings.ticketSupportRoleIds[0];
        await save(settings, guild.id);
        return message.reply(`<@&${roleId}> added as a ticket support role. (${settings.ticketSupportRoleIds.length} total)`);
      }

      return message.reply(`Usage:\n\`${prefix}ticket setup role add <@role>\` - add a support role\n\`${prefix}ticket setup role remove <@role>\` - remove a support role\n\`${prefix}ticket setup role clear\` - remove all\n\`${prefix}ticket setup role\` - list current roles`);
    }

    if (sub === 'log') {
      const val = args[1];
      if (!val) return message.reply(`Usage: \`${prefix}ticket setup log <#channel>\``);
      if (val.toLowerCase() === 'clear') {
        settings.ticketLogChannelId = null;
        await save(settings, guild.id);
        return message.reply('Ticket log channel cleared.');
      }
      const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (val.match(/^\d{17,19}$/)?.[0] || null);
      if (!channelId) return message.reply('Please mention a valid channel or provide a channel ID.');
      settings.ticketLogChannelId = channelId;
      await save(settings, guild.id);
      return message.reply(`Ticket log channel set to <#${channelId}>.`);
    }

    if (sub === 'max') {
      const val = parseInt(args[1]);
      if (isNaN(val) || val < 1 || val > 10) return message.reply(`Usage: \`${prefix}ticket setup max <1-10>\` - max open tickets per user.`);
      settings.ticketMaxOpen = val;
      await save(settings, guild.id);
      return message.reply(`Max open tickets per user set to **${val}**.`);
    }

    if (sub === 'message') {
      const val = args.slice(1).join(' ').trim();
      if (!val) return message.reply(`Usage: \`${prefix}ticket setup message <text>\` or \`${prefix}ticket setup message clear\`\nVariables: \`{user}\` \`{server}\` \`{ticket}\``);
      if (val.toLowerCase() === 'clear') {
        settings.ticketOpenMessage = null;
        await save(settings, guild.id);
        return message.reply('Custom ticket open message cleared.');
      }
      if (val.length > 1000) return message.reply('Message too long (max 1000 characters).');
      settings.ticketOpenMessage = val;
      await save(settings, guild.id);
      return message.reply('Ticket open message set.');
    }

    const cat = settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : 'Not set';
    const roleIds = getSupportRoleIds(settings);
    const role = roleIds.length > 0 ? roleIds.map((id: string) => `<@&${id}>`).join(', ') : 'Not set';
    const log = settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : 'Not set';
    const setupCh = settings.ticketSetupChannelId ? `<#${settings.ticketSetupChannelId}>` : 'Not set';

    const embed = new EmbedBuilder()
      .setTitle('Ticket System Configuration')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Category', value: cat, inline: true },
        { name: 'Ticket Channel', value: setupCh, inline: true },
        { name: 'Support Role', value: role, inline: true },
        { name: 'Log Channel', value: log, inline: true },
        { name: 'Max Open', value: String(settings.ticketMaxOpen || 3), inline: true },
        { name: 'Custom Message', value: settings.ticketOpenMessage ? 'Set' : 'Default', inline: true },
        {
          name: 'Setup Commands', value:
            `\`${prefix}ticket setup category <id|create>\` - set ticket category\n` +
            `\`${prefix}ticket setup channel [#channel|create]\` - set/create the ticket reaction channel\n` +
            `\`${prefix}ticket setup role add/remove <@role>\` - manage support roles\n` +
            `\`${prefix}ticket setup log <#channel>\` - set transcript log channel\n` +
            `\`${prefix}ticket setup max <1-10>\` - max open tickets per user\n` +
            `\`${prefix}ticket setup message <text>\` - custom open message ({user} {server} {ticket})`,
          inline: false
        },
      )
      .setTimestamp(new Date());

    return message.reply({ embeds: [embed] });
  },

  async claim(message, args, guild, settings, client, prefix) {
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply('This command can only be used inside an open ticket channel.');

    if ((ticket as any).claimedBy) {
      return message.reply(`This ticket is already claimed by <@${(ticket as any).claimedBy}>.`);
    }

    (ticket as any).claimedBy = message.author.id;
    (ticket as any).claimedAt = new Date();
    await ticket.save();

    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${(ticket as any).ticketNumber} - Claimed`)
      .setDescription(`<@${message.author.id}> has claimed this ticket and will be handling it.`)
      .setColor(0x2ecc71)
      .setTimestamp(new Date());

    return message.reply({ embeds: [embed] });
  },

  async close(message, args, guild, settings, client, _prefix) {
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });

    if (!ticket) {
      return message.reply('This channel is not an open ticket. Use this command inside a ticket channel.');
    }

    const reason = args.join(' ').trim() || 'No reason provided';

    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${(ticket as any).ticketNumber} - Closed`)
      .setDescription(`Closed by <@${message.author.id}>`)
      .setColor(0xED4245)
      .addFields({ name: 'Reason', value: reason, inline: false });

    if ((ticket as any).claimedBy) {
      embed.addFields({ name: 'Claimed By', value: `<@${(ticket as any).claimedBy}>`, inline: true });
    }

    embed.setTimestamp(new Date());

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
            .setTitle(`Ticket #${(ticket as any).ticketNumber} Closed`)
            .setColor(0xED4245)
            .addFields({ name: 'Opened By', value: `<@${(ticket as any).openedBy}>`, inline: true })
            .addFields({ name: 'Closed By', value: `<@${message.author.id}>`, inline: true });

          if ((ticket as any).claimedBy) {
            logEmbed.addFields({ name: 'Claimed By', value: `<@${(ticket as any).claimedBy}>`, inline: true });
          }

          logEmbed.addFields({ name: 'Reason', value: reason, inline: false });

          if ((ticket as any).subject) {
            logEmbed.addFields({ name: 'Subject', value: (ticket as any).subject, inline: false });
          }

          logEmbed.addFields({ name: 'Messages', value: String(transcriptMessages.length), inline: true })
            .setTimestamp(new Date());

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
          .setTitle(`Ticket #${(ticket as any).ticketNumber} - Closed`)
          .setDescription(`Your ticket in **${guild.name}** was closed by <@${message.author.id}>.`)
          .setColor(0xED4245)
          .addFields({ name: 'Reason', value: reason, inline: false })
          .setTimestamp(new Date());
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
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply('This command can only be used inside an open ticket channel.');

    const userId = args[0]?.match(/^<@!?(\d{17,19})>$/)?.[1] ?? (args[0]?.match(/^\d{17,19}$/)?.[0] || null);
    if (!userId) return message.reply(`Usage: \`${prefix}ticket add <@user>\``);

    const channel = guild.channels?.get(channelId);
    if (!channel) return message.reply('Could not find this channel.');

    try {
      await channel.editPermission(userId, {
        type: 1,
        allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages),
      });

      if (!(ticket as any).participants.includes(userId)) {
        (ticket as any).participants.push(userId);
        await ticket.save();
      }

      return message.reply(`<@${userId}> has been added to this ticket.`);
    } catch (err: any) {
      return message.reply(`Failed to add user: ${err.message}`);
    }
  },

  async remove(message, args, guild, settings, client, prefix) {
    const access = await getMemberWithTicketAccess(message, guild, settings);
    if (!access.ok) return message.reply(access.reason);

    const channelId = (message as any).channelId || (message as any).channel?.id;
    const ticket = await Ticket.findOne({ channelId, status: 'open' });
    if (!ticket) return message.reply('This command can only be used inside an open ticket channel.');

    const userId = args[0]?.match(/^<@!?(\d{17,19})>$/)?.[1] ?? (args[0]?.match(/^\d{17,19}$/)?.[0] || null);
    if (!userId) return message.reply(`Usage: \`${prefix}ticket remove <@user>\``);

    if (userId === (ticket as any).openedBy) return message.reply('You cannot remove the person who opened the ticket.');

    const channel = guild.channels?.get(channelId);
    if (!channel) return message.reply('Could not find this channel.');

    try {
      await channel.deletePermission(userId);
      (ticket as any).participants = (ticket as any).participants.filter((id: string) => id !== userId);
      await ticket.save();
      return message.reply(`<@${userId}> has been removed from this ticket.`);
    } catch (err: any) {
      return message.reply(`Failed to remove user: ${err.message}`);
    }
  },

  async panel(message, args, guild, settings, client, prefix) {
    if (!settings.ticketCategoryId) {
      return message.reply(`Ticket system is not set up. Run \`${prefix}ticket setup category <id|create>\` first.`);
    }

    const channelMention = args[0];
    const channelId = (channelMention?.match(/^<#(\d{17,19})>$/)?.[1]
      ?? (channelMention?.match(/^\d{17,19}$/)?.[0] || null))
      || (message as any).channelId || (message as any).channel?.id;

    let targetChannel = guild.channels?.get(channelId);
    if (!targetChannel) {
      targetChannel = await client.channels.fetch(channelId).catch(() => null);
    }
    if (!targetChannel) return message.reply('Could not find the target channel.');

    try {
      await postTicketPanel(targetChannel, guild, settings, client);
      if (channelId !== ((message as any).channelId || (message as any).channel?.id)) {
        return message.reply(`Ticket panel posted in <#${channelId}> - users can react to create tickets!`);
      }
    } catch (err: any) {
      return message.reply(`Failed to send panel: ${err.message}`);
    }
  },
};

function showHelp(message: any, prefix = '!') {
  return message.reply(
    '**Ticket System**\n' +
    `\`${prefix}ticket claim\` - claim this ticket (shows you're handling it)\n` +
    `\`${prefix}ticket close [reason]\` - close the current ticket\n` +
    `\`${prefix}ticket add <@user>\` - add a user to the ticket\n` +
    `\`${prefix}ticket remove <@user>\` - remove a user from the ticket\n` +
    `\`${prefix}ticket panel [#channel]\` - post the ticket reaction panel\n` +
    `\`${prefix}ticket setup\` - configure the ticket system (admin)\n\n` +
    '*To create a ticket, react to the ticket panel message in the designated channel.*'
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
    if (!guild) return void await message.reply('This command can only be used in a server.');

    const sub = args[0]?.toLowerCase();

    if (sub === 'open') {
      return void await message.reply(`Tickets are now created by reacting to the ticket panel. Ask an admin to run \`${prefix}ticket setup channel create\` if no panel is set up yet.`);
    }

    if (!sub || !subcommands[sub]) {
      return showHelp(message, prefix);
    }

    if (sub === 'setup' || sub === 'panel') {
      let member = guild.members?.get(message.author.id);
      if (!member) try { member = await guild.fetchMember(message.author.id); } catch { }
      if (member) {
        const perms = member.permissions;
        if (!perms?.has(PermissionFlags.ManageGuild) && !perms?.has(PermissionFlags.Administrator)) {
          return void await message.reply('You need **Manage Server** permission to configure tickets.');
        }
      }
    }

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !ticket (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !ticket: ${error.message || error}`);
        message.reply('An error occurred while processing the ticket command.').catch(() => { });
      }
    }
  }
};

export default command;
