import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '../../types';
import config from '../../config';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { hasAnyPermission } from '../../utils/permissions';
import { t, normalizeLocale } from '../../i18n';
import { registerReactionPaginator } from '../../utils/reactionPaginator';

const ACCENT_COLOR = 0xf1c40f;

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  moderation: { label: 'Moderation', description: 'Ban, kick, warn, timeout, mute, clear, slowmode' },
  admin:      { label: 'Admin',      description: 'Configure the bot - logging, automod, tickets, lockdown, reaction roles' },
  info:       { label: 'Info',        description: 'Server, member, role, and bot information' },
  general:    { label: 'General',     description: 'Help, ping, report' },
};

const CATEGORY_ORDER = ['moderation', 'admin', 'info', 'general'];
const CATEGORY_ALIASES: Record<string, string> = {
  mod: 'moderation',
  moderation: 'moderation',
  admin: 'admin',
  administration: 'admin',
  info: 'info',
  information: 'info',
  general: 'general',
  misc: 'general',
};

type HelpCategoryPage = {
  key: string;
  meta: { label: string; description?: string };
  commands: Command[];
};

function getMemberRoleIds(member: any | null): string[] {
  if (!member?.roles) return [];
  const roles = member.roles as any;
  if (Array.isArray(roles?.roleIds)) return roles.roleIds;
  if (roles?.cache && typeof roles.cache.values === 'function') {
    return [...roles.cache.values()].map((r: any) => r?.id).filter(Boolean);
  }
  if (typeof roles.values === 'function') {
    return [...roles.values()].map((r: any) => (typeof r === 'string' ? r : r?.id)).filter(Boolean);
  }
  return [];
}

function canSeeTicketCommand(member: any | null, guildSettings: any): boolean {
  if (!member) return false;
  if (hasAnyPermission(member, ['Administrator', 'ManageGuild'])) return true;
  const supportRoleIds = new Set<string>(guildSettings?.ticketSupportRoleIds || []);
  if (guildSettings?.ticketSupportRoleId) supportRoleIds.add(guildSettings.ticketSupportRoleId);
  if (supportRoleIds.size === 0) return false;
  const memberRoleIds = getMemberRoleIds(member);
  return memberRoleIds.some((id: string) => supportRoleIds.has(id));
}

function canSeeLockdownCommand(message: any, member: any | null, guildSettings: any): boolean {
  if (!member) return false;
  if (hasAnyPermission(member, ['Administrator'])) return true;
  const isGuildOwner = Boolean(message.guild?.ownerId && String(message.guild.ownerId) === String(message.author?.id));
  if (isGuildOwner) return true;
  if ((guildSettings?.lockdownAllowedUsers ?? []).includes(message.author?.id)) return true;
  const memberRoleIds = getMemberRoleIds(member);
  return (guildSettings?.lockdownAllowedRoles ?? []).some((roleId: string) => memberRoleIds.includes(roleId));
}


async function getPrefix(message: any): Promise<string> {
  const guildId = message.guildId || message.guild?.id;
  if (!guildId) return config.prefix;
  try {
    const settings = await settingsCache.get(guildId);
    if (settings?.prefixes?.length) return settings.prefixes[0];
  } catch {}
  return config.prefix;
}

function isCommandDisabledInGuild(cmd: Command, disabled: unknown): boolean {
  if (!Array.isArray(disabled) || disabled.length === 0) return false;
  return disabled.includes(cmd.name) || disabled.includes(cmd.category);
}

function sanitizeHelpQuery(raw: string): string {
  return raw.toLowerCase().replace(/^[^\w]+/, '').trim();
}

function categorySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCategoryStartIndex(query: string, categories: HelpCategoryPage[]): number {
  const normalized = sanitizeHelpQuery(query);
  if (!normalized) return -1;

  const directIndex = categories.findIndex((c) => c.key === normalized);
  if (directIndex >= 0) return directIndex;

  const aliasTarget = CATEGORY_ALIASES[normalized];
  if (aliasTarget) {
    const aliasIndex = categories.findIndex((c) => c.key === aliasTarget);
    if (aliasIndex >= 0) return aliasIndex;
  }

  const slug = categorySlug(normalized);
  return categories.findIndex((c) => categorySlug(c.meta.label) === slug);
}

async function buildVisibleHelpCategories(opts: {
  commandHandler: any;
  message: any;
  isOwner: boolean;
  member: any | null;
  disabledCommands: unknown;
  guildSettings: any;
}): Promise<HelpCategoryPage[]> {
  const categories = opts.commandHandler.getCommandsByCategory();
  const sorted = CATEGORY_ORDER.filter(c => categories[c])
    .concat(Object.keys(categories).filter(c => !CATEGORY_ORDER.includes(c)));

  const pages: HelpCategoryPage[] = [];
  for (const cat of sorted) {
    const cmds = categories[cat];
    if (!cmds || cat === 'owner') continue;

    const visible: Command[] = [];
    for (const cmd of cmds) {
      if (await canUserSeeCommand({
        message: opts.message,
        cmd,
        isOwner: opts.isOwner,
        member: opts.member,
        disabledCommands: opts.disabledCommands,
        guildSettings: opts.guildSettings,
      })) {
        visible.push(cmd);
      }
    }

    if (visible.length === 0) continue;
    pages.push({
      key: cat,
      meta: CATEGORY_META[cat] ?? { label: cat },
      commands: visible,
    });
  }

  return pages;
}

function buildCategoryEmbed(opts: {
  category: HelpCategoryPage;
  prefix: string;
  lang: string;
  pageNumber: number;
  totalPages: number;
}): EmbedBuilder {
  const commandList = opts.category.commands.map((cmd: Command) => `\`${cmd.name}\``).join('  ');
  const description = opts.category.meta.description
    ? `${opts.category.meta.description}\n\n${commandList}`
    : commandList;

  const footerParts = [t(opts.lang, 'commands.help.menuFooter', { prefix: opts.prefix })];
  if (opts.totalPages > 1) {
    footerParts.push(`${opts.pageNumber}/${opts.totalPages}`);
    footerParts.push('⬅️/➡️');
  }

  return new EmbedBuilder()
    .setTitle(`${t(opts.lang, 'commands.help.menuTitle')} - ${opts.category.meta.label}`)
    .setDescription(description)
    .setColor(ACCENT_COLOR)
    .setFooter({ text: footerParts.join(' • ') })
    .setTimestamp(new Date());
}

function buildTextCategoryList(opts: {
  categories: HelpCategoryPage[];
  prefix: string;
  lang: string;
  startIndex: number;
  showOnlyStartCategory: boolean;
}): string {
  const lines = [t(opts.lang, 'commands.help.commandListHeader', { prefix: opts.prefix }), ''];
  const list = opts.showOnlyStartCategory
    ? opts.categories.slice(opts.startIndex, opts.startIndex + 1)
    : opts.categories;

  for (const category of list) {
    lines.push(`**${category.meta.label}**${category.meta.description ? ` - ${category.meta.description}` : ''}`);
    lines.push(category.commands.map((cmd: Command) => `\`${cmd.name}\``).join('  '));
    lines.push('');
  }

  return lines.join('\n');
}

async function canUserSeeCommand(opts: {
  message: any;
  cmd: Command;
  isOwner: boolean;
  member: any | null;
  disabledCommands: unknown;
  guildSettings: any | null;
}): Promise<boolean> {
  const { message, cmd, isOwner, member, disabledCommands, guildSettings } = opts;

  if ((cmd as any).hidden) return false;
  if (cmd.ownerOnly && !isOwner) return false;
  if (!message.guildId && !message.guild?.id) {
    if (cmd.category === 'owner') return isOwner;
    return Boolean(cmd.allowDM);
  }

  if (cmd.category !== 'owner' && isCommandDisabledInGuild(cmd, disabledCommands)) return false;

  if (cmd.permissions?.length) {
    if (!member) return false;
    return hasAnyPermission(member, cmd.permissions);
  }

  if (cmd.category === 'admin') {
    if (cmd.name === 'ticket') return canSeeTicketCommand(member, guildSettings);
    if (cmd.name === 'lockdown') return canSeeLockdownCommand(message, member, guildSettings);
    return false;
  }

  return true;
}

const command: Command = {
  name: 'help',
  description: 'Show all commands, detailed info for one command, or a specific category page.',
  usage: '[command/category]',
  category: 'general',
  cooldown: 5,

  async execute(message, args, client) {
    const commandHandler = (client as any).commandHandler;
    if (!commandHandler) return void await message.reply(t('en', 'commands.help.handlerMissing'));

    const prefix = await getPrefix(message);
    const isOwner = Boolean(config.ownerId && (message as any).author.id === config.ownerId);
    const guildId = message.guildId || message.guild?.id;
    const member = guildId ? await (commandHandler as any).getMember(message).catch(() => null) : null;
    const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
    const disabledCommands = guildSettings?.disabledCommands ?? null;
    const lang = normalizeLocale(guildSettings?.language);

    try {
      if (args[0]) {
        const commandName = sanitizeHelpQuery(args[0]);
        const cmd = commandHandler.getCommand(commandName);

        const visible = cmd && await canUserSeeCommand({ message, cmd, isOwner, member, disabledCommands, guildSettings });
        if (cmd && visible) {
          const usageStr = `\`${prefix}${cmd.name}${cmd.usage ? ' ' + cmd.usage : ''}\``;
          const meta = CATEGORY_META[cmd.category] ?? { label: cmd.category };

          const embed = new EmbedBuilder()
            .setTitle(`${cmd.name}`)
            .setDescription(Array.isArray(cmd.description) ? cmd.description.join('\n') : (cmd.description || 'No description provided.'))
            .setColor(ACCENT_COLOR)
            .addFields({ name: 'Usage', value: usageStr, inline: false });

          if (cmd.permissions?.length) {
            embed.addFields({ name: 'Permission Required', value: cmd.permissions.join(', '), inline: true });
          }
          if (cmd.aliases?.length) {
            embed.addFields({ name: 'Aliases', value: cmd.aliases.map((a: string) => `\`${a}\``).join('  '), inline: true });
          }
          if (cmd.cooldown) {
            embed.addFields({ name: 'Cooldown', value: `${cmd.cooldown}s`, inline: true });
          }

          embed.addFields({ name: 'Category', value: `${meta.label}`, inline: true });
          embed.setFooter({ text: `${prefix}help [command/category] • Fluxy Docs: docs.fluxy.gay` });
          embed.setTimestamp(new Date());

          try {
            return void await message.reply({ embeds: [embed] });
          } catch {
            const lines = [
              `**${cmd.name}** - ${Array.isArray(cmd.description) ? cmd.description[0] : cmd.description || ''}`,
              `Usage: ${usageStr}`,
              cmd.permissions?.length ? `Permission: ${cmd.permissions.join(', ')}` : '',
              cmd.aliases?.length    ? `Aliases: ${cmd.aliases.join(', ')}` : '',
            ].filter(Boolean);
            return void await message.reply(lines.join('\n')).catch(() => {});
          }
        }
      }

      const visibleCategories = await buildVisibleHelpCategories({
        commandHandler,
        message,
        isOwner,
        member,
        disabledCommands,
        guildSettings,
      });

      if (visibleCategories.length === 0) {
        return void await message.reply(t(lang, 'commands.help.errors.generic')).catch(() => {});
      }

      const startIndex = args[0] ? findCategoryStartIndex(args[0], visibleCategories) : 0;
      if (args[0] && startIndex < 0) {
        const commandName = sanitizeHelpQuery(args[0]);
        return void await message
          .reply(t(lang, 'commands.help.errors.commandNotFound', { commandName, prefix }))
          .catch(() => {});
      }

      const pages = visibleCategories.map((category, index) => {
        return buildCategoryEmbed({
          category,
          prefix,
          lang,
          pageNumber: index + 1,
          totalPages: visibleCategories.length,
        });
      });

      try {
        const sentMessage: any = await message.reply({ embeds: [pages[startIndex]] });

        if (pages.length > 1) {
          const ownerUserId = String((message as any).author?.id ?? (message as any).authorId ?? '');
          const responseChannelId = String(sentMessage?.channelId ?? (message as any).channelId ?? '');
          const responseMessageId = String(sentMessage?.id ?? '');

          if (ownerUserId && responseChannelId && responseMessageId) {
            await registerReactionPaginator(client, {
              messageId: responseMessageId,
              channelId: responseChannelId,
              ownerUserId,
              pages,
              initialPageIndex: startIndex,
              ttlMs: 3 * 60 * 1000,
            });
          }
        }
      } catch {
        const text = buildTextCategoryList({
          categories: visibleCategories,
          prefix,
          lang,
          startIndex: Math.max(0, startIndex),
          showOnlyStartCategory: Boolean(args[0]),
        });
        return void await message.reply(text).catch(() => {});
      }

    } catch (error: any) {
      const guildName = (message as any).guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !help (ECONNRESET)`);
      } else if (
        error?.message?.toLowerCase().includes('nsfw') ||
        error?.message?.toLowerCase().includes('age restricted')
      ) {
        return;
      } else {
        console.error(`[${guildName}] Error in !help: ${error.message || error}`);
        try { await message.reply(t(lang, 'commands.help.errors.generic')); } catch {}
      }
    }
  }
};

export default command;
