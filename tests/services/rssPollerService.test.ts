const mockSettingsGet = jest.fn();
const mockFetchFeed = jest.fn();
const mockRssFind = jest.fn();
const mockRssFindOneAndUpdate = jest.fn();
const mockGuildSettingsUpdateOne = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
const mockLogOk = jest.fn();

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    rss: {
      enabled: true,
      defaultPollIntervalMinutes: 15,
      maxConcurrentFetches: 4,
      fetchTimeoutMs: 7000,
      maxBodyBytes: 1024 * 1024,
      rsshubBaseUrl: 'https://rsshub.local',
      rsshubAccessKey: null,
    },
  },
}));

jest.mock('../../src/utils/settingsCache', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockSettingsGet(...args),
  },
}));

jest.mock('../../src/utils/rssFeed', () => ({
  fetchFeed: (...args: any[]) => mockFetchFeed(...args),
}));

jest.mock('../../src/models/RssFeedState', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockRssFind(...args),
    findOneAndUpdate: (...args: any[]) => mockRssFindOneAndUpdate(...args),
  },
}));

jest.mock('../../src/models/GuildSettings', () => ({
  __esModule: true,
  default: {
    updateOne: (...args: any[]) => mockGuildSettingsUpdateOne(...args),
  },
}));

jest.mock('../../src/utils/consoleLogger', () => ({
  __esModule: true,
  default: {
    warn: (...args: any[]) => mockLogWarn(...args),
    info: (...args: any[]) => mockLogInfo(...args),
    ok: (...args: any[]) => mockLogOk(...args),
  },
}));

jest.mock('@erinjs/core', () => {
  class MockEmbedBuilder {
    public data: Record<string, unknown> = { fields: [] };

    setTitle(value: string) {
      this.data.title = value;
      return this;
    }
    setDescription(value: string) {
      this.data.description = value;
      return this;
    }
    setColor(value: number) {
      this.data.color = value;
      return this;
    }
    setFooter(value: unknown) {
      this.data.footer = value;
      return this;
    }
    setTimestamp(value: unknown) {
      this.data.timestamp = value;
      return this;
    }
    setAuthor(value: unknown) {
      this.data.author = value;
      return this;
    }
    addFields(value: unknown) {
      (this.data.fields as unknown[]).push(value);
      return this;
    }
    setImage(value: string) {
      this.data.image = value;
      return this;
    }
  }

  return { EmbedBuilder: MockEmbedBuilder };
});

import rssPollerService from '../../src/services/RssPollerService';
import { Routes } from '@erinjs/types';

function makeFeed(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feed-1',
    name: 'Fluxy Feed',
    sourceType: 'rss',
    url: 'https://example.com/feed.xml',
    route: null,
    channelId: '12345678901234567',
    mentionRoleId: '22345678901234567',
    enabled: true,
    maxItemsPerPoll: 3,
    includeSummary: true,
    includeImage: true,
    format: 'embed',
    ...overrides,
  };
}

function makeClient(sendMock: jest.Mock) {
  return {
    guilds: new Map([['g1', { id: 'g1', name: 'Guild One' }]]),
    channels: {
      get: jest.fn().mockReturnValue({ send: sendMock }),
      fetch: jest.fn().mockResolvedValue({ send: sendMock }),
    },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  rssPollerService.stop();
  (rssPollerService as any).running = false;
  (rssPollerService as any).client = null;
});

describe('RssPollerService', () => {
  test('bootstrap run seeds seen items and does not post', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed()],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Fluxy Feed',
      link: 'https://example.com',
      description: null,
      etag: 'etag-1',
      lastModified: 'Thu, 01 Apr 2026 00:00:00 GMT',
      notModified: false,
      items: [
        {
          key: 'item-1',
          title: 'First item',
          link: 'https://example.com/1',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
      ],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).not.toHaveBeenCalled();
    expect(mockRssFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'g1', feedId: 'feed-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          seenItemIds: expect.arrayContaining(['item-1']),
          lastSuccessAt: expect.any(Date),
          consecutiveFailures: 0,
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  test('posts unseen text items and updates seen state', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed({ format: 'text' })],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 0,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Fluxy Feed',
      link: 'https://example.com',
      description: null,
      etag: 'etag-2',
      lastModified: 'Thu, 02 Apr 2026 00:00:00 GMT',
      notModified: false,
      items: [
        {
          key: 'item-2',
          title: 'Second item',
          link: 'https://example.com/2',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
        {
          key: 'item-1',
          title: 'First item',
          link: 'https://example.com/1',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
      ],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toContain('<@&22345678901234567>');
    expect(sendMock.mock.calls[0][0]).toContain('Second item');
    expect(sendMock.mock.calls[0][0]).toContain('https://example.com/2');

    expect(mockRssFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'g1', feedId: 'feed-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          seenItemIds: expect.arrayContaining(['item-2']),
          lastSuccessAt: expect.any(Date),
          consecutiveFailures: 0,
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  test('records failure state when fetch throws', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed()],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 2,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockRejectedValue(new Error('feed fetch exploded'));
    mockRssFindOneAndUpdate.mockResolvedValue(null);

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).not.toHaveBeenCalled();
    expect(mockRssFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'g1', feedId: 'feed-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          consecutiveFailures: 3,
          lastError: expect.stringContaining('feed fetch exploded'),
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
    expect(mockLogWarn).toHaveBeenCalled();
  });

  test('treats not-modified as successful check and updates lastSuccessAt', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed()],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 1,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: null,
      link: null,
      description: null,
      etag: 'etag-304',
      lastModified: 'Thu, 03 Apr 2026 00:00:00 GMT',
      notModified: true,
      items: [],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).not.toHaveBeenCalled();
    expect(mockRssFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'g1', feedId: 'feed-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          lastSuccessAt: expect.any(Date),
          consecutiveFailures: 0,
          lastError: null,
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  test('forcePollGuild returns busy while poller is running', async () => {
    const client = makeClient(jest.fn().mockResolvedValue(undefined));
    (rssPollerService as any).running = true;

    const result = await rssPollerService.forcePollGuild(client, 'g1');

    expect(result.reason).toBe('busy');
    expect(result.processed).toBe(0);
    expect(mockSettingsGet).not.toHaveBeenCalled();
  });

  test('forcePollGuild processes feeds immediately and returns summary', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed({ format: 'text' })],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 0,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Fluxy Feed',
      link: 'https://example.com',
      description: null,
      etag: 'etag-2',
      lastModified: 'Thu, 02 Apr 2026 00:00:00 GMT',
      notModified: false,
      items: [
        {
          key: 'item-2',
          title: 'Second item',
          link: 'https://example.com/2',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
        {
          key: 'item-1',
          title: 'First item',
          link: 'https://example.com/1',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
      ],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);

    const result = await rssPollerService.forcePollGuild(client, 'g1');

    expect(result.reason).toBe('ok');
    expect(result.processed).toBe(1);
    expect(result.publishedItems).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.details[0].status).toBe('published');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test('embed output removes duplicate title text and keeps clean link field', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const client = makeClient(sendMock);

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed({ format: 'embed', mentionRoleId: null })],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 0,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Fluxy Feed',
      link: 'https://example.com',
      description: null,
      etag: 'etag-3',
      lastModified: 'Thu, 02 Apr 2026 00:00:00 GMT',
      notModified: false,
      items: [
        {
          key: 'item-2',
          title: 'RT Hello World',
          link: 'https://example.com/2',
          description: 'RT Hello World - this is the summary https://example.com/2',
          publishedAt: null,
          author: 'bone',
          imageUrl: null,
        },
        {
          key: 'item-1',
          title: 'First item',
          link: 'https://example.com/1',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
      ],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);

    const embed = payload.embeds[0].data;
    expect(embed.title).toBe('RT Hello World');
    expect(embed.description).toBe('this is the summary');
    expect(embed.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Link', value: 'https://example.com/2' })]),
    );
    expect(embed.author).toEqual(expect.objectContaining({ name: 'bone' }));
  });

  test('uses channel webhook with source profile metadata when rest is available', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const webhookPayloads: Array<Record<string, unknown>> = [];

    const restPost = jest.fn(async (route: string, options: any) => {
      if (route === Routes.channelWebhooks('12345678901234567')) {
        return { id: 'wh-1', token: 'tok-1' };
      }

      if (route === Routes.webhookExecute('wh-1', 'tok-1')) {
        webhookPayloads.push(options?.body ?? {});
        return { id: 'msg-1' };
      }

      throw new Error(`Unexpected route: ${route}`);
    });

    const client = {
      ...makeClient(sendMock),
      rest: {
        post: restPost,
      },
    } as any;

    mockSettingsGet.mockResolvedValue({
      guildId: 'g1',
      rss: {
        enabled: true,
        pollIntervalMinutes: 15,
        feeds: [makeFeed({ name: null, mentionRoleId: null })],
      },
    });

    mockRssFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'g1',
          feedId: 'feed-1',
          seenItemIds: ['item-1'],
          consecutiveFailures: 0,
          lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    });

    mockFetchFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Twitter @HELLDIVERS2',
      link: 'https://x.com/helldivers2',
      description: null,
      sourceImageUrl: 'https://pbs.twimg.com/profile_images/hd2.jpg',
      etag: 'etag-4',
      lastModified: 'Thu, 03 Apr 2026 00:00:00 GMT',
      notModified: false,
      items: [
        {
          key: 'item-2',
          title: 'HELlDIVERS 2',
          link: 'https://x.com/helldivers2/status/2040444809219916065',
          description: 'New stratagem report',
          publishedAt: null,
          author: 'HELLDIVERS 2',
          imageUrl: null,
        },
        {
          key: 'item-1',
          title: 'First item',
          link: 'https://example.com/1',
          description: null,
          publishedAt: null,
          author: null,
          imageUrl: null,
        },
      ],
    });

    mockRssFindOneAndUpdate.mockResolvedValue(null);
    mockGuildSettingsUpdateOne.mockResolvedValue({ modifiedCount: 1 });

    (rssPollerService as any).client = client;
    await (rssPollerService as any).pollTick();

    expect(sendMock).not.toHaveBeenCalled();
    expect(restPost).toHaveBeenCalledWith(
      Routes.channelWebhooks('12345678901234567'),
      expect.objectContaining({
        auth: true,
        body: expect.objectContaining({ name: expect.any(String) }),
      }),
    );
    expect(restPost).toHaveBeenCalledWith(
      Routes.webhookExecute('wh-1', 'tok-1'),
      expect.objectContaining({ auth: false, body: expect.any(Object) }),
    );

    expect(webhookPayloads).toHaveLength(1);
    expect(webhookPayloads[0]).toMatchObject({
      username: '@helldivers2',
      avatar_url: 'https://pbs.twimg.com/profile_images/hd2.jpg',
    });
    expect(String(webhookPayloads[0].content)).toContain('https://fixupx.com/helldivers2/status/2040444809219916065');
    expect(mockGuildSettingsUpdateOne).toHaveBeenCalledWith(
      { guildId: 'g1', 'rss.feeds.id': 'feed-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'rss.feeds.$.webhookId': 'wh-1',
          'rss.feeds.$.webhookToken': 'tok-1',
        }),
      }),
    );
  });
});
