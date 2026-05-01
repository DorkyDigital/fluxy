const OWNER_ID = '111111111111111111';
const TARGET_ID = '222222222222222222';

const mockCollectUserData = jest.fn();
const mockDeleteUserData = jest.fn();

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    ownerId: OWNER_ID,
  },
}));

jest.mock('../../src/services/UserDataService', () => ({
  __esModule: true,
  collectUserData: (...args: any[]) => mockCollectUserData(...args),
  deleteUserData: (...args: any[]) => mockDeleteUserData(...args),
}));

jest.mock('../../src/utils/isNetworkError', () => jest.fn(() => false));

import removeCommand from '../../src/commands/owner/remove';

function makeDeleteResult(overrides: Record<string, unknown> = {}) {
  return {
    userSettings: false,
    warnings: 0,
    warningsIssuedAnonymized: 0,
    moderationLogsAnonymized: 0,
    ticketMessagesAnonymized: 0,
    ticketsAnonymized: 0,
    ticketParticipantsRemoved: 0,
    globalBan: false,
    globalBansAddedAnonymized: 0,
    globalBanPromptsDeleted: 0,
    globalBanPromptDecisionsAnonymized: 0,
    commandUsage: 0,
    guildSettingsReferences: 0,
    keywordReferencesAnonymized: 0,
    starboardMessagesAnonymized: 0,
    starboardReactionsRemoved: 0,
    lockdownStatesAnonymized: 0,
    ...overrides,
  };
}

function makeMessage(authorId = OWNER_ID, guildId: string | null = null) {
  const sentMessages: any[] = [];
  const message: any = {
    author: { id: authorId },
    guildId,
    guild: guildId ? { id: guildId } : null,
    channelId: 'dm-channel-1',
    reply: jest.fn(async (payload: any) => {
      const sent = {
        id: `reply-${sentMessages.length + 1}`,
        channelId: 'dm-channel-1',
        payload,
        react: jest.fn().mockResolvedValue(undefined),
        edit: jest.fn().mockResolvedValue(undefined),
      };
      sentMessages.push(sent);
      return sent;
    }),
    _sentMessages: sentMessages,
  };
  return message;
}

function makeClient(options: { dmChannel?: any; fetchedUser?: any } = {}) {
  const listeners = new Set<(...args: any[]) => void>();
  const dmChannel =
    options.dmChannel === undefined ? { send: jest.fn().mockResolvedValue(undefined) } : options.dmChannel;
  const fetchedUser = options.fetchedUser === undefined ? null : options.fetchedUser;

  const client: any = {
    users: {
      fetch: jest.fn().mockResolvedValue(fetchedUser),
      createDM: jest.fn().mockResolvedValue(dmChannel),
    },
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'messageReactionAdd') listeners.add(handler);
    }),
    off: jest.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'messageReactionAdd') listeners.delete(handler);
    }),
    emitReaction(reaction: any, user: any) {
      for (const listener of [...listeners]) listener(reaction, user);
    },
    _listeners: listeners,
    _dmChannel: dmChannel,
  };

  return client;
}

async function flushPromises() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('owner remove command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollectUserData.mockResolvedValue({ userId: TARGET_ID, exportedAt: 'now' });
    mockDeleteUserData.mockResolvedValue(makeDeleteResult());
  });

  test('only runs in DMs with Fluxy', async () => {
    const message = makeMessage(OWNER_ID, 'guild-1');
    const client = makeClient();

    await removeCommand.execute(message, [TARGET_ID], client, '!');

    expect(message.reply).toHaveBeenCalledWith('Use this command in DMs with Fluxy only.');
    expect(mockCollectUserData).not.toHaveBeenCalled();
    expect(mockDeleteUserData).not.toHaveBeenCalled();
  });

  test('blocks non-owner usage even in DMs', async () => {
    const message = makeMessage('333333333333333333');
    const client = makeClient();

    await removeCommand.execute(message, [TARGET_ID], client, '!');

    expect(message.reply).toHaveBeenCalledWith('This command is restricted to the bot owner.');
    expect(mockCollectUserData).not.toHaveBeenCalled();
  });

  test('adds confirmation reactions and cancels on x reaction', async () => {
    const message = makeMessage();
    const client = makeClient();

    const pending = removeCommand.execute(message, [TARGET_ID], client, '!');
    await flushPromises();

    const confirmationMessage = message._sentMessages[0];
    expect(confirmationMessage.react).toHaveBeenCalledWith('✅');
    expect(confirmationMessage.react).toHaveBeenCalledWith('❌');

    client.emitReaction(
      { messageId: confirmationMessage.id, channelId: confirmationMessage.channelId, emoji: { name: '❌' } },
      { id: OWNER_ID, bot: false },
    );

    await pending;

    expect(confirmationMessage.edit).toHaveBeenCalledWith({ content: 'Cancelled. No data was removed.', embeds: [] });
    expect(mockCollectUserData).not.toHaveBeenCalled();
    expect(mockDeleteUserData).not.toHaveBeenCalled();
  });

  test('sends the target user an export before deleting data', async () => {
    const dmSend = jest.fn().mockResolvedValue(undefined);
    const message = makeMessage();
    const client = makeClient({ dmChannel: { send: dmSend } });
    mockCollectUserData.mockResolvedValue({ userId: TARGET_ID, warnings: [{ guildId: 'guild-1' }] });
    mockDeleteUserData.mockResolvedValue(
      makeDeleteResult({
        userSettings: true,
        globalBan: true,
        commandUsage: 3,
      }),
    );

    const pending = removeCommand.execute(message, [TARGET_ID], client, '!');
    await flushPromises();

    const confirmationMessage = message._sentMessages[0];
    client.emitReaction(
      { messageId: confirmationMessage.id, channelId: confirmationMessage.channelId, emoji: { name: '✅' } },
      { id: OWNER_ID, bot: false },
    );

    await pending;

    expect(mockCollectUserData).toHaveBeenCalledWith(TARGET_ID);
    expect(dmSend).toHaveBeenCalledTimes(1);
    const payload = dmSend.mock.calls[0][0];
    expect(payload.files[0].name).toBe(`fluxy-data-${TARGET_ID}.json`);
    expect(JSON.parse(payload.files[0].data.toString('utf-8')).userId).toBe(TARGET_ID);
    expect(mockDeleteUserData).toHaveBeenCalledWith(TARGET_ID, { removeGlobalBan: true });
    expect(message.reply).toHaveBeenLastCalledWith(expect.stringContaining('Data removal complete'));
    expect(message.reply).toHaveBeenLastCalledWith(expect.stringContaining('Global ban entry deleted'));
  });

  test('does not delete anything when the target export DM cannot be sent', async () => {
    const message = makeMessage();
    const client = makeClient({ dmChannel: null });

    const pending = removeCommand.execute(message, [TARGET_ID], client, '!');
    await flushPromises();

    const confirmationMessage = message._sentMessages[0];
    client.emitReaction(
      { messageId: confirmationMessage.id, channelId: confirmationMessage.channelId, emoji: { name: '✅' } },
      { id: OWNER_ID, bot: false },
    );

    await pending;

    expect(mockCollectUserData).toHaveBeenCalledWith(TARGET_ID);
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenLastCalledWith(
      `I could not DM \`${TARGET_ID}\` their data export, so I did not remove anything.`,
    );
  });
});
