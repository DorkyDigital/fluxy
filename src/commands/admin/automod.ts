import type { Command } from '../../types';
import { EmbedBuilder } from '@erinjs/core';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { t, normalizeLocale } from '../../i18n';

const VALID_LEVELS = ['off', 'minimal', 'medium', 'high'];

function levelDescription(lang: string, level: string): string {
  return t(lang, `commands.admin.automod.levelDescriptions.${level}`);
}

function yn(bool: any, lang: string): string {
  return bool ? t(lang, 'commands.admin.automod.yes') : t(lang, 'commands.admin.automod.no');
}


function parseRoleId(arg?: string): string | null {
  const m = arg?.match(/^<@&(\d{17,19})>$/);
  return m ? m[1] : (/^\d{17,19}$/.test(arg || '') ? arg! : null);
}

function parseChannelId(arg?: string): string | null {
  const m = arg?.match(/^<#(\d{17,19})>$/);
  return m ? m[1] : (/^\d{17,19}$/.test(arg || '') ? arg! : null);
}

async function showStatus(message: any, guild: any, settings: any, lang: string) {
  const am = settings.automod || {};
  const spam = am.spam || {};
  const exemptRoles    = (am.exemptRoles    || []).map((id: string) => `<@&${id}>`).join(', ') || t(lang, 'commands.admin.automod.status.none');
  const exemptChannels = (am.exemptChannels || []).map((id: string) => `<#${id}>`).join(', ')   || t(lang, 'commands.admin.automod.status.none');
  const customDomains  = (am.allowedDomains || []).join(', ') || t(lang, 'commands.admin.automod.status.none');
  const level = am.level || 'off';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.automod.status.title', { guildName: guild.name }))
    .setColor(0x5865F2)
    .addFields(
      { name: t(lang, 'commands.admin.automod.status.fieldLevel'), value: t(lang, 'commands.admin.automod.status.levelValue', { level, description: levelDescription(lang, level) }) },
      { name: t(lang, 'commands.admin.automod.status.fieldAntiSpam'), value: yn(am.antiSpam, lang),  inline: true },
      { name: t(lang, 'commands.admin.automod.status.fieldAntiLink'), value: yn(am.antiLink, lang),  inline: true },
      { name: t(lang, 'commands.admin.automod.status.fieldAntiReactionSpam'), value: yn(am.antiReactionSpam, lang), inline: true },
      { name: t(lang, 'commands.admin.automod.status.fieldGhostPing'), value: yn(am.ghostPing, lang), inline: true },
      {
        name: t(lang, 'commands.admin.automod.status.fieldSpamThresholds'),
        value: t(lang, 'commands.admin.automod.status.spamThresholdsValue', {
          maxMessages: spam.maxMessages ?? 5,
          timeWindow: spam.timeWindow ?? 5,
          violationThreshold: spam.violationThreshold ?? 3,
          timeoutDuration: spam.timeoutDuration ?? 10,
        })
      },
      { name: t(lang, 'commands.admin.automod.status.fieldAllowedDomains'), value: customDomains },
      { name: t(lang, 'commands.admin.automod.status.fieldExemptRoles'), value: exemptRoles },
      { name: t(lang, 'commands.admin.automod.status.fieldExemptChannels'), value: exemptChannels }
    )
    .setFooter({ text: t(lang, 'commands.admin.automod.status.footer') })

  return message.reply({ embeds: [embed] });
}

const subcommands: Record<string, (message: any, args: string[], guild: any, settings: any) => Promise<any>> = {

  async status(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    return showStatus(message, guild, settings, lang);
  },

  async level(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const lvl = args[0]?.toLowerCase();
    if (!lvl || !VALID_LEVELS.includes(lvl)) {
      return message.reply(t(lang, 'commands.admin.automod.level.validLevels', { levels: VALID_LEVELS.join('`, `') }));
    }

    settings.automod.level = lvl;

    const presets: Record<string, { antiSpam: boolean; antiLink: boolean; antiReactionSpam: boolean }> = {
      off:     { antiSpam: false, antiLink: false, antiReactionSpam: false },
      minimal: { antiSpam: true,  antiLink: false, antiReactionSpam: false },
      medium:  { antiSpam: true,  antiLink: true,  antiReactionSpam: true  },
      high:    { antiSpam: true,  antiLink: true,  antiReactionSpam: true  }
    };
    Object.assign(settings.automod, presets[lvl]);

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    return message.reply(t(lang, 'commands.admin.automod.level.setDone', { level: lvl, description: levelDescription(lang, lvl) }));
  },

  async spam(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [sub, rawVal] = args;
    const val = parseInt(rawVal, 10);

    if (!settings.automod.spam) settings.automod.spam = {};

    switch (sub) {
      case 'messages': {
        if (isNaN(val) || val < 2 || val > 20) return message.reply(t(lang, 'commands.admin.automod.spam.messagesRange'));
        settings.automod.spam.maxMessages = val;
        break;
      }
      case 'window': {
        if (isNaN(val) || val < 1 || val > 60) return message.reply(t(lang, 'commands.admin.automod.spam.windowRange'));
        settings.automod.spam.timeWindow = val;
        break;
      }
      case 'timeout': {
        if (isNaN(val) || val < 1 || val > 60) return message.reply(t(lang, 'commands.admin.automod.spam.timeoutRange'));
        settings.automod.spam.timeoutDuration = val;
        break;
      }
      case 'violations': {
        if (isNaN(val) || val < 1 || val > 10) return message.reply(t(lang, 'commands.admin.automod.spam.violationsRange'));
        settings.automod.spam.violationThreshold = val;
        break;
      }
      default:
        return message.reply(t(lang, 'commands.admin.automod.spam.usage'));
    }

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const spam = settings.automod.spam;
    return message.reply(t(lang, 'commands.admin.automod.spam.updated', {
      maxMessages: spam.maxMessages ?? 5,
      timeWindow: spam.timeWindow ?? 5,
      violationThreshold: spam.violationThreshold ?? 3,
      timeoutDuration: spam.timeoutDuration ?? 10,
    }));
  },

  async link(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [action, domain] = args;

    if (!domain || !['allow', 'deny'].includes(action)) {
      return message.reply(t(lang, 'commands.admin.automod.link.usage'));
    }

    const clean = domain.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();

    if (!settings.automod.allowedDomains) settings.automod.allowedDomains = [];

    if (action === 'allow') {
      if (settings.automod.allowedDomains.includes(clean)) {
        return message.reply(t(lang, 'commands.admin.automod.link.alreadyAllowed', { domain: clean }));
      }
      settings.automod.allowedDomains.push(clean);
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);
      return message.reply(t(lang, 'commands.admin.automod.link.added', { domain: clean }));
    } else {
      const idx = settings.automod.allowedDomains.indexOf(clean);
      if (idx === -1) return message.reply(t(lang, 'commands.admin.automod.link.notAllowed', { domain: clean }));
      settings.automod.allowedDomains.splice(idx, 1);
      settings.markModified('automod');
      await settings.save();
      settingsCache.invalidate(guild.id);
      return message.reply(t(lang, 'commands.admin.automod.link.removed', { domain: clean }));
    }
  },

  async reactionspam(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (!val || !['on', 'off'].includes(val)) {
      return message.reply(t(lang, 'commands.admin.automod.reactionspam.usage'));
    }

    settings.automod.antiReactionSpam = val === 'on';

    if (val === 'on' && (!settings.automod.level || settings.automod.level === 'off')) {
      settings.automod.level = 'minimal';
    }

    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const status = settings.automod.antiReactionSpam ? 'enabled' : 'disabled';
    let reply = t(lang, 'commands.admin.automod.reactionspam.base', { status });
    if (settings.automod.antiReactionSpam && settings.automod.level === 'minimal') {
      reply += t(lang, 'commands.admin.automod.reactionspam.activatedMinimal');
    }
    return message.reply(reply);
  },

  async ghostping(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (!val || !['on', 'off'].includes(val)) {
      return message.reply(t(lang, 'commands.admin.automod.ghostping.usage'));
    }

    settings.automod.ghostPing = val === 'on';
    settings.markModified('automod');
    await settings.save();
    settingsCache.invalidate(guild.id);

    const status = settings.automod.ghostPing ? 'enabled' : 'disabled';

    let reply = t(lang, 'commands.admin.automod.ghostping.base', { status });
    if (settings.automod.ghostPing && settings.automod.level === 'off') {
      reply += t(lang, 'commands.admin.automod.ghostping.noteLevelOff');
    }
    return message.reply(reply);
  },

  async exempt(message, args, guild, settings) {
    const lang = normalizeLocale(settings?.language);
    const [type, action, target] = args;

    if (!type || !action || !target || !['role', 'channel'].includes(type) || !['add', 'remove'].includes(action)) {
      return message.reply(t(lang, 'commands.admin.automod.exempt.usage'));
    }

    if (type === 'role') {
      const roleId = parseRoleId(target);
      if (!roleId) return message.reply(t(lang, 'commands.admin.automod.exempt.invalidRole'));

      if (!settings.automod.exemptRoles) settings.automod.exemptRoles = [];

      if (action === 'add') {
        if (settings.automod.exemptRoles.includes(roleId)) {
          return message.reply(t(lang, 'commands.admin.automod.exempt.roleAlreadyExempt'));
        }
        settings.automod.exemptRoles.push(roleId);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return message.reply(t(lang, 'commands.admin.automod.exempt.roleNowExempt', { roleId }));
      } else {
        const idx = settings.automod.exemptRoles.indexOf(roleId);
        if (idx === -1) return message.reply(t(lang, 'commands.admin.automod.exempt.roleNotExempt'));
        settings.automod.exemptRoles.splice(idx, 1);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return message.reply(t(lang, 'commands.admin.automod.exempt.roleNoLongerExempt', { roleId }));
      }
    }

    if (type === 'channel') {
      const channelId = parseChannelId(target);
      if (!channelId) return message.reply(t(lang, 'commands.admin.automod.exempt.invalidChannel'));

      if (!settings.automod.exemptChannels) settings.automod.exemptChannels = [];

      if (action === 'add') {
        if (settings.automod.exemptChannels.includes(channelId)) {
          return message.reply(t(lang, 'commands.admin.automod.exempt.channelAlreadyExempt'));
        }
        settings.automod.exemptChannels.push(channelId);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return message.reply(t(lang, 'commands.admin.automod.exempt.channelNowDisabled', { channelId }));
      } else {
        const idx = settings.automod.exemptChannels.indexOf(channelId);
        if (idx === -1) return message.reply(t(lang, 'commands.admin.automod.exempt.channelNotExempt'));
        settings.automod.exemptChannels.splice(idx, 1);
        settings.markModified('automod');
        await settings.save();
        settingsCache.invalidate(guild.id);
        return message.reply(t(lang, 'commands.admin.automod.exempt.channelReEnabled', { channelId }));
      }
    }
  }
};

function showHelp(message: any, lang: string) {
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'commands.admin.automod.help.title'))
    .setColor(0x5865F2)
    .addFields(
      {
        name: t(lang, 'commands.admin.automod.help.fieldStatusName'),
        value: t(lang, 'commands.admin.automod.help.fieldStatusValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldLevelName'),
        value: t(lang, 'commands.admin.automod.help.fieldLevelValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldSpamName'),
        value: t(lang, 'commands.admin.automod.help.fieldSpamValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldLinkName'),
        value: t(lang, 'commands.admin.automod.help.fieldLinkValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldReactionSpamName'),
        value: t(lang, 'commands.admin.automod.help.fieldReactionSpamValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldGhostPingName'),
        value: t(lang, 'commands.admin.automod.help.fieldGhostPingValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldExemptRoleName'),
        value: t(lang, 'commands.admin.automod.help.fieldExemptRoleValue')
      },
      {
        name: t(lang, 'commands.admin.automod.help.fieldExemptChannelName'),
        value: t(lang, 'commands.admin.automod.help.fieldExemptChannelValue')
      }
    )
    .setFooter({ text: t(lang, 'commands.admin.automod.help.footer') });

  return message.reply({ embeds: [embed] });
}

const command: Command = {
  name: 'automod',
  description: [
    'Configure every aspect of automod for your server. Run `!automod` with no arguments to see the full subcommand guide.',
    '',
    '**Subcommands:**',
    '`status` - show all current automod settings',
    '`level <off|minimal|medium|high>` - set the overall automod preset',
    '`spam <messages|window|violations|timeout> <value>` - tune spam detection thresholds',
    '`link <allow|deny> <domain>` - manage the link filter domain allowlist',
    '`ghostping <on|off>` - enable or disable ghost ping detection',
    '`exempt role <add|remove> <@role>` - give a role full automod immunity',
    '`exempt channel <add|remove> <#channel>` - disable automod in a specific channel',
  ].join('\n'),
  usage: '<subcommand> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.admin.automod.serverOnly'));

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);
      const lang = normalizeLocale(settings?.language);
      const sub = args[0]?.toLowerCase();

      if (!sub || !subcommands[sub]) {
        return showHelp(message, lang);
      }

      if (!settings.automod) settings.automod = {};

      await subcommands[sub](message, args.slice(1), guild, settings);

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !automod (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !automod: ${error.message || error}`);
        const cached: any = await settingsCache.get(guild.id).catch(() => null);
        const lang = normalizeLocale(cached?.language);
        message.reply(t(lang, 'commands.admin.automod.errorGeneric')).catch(() => {});
      }
    }
  }
};

export default command;
