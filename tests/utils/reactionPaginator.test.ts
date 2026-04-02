import { handlePaginatorReaction, registerReactionPaginator } from '../../src/utils/reactionPaginator';

function makeClient() {
  return {
    rest: {
      put: jest.fn().mockResolvedValue(undefined),
      patch: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe('reaction paginator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('registers paginator and adds back/next reactions', async () => {
    const client = makeClient();

    await registerReactionPaginator(client, {
      messageId: 'm1',
      channelId: 'c1',
      ownerUserId: 'u1',
      pages: [{ title: 'p1' }, { title: 'p2' }],
    });

    expect(client.rest.put).toHaveBeenCalledTimes(2);
    expect(client.rest.put.mock.calls[0][0]).toContain('/@me');
    expect(client.rest.put.mock.calls[1][0]).toContain('/@me');
  });

  test('owner next reaction updates page and removes reaction', async () => {
    const client = makeClient();

    await registerReactionPaginator(client, {
      messageId: 'm2',
      channelId: 'c2',
      ownerUserId: 'u1',
      pages: [{ title: 'first' }, { title: 'second' }],
    });

    client.rest.patch.mockClear();
    client.rest.delete.mockClear();

    const handled = await handlePaginatorReaction(
      client,
      {
        messageId: 'm2',
        channelId: 'c2',
        emoji: { name: '➡️' },
      },
      { id: 'u1', bot: false },
    );

    expect(handled).toBe(true);
    expect(client.rest.delete).toHaveBeenCalledTimes(1);
    expect(client.rest.patch).toHaveBeenCalledTimes(1);
    expect(client.rest.patch.mock.calls[0][0]).toContain('/channels/c2/messages/m2');
  });

  test('non-owner reaction is consumed but does not switch pages', async () => {
    const client = makeClient();

    await registerReactionPaginator(client, {
      messageId: 'm3',
      channelId: 'c3',
      ownerUserId: 'u1',
      pages: [{ title: 'first' }, { title: 'second' }],
    });

    client.rest.patch.mockClear();
    client.rest.delete.mockClear();

    const handled = await handlePaginatorReaction(
      client,
      {
        messageId: 'm3',
        channelId: 'c3',
        emoji: { name: '➡️' },
      },
      { id: 'u2', bot: false },
    );

    expect(handled).toBe(true);
    expect(client.rest.delete).toHaveBeenCalledTimes(1);
    expect(client.rest.patch).not.toHaveBeenCalled();
  });

  test('session becomes stale and removes reactions after timeout', async () => {
    jest.useFakeTimers();

    const client = makeClient();
    await registerReactionPaginator(client, {
      messageId: 'm4',
      channelId: 'c4',
      ownerUserId: 'u1',
      pages: [{ title: 'first' }, { title: 'second' }],
      ttlMs: 30_000,
    });

    client.rest.delete.mockClear();

    await jest.advanceTimersByTimeAsync(31_000);
    await Promise.resolve();

    expect(client.rest.delete).toHaveBeenCalled();

    const handled = await handlePaginatorReaction(
      client,
      {
        messageId: 'm4',
        channelId: 'c4',
        emoji: { name: '➡️' },
      },
      { id: 'u1', bot: false },
    );

    expect(handled).toBe(false);
  });
});
