import { clearReactionLogFilterCache, isReactionOnBotMessage } from '../../src/utils/reactionLogFilter';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    users: {
      get: jest.fn().mockReturnValue(null),
    },
    rest: {
      get: jest.fn(),
    },
    ...overrides,
  } as any;
}

describe('reactionLogFilter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearReactionLogFilterCache();
  });

  test('returns true when reaction payload includes bot-authored message', async () => {
    const client = makeClient();
    const reaction = {
      channelId: 'c1',
      messageId: 'm1',
      message: {
        author: {
          id: 'bot-1',
          bot: true,
        },
      },
    } as any;

    const isBotMessage = await isReactionOnBotMessage(client, reaction);

    expect(isBotMessage).toBe(true);
    expect(client.rest.get).not.toHaveBeenCalled();
  });

  test('uses user cache bot flag when payload has only author id', async () => {
    const client = makeClient({
      users: {
        get: jest.fn().mockReturnValue({ id: 'bot-2', bot: true }),
      },
    });

    const reaction = {
      channelId: 'c2',
      messageId: 'm2',
      messageAuthorId: 'bot-2',
    } as any;

    const isBotMessage = await isReactionOnBotMessage(client, reaction);

    expect(isBotMessage).toBe(true);
    expect(client.rest.get).not.toHaveBeenCalled();
  });

  test('fetches message author when needed and caches result', async () => {
    const restGet = jest.fn().mockResolvedValue({
      id: 'm3',
      author: {
        id: 'bot-3',
        bot: true,
      },
    });
    const client = makeClient({
      rest: {
        get: restGet,
      },
    });

    const reaction = {
      channelId: 'c3',
      messageId: 'm3',
    } as any;

    const first = await isReactionOnBotMessage(client, reaction);
    const second = await isReactionOnBotMessage(client, reaction);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(restGet).toHaveBeenCalledTimes(1);
  });

  test('returns false for human-authored messages', async () => {
    const client = makeClient({
      rest: {
        get: jest.fn().mockResolvedValue({
          id: 'm4',
          author: {
            id: 'user-1',
            bot: false,
          },
        }),
      },
    });

    const reaction = {
      channelId: 'c4',
      messageId: 'm4',
    } as any;

    const isBotMessage = await isReactionOnBotMessage(client, reaction);

    expect(isBotMessage).toBe(false);
  });

  test('returns false when message fetch fails', async () => {
    const client = makeClient({
      rest: {
        get: jest.fn().mockRejectedValue(new Error('boom')),
      },
    });

    const reaction = {
      channelId: 'c5',
      messageId: 'm5',
    } as any;

    const isBotMessage = await isReactionOnBotMessage(client, reaction);

    expect(isBotMessage).toBe(false);
  });
});
