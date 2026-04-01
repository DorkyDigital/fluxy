// i lwk want to remove this entire thing but people want it instead of tickets for some reason 🥀

import type { BotEvent } from '../types';
import { EmbedBuilder } from '@fluxerjs/core';
import automod from '../automod';
import ghostPing from '../automod/modules/ghostPing';
import honeypot from '../automod/modules/honeypot';
import settingsCache from '../utils/settingsCache';
import * as messageCache from '../utils/messageCache';
import Ticket from '../models/Ticket';
import config from '../config';
import { requestDMProcess } from '../utils/dmCoordinator';
import { t, normalizeLocale } from '../i18n';

async function handleInboxMessage(message: any, client: any, settings: any): Promise<void> {
  message.delete().catch(() => { });

  const content = message.content?.trim();
  if (!content) return;

  if (!settings.staffChannelId) {
    console.warn(`[${message.guild?.name ?? message.guildId}] Report inbox received a message but no staff output channel is configured.`);
    return;
  }

  const author = message.author;
  const embed = new EmbedBuilder()
    .setTitle('New Staff Report')
    .setColor(0xED4245)
    .setDescription(content)
    .addFields(
      { name: 'Reporter', value: `${author.username} (<@${author.id}>)`, inline: true },
      { name: 'User ID', value: author.id, inline: true },
      { name: 'Via', value: 'Report inbox channel', inline: true }
    )
    .setThumbnail(author.displayAvatarURL?.() ?? author.avatarURL ?? null)
    .setFooter({ text: 'This report is only visible to staff' })
    .setTimestamp(new Date());

  const guild = message.guild;
  let staffChannel: any;
  try {
    staffChannel = guild?.channels?.get(settings.staffChannelId) ?? null;
    if (!staffChannel) {
      staffChannel = await client.channels.fetch(settings.staffChannelId).catch(() => null);
    }
  } catch {
    staffChannel = null;
  }

  if (!staffChannel) {
    console.warn(`[${guild?.name ?? message.guildId}] Staff output channel ${settings.staffChannelId} not found when forwarding inbox report.`);
    return;
  }

  const rolePing = settings.staffRoleId ? `<@&${settings.staffRoleId}>` : null;
  await staffChannel.send({
    content: rolePing ?? undefined,
    embeds: [embed]
  }).catch((err: any) => {
    console.error(`[${guild?.name ?? message.guildId}] Failed to forward inbox report: ${err.message || err}`);
  });
}

async function handleMention(message: any, client: any): Promise<void> {
  const guildId = message.guildId || message.guild?.id;

  let prefix = config.prefix;
  if (guildId) {
    try {
      const settings = await settingsCache.get(guildId);
      if (settings?.prefixes?.length) prefix = settings.prefixes[0];
    } catch { }
  }

  const categories = client.commandHandler?.getCommandsByCategory() ?? {};

  const embed = new EmbedBuilder()
    .setTitle('👋 Hey there!')
    .setDescription(
      `My prefix in this server is **\`${prefix}\`**\n` +
      `Use \`${prefix}help\` to see all commands, or \`${prefix}help <command>\` for details on a specific one.\n\n` +
      `**📖 [Full Documentation](https://docs.fluxy.gay)**`
    )
    .setColor(0x6c72f8)
    .setTimestamp(new Date())
    .setFooter({ text: `Fluxy v${require('../../package.json').version}` });

  for (const [category, commands] of Object.entries(categories) as [string, any[]][]) {
    if (category === 'owner') continue;
    const visible = commands.filter((c: any) => !c.hidden);
    if (!visible.length) continue;
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    embed.addFields({
      name: label,
      value: visible.map((c: any) => `\`${c.name}\``).join('  '),
      inline: false,
    });
  }

  await message.reply({ embeds: [embed] }).catch(() => {
    message.reply(
      `My prefix here is **\`${prefix}\`** - use \`${prefix}help\` to see all commands.\n📖 Docs: https://docs.fluxy.gay`
    ).catch(() => { });
  });
}

const event: BotEvent = {
  name: 'messageCreate',

  async execute(message: any, client: any) {
    if (message.author?.bot) return;

    const guildId = message.guildId || message.guild?.id;

    if (!guildId) {
      const granted = await requestDMProcess(message.id);
      if (!granted) return;
    }

    if (message.content && client.user) {
      const mentionPatterns = [
        `<@${client.user.id}>`,
        `<@!${client.user.id}>`,
      ];
      const trimmed = message.content.trim();
      if (mentionPatterns.some((m: string) => trimmed === m || trimmed.startsWith(m + ' '))) {
        await handleMention(message, client);
        return;
      }
    }

    if (guildId) {
      let settings: any = null;
      try {
        settings = await settingsCache.get(guildId);
      } catch (err: any) {
        console.error(`Failed to fetch settings for guild ${guildId} in messageCreate event: ${err.message || err}`);
      }

      const channelId = message.channelId || message.channel?.id;

      if (channelId) {
        try {
          const { verificationSessions } = await import('../commands/admin/verify');
          const session = verificationSessions.get(channelId);

          if (session && message.author.id === session.userId && message.content) {
            const answer = message.content.trim().toUpperCase();
            const lang = normalizeLocale(settings?.language);

            if (answer === session.code) {
              clearTimeout(session.timeout);
              verificationSessions.delete(channelId);

              const verification = settings?.verification;
              if (verification?.verifiedRoleId) {
                try {
                  const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                  if (guild) {
                    let member = guild.members?.get(message.author.id);
                    if (!member) {
                      try { member = await guild.fetchMember(message.author.id); } catch {}
                    }
                    if (member) {
                      try {
                        await member.addRole(verification.verifiedRoleId);
                        console.log(`[verification] Granted verified role to ${message.author.id} in ${guild.name}`);
                      } catch (roleErr: any) {
                        const isNetworkError = (await import('../utils/isNetworkError')).default;
                        if (isNetworkError(roleErr)) {
                          const roleQueue = await import('../utils/roleQueue');
                          roleQueue.enqueue(guild.id, message.author.id, verification.verifiedRoleId, 'add');
                          console.log(`[verification] Queued verified role for ${message.author.id} (network error)`);
                        } else {
                          console.error(`[verification] Failed to add verified role: ${roleErr.message}`);
                        }
                      }
                    }
                  }
                } catch (err: any) {
                  console.error(`[verification] Failed to add verified role: ${err.message}`);
                }
              }

              try {
                const successEmbed = new EmbedBuilder()
                  .setTitle(t(lang, 'verification.result.passedTitle'))
                  .setDescription(t(lang, 'verification.result.passedDescription'))
                  .setColor(0x2ecc71);
                await message.reply({ embeds: [successEmbed] });
              } catch { }

              if (verification?.logChannelId) {
                try {
                  const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                  if (guild) {
                    const logChannel = guild.channels?.get(verification.logChannelId) || await client.channels.fetch(verification.logChannelId).catch(() => null);
                    if (logChannel) {
                      const logEmbed = new EmbedBuilder()
                        .setTitle(t(lang, 'verification.log.passedTitle'))
                        .setDescription(t(lang, 'verification.log.passedDescription', { userId: message.author.id }))
                        .setColor(0x2ecc71)
                        .setTimestamp(new Date());
                      await logChannel.send({ embeds: [logEmbed] });
                    }
                  }
                } catch { }
              }

              setTimeout(async () => {
                try {
                  const ch = message.guild?.channels?.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
                  if (ch) await ch.delete();
                } catch { }
              }, 3000);

              return;
            } else {
              session.attempts++;

              if (session.attempts >= session.maxAttempts) {
                clearTimeout(session.timeout);
                verificationSessions.delete(channelId);

                try {
                  const failEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'verification.result.failedTitle'))
                    .setDescription(t(lang, 'verification.result.failedDescription'))
                    .setColor(0xe74c3c);
                  await message.reply({ embeds: [failEmbed] });
                } catch { }

                const verification = settings?.verification;
                if (verification?.logChannelId) {
                  try {
                    const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId) : null);
                    if (guild) {
                      const logChannel = guild.channels?.get(verification.logChannelId) || await client.channels.fetch(verification.logChannelId).catch(() => null);
                      if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                          .setTitle(t(lang, 'verification.log.failedTitle'))
                          .setDescription(t(lang, 'verification.log.failedDescription', { userId: message.author.id }))
                          .setColor(0xe74c3c)
                          .setTimestamp(new Date());
                        await logChannel.send({ embeds: [logEmbed] });
                      }
                    }
                  } catch { }
                }

                if (session.panelChannelId && session.panelMessageId) {
                  try {
                    const { Routes } = await import('@fluxerjs/types');
                    await client.rest.delete(
                      `${Routes.channelMessageReaction(session.panelChannelId, session.panelMessageId, '✅')}/${message.author.id}`
                    );
                  } catch { }
                }

                setTimeout(async () => {
                  try {
                    const ch = message.guild?.channels?.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
                    if (ch) await ch.delete();
                  } catch { }
                }, 3000);

                return;
              } else {
                const remaining = session.maxAttempts - session.attempts;
                try {
                  const retryEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'verification.result.incorrectTitle'))
                    .setDescription(t(lang, 'verification.result.incorrectDescription', { remaining }))
                    .setColor(0xf39c12);
                  await message.reply({ embeds: [retryEmbed] });
                } catch { }
                return;
              }
            }
          }
        } catch { }
      }

      if (channelId && (message.content || message.attachments?.size)) {
        Ticket.findOneAndUpdate(
          { channelId, status: 'open' },
          {
            $push: {
              transcript: {
                authorId: message.author.id,
                authorName: message.author.username || message.author.id,
                avatarURL: message.author.avatarURL?.() || message.author.avatar || null,
                content: message.content,
                attachments: (message.attachments?.values?.()
                  ? [...message.attachments.values()].map((a: any) => ({ url: a.url, name: a.filename || a.name || 'file' }))
                  : []),
                timestamp: new Date(),
              },
            },
          },
        ).catch(() => { });
      }

      if (settings?.staffInboxChannelId && channelId === settings.staffInboxChannelId) {
        await handleInboxMessage(message, client, settings);
        return;
      }

      const honeypotTriggered = await honeypot.check(message, client, settings);
      if (honeypotTriggered) return;

      if (message.content) {
        ghostPing.storeMessage(message);
        messageCache.store(message.id, message.content);
      }

      const violationDetected = await automod.check(message, client);
      if (violationDetected) return;
    }

    if (client.commandHandler) {
      await client.commandHandler.handleMessage(message);
    }
  }
};

export default event;
