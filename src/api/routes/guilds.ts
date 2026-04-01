import { Router, type RequestHandler } from 'express';
import type { Client } from '@fluxerjs/core';
import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { AuthRequest } from '../middleware/auth';
import GuildSettings from '../../models/GuildSettings';
import log from '../../utils/consoleLogger';
import settingsCache from '../../utils/settingsCache';
import { broadcastSettingsUpdate } from '../ws/settingsWs';
import { generateTranscriptHtml } from '../../utils/transcriptGenerator';
import { validateSettingsUpdate } from '../middleware/settingsValidator';
import { t, normalizeLocale } from '../../i18n';
import { encodeReactionForRoute } from '../../utils/encodeReactionForRoute';

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
  'starboard',
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

export function createGuildsRouter(client: Client, requireGuildAccess: RequestHandler): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res) => {
    try {
      const token = req.fluxerToken;
      if (!token) {
        res.status(403).json({ error: 'Guild listing requires Fluxer OAuth authentication' });
        return;
      }

      const userGuildsRes = await fetch('https://api.fluxer.app/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!userGuildsRes.ok) {
        res.status(502).json({ error: 'Failed to fetch user guilds from Fluxer' });
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
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
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
      channels = Array.from((guild as any).channels?.values?.() || []);
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
          error: 'Guild not found. Ensure the bot is in the server and has not been rate-limited.',
        });
        return;
      }
    }

    const hasMissingNames = channels.length > 0 && channels.some((ch: any) => !ch.name);
    if (channels.length === 0 || hasMissingNames) {
      try {
        const fetched = await client.rest.get(Routes.guildChannels(guildId)) as any[];
        if (Array.isArray(fetched) && fetched.length > 0) channels = fetched;
      } catch { }
    }
    if (roles.length === 0) {
      try {
        const fetched = await client.rest.get(Routes.guildRoles(guildId)) as any[];
        if (Array.isArray(fetched)) roles = fetched;
      } catch { }
    }
    if (emojis.length === 0) {
      try {
        const fetched = await client.rest.get(`/guilds/${guildId}/emojis`) as any[];
        if (Array.isArray(fetched)) emojis = fetched;
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
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/:id/settings', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    const updates = sanitizeUpdates(req.body);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    // Deep-validate and sanitize all values
    const { valid, errors, sanitized } = validateSettingsUpdate(updates);
    if (!valid) {
      res.status(400).json({ error: 'Validation failed', details: errors });
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
        res.status(400).json({ error: `Validation error updating ${fields.join(', ')}`, details: err.message });
        return;
      }
      log.error('API', `Failed to update settings for ${guildId}: ${err.message}`);
      res.status(500).json({ error: 'Failed to update settings' });
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
          res.status(500).json({ error: 'Failed to create ticket category' });
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
          res.status(400).json({ error: 'Could not find the specified channel' });
          return;
        }
      } else {
        const channelRes = await client.rest.post(Routes.guildChannels(guildId), {
          body: {
            type: 0,
            name: 'make-a-ticket',
            parent_id: settings.ticketCategoryId,
            topic: 'React to the message below to create a support ticket!',
            permission_overwrites: overwrites,
          },
        }) as any;
        targetChannelId = channelRes?.id;
        targetChannelName = channelRes?.name ?? 'make-a-ticket';
        if (!targetChannelId) {
          res.status(500).json({ error: 'Failed to create ticket channel' });
          return;
        }
      }

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

      const msgRes = await client.rest.post(Routes.channelMessages(targetChannelId), {
        body: { embeds: [embed.toJSON()] },
      }) as any;
      const panelMsgId = msgRes?.id;
      if (!panelMsgId) {
        res.status(500).json({ error: 'Failed to post ticket panel message' });
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
      res.status(500).json({ error: `Failed to set up ticket panel: ${err.message}` });
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
          res.status(500).json({ error: `Failed to create Verified role: ${err.message}` });
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
          res.status(500).json({ error: `Failed to create category: ${err.message}` });
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
            topic: 'React with ✅ to begin the verification process.',
            permission_overwrites: [
              { id: everyoneRoleId, type: 0, allow: String(PermissionFlags.ViewChannel | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: String(PermissionFlags.SendMessages) },
              ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: '0' }] : []),
              { id: verifiedRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
            ],
          },
        }) as any;
        panelChannelId = chRes?.id;
      } catch (err: any) {
        res.status(500).json({ error: `Failed to create verify channel: ${err.message}` });
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
      res.status(500).json({ error: `Failed to set up verification: ${err.message}` });
    }
  });

  router.post('/:id/reaction-roles/panels', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const { channelId, title, description } = req.body || {};
    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }
    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title && String(title).trim() ? String(title).trim() : 'Reaction Roles')
        .setDescription(
          (description && String(description).trim())
            ? String(description).trim()
            : 'React below to get a role.'
        )
        .setTimestamp(new Date());

      const msgRes = await client.rest.post(Routes.channelMessages(channelId), {
        body: { embeds: [embed.toJSON()] },
      }) as any;
      const messageId = msgRes?.id;
      if (!messageId) {
        res.status(500).json({ error: 'Failed to post panel message' });
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
      res.status(500).json({ error: 'Failed to create panel' });
    }
  });

  router.post('/:id/reaction-roles/panels/:messageId/mappings', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const { emoji, roleId, removeRoleId } = req.body || {};
    if (!emoji || !roleId) {
      res.status(400).json({ error: 'emoji and roleId are required' });
      return;
    }
    try {
      const settings: any = await GuildSettings.findOne({ guildId });
      if (!settings) {
        res.status(404).json({ error: 'Guild settings not found' });
        return;
      }
      const panels = settings.reactionRoles || [];
      const panel = panels.find((p: any) => p.messageId === messageId);
      if (!panel) {
        res.status(404).json({ error: 'Panel not found' });
        return;
      }
      if (panel.roles.length >= 20) {
        res.status(400).json({ error: 'Panel already has maximum 20 mappings' });
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
        res.status(400).json({ error: 'Emoji already mapped on this panel' });
        return;
      }

      try {
        const channel = await client.channels.fetch(panel.channelId);
        const targetMessage = await (channel as any).messages.fetch(messageId);
        await targetMessage.react(emojiForReaction);
      } catch (reactErr: any) {
        res.status(400).json({ error: `Could not add reaction: ${reactErr.message || 'Invalid emoji'}` });
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
      res.status(500).json({ error: 'Failed to add mapping' });
    }
  });

  router.patch('/:id/reaction-roles/panels/:messageId', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const { title, description } = req.body || {};
    try {
      const settings: any = await GuildSettings.findOne({ guildId });
      if (!settings) {
        res.status(404).json({ error: 'Guild settings not found' });
        return;
      }
      const panels = settings.reactionRoles || [];
      const panel = panels.find((p: any) => p.messageId === messageId);
      if (!panel) {
        res.status(404).json({ error: 'Panel not found' });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title != null && String(title).trim() ? String(title).trim() : 'Reaction Roles')
        .setDescription(
          description != null && String(description).trim()
            ? String(description).trim()
            : 'React below to get a role.'
        )
        .setTimestamp(new Date());

      await client.rest.patch(Routes.channelMessage(panel.channelId, messageId), {
        body: { embeds: [embed.toJSON()] },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error(`[reaction-roles] Edit panel for ${guildId}: ${err.message}`);
      res.status(500).json({ error: 'Failed to edit panel' });
    }
  });

  router.post('/:id/upload-bg', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
        res.status(400).json({ error: 'Invalid image data. Must be a base64 data URL.' });
        return;
      }

      const matches = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
      if (!matches) {
        res.status(400).json({ error: 'Unsupported image format. Use PNG, JPEG, or WebP.' });
        return;
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');

      if (buffer.length > 4 * 1024 * 1024) {
        res.status(400).json({ error: 'Image too large (max 4MB).' });
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const guildId = req.params.id as string;

      if (!/^\d{17,20}$/.test(guildId)) {
        res.status(400).json({ error: 'Invalid guild ID format' });
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
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
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
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:id/tickets/:ticketId/claim', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id });
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      if ((ticket as any).claimedBy) {
        res.status(400).json({ error: `Already claimed by ${(ticket as any).claimedBy}` });
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
              title: `Ticket #${(ticket as any).ticketNumber} - Claimed`,
              description: `<@${req.userId}> has claimed this ticket via the dashboard.`,
              color: 0x2ecc71,
            }],
          });
        }
      } catch { }

      res.json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:id/tickets/:ticketId/close', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id, status: 'open' });
      if (!ticket) {
        res.status(404).json({ error: 'Open ticket not found' });
        return;
      }

      const reason = (req.body?.reason as string) || 'Closed from dashboard';

      (ticket as any).status = 'closed';
      (ticket as any).closedBy = req.userId;
      (ticket as any).closedAt = new Date();
      await ticket.save();

      try {
        const channel = client.channels.get((ticket as any).channelId);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle(`Ticket #${(ticket as any).ticketNumber} - Closed`)
            .setDescription(`Closed by <@${req.userId}> via dashboard`)
            .setColor(0xED4245)
            .addFields({ name: 'Reason', value: reason, inline: false });

          if ((ticket as any).claimedBy) {
            embed.addFields({ name: 'Claimed By', value: `<@${(ticket as any).claimedBy}>`, inline: true });
          }

          await (channel as any).send({ embeds: [embed] });
          setTimeout(() => (channel as any).delete().catch(() => { }), 5000);
        }
      } catch { }

      try {
        const guildSettings = await settingsCache.get(req.params.id as string);
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
              .setTitle(`Ticket #${(ticket as any).ticketNumber} Closed`)
              .setColor(0xED4245)
              .addFields(
                { name: 'Opened By', value: `<@${(ticket as any).openedBy}>`, inline: true },
                { name: 'Closed By', value: `<@${req.userId}> (dashboard)`, inline: true },
              );
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
          const userEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${(ticket as any).ticketNumber} - Closed`)
            .setDescription(`Your ticket in **${guild?.name || req.params.id}** was closed by <@${req.userId}> via the dashboard.`)
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
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Starboard leaderboard ───
  router.get('/:id/starboard/leaderboard', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const entries = await StarboardMessage.find({ guildId: req.params.id, starCount: { $gt: 0 } })
        .sort({ starCount: -1 })
        .limit(10)
        .lean();
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Starboard stats ───
  router.get('/:id/starboard/stats', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const guildId = req.params.id as string;
      const totalEntries = await StarboardMessage.countDocuments({ guildId });
      const postedCount = await StarboardMessage.countDocuments({ guildId, starboardMessageId: { $ne: null } });
      const totalStarsResult = await StarboardMessage.aggregate([
        { $match: { guildId } },
        { $group: { _id: null, total: { $sum: '$starCount' } } },
      ]);
      const totalStars = totalStarsResult[0]?.total ?? 0;

      const topUsers = await StarboardMessage.aggregate([
        { $match: { guildId, starCount: { $gt: 0 } } },
        { $group: { _id: '$authorId', totalStars: { $sum: '$starCount' }, messageCount: { $sum: 1 } } },
        { $sort: { totalStars: -1 } },
        { $limit: 5 },
      ]);

      res.json({ totalEntries, totalStars, postedCount, topUsers });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
