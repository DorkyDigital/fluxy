const mockGetOrCreate = jest.fn();
const mockRssStateFind = jest.fn();
const mockForcePollGuild = jest.fn();
const mockGetRuntimeState = jest.fn();

jest.mock('@fluxerjs/core', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => {
    const embed: any = {
      data: {
        fields: [] as any[],
      },
      setTitle: jest.fn(function (this: any, value: string) {
        this.data.title = value;
        return this;
      }),
      setDescription: jest.fn(function (this: any, value: string) {
        this.data.description = value;
        return this;
      }),
      setColor: jest.fn(function (this: any, value: number) {
        this.data.color = value;
        return this;
      }),
      addFields: jest.fn(function (this: any, ...fields: any[]) {
        this.data.fields.push(...fields);
        return this;
      }),
      setTimestamp: jest.fn(function (this: any, value: Date) {
        this.data.timestamp = value;
        return this;
      }),
      setFooter: jest.fn(function () {
        return this;
      }),
      setImage: jest.fn(function () {
        return this;
      }),
      toJSON: jest.fn(function (this: any) {
        return this.data;
      }),
    };
    return embed;
  }),
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    ownerId: 'owner-1',
    rss: {
      defaultPollIntervalMinutes: 15,
      minPollIntervalMinutes: 10,
      maxFeedsPerGuild: 5,
      fetchTimeoutMs: 8000,
      maxBodyBytes: 1024 * 1024,
      rsshubBaseUrl: 'https://rsshub.app',
      rsshubAccessKey: null,
    },
  },
}));

jest.mock('../../src/models/GuildSettings', () => ({
  __esModule: true,
  default: {
    getOrCreate: (...args: any[]) => mockGetOrCreate(...args),
  },
}));

jest.mock('../../src/models/RssFeedState', () => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => mockRssStateFind(...args),
    deleteOne: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/services/RssPollerService', () => ({
  __esModule: true,
  default: {
    forcePollGuild: (...args: any[]) => mockForcePollGuild(...args),
    getRuntimeState: (...args: any[]) => mockGetRuntimeState(...args),
  },
}));

jest.mock('../../src/utils/isNetworkError', () => jest.fn(() => false));

jest.mock('../../src/utils/settingsCache', () => ({
  __esModule: true,
  default: {
    invalidate: jest.fn(),
  },
}));

jest.mock('../../src/utils/rssFeed', () => ({
  fetchFeed: jest.fn(),
}));

import rssCommand from '../../src/commands/admin/rss';

function makeGuildSettings() {
  return {
    rss: {
      enabled: true,
      pollIntervalMinutes: 15,
      feeds: [
        {
          id: 'feed-1',
          name: 'Flux Feed',
          sourceType: 'rss',
          url: 'https://example.com/feed.xml',
          route: null,
          channelId: 'channel-1',
          mentionRoleId: null,
          enabled: true,
          maxItemsPerPoll: 3,
          includeSummary: true,
          includeImage: true,
          format: 'embed',
        },
      ],
    },
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMessage(authorId: string) {
  return {
    author: { id: authorId },
    guild: { id: 'guild-1', name: 'Guild One' },
    guildId: 'guild-1',
    reply: jest.fn().mockResolvedValue({ id: 'm-1' }),
  } as any;
}

describe('rss owner-only tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks non-owner from owner-only rss debug tools', async () => {
    const message = makeMessage('user-2');
    const client = {} as any;

    await (rssCommand as any).execute(message, ['debug'], client, '!');

    expect(message.reply).toHaveBeenCalledWith('This RSS subcommand is restricted to the bot owner.');
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  test('owner forcepoll calls poller service and returns summary', async () => {
    mockGetOrCreate.mockResolvedValue(makeGuildSettings());
    mockForcePollGuild.mockResolvedValue({
      requestedFeedId: null,
      matchedFeeds: 1,
      processed: 1,
      publishedItems: 2,
      failed: 0,
      skipped: 0,
      reason: 'ok',
      details: [
        {
          feedId: 'feed-1',
          status: 'published',
          publishedCount: 2,
          error: null,
        },
      ],
    });

    const message = makeMessage('owner-1');
    const client = { id: 'client-1' } as any;

    await (rssCommand as any).execute(message, ['forcepoll'], client, '!');

    expect(mockForcePollGuild).toHaveBeenCalledWith(client, 'guild-1', undefined);
    expect(message.reply).toHaveBeenCalledTimes(1);
    const payload = message.reply.mock.calls[0][0] as string;
    expect(payload).toContain('Force poll completed for this guild.');
    expect(payload).toContain('Published items: 2');
  });

  test('owner debug returns runtime and feed state embed', async () => {
    mockGetOrCreate.mockResolvedValue(makeGuildSettings());
    mockGetRuntimeState.mockReturnValue({
      started: true,
      running: false,
      hasClient: true,
    });

    mockRssStateFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          guildId: 'guild-1',
          feedId: 'feed-1',
          seenItemIds: ['a', 'b', 'c'],
          lastCheckedAt: new Date('2026-04-02T10:00:00.000Z'),
          lastSuccessAt: new Date('2026-04-02T10:00:00.000Z'),
          consecutiveFailures: 0,
          lastError: null,
          etag: 'etag-1',
        },
      ]),
    });

    const message = makeMessage('owner-1');
    const client = {} as any;

    await (rssCommand as any).execute(message, ['debug'], client, '!');

    expect(message.reply).toHaveBeenCalledTimes(1);
    const payload = message.reply.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].data.title).toBe('RSS Debug (Owner Only)');
    expect(payload.embeds[0].data.description).toContain('Poller runtime: started');
    expect(payload.embeds[0].data.fields[0].value).toContain('Seen IDs: 3');
  });
});
