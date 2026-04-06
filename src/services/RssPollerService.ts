import type { Client } from '@erinjs/core';
import { EmbedBuilder } from '@erinjs/core';
import { Routes } from '@erinjs/types';
import type { IRssFeed, IRssSettings } from '../types';
import config from '../config';
import GuildSettings from '../models/GuildSettings';
import RssFeedState, { type IRssFeedState } from '../models/RssFeedState';
import log from '../utils/consoleLogger';
import settingsCache from '../utils/settingsCache';
import { fetchFeed } from '../utils/rssFeed';
import { t } from '../i18n';
import {
  RSS_MAX_SEEN_ITEM_IDS,
  clampItemsPerPoll,
  clampPollIntervalMinutes,
} from '../utils/rssDefaults';

interface DueFeed {
  guildId: string;
  feed: IRssFeed;
  state: IRssFeedState | null;
  pollIntervalMinutes: number;
}

interface ProcessFeedResult {
  status: 'not_modified' | 'bootstrapped' | 'published' | 'no_new_items' | 'failed';
  publishedCount: number;
  error: string | null;
}

interface WebhookTarget {
  id: string;
  token: string;
}

export interface ForcePollResult {
  requestedFeedId: string | null;
  matchedFeeds: number;
  processed: number;
  publishedItems: number;
  failed: number;
  skipped: number;
  reason: 'ok' | 'busy' | 'rss_disabled' | 'no_feeds' | 'feed_not_found' | 'no_eligible_feeds';
  details: Array<{
    feedId: string;
    status: ProcessFeedResult['status'];
    publishedCount: number;
    error: string | null;
  }>;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)) + '...';
}

function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeTitlePrefix(title: string, summary: string): string {
  const normalizedTitle = normalizeSummaryText(title);
  if (!normalizedTitle) return summary;

  const normalizedSummary = normalizeSummaryText(summary);
  if (!normalizedSummary) return '';

  if (normalizedSummary.toLowerCase() === normalizedTitle.toLowerCase()) {
    return '';
  }

  const titlePrefixPattern = new RegExp(
    `^${escapeRegExp(normalizedTitle)}(?:\\s*[\\-:|\\u2013\\u2014]\\s*)?`,
    'i',
  );
  return normalizedSummary.replace(titlePrefixPattern, '').trim();
}

function removeTrailingLink(summary: string, link: string): string {
  const normalizedSummary = normalizeSummaryText(summary);
  const normalizedLink = normalizeSummaryText(link);
  if (!normalizedSummary || !normalizedLink) return normalizedSummary;

  const trailingLinkPattern = new RegExp(`${escapeRegExp(normalizedLink)}$`, 'i');
  return normalizedSummary.replace(trailingLinkPattern, '').trim();
}

function buildEmbedSummary(item: { title: string; description: string | null; link: string }, includeSummary: boolean): string | null {
  if (!includeSummary || !item.description) return null;

  let summary = normalizeSummaryText(item.description);
  if (!summary) return null;

  summary = removeTitlePrefix(item.title, summary);
  summary = removeTrailingLink(summary, item.link);

  if (!summary) return null;
  return truncate(summary, 900);
}

function mergeSeen(existing: string[], newestFirst: string[]): string[] {
  const merged = [...newestFirst, ...existing.filter((id) => !newestFirst.includes(id))];
  return merged.slice(0, RSS_MAX_SEEN_ITEM_IDS);
}

function normalizeRssSettings(settings: unknown): IRssSettings | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const rss = settings as Partial<IRssSettings>;
  if (!Array.isArray(rss.feeds)) return null;
  return {
    enabled: rss.enabled === true,
    pollIntervalMinutes: typeof rss.pollIntervalMinutes === 'number'
      ? rss.pollIntervalMinutes
      : config.rss.defaultPollIntervalMinutes,
    feeds: rss.feeds as IRssFeed[],
  };
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function extractTwitterHandleFromUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const host = normalizeHost(parsed.hostname);
    if (host !== 'x.com' && host !== 'twitter.com') return null;

    const [first, second] = parsed.pathname.split('/').filter(Boolean);
    if (!first) return null;
    if (first.toLowerCase() === 'i') return null;
    if (second && second.toLowerCase() !== 'status') return null;

    if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
    return `@${first}`;
  } catch {
    return null;
  }
}

function extractTwitterHandleFromText(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/@([A-Za-z0-9_]{1,15})/);
  if (!match) return null;
  return `@${match[1]}`;
}

function toRichPreviewLink(value: string): string {
  try {
    const parsed = new URL(value);
    const host = normalizeHost(parsed.hostname);
    if (host === 'x.com' || host === 'twitter.com') {
      parsed.hostname = 'fxtwitter.com';
      return parsed.toString();
    }
  } catch {
    return value;
  }

  return value;
}

function pickWebhookDisplayName(feed: IRssFeed, parsedTitle: string | null, itemAuthor: string | null, itemLink: string): string {
  const configured = typeof feed.name === 'string' ? feed.name.trim() : '';
  if (configured) return truncate(configured, 80);

  const linkedHandle = extractTwitterHandleFromUrl(itemLink);
  if (linkedHandle) return linkedHandle;

  const authorHandle = extractTwitterHandleFromText(itemAuthor);
  if (authorHandle) return authorHandle;

  if (itemAuthor && itemAuthor.trim().length > 0) {
    return truncate(itemAuthor.trim(), 80);
  }

  if (parsedTitle && parsedTitle.trim().length > 0) {
    return truncate(parsedTitle.trim(), 80);
  }

  return 'Fluxy RSS';
}

function pickWebhookAvatarUrl(sourceImageUrl: string | null, itemLink: string): string | null {
  if (isHttpUrl(sourceImageUrl)) return sourceImageUrl;

  const handle = extractTwitterHandleFromUrl(itemLink);
  if (!handle) return null;

  const name = handle.replace(/^@/, '');
  return `https://unavatar.io/x/${name}`;
}

function serializeEmbed(embed: EmbedBuilder): unknown {
  const asAny = embed as any;
  if (typeof asAny.toJSON === 'function') {
    return asAny.toJSON();
  }
  if (asAny.data && typeof asAny.data === 'object') {
    return asAny.data;
  }
  return embed;
}

class RssPollerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private client: Client | null = null;

  start(client: Client): void {
    if (!config.rss.enabled) {
      log.info('RSS', 'RSS poller disabled by configuration');
      return;
    }

    if (this.timer) return;

    this.client = client;
    this.timer = setInterval(() => {
      void this.pollTick();
    }, 60_000);

    (this.timer as any)?.unref?.();

    log.ok('RSS', 'RSS poller started');
    void this.pollTick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('RSS', 'RSS poller stopped');
    }
  }

  getRuntimeState(): { started: boolean; running: boolean; hasClient: boolean } {
    return {
      started: this.timer !== null,
      running: this.running,
      hasClient: this.client !== null,
    };
  }

  async forcePollGuild(client: Client, guildId: string, feedId?: string): Promise<ForcePollResult> {
    const requestedFeedId = feedId || null;

    if (this.running) {
      return {
        requestedFeedId,
        matchedFeeds: 0,
        processed: 0,
        publishedItems: 0,
        failed: 0,
        skipped: 0,
        reason: 'busy',
        details: [],
      };
    }

    const settings = await settingsCache.get(guildId);
    const rss = normalizeRssSettings((settings as any)?.rss);

    if (!rss || !rss.enabled) {
      return {
        requestedFeedId,
        matchedFeeds: 0,
        processed: 0,
        publishedItems: 0,
        failed: 0,
        skipped: 0,
        reason: 'rss_disabled',
        details: [],
      };
    }

    if (rss.feeds.length === 0) {
      return {
        requestedFeedId,
        matchedFeeds: 0,
        processed: 0,
        publishedItems: 0,
        failed: 0,
        skipped: 0,
        reason: 'no_feeds',
        details: [],
      };
    }

    const feeds = requestedFeedId
      ? rss.feeds.filter((feed) => feed?.id === requestedFeedId)
      : rss.feeds;

    if (requestedFeedId && feeds.length === 0) {
      return {
        requestedFeedId,
        matchedFeeds: 0,
        processed: 0,
        publishedItems: 0,
        failed: 0,
        skipped: 0,
        reason: 'feed_not_found',
        details: [],
      };
    }

    const eligibleFeeds = feeds.filter((feed) => feed?.enabled && feed?.id && feed?.channelId);

    if (eligibleFeeds.length === 0) {
      return {
        requestedFeedId,
        matchedFeeds: feeds.length,
        processed: 0,
        publishedItems: 0,
        failed: 0,
        skipped: feeds.length,
        reason: 'no_eligible_feeds',
        details: [],
      };
    }

    const stateDocs = await RssFeedState.find({
      guildId,
      feedId: { $in: eligibleFeeds.map((feed) => feed.id) },
    }).lean();
    const stateByFeedId = new Map(stateDocs.map((state) => [state.feedId, state as IRssFeedState]));
    const pollIntervalMinutes = clampPollIntervalMinutes(rss.pollIntervalMinutes);

    this.running = true;

    try {
      const details: ForcePollResult['details'] = [];
      let processed = 0;
      let failed = 0;
      let publishedItems = 0;

      for (const feed of eligibleFeeds) {
        const result = await this.processFeed(client, {
          guildId,
          feed,
          state: stateByFeedId.get(feed.id) ?? null,
          pollIntervalMinutes,
        });

        processed += 1;
        publishedItems += result.publishedCount;
        if (result.status === 'failed') failed += 1;

        details.push({
          feedId: feed.id,
          status: result.status,
          publishedCount: result.publishedCount,
          error: result.error,
        });
      }

      return {
        requestedFeedId,
        matchedFeeds: feeds.length,
        processed,
        publishedItems,
        failed,
        skipped: feeds.length - eligibleFeeds.length,
        reason: 'ok',
        details,
      };
    } finally {
      this.running = false;
    }
  }

  private async pollTick(): Promise<void> {
    if (this.running || !this.client) return;
    this.running = true;

    try {
      const dueFeeds = await this.collectDueFeeds(this.client);
      if (dueFeeds.length === 0) return;

      const concurrency = Math.max(1, config.rss.maxConcurrentFetches || 8);
      let cursor = 0;

      const workers = Array.from({ length: Math.min(concurrency, dueFeeds.length) }, async () => {
        while (cursor < dueFeeds.length) {
          const idx = cursor;
          cursor++;
          await this.processFeed(this.client!, dueFeeds[idx]);
        }
      });

      await Promise.all(workers);
    } catch (err: any) {
      log.warn('RSS', `Poll tick failed: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }

  private async collectDueFeeds(client: Client): Promise<DueFeed[]> {
    const now = Date.now();
    const guildIds = Array.from(client.guilds.keys());
    const dueFeeds: DueFeed[] = [];

    for (const guildId of guildIds) {
      const settings = await settingsCache.get(guildId);
      const rss = normalizeRssSettings((settings as any)?.rss);

      if (!rss || !rss.enabled || rss.feeds.length === 0) continue;

      const pollIntervalMinutes = clampPollIntervalMinutes(rss.pollIntervalMinutes);
      const feedIds = rss.feeds
        .map((feed) => (typeof feed?.id === 'string' && feed.id.length > 0 ? feed.id : null))
        .filter((id): id is string => !!id);

      const stateDocs = await RssFeedState.find({
        guildId,
        feedId: { $in: feedIds },
      }).lean();
      const stateByFeedId = new Map(stateDocs.map((state) => [state.feedId, state as IRssFeedState]));

      for (const feed of rss.feeds) {
        if (!feed?.enabled || !feed.id || !feed.channelId) continue;

        const state = stateByFeedId.get(feed.id) ?? null;
        const lastCheckedAt = state?.lastCheckedAt ? new Date(state.lastCheckedAt).getTime() : 0;
        if (now - lastCheckedAt < pollIntervalMinutes * 60_000) continue;

        dueFeeds.push({
          guildId,
          feed,
          state,
          pollIntervalMinutes,
        });
      }
    }

    return dueFeeds;
  }

  private async persistWebhookTarget(
    guildId: string,
    feed: IRssFeed,
    target: WebhookTarget,
    webhookName: string | null,
  ): Promise<void> {
    feed.webhookId = target.id;
    feed.webhookToken = target.token;
    feed.webhookName = webhookName;

    try {
      await GuildSettings.updateOne(
        { guildId, 'rss.feeds.id': feed.id },
        {
          $set: {
            'rss.feeds.$.webhookId': target.id,
            'rss.feeds.$.webhookToken': target.token,
            'rss.feeds.$.webhookName': webhookName,
          },
        },
      );
      (settingsCache as any).invalidate?.(guildId);
    } catch (err: any) {
      log.warn('RSS', `[${guildId}] failed to persist webhook for feed ${feed.id}: ${err?.message || err}`);
    }
  }

  private async createWebhookTarget(client: Client, feed: IRssFeed, name: string): Promise<WebhookTarget | null> {
    const rest = (client as any)?.rest;
    if (!rest || typeof rest.post !== 'function') return null;

    try {
      const created = await rest.post(
        Routes.channelWebhooks(feed.channelId),
        {
          auth: true,
          body: {
            name: truncate(name || 'Fluxy RSS', 80),
          },
        },
      ) as { id?: string; token?: string | null };

      if (typeof created?.id !== 'string' || !created.id) return null;
      if (typeof created?.token !== 'string' || !created.token) return null;

      return {
        id: created.id,
        token: created.token,
      };
    } catch {
      return null;
    }
  }

  private async resolveWebhookTarget(
    client: Client,
    guildId: string,
    feed: IRssFeed,
    parsedTitle: string | null,
  ): Promise<WebhookTarget | null> {
    if (typeof feed.webhookId === 'string' && feed.webhookId && typeof feed.webhookToken === 'string' && feed.webhookToken) {
      return {
        id: feed.webhookId,
        token: feed.webhookToken,
      };
    }

    const webhookName = truncate(
      (typeof feed.webhookName === 'string' && feed.webhookName.trim().length > 0
        ? feed.webhookName
        : typeof feed.name === 'string' && feed.name.trim().length > 0
          ? feed.name
          : parsedTitle || 'Fluxy RSS').trim(),
      80,
    );

    const created = await this.createWebhookTarget(client, feed, webhookName);
    if (!created) return null;

    await this.persistWebhookTarget(guildId, feed, created, webhookName);
    return created;
  }

  private async executeWebhookPayload(
    client: Client,
    target: WebhookTarget,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const rest = (client as any)?.rest;
    if (!rest || typeof rest.post !== 'function') {
      throw new Error('Client REST transport unavailable for webhook execution');
    }

    await rest.post(Routes.webhookExecute(target.id, target.token), {
      auth: false,
      body: payload,
    });
  }

  private async processFeed(client: Client, due: DueFeed): Promise<ProcessFeedResult> {
    const now = new Date();
    const { guildId, feed, state } = due;

    try {
      const parsed = await fetchFeed(
        {
          sourceType: feed.sourceType,
          url: feed.url,
          route: feed.route,
        },
        {
          timeoutMs: config.rss.fetchTimeoutMs,
          maxBodyBytes: config.rss.maxBodyBytes,
          etag: state?.etag ?? null,
          lastModified: state?.lastModified ?? null,
          rsshubBaseUrl: config.rss.rsshubBaseUrl,
          rsshubAccessKey: config.rss.rsshubAccessKey,
        },
      );

      if (parsed.notModified) {
        await RssFeedState.findOneAndUpdate(
          { guildId, feedId: feed.id },
          {
            $set: {
              lastCheckedAt: now,
              lastSuccessAt: now,
              lastError: null,
              etag: parsed.etag,
              lastModified: parsed.lastModified,
              consecutiveFailures: 0,
            },
          },
          { upsert: true, setDefaultsOnInsert: true },
        );
        return {
          status: 'not_modified',
          publishedCount: 0,
          error: null,
        };
      }

      const existingSeen = Array.isArray(state?.seenItemIds) ? state!.seenItemIds : [];
      const seenSet = new Set(existingSeen);
      const isBootstrap = existingSeen.length === 0;

      if (isBootstrap) {
        const seedKeys = parsed.items.slice(0, RSS_MAX_SEEN_ITEM_IDS).map((item) => item.key);
        await RssFeedState.findOneAndUpdate(
          { guildId, feedId: feed.id },
          {
            $set: {
              seenItemIds: mergeSeen(existingSeen, seedKeys),
              etag: parsed.etag,
              lastModified: parsed.lastModified,
              lastCheckedAt: now,
              lastSuccessAt: now,
              lastError: null,
              consecutiveFailures: 0,
            },
          },
          { upsert: true, setDefaultsOnInsert: true },
        );
        return {
          status: 'bootstrapped',
          publishedCount: 0,
          error: null,
        };
      }

      const unseen = parsed.items.filter((item) => !seenSet.has(item.key));
      const maxItems = clampItemsPerPoll(feed.maxItemsPerPoll);
      const toPublish = unseen.slice(0, maxItems).reverse();

      if (toPublish.length > 0) {
        let fallbackChannel: any = null;
        const resolveFallbackChannel = async (): Promise<any> => {
          if (fallbackChannel && typeof fallbackChannel.send === 'function') {
            return fallbackChannel;
          }

          let channel: any = client.channels.get(feed.channelId);
          if (!channel) {
            channel = await client.channels.fetch(feed.channelId).catch(() => null);
          }

          if (!channel || typeof channel.send !== 'function') {
            throw new Error(`Channel ${feed.channelId} is unavailable for feed ${feed.id}`);
          }

          fallbackChannel = channel;
          return channel;
        };

        let webhookTarget = await this.resolveWebhookTarget(client, guildId, feed, parsed.title);
        let webhookRetryAttempted = false;

        const sendWithFallback = async (
          webhookName: string,
          webhookPayload: Record<string, unknown>,
          fallbackPayload: unknown,
        ): Promise<void> => {
          if (webhookTarget) {
            try {
              await this.executeWebhookPayload(client, webhookTarget, webhookPayload);
              return;
            } catch {
              if (!webhookRetryAttempted) {
                webhookRetryAttempted = true;
                const recreated = await this.createWebhookTarget(client, feed, webhookName);
                if (recreated) {
                  webhookTarget = recreated;
                  await this.persistWebhookTarget(guildId, feed, recreated, webhookName);
                  try {
                    await this.executeWebhookPayload(client, webhookTarget, webhookPayload);
                    return;
                  } catch {
                    webhookTarget = null;
                  }
                } else {
                  webhookTarget = null;
                }
              } else {
                webhookTarget = null;
              }
            }
          }

          const channel = await resolveFallbackChannel();
          await channel.send(fallbackPayload as any);
        };

        const sourceTitle = feed.name || parsed.title || 'RSS Feed';

        for (const item of toPublish) {
          const mention = feed.mentionRoleId ? `<@&${feed.mentionRoleId}>` : null;
          const richPreviewLink = toRichPreviewLink(item.link);
          const webhookName = pickWebhookDisplayName(feed, parsed.title, item.author, item.link);
          const webhookAvatarUrl = pickWebhookAvatarUrl(parsed.sourceImageUrl, item.link);

          const webhookBasePayload: Record<string, unknown> = {
            username: webhookName,
            allowed_mentions: mention
              ? { parse: [], roles: [feed.mentionRoleId as string] }
              : { parse: [] },
          };

          if (webhookAvatarUrl) {
            webhookBasePayload.avatar_url = webhookAvatarUrl;
          }

          if (feed.format === 'text') {
            const lines: string[] = [];
            if (mention) lines.push(mention);
            lines.push(item.title);
            lines.push(richPreviewLink);

            const content = lines.join('\n');
            await sendWithFallback(
              webhookName,
              {
                ...webhookBasePayload,
                content,
              },
              content,
            );
          } else {
            const title = truncate(item.title || sourceTitle, 256);
            const summary = buildEmbedSummary(item, feed.includeSummary);
            const description = summary
              ? summary
              : item.link;

            const embed = new EmbedBuilder()
              .setTitle(title)
              .setDescription(description)
              .setColor(0x3498db)
              .setFooter({ text: truncate(sourceTitle, 200) });

            if (item.publishedAt) {
              embed.setTimestamp(item.publishedAt);
            }

            if (item.author) {
              const authorPayload: Record<string, unknown> = {
                name: truncate(item.author, 200),
              };
              if (webhookAvatarUrl) {
                authorPayload.icon_url = webhookAvatarUrl;
              }
              embed.setAuthor(authorPayload as any);
            }

            if (summary) {
              embed.addFields({
                name: t('en', 'auditCatalog.services.RssPollerService.l750_addFields_name'),
                value: item.link,
                inline: false,
              });
            }

            if (feed.includeImage && item.imageUrl) {
              embed.setImage(item.imageUrl);
            }

            const contentLines: string[] = [];
            if (mention) contentLines.push(mention);
            contentLines.push(richPreviewLink);

            const webhookPayload: Record<string, unknown> = {
              ...webhookBasePayload,
              embeds: [serializeEmbed(embed)],
            };

            const content = contentLines.join('\n').trim();
            if (content) {
              webhookPayload.content = content;
            }

            const fallbackPayload: Record<string, unknown> = {
              embeds: [embed],
            };
            if (content) {
              fallbackPayload.content = content;
            }

            await sendWithFallback(webhookName, webhookPayload, fallbackPayload);
          }
        }
      }

      const publishedKeys = toPublish.map((item) => item.key).reverse();
      const seenItemIds = mergeSeen(existingSeen, publishedKeys);

      await RssFeedState.findOneAndUpdate(
        { guildId, feedId: feed.id },
        {
          $set: {
            seenItemIds,
            etag: parsed.etag,
            lastModified: parsed.lastModified,
            lastCheckedAt: now,
            lastSuccessAt: now,
            lastError: null,
            consecutiveFailures: 0,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      return {
        status: toPublish.length > 0 ? 'published' : 'no_new_items',
        publishedCount: toPublish.length,
        error: null,
      };
    } catch (err: any) {
      const nextFailureCount = (state?.consecutiveFailures ?? 0) + 1;
      await RssFeedState.findOneAndUpdate(
        { guildId, feedId: feed.id },
        {
          $set: {
            lastCheckedAt: now,
            lastError: truncate(err?.message || String(err), 1000),
            consecutiveFailures: nextFailureCount,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      if (nextFailureCount <= 3 || nextFailureCount % 10 === 0) {
        log.warn('RSS', `[${guildId}] feed ${feed.id} failed (${nextFailureCount}): ${err?.message || err}`);
      }

      return {
        status: 'failed',
        publishedCount: 0,
        error: truncate(err?.message || String(err), 1000),
      };
    }
  }
}

const rssPollerService = new RssPollerService();

export default rssPollerService;
