import { Router, type RequestHandler } from 'express';
import type { Client } from '@erinjs/core';
import { EmbedBuilder, PermissionFlags } from '@erinjs/core';
import { Routes } from '@erinjs/types';
import type { AuthRequest } from '../middleware/auth';
import GuildSettings from '../../models/GuildSettings';
import config from '../../config';
import log from '../../utils/consoleLogger';
import settingsCache from '../../utils/settingsCache';
import { broadcastSettingsUpdate } from '../ws/settingsWs';
import { generateTranscriptHtml } from '../../utils/transcriptGenerator';
import { validateSettingsUpdate } from '../middleware/settingsValidator';
import { t, normalizeLocale } from '../../i18n';
import { encodeReactionForRoute } from '../../utils/encodeReactionForRoute';
import RssFeedState from '../../models/RssFeedState';
import { fetchFeed } from '../../utils/rssFeed';

const ALLOWED_SETTINGS_FIELDS = new Set([
  'prefixes',
  'language',
  'welcomeMessage',
  'reactionRoles',
  'moderation',
  'automod',
  'automodEnabled',
  'antiLink',
  'antiSpam',
  'antiGhostPing',
  'logChannelId',
  'muteRoleId',
  'prefix',
  'reactionRoleDMEnabled',
  'autoroleId',
  'raidDisableAutorole',
  'staffChannelId',
  'staffRoleId',
  'staffInboxChannelId',
  'keywordWarnings',
  'honeypotChannels',
  'honeypotAlertRoleId',
  'serverLogChannelId',
  'logChannelOverrides',
  'disabledLogEvents',
  'blacklistedChannels',
  'ticketCategoryId',
  'ticketSupportRoleId',
  'ticketSupportRoleIds',
  'ticketLogChannelId',
  'ticketMaxOpen',
  'ticketOpenMessage',
  'ticketSetupChannelId',
  'ticketSetupMessageId',
  'ticketEmoji',
  'customCommands',
  'lockdownRoles',
  'goodbyeMessage',
  'lockdownAllowedRoles',
  'lockdownAllowedUsers',
  'slowmodeAllowedRoles',
  'commandAllowedRoles',
  'globalBanEnabled',
  'globalBanAutoApply',
  'disabledCommands',
  'onboardingComplete',
  'onboardingStep',
  'verification',
  'rss',
  'starboard',
  'starboards',
]);

function sanitizeUpdates(body: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_SETTINGS_FIELDS.has(key)) {
      clean[key] = body[key];
    }
  }
  return clean;
}

function asArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function getGuildChannelCacheFallback(client: Client, guild: any, guildId: string): any[] {
  const cachedGuildChannels = Array.from(guild?.channels?.values?.() || []);
  if (cachedGuildChannels.length > 0) return cachedGuildChannels;

  const cachedClientChannels = Array.from(((client as any).channels?.values?.() || []) as Iterable<any>).filter((channel: any) => {
    const channelGuildId = channel?.guildId ?? channel?.guild_id ?? channel?.guild?.id ?? null;
    return channelGuildId === guildId;
  });

  if (cachedClientChannels.length > 0 && typeof guild?.channels?.set === 'function') {
    for (const channel of cachedClientChannels) {
      guild.channels.set(channel.id, channel);
    }
  }

  return cachedClientChannels;
}

function guildsT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.routes.guilds.${key}`, vars);
}

export function createGuildsRouter(client: Client, requireGuildAccess: RequestHandler): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res) => {
    try {
      const token = req.fluxerToken;
      if (!token) {
        res.status(403).json({ error: guildsT('guildListingRequiresOauth') });
        return;
      }

      const userGuildsRes = await fetch('https://api.fluxer.app/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!userGuildsRes.ok) {
        res.status(502).json({ error: guildsT('fetchUserGuildsFailed') });
        return;
      }

      const userGuilds = await userGuildsRes.json() as Array<{
        id: string;
        name: string;
        icon?: string | null;
        owner_id?: string;
        permissions?: string | null;
      }>;

      const userId = req.userId;
      const manageable = userGuilds.filter(ug => {
        if (ug.owner_id === userId) return true;
        const perms = ug.permissions ? BigInt(ug.permissions) : 0n;
        return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
      });

      const fetchAllGuildIds = (client as any).fetchAllGuildIds;
      const allBotGuildIds: Set<string> = fetchAllGuildIds
        ? await fetchAllGuildIds()
        : new Set(client.guilds.keys());

      const result = manageable.map(ug => {
        const botGuild = client.guilds.get(ug.id);
        if (botGuild) {
          return {
            id: botGuild.id,
            name: botGuild.name,
            icon: (botGuild as any).icon || null,
            botPresent: true,
          };
        }
        if (allBotGuildIds.has(ug.id)) {
          return {
            id: ug.id,
            name: ug.name,
            icon: ug.icon || null,
            botPresent: true,
          };
        }
        return {
          id: ug.id,
          name: ug.name,
          icon: ug.icon || null,
          botPresent: false,
        };
      });

      result.sort((a, b) => (a.botPresent === b.botPresent ? 0 : a.botPresent ? -1 : 1));

      res.json(result);
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.get('/:id', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const guild = client.guilds.get(guildId);

    let guildName = '';
    let guildIcon: string | null = null;
    let guildOwnerId: string | null = null;
    let channels: any[] = [];
    let roles: any[] = [];
    let emojis: any[] = [];

    if (guild) {
      guildName = guild.name;
      guildIcon = (guild as any).icon || null;
      guildOwnerId = (guild as any).ownerId || null;
      channels = getGuildChannelCacheFallback(client, guild, guildId);
      roles = Array.from((guild as any).roles?.values?.() || []);
    } else {
      let fetched = false;
      try {
        const guildData = await client.rest.get(Routes.guild(guildId)) as any;
        if (guildData?.id) {
          guildName = guildData.name;
          guildIcon = guildData.icon || null;
          guildOwnerId = guildData.owner_id || null;
          fetched = true;
        }
      } catch (err: any) {
        log.warn('API', `GET /guilds/${guildId} failed: ${err?.statusCode ?? err?.code ?? err?.message} - trying bot guild list fallback`);
      }

      if (!fetched) {
        try {
          let after: string | undefined;
          let found: { name: string; icon?: string | null; owner_id?: string } | null = null;
          do {
            const url = Routes.currentUserGuilds() + (after ? `?after=${after}&limit=200` : '?limit=200');
            const page = (await client.rest.get(url)) as any;
            const arr = Array.isArray(page) ? page : (page?.guilds ?? []);
            found = arr.find((g: any) => g.id === guildId) || null;
            if (found) break;
            if (arr.length === 200) after = arr[arr.length - 1]?.id;
            else break;
          } while (true);

          if (found) {
            guildName = found.name;
            guildIcon = found.icon ?? null;
            guildOwnerId = found.owner_id ?? null;
            fetched = true;
          }
        } catch (fallbackErr: any) {
          log.warn('API', `Guild ${guildId} fallback (bot guild list) failed: ${fallbackErr?.message}`);
        }
      }

      if (!fetched) {
        res.status(404).json({
          error: guildsT('guildNotFound'),
        });
        return;
      }
    }

    const cachedChannels = channels;
    try {
      const fetched = asArray(await client.rest.get(Routes.guildChannels(guildId)) as any);
      if (fetched.length > 0) channels = fetched;
    } catch { }
    const hasMissingNames = channels.length > 0 && channels.some((ch: any) => !ch?.name);
    if (channels.length === 0 || hasMissingNames) {
      channels = cachedChannels;
    }

    const cachedRoles = roles;
    try {
      const fetched = asArray(await client.rest.get(Routes.guildRoles(guildId)) as any);
      if (fetched.length > 0) roles = fetched;
    } catch { }
    if (roles.length === 0) {
      roles = cachedRoles;
    }
    if (emojis.length === 0) {
      try {
        const fetched = asArray(await client.rest.get(`/guilds/${guildId}/emojis`) as any);
        if (fetched.length > 0) emojis = fetched;
      } catch { }
    }

    res.json({
      id: guildId,
      name: guildName,
      icon: guildIcon,
      ownerId: guildOwnerId,
      channels: channels
        .filter((ch: any) => ch.id && ch.name)
        .map((ch: any) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          parent_id: ch.parent_id || ch.parentId || null,
          position: ch.position ?? 0,
        })),
      roles: roles.map((role: any) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
      })),
      emojis: emojis.map((emoji: any) => ({
        id: emoji.id,
        name: emoji.name,
        animated: !!emoji.animated,
        url: typeof emoji.url === 'string' ? emoji.url : null,
      })),
    });
  });

  router.get('/:id/settings', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const settings = await settingsCache.getOrCreate(req.params.id as string);
      res.json(settings);
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.patch('/:id/settings', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    const updates = sanitizeUpdates(req.body);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: guildsT('noValidFieldsToUpdate') });
      return;
    }

    // Deep-validate and sanitize all values
    const { valid, errors, sanitized } = validateSettingsUpdate(updates);
    if (!valid) {
      res.status(400).json({ error: guildsT('validationFailed'), details: errors });
      return;
    }

    try {
      const updated = await GuildSettings.findOneAndUpdate(
        { guildId },
        { $set: sanitized },
        { returnDocument: 'after', upsert: true, runValidators: true },
      ).lean();

      settingsCache.invalidate(guildId as string);

      broadcastSettingsUpdate(guildId as string);

      res.json(updated);
    } catch (err: any) {
      const fields = Object.keys(sanitized);
      if (err.name === 'ValidationError') {
        res.status(400).json({ error: guildsT('validationErrorUpdating', { fields: fields.join(', ') }), details: err.message });
        return;
      }
      log.error('API', `Failed to update settings for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('updateSettingsFailed') });
    }
  });

  router.post('/:id/ticket-setup', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    try {
      const settings: any = await GuildSettings.findOne({ guildId }) || await (GuildSettings as any).getOrCreate(guildId);
      const { channelId: existingChannelId } = req.body || {};

      const botId = client.user?.id;
      const everyoneRoleId = guildId;
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

      if (!settings.ticketCategoryId) {
        const categoryRes = await client.rest.post(Routes.guildChannels(guildId), {
          body: { type: 4, name: 'Tickets' },
        }) as any;
        const categoryId = categoryRes?.id;
        if (!categoryId) {
          res.status(500).json({ error: guildsT('createTicketCategoryFailed') });
          return;
        }
        settings.ticketCategoryId = categoryId;
        await settings.save();
        settingsCache.invalidate(guildId);
      }

      let targetChannelId: string;
      let targetChannelName: string;

      if (existingChannelId) {
        try {
          const ch = await client.channels.fetch(existingChannelId);
          if (!ch) throw new Error('Channel not found');
          targetChannelId = (ch as any).id;
          targetChannelName = (ch as any).name ?? 'channel';
        } catch {
          res.status(400).json({ error: guildsT('specifiedChannelNotFound') });
          return;
        }
      } else {
        const channelRes = await client.rest.post(Routes.guildChannels(guildId), {
          body: {
            type: 0,
            name: 'make-a-ticket',
            parent_id: settings.ticketCategoryId,
            topic: guildsT('ticketSetupTopic'),
            permission_overwrites: overwrites,
          },
        }) as any;
        targetChannelId = channelRes?.id;
        targetChannelName = channelRes?.name ?? 'make-a-ticket';
        if (!targetChannelId) {
          res.status(500).json({ error: guildsT('createTicketChannelFailed') });
          return;
        }
      }

      const emoji = settings.ticketEmoji || '\uD83C\uDFAB';
      const lang = normalizeLocale((settings as any).language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.admin.ticket.user.panelEmbed.title'))
        .setDescription(t(lang, 'auditCatalog.api.routes.guilds.ticketSetupPanelDescription', { emoji }))
        .setColor(0x5865F2)
        .setFooter({ text: t(lang, 'commands.admin.ticket.user.panelEmbed.footer') });

      const msgRes = await client.rest.post(Routes.channelMessages(targetChannelId), {
        body: { embeds: [embed.toJSON()] },
      }) as any;
      const panelMsgId = msgRes?.id;
      if (!panelMsgId) {
        res.status(500).json({ error: guildsT('postTicketPanelMessageFailed') });
        return;
      }

      try {
        const encoded = encodeReactionForRoute(emoji);
        await client.rest.put(
          `${Routes.channelMessageReaction(targetChannelId, panelMsgId, encoded)}/@me`
        );
      } catch (reactErr: any) {
        console.warn(`[ticket-setup] Failed to add panel reaction for ${guildId}: ${reactErr?.message || reactErr}`);
      }

      settings.ticketSetupChannelId = targetChannelId;
      settings.ticketSetupMessageId = panelMsgId;
      settings.markModified('ticketSetupChannelId');
      settings.markModified('ticketSetupMessageId');
      await settings.save();
      settingsCache.invalidate(guildId);
      broadcastSettingsUpdate(guildId);

      res.json({
        success: true,
        categoryId: settings.ticketCategoryId,
        channelId: targetChannelId,
        channelName: targetChannelName,
        messageId: panelMsgId,
      });
    } catch (err: any) {
      console.error(`[ticket-setup] Error for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('ticketSetupFailed', { error: err.message }) });
    }
  });

  router.post('/:id/verification-setup', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    try {
      const settings: any = await GuildSettings.findOne({ guildId }) || await (GuildSettings as any).getOrCreate(guildId);
      if (!settings.verification) settings.verification = {};
      const verification = settings.verification;

      const botId = client.user?.id;
      const everyoneRoleId = guildId;

      let verifiedRoleId = req.body?.verifiedRoleId || verification.verifiedRoleId;
      if (!verifiedRoleId) {
        try {
          const roleRes = await client.rest.post(Routes.guildRoles(guildId), {
            body: { name: 'Verified', color: 0x2ecc71, mentionable: false },
          }) as any;
          verifiedRoleId = roleRes?.id;
        } catch (err: any) {
          res.status(500).json({ error: guildsT('createVerifiedRoleFailed', { error: err.message }) });
          return;
        }
      }
      verification.verifiedRoleId = verifiedRoleId;

      let categoryId = verification.categoryId;
      if (!categoryId) {
        try {
          const catRes = await client.rest.post(Routes.guildChannels(guildId), {
            body: {
              type: 4,
              name: 'Verification',
              permission_overwrites: [
                { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
                ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageChannels | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: '0' }] : []),
              ],
            },
          }) as any;
          categoryId = catRes?.id;
        } catch (err: any) {
          res.status(500).json({ error: guildsT('createVerificationCategoryFailed', { error: err.message }) });
          return;
        }
      }
      verification.categoryId = categoryId;

      let panelChannelId: string;
      try {
        const chRes = await client.rest.post(Routes.guildChannels(guildId), {
          body: {
            type: 0,
            name: 'verify-here',
            parent_id: categoryId,
            topic: guildsT('verificationSetupTopic'),
            permission_overwrites: [
              { id: everyoneRoleId, type: 0, allow: String(PermissionFlags.ViewChannel | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: String(PermissionFlags.SendMessages) },
              ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: '0' }] : []),
              { id: verifiedRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
            ],
          },
        }) as any;
        panelChannelId = chRes?.id;
      } catch (err: any) {
        res.status(500).json({ error: guildsT('createVerificationChannelFailed', { error: err.message }) });
        return;
      }
      verification.panelChannelId = panelChannelId;

      const lang = normalizeLocale((settings as any).language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'verification.panel.title'))
        .setDescription(t(lang, 'verification.panel.description'))
        .setColor(0x5865F2)
        .setFooter({ text: t(lang, 'verification.panel.footer') })
        .setTimestamp(new Date());

      const msgRes = await client.rest.post(Routes.channelMessages(panelChannelId), {
        body: { embeds: [embed.toJSON()] },
      }) as any;
      const panelMessageId = msgRes?.id;

      try {
        const checkEncoded = encodeReactionForRoute('✅');
        await client.rest.put(
          `${Routes.channelMessageReaction(panelChannelId, panelMessageId, checkEncoded)}/@me`
        );
      } catch (err: any) {
        console.error(`[verification-setup] Failed to add reaction:`, err);
      }

      verification.panelMessageId = panelMessageId;
      verification.enabled = true;

      settings.markModified('verification');
      await settings.save();
      settingsCache.invalidate(guildId);
      broadcastSettingsUpdate(guildId);

      res.json({
        success: true,
        categoryId,
        panelChannelId,
        panelMessageId,
        verifiedRoleId,
      });
    } catch (err: any) {
      console.error(`[verification-setup] Error for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('verificationSetupFailed', { error: err.message }) });
    }
  });

  router.post('/:id/reaction-roles/panels', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const { channelId, title, description } = req.body || {};
    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({ error: guildsT('channelIdRequired') });
      return;
    }
    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title && String(title).trim() ? String(title).trim() : guildsT('reactionRolesDefaultTitle'))
        .setDescription(
          (description && String(description).trim())
            ? String(description).trim()
            : guildsT('reactionRolesDefaultDescription')
        )
        .setTimestamp(new Date());

      const msgRes = await client.rest.post(Routes.channelMessages(channelId), {
        body: { embeds: [embed.toJSON()] },
      }) as any;
      const messageId = msgRes?.id;
      if (!messageId) {
        res.status(500).json({ error: guildsT('postReactionRolePanelFailed') });
        return;
      }

      const settings: any = await GuildSettings.findOne({ guildId }) || await (GuildSettings as any).getOrCreate(guildId);
      const panels = settings.reactionRoles || [];
      const exists = panels.some((p: any) => p.messageId === messageId);
      if (!exists) {
        panels.push({ messageId, channelId, roles: [] });
        settings.reactionRoles = panels;
        settings.markModified('reactionRoles');
        await settings.save();
        settingsCache.invalidate(guildId);
        broadcastSettingsUpdate(guildId);
      }

      res.json({ messageId, channelId });
    } catch (err: any) {
      console.error(`[reaction-roles] Create panel for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('createReactionRolePanelFailed') });
    }
  });

  router.post('/:id/reaction-roles/panels/:messageId/mappings', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const { emoji, roleId, removeRoleId } = req.body || {};
    if (!emoji || !roleId) {
      res.status(400).json({ error: guildsT('emojiAndRoleIdRequired') });
      return;
    }
    try {
      const settings: any = await GuildSettings.findOne({ guildId });
      if (!settings) {
        res.status(404).json({ error: guildsT('guildSettingsNotFound') });
        return;
      }
      const panels = settings.reactionRoles || [];
      const panel = panels.find((p: any) => p.messageId === messageId);
      if (!panel) {
        res.status(404).json({ error: guildsT('reactionRolePanelNotFound') });
        return;
      }
      if (panel.roles.length >= 20) {
        res.status(400).json({ error: guildsT('reactionRolePanelMaxMappings') });
        return;
      }
      const emojiRaw = String(emoji).trim();
      let normalized = emojiRaw;
      const mentionMatch = /^<a?:(\w+):(\d+)>$/.exec(normalized);
      if (mentionMatch) {
        normalized = `${mentionMatch[1]}:${mentionMatch[2]}`;
      } else {
        const colonMatch = /^a?:(\w+):(\d+)$/.exec(normalized);
        if (colonMatch) {
          normalized = `${colonMatch[1]}:${colonMatch[2]}`;
        } else {
          normalized = normalized.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
        }
      }

      let emojiForReaction = emojiRaw;
      const looksLikeCustomEmojiInput =
        /^<a?:[\w]+:\d+>$/.test(emojiRaw) || 
        /^(a:)?[\w]+:\d+$/.test(emojiRaw);
      if (looksLikeCustomEmojiInput) {
        try {
          const resolved = await (client as any).resolveEmoji?.(emojiRaw, guildId);
          if (typeof resolved === 'string' && resolved.trim()) emojiForReaction = resolved.trim();
        } catch {}
      }
      if (panel.roles.some((r: any) => r.emoji === normalized || r.emoji === emojiRaw)) {
        res.status(400).json({ error: guildsT('reactionRoleEmojiAlreadyMapped') });
        return;
      }

      try {
        const channel = await client.channels.fetch(panel.channelId);
        const targetMessage = await (channel as any).messages.fetch(messageId);
        await targetMessage.react(emojiForReaction);
      } catch (reactErr: any) {
        res.status(400).json({
          error: guildsT('addReactionFailed', { error: reactErr.message || guildsT('invalidEmoji') })
        });
        return;
      }

      panel.roles.push({ emoji: normalized, roleId, removeRoleId: removeRoleId || null });
      settings.markModified('reactionRoles');
      await settings.save();
      settingsCache.invalidate(guildId);
      broadcastSettingsUpdate(guildId);

      res.json({ emoji: normalized, roleId, removeRoleId: removeRoleId || null });
    } catch (err: any) {
      console.error(`[reaction-roles] Add mapping for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('addReactionRoleMappingFailed') });
    }
  });

  router.patch('/:id/reaction-roles/panels/:messageId', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const { title, description } = req.body || {};
    try {
      const settings: any = await GuildSettings.findOne({ guildId });
      if (!settings) {
        res.status(404).json({ error: guildsT('guildSettingsNotFound') });
        return;
      }
      const panels = settings.reactionRoles || [];
      const panel = panels.find((p: any) => p.messageId === messageId);
      if (!panel) {
        res.status(404).json({ error: guildsT('reactionRolePanelNotFound') });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title !== null && title !== undefined && String(title).trim() ? String(title).trim() : guildsT('reactionRolesDefaultTitle'))
        .setDescription(
          description !== null && description !== undefined && String(description).trim()
            ? String(description).trim()
            : guildsT('reactionRolesDefaultDescription')
        )
        .setTimestamp(new Date());

      await client.rest.patch(Routes.channelMessage(panel.channelId, messageId), {
        body: { embeds: [embed.toJSON()] },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error(`[reaction-roles] Edit panel for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('editReactionRolePanelFailed') });
    }
  });

  router.post('/:id/upload-bg', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
        res.status(400).json({ error: guildsT('invalidImageData') });
        return;
      }

      const matches = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
      if (!matches) {
        res.status(400).json({ error: guildsT('unsupportedImageFormat') });
        return;
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');

      if (buffer.length > 4 * 1024 * 1024) {
        res.status(400).json({ error: guildsT('imageTooLarge') });
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const guildId = req.params.id as string;

      if (!/^\d{17,20}$/.test(guildId)) {
        res.status(400).json({ error: guildsT('invalidGuildIdFormat') });
        return;
      }

      const uploadsDir = path.join(__dirname, '..', '..', '..', 'dashboard', 'dist', 'uploads', guildId);
      fs.mkdirSync(uploadsDir, { recursive: true });

      try {
        const existing = fs.readdirSync(uploadsDir).filter((f: string) => f.startsWith('bg-'));
        for (const old of existing) {
          try { fs.unlinkSync(path.join(uploadsDir, old)); } catch { }
        }
      } catch { }

      const filename = `bg-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buffer);

      const url = `/uploads/${guildId}/${filename}`;
      res.json({ url });
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.get('/:id/tickets', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const rawStatus = req.query.status;
      const status = (typeof rawStatus === 'string' && ['open', 'closed'].includes(rawStatus))
        ? rawStatus
        : 'open';
      const tickets = await Ticket.find({ guildId: req.params.id, status })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      res.json(tickets);
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.post('/:id/tickets/:ticketId/claim', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id });
      if (!ticket) {
        res.status(404).json({ error: guildsT('ticketNotFound') });
        return;
      }
      if ((ticket as any).claimedBy) {
        res.status(400).json({ error: guildsT('ticketAlreadyClaimedBy', { userId: (ticket as any).claimedBy }) });
        return;
      }
      (ticket as any).claimedBy = req.userId;
      (ticket as any).claimedAt = new Date();
      await ticket.save();

      try {
        const channel = client.channels.get((ticket as any).channelId);
        if (channel) {
          await (channel as any).send({
            embeds: [{
              title: guildsT('ticketClaimedTitle', { ticketNumber: (ticket as any).ticketNumber }),
              description: guildsT('ticketClaimedDescription', { userId: req.userId! }),
              color: 0x2ecc71,
            }],
          });
        }
      } catch { }

      res.json(ticket);
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.post('/:id/tickets/:ticketId/close', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id, status: 'open' });
      if (!ticket) {
        res.status(404).json({ error: guildsT('openTicketNotFound') });
        return;
      }

      const reason = (req.body?.reason as string) || guildsT('ticketClosedFromDashboard');

      (ticket as any).status = 'closed';
      (ticket as any).closedBy = req.userId;
      (ticket as any).closedAt = new Date();
      await ticket.save();

      try {
        const channel = client.channels.get((ticket as any).channelId);
        if (channel) {
          const lang = normalizeLocale((await settingsCache.get(req.params.id as string).catch(() => null) as any)?.language);
          const embed = new EmbedBuilder()
            .setTitle(t(lang, 'auditCatalog.api.routes.guilds.l855_setTitle', { '(ticket as any).ticketNumber': (ticket as any).ticketNumber }))
            .setDescription(t(lang, 'auditCatalog.api.routes.guilds.l856_setDescription', { 'req.userId': req.userId }))
            .setColor(0xED4245)
            .addFields({ name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false });

          if ((ticket as any).claimedBy) {
            embed.addFields({ name: t(lang, 'commands.admin.ticket.user.closeEmbed.claimedByField'), value: `<@${(ticket as any).claimedBy}>`, inline: true });
          }

          await (channel as any).send({ embeds: [embed] });
          setTimeout(() => (channel as any).delete().catch(() => { }), 5000);
        }
      } catch { }

      try {
        const guildSettings = await settingsCache.get(req.params.id as string);
        const lang = normalizeLocale((guildSettings as any)?.language);
        const logChannelId = (guildSettings as any)?.ticketLogChannelId;
        if (logChannelId) {
          const logChannel = client.channels.get(logChannelId);
          if (logChannel) {
            const transcriptMessages = ((ticket as any).transcript || []) as Array<{
              authorId: string; authorName: string; avatarURL?: string | null;
              content: string; attachments?: Array<{ url: string; name: string }>;
              timestamp: Date | string;
            }>;

            const logEmbed = new EmbedBuilder()
              .setTitle(t(lang, 'auditCatalog.api.routes.guilds.l882_setTitle', { '(ticket as any).ticketNumber': (ticket as any).ticketNumber }))
              .setColor(0xED4245)
              .addFields(
                { name: t(lang, 'commands.admin.ticket.user.logEmbed.openedByField'), value: `<@${(ticket as any).openedBy}>`, inline: true },
                { name: t(lang, 'commands.admin.ticket.user.logEmbed.closedByField'), value: t(lang, 'auditCatalog.api.routes.guilds.l886_addFields_value', { 'req.userId': req.userId }), inline: true },
              );
            if ((ticket as any).claimedBy) {
              logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.claimedByField'), value: `<@${(ticket as any).claimedBy}>`, inline: true });
            }
            logEmbed.addFields({ name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false });

            if ((ticket as any).subject) {
              logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.subjectField'), value: (ticket as any).subject, inline: false });
            }

            logEmbed.addFields({ name: t(lang, 'commands.admin.ticket.user.logEmbed.messagesField'), value: String(transcriptMessages.length), inline: true })
              .setTimestamp(new Date());

            const sendOpts: any = { embeds: [logEmbed] };

            if (transcriptMessages.length > 0) {
              try {
                const guild = client.guilds.get(req.params.id as string);

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
                const closedByName = await resolveName(req.userId!);
                const claimedByName = (ticket as any).claimedBy ? await resolveName((ticket as any).claimedBy) : null;

                const html = generateTranscriptHtml({
                  guildName: guild?.name || req.params.id as string,
                  ticketNumber: (ticket as any).ticketNumber,
                  openedBy: openedByName,
                  claimedBy: claimedByName,
                  closedBy: `${closedByName} (dashboard)`,
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

            await (logChannel as any).send(sendOpts);
          }
        }
      } catch { }

      const openedByUserId = (ticket as any).openedBy;
      if (openedByUserId) {
        try {
          const transcriptMessages = ((ticket as any).transcript || []) as Array<{
            authorId: string; authorName: string; avatarURL?: string | null;
            content: string; attachments?: Array<{ url: string; name: string }>;
            timestamp: Date | string;
          }>;
          const guild = client.guilds.get(req.params.id as string);
          const lang = normalizeLocale((await settingsCache.get(req.params.id as string).catch(() => null) as any)?.language);
          const userEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'auditCatalog.api.routes.guilds.l958_setTitle', { '(ticket as any).ticketNumber': (ticket as any).ticketNumber }))
            .setDescription(t(lang, 'auditCatalog.api.routes.guilds.l959_setDescription', { 'guild?.name || req.params.id': guild?.name || String(req.params.id), 'req.userId': req.userId }))
            .setColor(0xED4245)
            .addFields({ name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false })
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
              const closedByName = await resolveName(req.userId!);
              const claimedByName = (ticket as any).claimedBy ? await resolveName((ticket as any).claimedBy) : null;
              const html = generateTranscriptHtml({
                guildName: guild?.name || (req.params.id as string),
                ticketNumber: (ticket as any).ticketNumber,
                openedBy: openedByName,
                claimedBy: claimedByName,
                closedBy: `${closedByName} (dashboard)`,
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

      res.json({
        _id: (ticket as any)._id,
        ticketNumber: (ticket as any).ticketNumber,
        status: (ticket as any).status,
        closedBy: (ticket as any).closedBy,
        closedAt: (ticket as any).closedAt,
      });
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  router.post('/:id/rss/test', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sourceType = body.sourceType === 'rsshub' ? 'rsshub' : 'rss';
      const url = typeof body.url === 'string' ? body.url : null;
      const route = typeof body.route === 'string' ? body.route : null;

      if (sourceType === 'rss' && !url) {
        res.status(400).json({ error: guildsT('rssUrlRequired') });
        return;
      }

      if (sourceType === 'rsshub' && !route) {
        res.status(400).json({ error: guildsT('rsshubRouteRequired') });
        return;
      }

      const parsed = await fetchFeed(
        {
          sourceType,
          url,
          route,
        },
        {
          timeoutMs: config.rss.fetchTimeoutMs,
          maxBodyBytes: config.rss.maxBodyBytes,
          rsshubBaseUrl: config.rss.rsshubBaseUrl,
          rsshubAccessKey: config.rss.rsshubAccessKey,
        },
      );

      res.json({
        guildId,
        feedUrl: parsed.feedUrl,
        title: parsed.title,
        link: parsed.link,
        description: parsed.description,
        itemCount: parsed.items.length,
        items: parsed.items.slice(0, 5).map((item) => ({
          key: item.key,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          author: item.author,
        })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || guildsT('fetchFeedFailed') });
    }
  });

  router.get('/:id/rss/status', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const settings = await settingsCache.getOrCreate(guildId);
      const rss = (settings as any)?.rss;
      const feeds = Array.isArray(rss?.feeds) ? rss.feeds : [];

      if (feeds.length === 0) {
        res.json([]);
        return;
      }

      const feedIds = feeds
        .map((feed: any) => (typeof feed?.id === 'string' ? feed.id : null))
        .filter((id: string | null): id is string => !!id);

      const states = await RssFeedState.find({
        guildId,
        feedId: { $in: feedIds },
      }).lean();

      const stateByFeedId = new Map(states.map((state) => [state.feedId, state]));

      res.json(
        feeds.map((feed: any) => {
          const state = stateByFeedId.get(feed.id);
          return {
            feedId: feed.id,
            name: feed.name ?? null,
            channelId: feed.channelId,
            enabled: feed.enabled !== false,
            sourceType: feed.sourceType,
            lastCheckedAt: state?.lastCheckedAt ?? null,
            lastSuccessAt: state?.lastSuccessAt ?? null,
            lastError: state?.lastError ?? null,
            consecutiveFailures: state?.consecutiveFailures ?? 0,
            seenCount: Array.isArray(state?.seenItemIds) ? state!.seenItemIds.length : 0,
          };
        }),
      );
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  // ─── Starboard leaderboard ───
  router.get('/:id/starboard/leaderboard', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const guildId = req.params.id as string;
      const rawBoardId = typeof req.query.boardId === 'string'
        ? req.query.boardId
        : (typeof req.query.channelId === 'string' ? req.query.channelId : null);
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

      const match: any = { guildId, starCount: { $gt: 0 } };
      if (rawBoardId) match.starboardChannelId = rawBoardId;

      const entries = await StarboardMessage.find(match)
        .sort({ starCount: -1 })
        .limit(limit)
        .lean();

      res.json(entries);
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  // ─── Starboard stats ───
  router.get('/:id/starboard/stats', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const guildId = req.params.id as string;
      const rawBoardId = typeof req.query.boardId === 'string'
        ? req.query.boardId
        : (typeof req.query.channelId === 'string' ? req.query.channelId : null);

      const match: any = { guildId };
      if (rawBoardId) match.starboardChannelId = rawBoardId;

      const totalEntries = await StarboardMessage.countDocuments(match);
      const postedCount = await StarboardMessage.countDocuments({ ...match, starboardMessageId: { $ne: null } });
      const totalStarsResult = await StarboardMessage.aggregate([
        { $match: { ...match } },
        { $group: { _id: null, total: { $sum: '$starCount' } } },
      ]);
      const totalStars = totalStarsResult[0]?.total ?? 0;

      const topUsers = await StarboardMessage.aggregate([
        { $match: { ...match, starCount: { $gt: 0 } } },
        { $group: { _id: '$authorId', totalStars: { $sum: '$starCount' }, messageCount: { $sum: 1 } } },
        { $sort: { totalStars: -1 } },
        { $limit: 5 },
      ]);

      const boardBreakdown = await StarboardMessage.aggregate([
        { $match: { guildId } },
        { $group: { _id: '$starboardChannelId', stars: { $sum: '$starCount' }, messages: { $sum: 1 } } },
        { $sort: { stars: -1 } },
      ]);

      res.json({ totalEntries, totalStars, postedCount, topUsers, boardBreakdown });
    } catch {
      res.status(500).json({ error: guildsT('internalServerError') });
    }
  });

  return router;
}
