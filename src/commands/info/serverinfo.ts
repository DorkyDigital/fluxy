import { EmbedBuilder } from '@erinjs/core';
import { Routes } from '@erinjs/types';
import type { Command } from '../../types';
import isNetworkError from '../../utils/isNetworkError';
import * as memberCounter from '../../utils/memberCounter';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'serverinfo',
  description: 'Show server stats \u2014 owner, member count, channels, roles, and creation date',
  usage: '',
  category: 'info',
  cooldown: 5,

  async execute(message, _args, client) {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.serverinfo.serverOnly'));
    }

    try {
      const settings = await settingsCache.get(guild.id).catch(() => null);
      const lang = normalizeLocale(settings?.language);
      const ownerId = guild.ownerId;

      let textChannels = 0;
      let voiceChannels = 0;
      let categories = 0;

      if (guild.channels.cache) {
        guild.channels.cache.forEach((channel: any) => {
          if (channel.type === 0) textChannels++;
          else if (channel.type === 2) voiceChannels++;
          else if (channel.type === 4) categories++;
        });
      } else if (guild.channels.size) {
        for (const channel of guild.channels.values()) {
          if ((channel as any).type === 0) textChannels++;
          else if ((channel as any).type === 2) voiceChannels++;
          else if ((channel as any).type === 4) categories++;
        }
      }

      let memberCount = 0;
      try {
        const guildData: any = await client.rest.get(Routes.guild(guild.id));
        if (typeof guildData?.member_count === 'number' && guildData.member_count > 0) {
          memberCount = guildData.member_count;
        } else {
          const cached = memberCounter.get(guild.id);
          if (cached) {
            memberCount = cached;
          } else {
            let lastId: string | undefined;
            while (true) {
              const qs = `?limit=1000${lastId ? `&after=${lastId}` : ''}`;
              const list: any = await client.rest.get(Routes.guildMembers(guild.id) + qs, { auth: true } as any);
              const arr = Array.isArray(list) ? list : [];
              memberCount += arr.length;
              if (arr.length < 1000) break;
              lastId = arr[arr.length - 1]?.user?.id;
              if (!lastId) break;
            }
          }
        }
      } catch {
        memberCount = memberCounter.get(guild.id) || guild.members?.size || 0;
      }

      const roleCount = guild.roles?.cache?.size || guild.roles?.size || 0;

      const createdAt = guild.createdAt ? new Date(guild.createdAt) : new Date(parseInt(guild.id) / 4194304 + 1420070400000);
      const localeForDate = lang === 'en' ? 'en-US' : lang;
      const createdString = createdAt.toLocaleDateString(localeForDate, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const features = guild.features?.length ? guild.features.join(', ') : t(lang, 'commands.serverinfo.none');

      const embed = new EmbedBuilder()
        .setTitle(guild.name)
        .setColor(0x3498db)
        .setThumbnail(guild.iconURL?.() || null)
        .addFields(
          { name: t(lang, 'commands.serverinfo.fieldId'), value: guild.id, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldOwner'), value: `<@${ownerId}>`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldMembers'), value: `${memberCount}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldTextChannels'), value: `${textChannels}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldVoiceChannels'), value: `${voiceChannels}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldCategories'), value: `${categories}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldRoles'), value: `${roleCount}`, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldCreated'), value: createdString, inline: true },
          { name: t(lang, 'commands.serverinfo.fieldFeatures'), value: (features.substring(0, 1024) || t(lang, 'commands.serverinfo.none')), inline: false }
        );

      await message.reply({ embeds: [embed] });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !serverinfo (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !serverinfo: ${error.message || error}`);
        message.reply(t('en', 'commands.serverinfo.genericError')).catch(() => {});
      }
    }
  }
};

export default command;
