import { randomUUID } from 'crypto';
import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '../../types';
import type { IRssFeed, IRssSettings } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import RssFeedState from '../../models/RssFeedState';
import config from '../../config';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { fetchFeed } from '../../utils/rssFeed';
import { clampItemsPerPoll, clampPollIntervalMinutes } from '../../utils/rssDefaults';

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
  usage: '<add|list|remove|pause|resume|interval|test|status> ...',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }
    if (!guild) return void await message.reply('This command can only be used in a server.');

    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('RSS Setup & RSSHub Guide')
        .setDescription(
          [
            'Manage RSS/Atom feeds and RSSHub routes for your server.',
            `Limit: ${config.rss.maxFeedsPerGuild} feeds • Minimum interval: ${config.rss.minPollIntervalMinutes} minutes`,
          ].join('\n'),
        )
        .addFields(
          {
            name: 'Commands',
            value: [
              `\`${prefix}rss add <#channel> <url|/rsshub/route> [@role]\``,
              `\`${prefix}rss list\``,
              `\`${prefix}rss remove <index|feedId>\``,
              `\`${prefix}rss pause <index|feedId>\``,
              `\`${prefix}rss resume <index|feedId>\``,
              `\`${prefix}rss interval <minutes>\``,
              `\`${prefix}rss test <index|feedId|url|/rsshub/route>\``,
              `\`${prefix}rss status\``,
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Source Format',
            value: [
              'RSS/Atom: use full URL (https://...)',
              'RSSHub: use route path only (must start with /)',
              `RSSHub base URL: ${config.rss.rsshubBaseUrl}`,
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Examples',
            value: [
              `\`${prefix}rss test https://hnrss.org/frontpage\``,
              `\`${prefix}rss test /twitter/user/dogbonewish\``,
              `\`${prefix}rss add <#updates> /github/issue/vercel/next.js @News\``,
              `\`${prefix}rss add <#updates> /twitter/user/username\``,
              'Tip: most instances use /twitter/... for X profiles, not /x/...',
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Troubleshooting',
            value: [
              'No immediate posts after add is normal: first poll seeds existing items.',
              'Use rss test first, then rss add, then rss status to monitor errors.',
            ].join('\n'),
            inline: false,
          },
        )
        .setColor(0x3498db)
        .setTimestamp(new Date());

      return void await message.reply({ embeds: [embed] });
    }

    try {
      const settings: any = await GuildSettings.getOrCreate(guild.id);
      const rss = ensureRssSettings(settings);

      if (sub === 'add') {
        const channelId = parseChannelId(args[1]);
        if (!channelId) {
          return void await message.reply(`Usage: ${prefix}rss add <#channel> <url|/rsshub/route> [@role]`);
        }

        const sourceInput = args[2];
        if (!sourceInput) {
          return void await message.reply(`Usage: ${prefix}rss add <#channel> <url|/rsshub/route> [@role]`);
        }

        if (rss.feeds.length >= config.rss.maxFeedsPerGuild) {
          return void await message.reply(`You can only configure up to ${config.rss.maxFeedsPerGuild} feeds per server.`);
        }

        const parsedSource = parseSource(sourceInput);
        if (!parsedSource) {
          return void await message.reply('Invalid source. Use an http(s) URL or an RSSHub route starting with /.');
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
          return void await message.reply('Feed is reachable, but no items were found.');
        }

        const feed: IRssFeed = {
          id: randomUUID(),
          name: probe.title,
          sourceType: parsedSource.sourceType,
          url: parsedSource.url,
          route: parsedSource.route,
          channelId,
          mentionRoleId,
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

        return void await message.reply(summary);
      }

      if (sub === 'list') {
        if (rss.feeds.length === 0) {
          return void await message.reply(`No RSS feeds configured. Use ${prefix}rss add to create one.`);
        }

        const embed = new EmbedBuilder()
          .setTitle('Configured RSS Feeds')
          .setDescription(`Polling: every ${rss.pollIntervalMinutes} minute(s) • RSS ${rss.enabled ? 'enabled' : 'disabled'}`)
          .setColor(0x3498db)
          .setTimestamp(new Date());

        for (let i = 0; i < rss.feeds.length; i++) {
          const feed = rss.feeds[i];
          embed.addFields({
            name: feed.name || `Feed ${i + 1}`,
            value: buildFeedSummary(feed, i),
            inline: false,
          });
        }

        return void await message.reply({ embeds: [embed] });
      }

      if (sub === 'remove') {
        const ref = args[1];
        if (!ref) return void await message.reply(`Usage: ${prefix}rss remove <index|feedId>`);

        const found = findFeedByRef(rss.feeds, ref);
        if (!found) return void await message.reply('Feed not found. Use rss list to check indexes and IDs.');

        const [removed] = rss.feeds.splice(found.index, 1);
        await saveSettings(settings, guild.id);

        await RssFeedState.deleteOne({ guildId: guild.id, feedId: removed.id }).catch(() => {});

        return void await message.reply(`Removed feed \`${removed.id}\`.`);
      }

      if (sub === 'pause' || sub === 'resume') {
        const ref = args[1];
        if (!ref) return void await message.reply(`Usage: ${prefix}rss ${sub} <index|feedId>`);

        const found = findFeedByRef(rss.feeds, ref);
        if (!found) return void await message.reply('Feed not found. Use rss list to check indexes and IDs.');

        found.feed.enabled = sub === 'resume';
        await saveSettings(settings, guild.id);
        return void await message.reply(`${sub === 'resume' ? 'Resumed' : 'Paused'} feed \`${found.feed.id}\`.`);
      }

      if (sub === 'interval') {
        const raw = args[1];
        if (!raw) {
          return void await message.reply(`Current poll interval is ${rss.pollIntervalMinutes} minute(s).\nUsage: ${prefix}rss interval <minutes>`);
        }

        const parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed)) {
          return void await message.reply('Interval must be a number.');
        }

        const clamped = clampPollIntervalMinutes(parsed);
        rss.pollIntervalMinutes = clamped;
        rss.enabled = true;
        await saveSettings(settings, guild.id);

        return void await message.reply(`RSS poll interval set to ${clamped} minute(s).`);
      }

      if (sub === 'test') {
        const refOrSource = args[1];
        if (!refOrSource) {
          return void await message.reply(`Usage: ${prefix}rss test <index|feedId|url|/rsshub/route>`);
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
          return void await message.reply('Could not resolve feed source from your input.');
        }

        const parsed = await fetchFeed(
          source,
          {
            timeoutMs: config.rss.fetchTimeoutMs,
            maxBodyBytes: config.rss.maxBodyBytes,
            rsshubBaseUrl: config.rss.rsshubBaseUrl,
            rsshubAccessKey: config.rss.rsshubAccessKey,
          },
        );

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
              name: 'Resolved URL',
              value: parsed.feedUrl,
              inline: false,
            },
            {
              name: 'Total items parsed',
              value: String(parsed.items.length),
              inline: true,
            },
          )
          .setTimestamp(new Date());

        return void await message.reply({ embeds: [embed] });
      }

      if (sub === 'status') {
        if (rss.feeds.length === 0) {
          return void await message.reply(`No RSS feeds configured. Use ${prefix}rss add to create one.`);
        }

        const states = await RssFeedState.find({
          guildId: guild.id,
          feedId: { $in: rss.feeds.map((feed) => feed.id) },
        }).lean();
        const stateByFeedId = new Map(states.map((state) => [state.feedId, state]));

        const embed = new EmbedBuilder()
          .setTitle('RSS Feed Status')
          .setDescription(`Poll interval: ${rss.pollIntervalMinutes} minute(s)`)
          .setColor(0x3498db)
          .setTimestamp(new Date());

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

        return void await message.reply({ embeds: [embed] });
      }

      return void await message.reply(`Unknown subcommand. Use ${prefix}rss help.`);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !rss (ECONNRESET)`);
        return;
      }
      console.error(`[${guildName}] Error in !rss: ${error.message || error}`);
      await message.reply(`RSS command failed: ${error.message || 'unknown error'}`).catch(() => {});
    }
  },
};

export default command;
