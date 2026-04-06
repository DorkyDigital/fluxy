import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'roleinfo',
  description: 'Show details about a role \u2014 ID, color, position, whether it is hoisted, mentionable, or managed by an integration',
  usage: '<@role or role ID>',
  category: 'info',
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.roleinfo.serverOnly'));
    const settings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(settings?.language);

    const roleArg = args[0];
    if (!roleArg) return void await message.reply(t(lang, 'commands.roleinfo.usage', { prefix }));

    const roleMention = roleArg.match(/^<@&(\d{17,19})>$/);
    let roleId: string;
    if (roleMention) roleId = roleMention[1];
    else if (/^\d{17,19}$/.test(roleArg)) roleId = roleArg;
    else return void await message.reply(t(lang, 'commands.roleinfo.invalidRoleInput'));

    try {
      let role: any = guild.roles?.get(roleId);
      if (!role) {
        try { role = await guild.fetchRole(roleId); } catch {}
      }
      if (!role) return void await message.reply(t(lang, 'commands.roleinfo.roleNotFound'));

      const createdAt = new Date(Number(BigInt(role.id) / 4194304n + 1420070400000n));
      const localeForDate = lang === 'en' ? 'en-US' : lang;
      const createdStr = createdAt.toLocaleDateString(localeForDate, {
        year: 'numeric', month: 'long', day: 'numeric'
      });

      const colorHex = role.color && role.color !== 0
        ? `#${role.color.toString(16).padStart(6, '0').toUpperCase()}`
        : t(lang, 'commands.roleinfo.defaultColor');

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.roleinfo.title', { roleName: role.name }))
        .setColor(role.color || 0x5865F2)
        .addFields(
          { name: t(lang, 'commands.roleinfo.fieldId'), value: role.id, inline: true },
          { name: t(lang, 'commands.roleinfo.fieldColor'), value: colorHex, inline: true },
          { name: t(lang, 'commands.roleinfo.fieldPosition'), value: `${role.position ?? t(lang, 'commands.roleinfo.unknown')}`, inline: true },
          { name: t(lang, 'commands.roleinfo.fieldHoisted'), value: role.hoist ? t(lang, 'commands.roleinfo.yes') : t(lang, 'commands.roleinfo.no'), inline: true },
          { name: t(lang, 'commands.roleinfo.fieldMentionable'), value: role.mentionable ? t(lang, 'commands.roleinfo.yes') : t(lang, 'commands.roleinfo.no'), inline: true },
          { name: t(lang, 'commands.roleinfo.fieldManaged'), value: role.managed ? t(lang, 'commands.roleinfo.managedYes') : t(lang, 'commands.roleinfo.no'), inline: true },
          { name: t(lang, 'commands.roleinfo.fieldCreated'), value: createdStr, inline: false },
        );

      return void await message.reply({ embeds: [embed] });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !roleinfo (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !roleinfo: ${error.message || error}`);
        message.reply(t(lang, 'commands.roleinfo.genericError')).catch(() => {});
      }
    }
  }
};

export default command;
