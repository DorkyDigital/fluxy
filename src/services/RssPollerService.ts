import type { Client } from '@fluxerjs/core';
import { EmbedBuilder } from '@fluxerjs/core';
import type { IRssFeed, IRssSettings } from '../types';
import config from '../config';
import RssFeedState, { type IRssFeedState } from '../models/RssFeedState';
import log from '../utils/consoleLogger';
import settingsCache from '../utils/settingsCache';
import { fetchFeed } from '../utils/rssFeed';
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
        let channel: any = client.channels.get(feed.channelId);
        if (!channel) {
          channel = await client.channels.fetch(feed.channelId).catch(() => null);
        }
        if (!channel || typeof channel.send !== 'function') {
          throw new Error(`Channel ${feed.channelId} is unavailable for feed ${feed.id}`);
        }

        for (const item of toPublish) {
          const mention = feed.mentionRoleId ? `<@&${feed.mentionRoleId}>` : null;

          if (feed.format === 'text') {
            const lines = [
              item.title,
              item.link,
            ];
            const content = `${mention ? `${mention}\n` : ''}${lines.join('\n')}`;
            await channel.send(content);
          } else {
            const sourceTitle = feed.name || parsed.title || 'RSS Feed';
            const title = truncate(item.title || sourceTitle, 256);
            const summary = feed.includeSummary ? truncate(item.description || '', 800) : '';
            const description = summary
              ? `${summary}\n\n${item.link}`
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
              embed.addFields({
                name: 'Author',
                value: truncate(item.author, 200),
                inline: true,
              });
            }

            if (feed.includeImage && item.imageUrl) {
              embed.setImage(item.imageUrl);
            }

            const payload = mention
              ? { content: mention, embeds: [embed] }
              : { embeds: [embed] };
            await channel.send(payload);
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
