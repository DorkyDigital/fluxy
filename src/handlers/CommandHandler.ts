// za commen handler

import fs from 'fs';
import path from 'path';
import * as GlitchTip from '@sentry/node';
import { PermissionFlags, EmbedBuilder } from '@erinjs/core';
import type { Client, Message } from '@erinjs/core';
import type { Command } from '../types';
import config from '../config';
import settingsCache from '../utils/settingsCache';
import isNetworkError from '../utils/isNetworkError';
import statsService from '../services/StatsService';
import UserSettings from '../models/UserSettings';
import parseUserId from '../utils/parseUserId';
import { t, normalizeLocale } from '../i18n';

const DEFAULT_PREFIXES = [config.prefix];
const MAX_CUSTOM_COMMANDS_PER_GUILD = 5;

export default class CommandHandler {
  client: Client;
  commands = new Map<string, Command>();
  private cooldowns = new Map<string, number>();
  private customCommandCooldowns = new Map<string, number>();
  prefix: string;

  constructor(client: Client) {
    this.client = client;
    this.prefix = config.prefix;
  }

  async getPrefixes(guildId: string | null): Promise<string[]> {
    if (!guildId) {
      return DEFAULT_PREFIXES;
    }

    try {
      const settings = await settingsCache.get(guildId);

      if (settings && settings.prefixes && settings.prefixes.length > 0) {
        return settings.prefixes;
      }

      return DEFAULT_PREFIXES;
    } catch (error) {
      console.error('Error fetching prefixes:', error);
      return DEFAULT_PREFIXES;
    }
  }

  async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, '..', 'commands');

    if (!fs.existsSync(commandsPath)) {
      console.warn('Commands directory not found, creating...');
      fs.mkdirSync(commandsPath, { recursive: true });
      return;
    }

    const categories = fs
      .readdirSync(commandsPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const category of categories) {
      const categoryPath = path.join(commandsPath, category);
      const commandFiles = fs
        .readdirSync(categoryPath)
        .filter((file) => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts'));

      for (const file of commandFiles) {
        try {
          const commandPath = path.join(categoryPath, file);
          const imported = require(commandPath);
          const command: Command = imported.default || imported;

          if (!command.name) {
            console.warn(`Command in ${file} is missing a name, skipping...`);
            continue;
          }

          this.commands.set(command.name, {
            ...command,
            category,
          });

          if (command.aliases && Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
              this.commands.set(alias, {
                ...command,
                category,
                isAlias: true,
              });
            }
          }
        } catch (error: any) {
          console.error(`Error loading command ${file}:`, error.message);
        }
      }
    }
  }

  async handleMessage(message: Message): Promise<void> {
    if ((message as any).author?.bot || !message.content) return;

    const guildId = (message as any).guildId || (message as any).guild?.id;
    const userId = (message as any).author?.id;
    let locale = 'en';

    if (guildId) {
      try {
        const localeSettings = await settingsCache.get(guildId);
        locale = normalizeLocale((localeSettings as any)?.language);
      } catch {}
    }

    let usedPrefix: string | null = null;

    if (userId) {
      try {
        const userPrefix = await UserSettings.getPrefix(userId);
        if (userPrefix && message.content.startsWith(userPrefix)) {
          usedPrefix = userPrefix;
        }
      } catch {}
    }

    if (!usedPrefix) {
      const prefixes = await this.getPrefixes(guildId);
      for (const prefix of prefixes) {
        if (message.content.startsWith(prefix)) {
          usedPrefix = prefix;
          break;
        }
      }
    }

    if (!usedPrefix) return;

    const args = message.content.slice(usedPrefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    let command = this.commands.get(commandName);
    if (command?.hidden && command?.ownerOnly && config.ownerId && (message as any).author?.id !== config.ownerId) {
      command = undefined;
    }
    if (!command) {
      if (guildId) {
        try {
          const settings = await settingsCache.get(guildId);
          const lang = normalizeLocale((settings as any)?.language);
          const customCommands = Array.isArray(settings?.customCommands)
            ? settings.customCommands.slice(0, MAX_CUSTOM_COMMANDS_PER_GUILD)
            : [];
          const customCmd = customCommands.find((c) => c.name === commandName);

          if (customCmd && customCmd.enabled !== false) {
            const disabled = (settings as any)?.disabledCommands ?? [];
            if (disabled.includes(commandName) || disabled.includes('customcommand')) {
              return;
            }

            const channelId = (message as any).channelId || (message as any).channel?.id;

            if (settings?.blacklistedChannels?.includes(channelId)) {
              const member = await this.getMember(message);
              const memberRoleIds = (member as any)?.roles?.roleIds ?? [];

              const isStaff = settings.staffRoleId && memberRoleIds.includes(settings.staffRoleId);
              const isAdmin =
                (member as any)?.permissions?.has((PermissionFlags as any).Administrator) ||
                (member as any)?.permissions?.has((PermissionFlags as any).ManageGuild);

              if (!isStaff && !isAdmin) {
                return;
              }
            }

            if (Array.isArray(customCmd.allowedChannelIds) && customCmd.allowedChannelIds.length > 0) {
              if (!channelId || !customCmd.allowedChannelIds.includes(channelId)) {
                return;
              }
            }

            const needsRoleGate = Array.isArray(customCmd.requiredRoleIds) && customCmd.requiredRoleIds.length > 0;
            const needsPermissionGate =
              typeof customCmd.requiredPermission === 'string' && customCmd.requiredPermission.length > 0;

            if (needsRoleGate || needsPermissionGate) {
              const member = await this.getMember(message);
              if (!member) return;

              const memberRoleIds = (member as any)?.roles?.roleIds ?? [];

              if (needsRoleGate) {
                const hasRole = customCmd.requiredRoleIds.some((roleId) => memberRoleIds.includes(roleId));
                if (!hasRole) {
                  return;
                }
              }

              if (needsPermissionGate) {
                const permissionName = customCmd.requiredPermission;
                if (typeof permissionName !== 'string') {
                  return;
                }

                const flag = (PermissionFlags as unknown as Record<string, bigint>)[permissionName];
                if (!flag || !(member as any)?.permissions?.has(flag)) {
                  return;
                }
              }
            }

            const cooldownSeconds =
              typeof customCmd.cooldownSeconds === 'number'
                ? Math.max(0, Math.min(3600, Math.floor(customCmd.cooldownSeconds)))
                : 0;

            if (cooldownSeconds > 0 && (message as any).author?.id) {
              const customCooldown = this.checkCustomCommandCooldown(
                (message as any).author.id,
                guildId,
                customCmd.name,
                cooldownSeconds,
              );

              if (!customCooldown.ready) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l220_reply', {
                      'customCooldown.remaining': customCooldown.remaining,
                      'customCmd.name': customCmd.name,
                    }),
                  )
                  .catch(() => {});
                return;
              }
            }

            const actionType = customCmd.actionType === 'toggleRole' ? 'toggleRole' : 'reply';
            const authorMention = `<@${(message as any).author.id}>`;
            let targetMention = authorMention;
            let roleMention = 'configured role';
            let actionWord = 'sent';

            if (actionType === 'toggleRole') {
              let guild = (message as any).guild;
              if (!guild && guildId) {
                guild = await this.client.guilds.fetch(guildId).catch(() => null);
              }

              if (!guild) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l239_reply')).catch(() => {});
                return;
              }

              const targetRoleId =
                typeof customCmd.targetRoleId === 'string' && customCmd.targetRoleId.length > 0
                  ? customCmd.targetRoleId
                  : null;

              if (!targetRoleId) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l248_reply', { 'customCmd.name': customCmd.name }),
                  )
                  .catch(() => {});
                return;
              }

              const invokingMember = await this.getMember(message);
              const memberHasManageRoles =
                (invokingMember as any)?.permissions?.has((PermissionFlags as any).ManageRoles) ||
                (invokingMember as any)?.permissions?.has((PermissionFlags as any).Administrator);

              if (!memberHasManageRoles) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l257_reply')).catch(() => {});
                return;
              }

              const targetUserId = parseUserId(args[0]);
              if (!targetUserId) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l263_reply', {
                      usedPrefix,
                      'customCmd.name': customCmd.name,
                    }),
                  )
                  .catch(() => {});
                return;
              }

              let targetMember = guild.members?.get(targetUserId);
              if (!targetMember) {
                targetMember = await guild.fetchMember(targetUserId).catch(() => null);
              }

              if (!targetMember) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l273_reply')).catch(() => {});
                return;
              }

              let targetRole = guild.roles?.get(targetRoleId);
              if (!targetRole && typeof guild.fetchRole === 'function') {
                targetRole = await guild.fetchRole(targetRoleId).catch(() => null);
              }

              if (!targetRole) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l283_reply', { 'customCmd.name': customCmd.name }),
                  )
                  .catch(() => {});
                return;
              }

              const botUserId = this.client.user?.id;
              let botMember = botUserId ? (guild.members?.get(botUserId) ?? null) : null;
              if (!botMember && botUserId) {
                botMember = await guild.fetchMember(botUserId).catch(() => null);
              }

              const botHasManageRoles =
                (botMember as any)?.permissions?.has((PermissionFlags as any).ManageRoles) ||
                (botMember as any)?.permissions?.has((PermissionFlags as any).Administrator);

              if (!botHasManageRoles) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l297_reply')).catch(() => {});
                return;
              }

              const targetRoleIds = (targetMember as any)?.roles?.roleIds ?? [];
              const hasRoleAlready = Array.isArray(targetRoleIds) && targetRoleIds.includes(targetRoleId);

              try {
                if (hasRoleAlready) {
                  await targetMember.removeRole(targetRoleId);
                  actionWord = 'removed';
                } else {
                  await targetMember.addRole(targetRoleId);
                  actionWord = 'added';
                }
              } catch {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l313_reply')).catch(() => {});
                return;
              }

              targetMention = `<@${targetMember.id || targetUserId}>`;
              roleMention = `<@&${targetRoleId}>`;
            }

            const responseTemplate =
              typeof customCmd.response === 'string' && customCmd.response.trim().length > 0
                ? customCmd.response
                : actionType === 'toggleRole'
                  ? '{target}: role {role} was {action}.'
                  : '{user}';

            const response = responseTemplate
              .replace(/\{user\}/gi, authorMention)
              .replace(/\{server\}/gi, (message as any).guild?.name || 'this server')
              .replace(/\{channel\}/gi, channelId ? `<#${channelId}>` : '#unknown-channel')
              .replace(/\{target\}/gi, targetMention)
              .replace(/\{role\}/gi, roleMention)
              .replace(/\{action\}/gi, actionWord);

            if (customCmd.embed) {
              const parsedColor =
                typeof customCmd.color === 'string' ? parseInt(customCmd.color.replace('#', ''), 16) : NaN;

              const embed = new EmbedBuilder()
                .setDescription(response)
                .setColor(Number.isFinite(parsedColor) ? parsedColor : 0x5865f2);

              if (customCmd.title) embed.setTitle(customCmd.title);
              await message.reply({ embeds: [embed] }).catch(() => {});
            } else {
              await message.reply(response).catch(() => {});
            }

            statsService
              .recordCommand(`custom:${customCmd.name}`, guildId ?? undefined, (message as any).author?.id)
              .catch(() => {});

            if (customCmd.deleteTrigger && typeof (message as any).delete === 'function') {
              await (message as any).delete().catch(() => {});
            }

            return;
          }
        } catch {}
      }
      return;
    }

    if (guildId) {
      const settings = await settingsCache.get(guildId);
      const channelId = (message as any).channelId || (message as any).channel?.id;

      if (settings?.blacklistedChannels?.includes(channelId)) {
        const member = await this.getMember(message);
        const memberRoleIds = (member as any)?.roles?.roleIds ?? [];

        const isStaff = settings.staffRoleId && memberRoleIds.includes(settings.staffRoleId);
        const isAdmin =
          (member as any)?.permissions?.has((PermissionFlags as any).Administrator) ||
          (member as any)?.permissions?.has((PermissionFlags as any).ManageGuild);

        if (!isStaff && !isAdmin) {
          return;
        }
      }
    }

    if (guildId && command.category !== 'owner') {
      try {
        const settings = await settingsCache.get(guildId);
        const disabled = (settings as any)?.disabledCommands ?? [];
        if (disabled.length > 0) {
          const isDisabled = disabled.includes(command.name) || disabled.includes(command.category);
          if (isDisabled) {
            return;
          }
        }
      } catch {}
    }

    const guild = (message as any).guild;
    if (!guild && command.category !== 'owner' && !command.allowDM) {
      await message.reply(t(locale, 'commands.admin.keywords.serverOnly')).catch(() => {});
      return;
    }

    if (command.permissions && command.permissions.length > 0 && guild) {
      const member = await this.getMember(message);
      if (!member) {
        await message.reply(t(locale, 'auditCatalog.handlers.CommandHandler.l403_reply')).catch(() => {});
        return;
      }

      const hasPermission = command.permissions.some((perm) => {
        return (member as any).permissions?.has((PermissionFlags as unknown as Record<string, bigint>)[perm]);
      });

      if (!hasPermission) {
        await message
          .reply(
            t(locale, 'auditCatalog.handlers.CommandHandler.l412_reply', {
              requiredPermissions: command.permissions.join(', '),
            }),
          )
          .catch(() => {});
        return;
      }
    }

    if (command.ownerOnly && config.ownerId) {
      if ((message as any).author.id !== config.ownerId) {
        await message.reply(t(locale, 'commands.reload.ownerOnly')).catch(() => {});
        return;
      }
    }

    const cooldownInfo = this.checkCooldown((message as any).author.id, commandName);
    if (!cooldownInfo.ready) {
      await message
        .reply(
          t(locale, 'auditCatalog.handlers.CommandHandler.l426_reply', {
            'cooldownInfo.remaining': cooldownInfo.remaining,
          }),
        )
        .catch(() => {});
      return;
    }

    try {
      await command.execute(message, args, this.client, usedPrefix);
      statsService.recordCommand(command.name, guildId ?? undefined, (message as any).author?.id).catch(() => {});
    } catch (error: any) {
      const guildName =
        (message as any).guild?.name || ((message as any).guildId ? `Guild ${(message as any).guildId}` : 'DM');

      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !${commandName} (ECONNRESET)`);
        await message
          .reply(
            'The Fluxer API is having connectivity issues, which is affecting bot functionality.\n' +
              'Check the status page to see if there are any ongoing incidents: <https://status.starlightnet.work>',
          )
          .catch(() => {});
      } else if (
        error?.message?.toLowerCase().includes('nsfw') ||
        error?.message?.toLowerCase().includes('age restricted')
      ) {
        console.warn(`[${guildName}] NSFW channel restriction blocked reply for !${commandName}`);
      } else if (
        error?.statusCode === 404 ||
        error?.message?.toLowerCase().includes("wasn't found") ||
        error?.message?.toLowerCase().includes('not found')
      ) {
        console.warn(`[${guildName}] Message or channel not found during !${commandName} (user likely deleted it)`);
      } else if (
        error?.statusCode === 403 ||
        error?.message?.toLowerCase().includes("don't have the permissions") ||
        error?.message?.toLowerCase().includes('missing permissions')
      ) {
        console.warn(`[${guildName}] Missing permissions during !${commandName}: ${error.message}`);
      } else {
        console.error(`[${guildName}] Error in !${commandName}: ${error.message || error}`);
        GlitchTip.captureException(error, {
          tags: { command: commandName, guild: guildName },
          extra: { args, guildId, userId: (message as any).author?.id },
        });
        await message.reply(t(locale, 'commands.admin.automod.errorGeneric')).catch(() => {});

        if (config.ownerId) {
          try {
            const owner = await this.client.users.fetch(config.ownerId).catch(() => null);
            if (owner) {
              await (owner as any)
                .send(
                  `**Command error** in **${guildName}**\n` +
                    `Command: \`!${commandName}\`\n` +
                    `Error: \`${error.message || error}\``,
                )
                .catch(() => {});
            }
          } catch {}
        }
      }
    }
  }

  async getMember(message: Message): Promise<unknown> {
    let guild = (message as any).guild;

    if (!guild && (message as any).guildId) {
      try {
        guild = await this.client.guilds.fetch((message as any).guildId);
      } catch {
        return null;
      }
    }

    if (!guild) return null;

    let member = guild.members?.get((message as any).author.id);

    if (!member) {
      try {
        member = await guild.fetchMember((message as any).author.id);
      } catch {
        return null;
      }
    }

    return member;
  }

  checkCooldown(userId: string, commandName: string): { ready: boolean; remaining: number } {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const cooldownAmount = config.cooldown.default;

    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key)! + cooldownAmount;

      if (now < expirationTime) {
        const remaining = Math.ceil((expirationTime - now) / 1000);
        return { ready: false, remaining };
      }
    }

    this.cooldowns.set(key, now);

    setTimeout(() => {
      this.cooldowns.delete(key);
    }, cooldownAmount);

    return { ready: true, remaining: 0 };
  }

  checkCustomCommandCooldown(
    userId: string,
    guildId: string,
    commandName: string,
    cooldownSeconds: number,
  ): { ready: boolean; remaining: number } {
    if (cooldownSeconds <= 0) {
      return { ready: true, remaining: 0 };
    }

    const key = `${guildId}:${userId}:custom:${commandName}`;
    const now = Date.now();
    const cooldownAmount = cooldownSeconds * 1000;

    if (this.customCommandCooldowns.has(key)) {
      const expirationTime = this.customCommandCooldowns.get(key)! + cooldownAmount;

      if (now < expirationTime) {
        const remaining = Math.ceil((expirationTime - now) / 1000);
        return { ready: false, remaining };
      }
    }

    this.customCommandCooldowns.set(key, now);

    setTimeout(() => {
      this.customCommandCooldowns.delete(key);
    }, cooldownAmount);

    return { ready: true, remaining: 0 };
  }

  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getCommandsByCategory(): Record<string, Command[]> {
    const categories: Record<string, Command[]> = {};

    for (const [, command] of this.commands) {
      if (command.isAlias) continue;

      if (!categories[command.category]) {
        categories[command.category] = [];
      }

      categories[command.category].push(command);
    }

    return categories;
  }
}
