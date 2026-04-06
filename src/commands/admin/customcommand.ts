import type { Command } from '../../types';
import { EmbedBuilder } from '@erinjs/core';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { t, normalizeLocale } from '../../i18n';

const RESERVED_NAMES = [
  'help', 'ticket', 'automod', 'ban', 'kick', 'warn', 'mute', 'unmute',
  'clear', 'timeout', 'lockdown', 'setlog', 'setserverlog', 'setstaff',
  'setprefix', 'clearprefix', 'blacklist', 'welcome', 'autorole',
  'reactionrole', 'rr', 'roleall', 'roleclear', 'status', 'report',
  'honeypot', 'hp', 'keywords', 'customcommand', 'cc',
  'toggle-automod', 'toggle-antispam', 'toggle-antilink',
  'toggle-antireactionspam', 'toggle-ghostping',
  'serverinfo', 'userinfo', 'avatar', 'ping', 'uptime',
  'warnings', 'slowmode', 'nick'
];

const MAX_COMMANDS = 5;
const MAX_RESPONSE_LENGTH = 2000;

function parseColor(str?: string): string | null {
  if (!str) return null;
  const hex = str.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  return null;
}

const subcommands: Record<string, (message: any, args: string[], guild: any, settings: any) => Promise<any>> = {

  async add(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const name = args[0]?.toLowerCase();
    if (!name) {
      return message.reply(
        t(lang, 'auditCatalog.commands.admin.customcommand.l35_reply')
      );
    }

    if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l41_reply'));
    }

    if (RESERVED_NAMES.includes(name)) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l45_reply', { name }));
    }

    const response = args.slice(1).join(' ').trim();
    if (!response) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l50_reply'));
    }

    if (response.length > MAX_RESPONSE_LENGTH) {
      return message.reply(
        t(lang, 'auditCatalog.commands.admin.customcommand.l54_reply', {
          'response.length': response.length,
          MAX_RESPONSE_LENGTH,
        })
      );
    }

    const existing = settings.customCommands?.find((c: any) => c.name === name);
    if (existing) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l59_reply', { name }));
    }

    if ((settings.customCommands?.length || 0) >= MAX_COMMANDS) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l63_reply', { MAX_COMMANDS }));
    }

    settings.customCommands.push({
      name,
      response: response.replace(/\\n/g, '\n'),
      embed: false,
      color: null,
      title: null,
      enabled: true,
      actionType: 'reply',
      targetRoleId: null,
      requiredRoleIds: [],
      requiredPermission: null,
      allowedChannelIds: [],
      cooldownSeconds: 0,
      deleteTrigger: false,
    });
    settings.markModified('customCommands');
    await settings.save();
    settingsCache.invalidate(guild.id);

    return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l85_reply', { name }));
  },

  async remove(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const name = args[0]?.toLowerCase();
    if (!name) return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l90_reply'));

    const idx = settings.customCommands?.findIndex((c: any) => c.name === name);
    if (idx === undefined || idx === -1) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l94_reply', { name }));
    }

    settings.customCommands.splice(idx, 1);
    settings.markModified('customCommands');
    await settings.save();
    settingsCache.invalidate(guild.id);

    return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l102_reply', { name }));
  },

  async edit(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const name = args[0]?.toLowerCase();
    if (!name) return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l107_reply'));

    const response = args.slice(1).join(' ').trim();
    if (!response) return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l110_reply'));

    if (response.length > MAX_RESPONSE_LENGTH) {
      return message.reply(
        t(lang, 'auditCatalog.commands.admin.customcommand.l54_reply', {
          'response.length': response.length,
          MAX_RESPONSE_LENGTH,
        })
      );
    }

    const cmd = settings.customCommands?.find((c: any) => c.name === name);
    if (!cmd) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l94_reply', { name }));
    }

    cmd.response = response.replace(/\\n/g, '\n');
    settings.markModified('customCommands');
    await settings.save();
    settingsCache.invalidate(guild.id);

    return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l126_reply', { name }));
  },

  async embed(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const name = args[0]?.toLowerCase();
    const toggle = args[1]?.toLowerCase();

    if (!name || !['on', 'off'].includes(toggle)) {
      return message.reply(
        t(lang, 'auditCatalog.commands.admin.customcommand.l135_reply')
      );
    }

    const cmd = settings.customCommands?.find((c: any) => c.name === name);
    if (!cmd) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l94_reply', { name }));
    }

    cmd.embed = toggle === 'on';

    if (toggle === 'on') {
      const colorArg = args[2];
      const color = parseColor(colorArg);
      if (color) {
        cmd.color = color;
        const title = args.slice(3).join(' ').trim() || null;
        cmd.title = title;
      } else if (colorArg) {
        cmd.title = args.slice(2).join(' ').trim() || null;
      }
    }

    settings.markModified('customCommands');
    await settings.save();
    settingsCache.invalidate(guild.id);

    if (cmd.embed) {
      let reply = t(lang, 'auditCatalog.commands.admin.customcommand.l164_reply', { name });
      if (cmd.color) {
        reply += ` ${t(lang, 'auditCatalog.commands.admin.customcommand.l165_reply', { 'cmd.color': cmd.color })}`;
      }
      if (cmd.title) {
        reply += ` ${t(lang, 'auditCatalog.commands.admin.customcommand.l166_reply', { 'cmd.title': cmd.title })}`;
      }
      return message.reply(reply);
    }
    return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l169_reply', { name }));
  },

  async list(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const commands = settings.customCommands || [];
    if (commands.length === 0) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l175_reply'));
    }

    const lines = commands.map((c: any, i: number) => {
      const preview = c.response.length > 60 ? c.response.substring(0, 57) + '...' : c.response;
      const flags = c.embed ? t(lang, 'auditCatalog.commands.admin.customcommand.l180_reply') : '';
      return `**${i + 1}.** \`!${c.name}\`${flags} - ${preview}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'auditCatalog.commands.admin.customcommand.l185_setTitle', { 'guild.name': guild.name }))
      .setDescription(lines.join('\n'))
      .setColor(0x5865F2)
      .setFooter({
        text: t(lang, 'auditCatalog.commands.admin.customcommand.l188_setFooter', {
          'commands.length': commands.length,
          MAX_COMMANDS,
        }),
      });

    return message.reply({ embeds: [embed] });
  },

  async info(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const name = args[0]?.toLowerCase();
    if (!name) return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l195_reply'));

    const cmd = settings.customCommands?.find((c: any) => c.name === name);
    if (!cmd) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l94_reply', { name }));
    }

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'auditCatalog.commands.admin.customcommand.l203_setTitle', { 'cmd.name': cmd.name }))
      .setColor(0x5865F2)
      .addFields(
        {
          name: t(lang, 'auditCatalog.commands.admin.customcommand.l206_addFields_name'),
          value: cmd.response.length > 1024 ? cmd.response.substring(0, 1021) + '...' : cmd.response,
        },
        {
          name: t(lang, 'auditCatalog.commands.admin.customcommand.l207_addFields_name'),
          value: cmd.embed
            ? t(lang, 'verification.status.enabledYes')
            : t(lang, 'verification.status.enabledNo'),
          inline: true
        }
      );

    if (cmd.embed && cmd.color) {
      embed.addFields({ name: t(lang, 'commands.roleinfo.fieldColor'), value: cmd.color, inline: true });
    }
    if (cmd.embed && cmd.title) {
      embed.addFields({ name: t(lang, 'auditCatalog.commands.admin.customcommand.l211_addFields_name'), value: cmd.title, inline: true });
    }

    return message.reply({ embeds: [embed] });
  }
};

function showHelp(message: any, lang: string) {
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'auditCatalog.commands.admin.customcommand.l219_setTitle'))
    .setColor(0x5865F2)
    .setDescription(t(lang, 'auditCatalog.commands.admin.customcommand.l221_setDescription'))
    .addFields(
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l223_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l223_addFields_value')
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l224_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l224_addFields_value')
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l225_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l225_addFields_value')
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l226_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l226_addFields_value')
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l227_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l227_addFields_value')
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.customcommand.l228_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.customcommand.l228_addFields_value')
      }
    )
    .setFooter({ text: t(lang, 'auditCatalog.commands.admin.customcommand.l230_setFooter') });

  return message.reply({ embeds: [embed] });
}

const command: Command = {
  name: 'customcommand',
  aliases: ['cc'],
  description: 'Create and manage custom commands with configurable responses.',
  usage: '<add|remove|edit|embed|list|info> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.admin.keywords.serverOnly'));

    const settings: any = await GuildSettings.getOrCreate(guild.id);
    const lang = normalizeLocale(settings?.language);
    if (!settings.customCommands) settings.customCommands = [];

    const sub = args[0]?.toLowerCase();

    if (!sub || !subcommands[sub]) {
      return showHelp(message, lang);
    }

    try {
      await subcommands[sub](message, args.slice(1), guild, settings);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !customcommand (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !customcommand: ${error.message || error}`);
        message.reply(t(lang, 'auditCatalog.commands.admin.customcommand.l265_reply')).catch(() => {});
      }
    }
  }
};

export default command;
