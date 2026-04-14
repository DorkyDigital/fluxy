import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import { canManageRole } from '../../utils/permissions';
import { t, normalizeLocale } from '../../i18n';

const MAX_HONEYPOTS = 10;
const VALID_ACTIONS = ['ban', 'kick', 'timeout', 'role'];

async function resolveChannel(arg: string, guild: any, client: any): Promise<any> {
  const idMatch = /^<#(\d+)>$/.exec(arg) || /^(\d+)$/.exec(arg);
  if (idMatch) {
    const id = idMatch[1];
    let ch = guild.channels.get(id);
    if (!ch) {
      try {
        ch = await client.channels.resolve(id);
      } catch {}
    }
    return ch || null;
  }
  const name = arg.replace(/^#/, '').toLowerCase();
  for (const ch of guild.channels.values()) {
    if (ch.name && ch.name.toLowerCase() === name) return ch;
  }
  return null;
}

function parseRoleId(str: string): string | null {
  const match = /^<@&(\d+)>$/.exec(str) || /^(\d+)$/.exec(str);
  return match ? match[1] : null;
}

async function getSettings(guildId: string): Promise<any> {
  return GuildSettings.getOrCreate(guildId);
}

function saveEntry(entry: any, action: string, param: any) {
  entry.action = action;
  if (action === 'ban') {
    const days = parseInt(param, 10);
    entry.banDeleteDays = !isNaN(days) && days >= 0 && days <= 7 ? days : 1;
  } else if (action === 'timeout') {
    entry.timeoutHours = parseInt(param, 10);
  } else if (action === 'role') {
    entry.roleId = param;
  }
}

function formatEntry(h: any): string {
  let detail = '';
  if (h.action === 'ban') detail = ` - delete \`${h.banDeleteDays ?? 1}\` day(s) of messages`;
  if (h.action === 'timeout') detail = ` - \`${h.timeoutHours ?? 24}\` hour(s)`;
  if (h.action === 'role') detail = h.roleId ? ` - <@&${h.roleId}>` : ' - (no role set)';
  const status = h.enabled === false ? ' `disabled`' : '';
  return `\`${h.action}\`${detail}${status}`;
}

async function showList(message: any, guild: any, prefix = '!') {
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  const honeypots = settings.honeypotChannels || [];
  const alertRole = settings.honeypotAlertRoleId;

  if (!honeypots.length) {
    return message.reply(
      `**Honeypot Channels** - None configured.\n\n` +
        `Use \`${prefix}honeypot add <#channel> <ban|kick|timeout|role>\` to create one.`,
    );
  }

  const lines = honeypots.map((h: any, i: number) => `**${i + 1}.** <#${h.channelId}> - ${formatEntry(h)}`).join('\n');

  const footer = alertRole
    ? `\n\nAlert role: <@&${alertRole}>`
    : `\n\nNo alert role set. Use \`${prefix}honeypot alertrole <@role>\` to configure one.`;

  return message.reply(
    t(lang, 'auditCatalog.commands.admin.honeypot.l79_reply', {
      'honeypots.length': honeypots.length,
      MAX_HONEYPOTS,
      lines,
      footer,
    }),
  );
}

async function showInfo(message: any, guild: any, client: any, args: string[], prefix = '!') {
  const [channelArg] = args;
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  if (!channelArg) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l85_reply', { prefix }));

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const entry = (settings.honeypotChannels || []).find((h: any) => h.channelId === channel.id);
  if (!entry)
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l92_reply', { 'channel.id': channel.id }));

  const lines = [
    `**Honeypot Info - <#${channel.id}>**`,
    '',
    `**Status:** ${entry.enabled === false ? 'Disabled' : 'Enabled'}`,
    `**Action:** \`${entry.action}\``,
  ];

  if (entry.action === 'ban') {
    lines.push(`**Message Purge:** ${entry.banDeleteDays ?? 1} day(s)`);
  } else if (entry.action === 'timeout') {
    lines.push(`**Timeout Duration:** ${entry.timeoutHours ?? 24} hour(s)`);
  } else if (entry.action === 'role') {
    lines.push(
      `**Role:** ${entry.roleId ? `<@&${entry.roleId}>` : `(none set - use \`${prefix}honeypot action #channel role @role\`)`}`,
    );
  }

  const alertRole = settings.honeypotAlertRoleId;
  lines.push(`**Alert Role:** ${alertRole ? `<@&${alertRole}>` : 'None'}`);

  return message.reply(lines.join('\n'));
}

async function upsertHoneypot(
  message: any,
  guild: any,
  client: any,
  args: string[],
  requireExisting: boolean,
  prefix = '!',
) {
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg, actionArg, paramArg] = args;
  const subName = requireExisting ? 'action' : 'add';

  if (!channelArg || !actionArg) {
    return message.reply(
      `Usage:\n` +
        `\`${prefix}honeypot ${subName} <#channel> ban [delete_days]\`\n` +
        `\`${prefix}honeypot ${subName} <#channel> kick\`\n` +
        `\`${prefix}honeypot ${subName} <#channel> timeout <hours>\`\n` +
        `\`${prefix}honeypot ${subName} <#channel> role <@role>\``,
    );
  }

  const action = actionArg.toLowerCase();
  if (!VALID_ACTIONS.includes(action)) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l131_reply'));
  }

  let resolvedParam: any = null;
  if (action === 'timeout') {
    const hours = parseInt(paramArg, 10);
    if (isNaN(hours) || hours < 1 || hours > 672) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l138_reply', { prefix }));
    }
    resolvedParam = hours;
  } else if (action === 'role') {
    const roleId = parseRoleId(paramArg || '');
    if (!roleId) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l144_reply', { prefix }));
    }
    let targetRole = guild.roles?.get(roleId);
    if (!targetRole) {
      try {
        targetRole = await guild.fetchRole(roleId);
      } catch {}
    }
    if (targetRole) {
      let commandMember = guild.members?.get(message.author.id);
      if (!commandMember) {
        try {
          commandMember = await guild.fetchMember(message.author.id);
        } catch {}
      }
      if (commandMember) {
        const check = canManageRole(commandMember, targetRole, guild);
        if (!check.allowed) return message.reply(check.reason);
      }
    }
    resolvedParam = roleId;
  } else if (action === 'ban' && paramArg) {
    const days = parseInt(paramArg, 10);
    if (isNaN(days) || days < 0 || days > 7) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l164_reply'));
    }
    resolvedParam = days;
  }

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  if (!settings.honeypotChannels) settings.honeypotChannels = [];

  const existing = settings.honeypotChannels.find((h: any) => h.channelId === channel.id);

  if (requireExisting && !existing) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.l178_reply', { 'channel.id': channel.id, prefix }),
    );
  }

  if (!requireExisting && !existing && settings.honeypotChannels.length >= MAX_HONEYPOTS) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l182_reply', { MAX_HONEYPOTS }));
  }

  if (existing) {
    saveEntry(existing, action, resolvedParam);
  } else {
    const newEntry = { channelId: channel.id, action, enabled: true };
    saveEntry(newEntry, action, resolvedParam);
    settings.honeypotChannels.push(newEntry);
  }

  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(
    t(lang, 'auditCatalog.commands.admin.honeypot.l198_reply', {
      'channel.id': channel.id,
      existing: existing !== undefined,
      formattedEntry: formatEntry(settings.honeypotChannels.find((h: any) => h.channelId === channel.id)),
    }),
  );
}

async function removeHoneypot(message: any, guild: any, client: any, args: string[], prefix = '!') {
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg] = args;
  if (!channelArg) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l206_reply', { prefix }));

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const before = (settings.honeypotChannels || []).length;
  settings.honeypotChannels = (settings.honeypotChannels || []).filter((h: any) => h.channelId !== channel.id);

  if (settings.honeypotChannels.length === before) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l218_reply', { 'channel.id': channel.id }));
  }

  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l225_reply', { 'channel.id': channel.id }));
}

async function toggleHoneypot(message: any, guild: any, client: any, args: string[], enabled: boolean, prefix = '!') {
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [channelArg] = args;
  if (!channelArg) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l231_reply', { prefix, enabled }));
  }

  const channel = await resolveChannel(channelArg, guild, client);
  if (!channel) return message.reply(t(lang, 'commands.admin.reactionrole.common.channelNotFound'));

  const entry = (settings.honeypotChannels || []).find((h: any) => h.channelId === channel.id);

  if (!entry) {
    return message.reply(
      t(lang, 'auditCatalog.commands.admin.honeypot.l241_reply', { 'channel.id': channel.id, prefix }),
    );
  }

  entry.enabled = enabled;
  settings.markModified('honeypotChannels');
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(
    `Honeypot in <#${channel.id}> is now **${enabled ? 'enabled' : 'disabled'}**.` +
      (!enabled ? ' It will not take action until re-enabled.' : ''),
  );
}

async function setAlertRole(message: any, guild: any, args: string[], prefix = '!') {
  const settings = await getSettings(guild.id);
  const lang = normalizeLocale(settings?.language);
  const [roleArg] = args;
  if (!roleArg) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l258_reply', { prefix }));
  }

  if (roleArg.toLowerCase() === 'clear') {
    settings.honeypotAlertRoleId = null;
    await settings.save();
    settingsCache.invalidate(guild.id);
    return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l267_reply'));
  }

  const roleId = parseRoleId(roleArg);
  if (!roleId) return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l271_reply'));

  let role = guild.roles?.get(roleId);
  if (!role) {
    try {
      role = await guild.fetchRole(roleId);
    } catch {}
  }
  if (!role) return message.reply(t(lang, 'commands.inrole.roleNotFound'));

  settings.honeypotAlertRoleId = roleId;
  await settings.save();
  settingsCache.invalidate(guild.id);

  return message.reply(t(lang, 'auditCatalog.commands.admin.honeypot.l283_reply', { roleId }));
}

const command: Command = {
  name: 'honeypot',
  aliases: ['hp'],
  description: [
    'Configure honeypot channels - anyone who sends a message is immediately actioned.',
    '',
    '**Subcommands:**',
    '`add <#channel> ban [days]` - ban (delete 0–7 days of messages, default 1)',
    '`add <#channel> kick` - kick',
    '`add <#channel> timeout <hours>` - timeout (1–672 hours)',
    '`add <#channel> role <@role>` - assign a role',
    '`remove <#channel>` - remove honeypot from a channel',
    '`action <#channel> <ban|kick|timeout|role> [param]` - change the action',
    '`enable <#channel>` / `disable <#channel>` - toggle without removing',
    '`info <#channel>` - show full config for one honeypot',
    '`alertrole <@role|clear>` - role to ping in mod log on every trigger',
    '`list` - show all configured honeypot channels',
  ].join('\n'),
  usage: '<subcommand> [args...]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    const guild = (message as any).guild;
    if (!guild) return void (await message.reply(t('en', 'commands.admin.keywords.serverOnly')));

    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'list') return showList(message, guild, prefix);
    if (sub === 'add') return upsertHoneypot(message, guild, client, args.slice(1), false, prefix);
    if (sub === 'action') return upsertHoneypot(message, guild, client, args.slice(1), true, prefix);
    if (sub === 'remove') return removeHoneypot(message, guild, client, args.slice(1), prefix);
    if (sub === 'enable') return toggleHoneypot(message, guild, client, args.slice(1), true, prefix);
    if (sub === 'disable') return toggleHoneypot(message, guild, client, args.slice(1), false, prefix);
    if (sub === 'info') return showInfo(message, guild, client, args.slice(1), prefix);
    if (sub === 'alertrole') return setAlertRole(message, guild, args.slice(1), prefix);

    return void (await message.reply(t('en', 'auditCatalog.commands.admin.honeypot.l324_reply', { prefix })));
  },
};

export default command;
