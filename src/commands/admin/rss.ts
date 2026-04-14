import { randomUUID } from 'crypto';
import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import type { IRssFeed, IRssSettings } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import RssFeedState from '../../models/RssFeedState';
import config from '../../config';
import rssPollerService from '../../services/RssPollerService';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { fetchFeed } from '../../utils/rssFeed';
import { clampPollIntervalMinutes } from '../../utils/rssDefaults';
import { t, normalizeLocale } from '../../i18n';

const OWNER_ONLY_SUBCOMMANDS = new Set(['debug', 'forcepoll', 'force', 'pollnow']);

function parseChannelId(raw?: string): string | null {
  if (!raw) return null;
  const mention = raw.match(/^<#(\d{17,20})>$/);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return null;
}

function parseRoleId(raw?: string): string | null {
  if (!raw) return null;
  const mention = raw.match(/^<@&(\d{17,20})>$/);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return null;
}

function ensureRssSettings(settings: any): IRssSettings {
  if (!settings.rss || typeof settings.rss !== 'object' || Array.isArray(settings.rss)) {
    settings.rss = {
      enabled: false,
      pollIntervalMinutes: config.rss.defaultPollIntervalMinutes,
      feeds: [],
    } as IRssSettings;
  }

  if (!Array.isArray(settings.rss.feeds)) settings.rss.feeds = [];
  if (typeof settings.rss.enabled !== 'boolean') settings.rss.enabled = false;
  settings.rss.pollIntervalMinutes = clampPollIntervalMinutes(
    typeof settings.rss.pollIntervalMinutes === 'number'
      ? settings.rss.pollIntervalMinutes
      : config.rss.defaultPollIntervalMinutes,
  );

  return settings.rss as IRssSettings;
}

function parseSource(raw: string): { sourceType: 'rss' | 'rsshub'; url: string | null; route: string | null } | null {
  const input = raw.trim();
  if (!input) return null;

  if (input.startsWith('/')) {
    return {
      sourceType: 'rsshub',
      url: null,
      route: input,
    };
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return {
      sourceType: 'rss',
      url: parsed.toString(),
      route: null,
    };
  } catch {
    return null;
  }
}

function buildFeedSummary(feed: IRssFeed, index: number): string {
  const source = feed.sourceType === 'rsshub' ? feed.route : feed.url;
  const role = feed.mentionRoleId ? `<@&${feed.mentionRoleId}>` : 'none';
  return [
    `Index: ${index + 1}`,
    `ID: \`${feed.id}\``,
    `Status: ${feed.enabled ? 'enabled' : 'paused'}`,
    `Channel: <#${feed.channelId}>`,
    `Mention role: ${role}`,
    `Source: ${source || 'unknown'}`,
  ].join('\n');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)) + '...';
}

function isBotOwner(message: any): boolean {
  return Boolean(config.ownerId && String(message?.author?.id) === String(config.ownerId));
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'invalid date';
  return date.toISOString();
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function findFeedByRef(feeds: IRssFeed[], ref: string): { feed: IRssFeed; index: number } | null {
  const byIndex = parseInt(ref, 10);
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= feeds.length) {
    return { feed: feeds[byIndex - 1], index: byIndex - 1 };
  }

  const exact = feeds.findIndex((f) => f.id === ref);
  if (exact >= 0) return { feed: feeds[exact], index: exact };

  const partial = feeds.findIndex((f) => f.id.startsWith(ref));
  if (partial >= 0) return { feed: feeds[partial], index: partial };

  return null;
}

async function saveSettings(settings: any, guildId: string): Promise<void> {
  settings.markModified('rss');
  await settings.save();
  settingsCache.invalidate(guildId);
}

const command: Command = {
  name: 'rss',
  description: 'Manage RSS subscriptions for this server.',
  usage: '<add|list|remove|pause|resume|interval|test|status|debug|forcepoll> ...',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }
    if (!guild) return void (await message.reply(t('en', 'commands.admin.keywords.serverOnly')));

    let initialSettings: any = null;
    let lang = 'en';
    try {
      initialSettings = await settingsCache.get(guild.id);
      lang = normalizeLocale(initialSettings?.language);
    } catch {}

    const sub = args[0]?.toLowerCase();
    const owner = isBotOwner(message);

    if (sub && OWNER_ONLY_SUBCOMMANDS.has(sub) && !owner) {
      return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l157_reply')));
    }

    if (!sub || sub === 'help') {
      const commandLines = [
        `\`${prefix}rss add <#channel> <url|/rsshub/route> [@role]\``,
        `\`${prefix}rss list\``,
        `\`${prefix}rss remove <index|feedId>\``,
        `\`${prefix}rss pause <index|feedId>\``,
        `\`${prefix}rss resume <index|feedId>\``,
        `\`${prefix}rss interval <minutes>\``,
        `\`${prefix}rss test <index|feedId|url|/rsshub/route>\``,
        `\`${prefix}rss status\``,
      ];

      if (owner) {
        commandLines.push(`\`${prefix}rss debug [index|feedId]\` (owner-only)`);
        commandLines.push(`\`${prefix}rss forcepoll [index|feedId]\` (owner-only)`);
      }

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'auditCatalog.commands.admin.rss.l178_setTitle'))
        .setDescription(
          [
            'Manage RSS/Atom feeds and RSSHub routes for your server.',
            `Limit: ${config.rss.maxFeedsPerGuild} feeds • Minimum interval: ${config.rss.minPollIntervalMinutes} minutes`,
          ].join('\n'),
        )
        .addFields(
          {
            name: t(lang, 'auditCatalog.commands.admin.rss.l187_addFields_name'),
            value: commandLines.join('\n'),
            inline: false,
          },
          {
            name: t(lang, 'auditCatalog.commands.admin.rss.l192_addFields_name'),
            value: [
              'RSS/Atom: use full URL (https://...)',
              'RSSHub: use route path only (must start with /)',
              `RSSHub base URL: ${config.rss.rsshubBaseUrl}`,
            ].join('\n'),
            inline: false,
          },
          {
            name: t(lang, 'auditCatalog.commands.admin.rss.l201_addFields_name'),
            value: [
              `\`${prefix}rss test https://hnrss.org/frontpage\``,
              `\`${prefix}rss test /twitter/user/username\``,
              `\`${prefix}rss add <#updates> /github/issue/vercel/next.js @News\``,
              `\`${prefix}rss add <#updates> /twitter/user/username\``,
              'Tip: most instances use /twitter/... for X profiles, not /x/...',
            ].join('\n'),
            inline: false,
          },
          {
            name: t(lang, 'auditCatalog.commands.admin.rss.l212_addFields_name'),
            value: [
              'No immediate posts after add is normal: first poll seeds existing items.',
              'Use rss test first, then rss add, then rss status to monitor errors.',
            ].join('\n'),
            inline: false,
          },
        )
        .setColor(0x3498db);

      return void (await message.reply({ embeds: [embed] }));
    }

    try {
      const settings: any = initialSettings ?? (await GuildSettings.getOrCreate(guild.id));
      lang = normalizeLocale(settings?.language);
      const rss = ensureRssSettings(settings);

      if (sub === 'add') {
        const channelId = parseChannelId(args[1]);
        if (!channelId) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l232_reply', { prefix })));
        }

        const sourceInput = args[2];
        if (!sourceInput) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l237_reply', { prefix })));
        }

        if (rss.feeds.length >= config.rss.maxFeedsPerGuild) {
          return void (await message.reply(
            t(lang, 'auditCatalog.commands.admin.rss.l241_reply', {
              'config.rss.maxFeedsPerGuild': config.rss.maxFeedsPerGuild,
            }),
          ));
        }

        const parsedSource = parseSource(sourceInput);
        if (!parsedSource) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l246_reply')));
        }

        const mentionRoleId = parseRoleId(args[3]);

        const probe = await fetchFeed(
          {
            sourceType: parsedSource.sourceType,
            url: parsedSource.url,
            route: parsedSource.route,
          },
          {
            timeoutMs: config.rss.fetchTimeoutMs,
            maxBodyBytes: config.rss.maxBodyBytes,
            rsshubBaseUrl: config.rss.rsshubBaseUrl,
            rsshubAccessKey: config.rss.rsshubAccessKey,
          },
        );

        if (probe.items.length === 0) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l266_reply')));
        }

        const feed: IRssFeed = {
          id: randomUUID(),
          name: probe.title,
          sourceType: parsedSource.sourceType,
          url: parsedSource.url,
          route: parsedSource.route,
          channelId,
          mentionRoleId,
          webhookId: null,
          webhookToken: null,
          webhookName: null,
          enabled: true,
          maxItemsPerPoll: 3,
          includeSummary: true,
          includeImage: true,
          format: 'embed',
        };

        rss.enabled = true;
        rss.feeds.push(feed);

        await saveSettings(settings, guild.id);

        const summary = [
          `Added feed \`${feed.id}\` to <#${channelId}>.`,
          `Source: ${feed.sourceType === 'rsshub' ? feed.route : feed.url}`,
          `Title: ${probe.title || 'Unknown feed title'}`,
          mentionRoleId ? `Mention role: <@&${mentionRoleId}>` : 'Mention role: none',
        ].join('\n');

        return void (await message.reply(summary));
      }

      if (sub === 'list') {
        if (rss.feeds.length === 0) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l304_reply', { prefix })));
        }

        const embed = new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.rss.l308_setTitle'))
          .setDescription(
            t(lang, 'auditCatalog.commands.admin.rss.l309_setDescription', {
              'rss.pollIntervalMinutes': rss.pollIntervalMinutes,
              'rss.enabled': rss.enabled,
            }),
          )
          .setColor(0x3498db);

        for (let i = 0; i < rss.feeds.length; i++) {
          const feed = rss.feeds[i];
          embed.addFields({
            name: feed.name || `Feed ${i + 1}`,
            value: buildFeedSummary(feed, i),
            inline: false,
          });
        }

        return void (await message.reply({ embeds: [embed] }));
      }

      if (sub === 'remove') {
        const ref = args[1];
        if (!ref) return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l326_reply', { prefix })));

        const found = findFeedByRef(rss.feeds, ref);
        if (!found) return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l329_reply')));

        const [removed] = rss.feeds.splice(found.index, 1);
        await saveSettings(settings, guild.id);

        await RssFeedState.deleteOne({ guildId: guild.id, feedId: removed.id }).catch(() => {});

        return void (await message.reply(
          t(lang, 'auditCatalog.commands.admin.rss.l336_reply', { 'removed.id': removed.id }),
        ));
      }

      if (sub === 'pause' || sub === 'resume') {
        const ref = args[1];
        if (!ref)
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l341_reply', { prefix, sub })));

        const found = findFeedByRef(rss.feeds, ref);
        if (!found) return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l344_reply')));

        found.feed.enabled = sub === 'resume';
        await saveSettings(settings, guild.id);
        return void (await message.reply(
          t(lang, 'auditCatalog.commands.admin.rss.l348_reply', { sub, 'found.feed.id': found.feed.id }),
        ));
      }

      if (sub === 'interval') {
        const raw = args[1];
        if (!raw) {
          return void (await message.reply(
            t(lang, 'auditCatalog.commands.admin.rss.l354_reply', {
              'rss.pollIntervalMinutes': rss.pollIntervalMinutes,
              prefix,
            }),
          ));
        }

        const parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed)) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l359_reply')));
        }

        const clamped = clampPollIntervalMinutes(parsed);
        rss.pollIntervalMinutes = clamped;
        rss.enabled = true;
        await saveSettings(settings, guild.id);

        return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l367_reply', { clamped })));
      }

      if (sub === 'test') {
        const refOrSource = args[1];
        if (!refOrSource) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l373_reply', { prefix })));
        }

        let source: { sourceType: 'rss' | 'rsshub'; url: string | null; route: string | null } | null = null;

        const found = findFeedByRef(rss.feeds, refOrSource);
        if (found) {
          source = {
            sourceType: found.feed.sourceType,
            url: found.feed.url,
            route: found.feed.route,
          };
        } else {
          source = parseSource(refOrSource);
        }

        if (!source) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l390_reply')));
        }

        const parsed = await fetchFeed(source, {
          timeoutMs: config.rss.fetchTimeoutMs,
          maxBodyBytes: config.rss.maxBodyBytes,
          rsshubBaseUrl: config.rss.rsshubBaseUrl,
          rsshubAccessKey: config.rss.rsshubAccessKey,
        });

        const preview = parsed.items
          .slice(0, 5)
          .map((item, idx) => `${idx + 1}. ${item.title}\n${item.link}`)
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle(parsed.title || 'Feed test successful')
          .setDescription(preview || 'Feed is reachable, but no preview items were returned.')
          .setColor(0x2ecc71)
          .addFields(
            {
              name: t(lang, 'auditCatalog.commands.admin.rss.l414_addFields_name'),
              value: parsed.feedUrl,
              inline: false,
            },
            {
              name: t(lang, 'auditCatalog.commands.admin.rss.l419_addFields_name'),
              value: String(parsed.items.length),
              inline: true,
            },
          );

        return void (await message.reply({ embeds: [embed] }));
      }

      if (sub === 'status') {
        if (rss.feeds.length === 0) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l430_reply', { prefix })));
        }

        const states = await RssFeedState.find({
          guildId: guild.id,
          feedId: { $in: rss.feeds.map((feed) => feed.id) },
        }).lean();
        const stateByFeedId = new Map(states.map((state) => [state.feedId, state]));

        const embed = new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.rss.l440_setTitle'))
          .setDescription(
            t(lang, 'auditCatalog.commands.admin.rss.l441_setDescription', {
              'rss.pollIntervalMinutes': rss.pollIntervalMinutes,
            }),
          )
          .setColor(0x3498db);

        for (const feed of rss.feeds) {
          const state = stateByFeedId.get(feed.id);
          const lines = [
            `Status: ${feed.enabled ? 'enabled' : 'paused'}`,
            `Last checked: ${state?.lastCheckedAt ? new Date(state.lastCheckedAt).toISOString() : 'never'}`,
            `Last success: ${state?.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : 'never'}`,
            `Failures: ${state?.consecutiveFailures ?? 0}`,
            `Last error: ${state?.lastError || 'none'}`,
          ];

          embed.addFields({
            name: feed.name || feed.id,
            value: truncate(lines.join('\n'), 1000),
            inline: false,
          });
        }

        return void (await message.reply({ embeds: [embed] }));
      }

      if (sub === 'debug') {
        if (rss.feeds.length === 0) {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l466_reply', { prefix })));
        }

        const ref = args[1];
        let feeds = rss.feeds;

        if (ref) {
          const found = findFeedByRef(rss.feeds, ref);
          if (!found) return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l474_reply')));
          feeds = [found.feed];
        }

        const states = await RssFeedState.find({
          guildId: guild.id,
          feedId: { $in: feeds.map((feed) => feed.id) },
        }).lean();
        const stateByFeedId = new Map(states.map((state: any) => [state.feedId, state]));

        const runtime = rssPollerService.getRuntimeState();
        const intervalMinutes = clampPollIntervalMinutes(rss.pollIntervalMinutes);
        const nowMs = Date.now();
        const visibleFeeds = feeds.slice(0, 10);

        const embed = new EmbedBuilder()
          .setTitle(t(lang, 'auditCatalog.commands.admin.rss.l490_setTitle'))
          .setDescription(
            [
              `Poller runtime: ${runtime.started ? 'started' : 'stopped'} • ${runtime.running ? 'busy' : 'idle'} • client=${runtime.hasClient ? 'attached' : 'none'}`,
              `Guild RSS enabled: ${rss.enabled ? 'true' : 'false'} • Poll interval: ${intervalMinutes} minute(s)`,
            ].join('\n'),
          )
          .setColor(0xe67e22);

        for (const feed of visibleFeeds) {
          const state = stateByFeedId.get(feed.id) as any;
          const lastCheckedMs = state?.lastCheckedAt ? new Date(state.lastCheckedAt).getTime() : 0;
          const nextDueMs = lastCheckedMs > 0 ? lastCheckedMs + intervalMinutes * 60_000 : 0;
          const dueNow = nextDueMs === 0 || nowMs >= nextDueMs;
          const source = feed.sourceType === 'rsshub' ? feed.route : feed.url;

          const lines = [
            `Status: ${feed.enabled ? 'enabled' : 'paused'}`,
            `Source: ${truncate(source || 'unknown', 160)}`,
            `Last checked: ${toIso(state?.lastCheckedAt)}`,
            `Next due: ${dueNow ? 'now' : `${toIso(new Date(nextDueMs))} (in ${formatDuration(nextDueMs - nowMs)})`}`,
            `Last success: ${toIso(state?.lastSuccessAt)}`,
            `Failures: ${state?.consecutiveFailures ?? 0}`,
            `Seen IDs: ${Array.isArray(state?.seenItemIds) ? state.seenItemIds.length : 0}`,
            `ETag: ${state?.etag ? 'set' : 'none'}`,
            `Last error: ${state?.lastError ? truncate(String(state.lastError), 220) : 'none'}`,
          ];

          embed.addFields({
            name: truncate(feed.name || feed.id, 256),
            value: truncate(lines.join('\n'), 1000),
            inline: false,
          });
        }

        if (feeds.length > visibleFeeds.length) {
          embed.addFields({
            name: t(lang, 'auditCatalog.commands.admin.rss.l527_addFields_name'),
            value: t(lang, 'auditCatalog.commands.admin.rss.l528_addFields_value', {
              'visibleFeeds.length': visibleFeeds.length,
              'feeds.length': feeds.length,
            }),
            inline: false,
          });
        }

        return void (await message.reply({ embeds: [embed] }));
      }

      if (sub === 'forcepoll' || sub === 'force' || sub === 'pollnow') {
        const ref = args[1];
        let targetFeedId: string | undefined;

        if (ref) {
          const found = findFeedByRef(rss.feeds, ref);
          if (!found) return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l542_reply')));
          targetFeedId = found.feed.id;
        }

        const result = await rssPollerService.forcePollGuild(client, guild.id, targetFeedId);

        if (result.reason === 'busy') {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l549_reply')));
        }
        if (result.reason === 'rss_disabled') {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l552_reply')));
        }
        if (result.reason === 'no_feeds') {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l555_reply', { prefix })));
        }
        if (result.reason === 'feed_not_found') {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l558_reply')));
        }
        if (result.reason === 'no_eligible_feeds') {
          return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l561_reply')));
        }

        const lines = [
          targetFeedId ? `Force poll completed for feed \`${targetFeedId}\`.` : 'Force poll completed for this guild.',
          `Matched feeds: ${result.matchedFeeds}`,
          `Processed: ${result.processed}`,
          `Published items: ${result.publishedItems}`,
          `Failed: ${result.failed}`,
        ];

        if (result.skipped > 0) {
          lines.push(`Skipped: ${result.skipped}`);
        }

        const detailLines = result.details.slice(0, 5).map((detail) => {
          const status = detail.status.replace(/_/g, ' ');
          const published = detail.publishedCount > 0 ? `, published=${detail.publishedCount}` : '';
          const error = detail.error ? `, error=${truncate(detail.error, 80)}` : '';
          return `- ${detail.feedId}: ${status}${published}${error}`;
        });

        if (detailLines.length > 0) {
          lines.push('Details:');
          lines.push(...detailLines);
        }

        return void (await message.reply(lines.join('\n')));
      }

      return void (await message.reply(t(lang, 'auditCatalog.commands.admin.rss.l591_reply', { prefix })));
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !rss (ECONNRESET)`);
        return;
      }
      console.error(`[${guildName}] Error in !rss: ${error.message || error}`);
      await message
        .reply(
          t(lang, 'auditCatalog.commands.admin.rss.l599_reply', {
            "error.message || 'unknown error'": error.message || 'unknown error',
          }),
        )
        .catch(() => {});
    }
  },
};

export default command;
