jest.mock('@erinjs/core', () => ({
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
      setFooter: jest.fn(function (this: any, value: any) {
        this.data.footer = value;
        return this;
      }),
      setTimestamp: jest.fn(function (this: any, value: Date) {
        this.data.timestamp = value;
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
  prefix: '!',
  ownerId: 'owner-1',
}));

jest.mock('../../src/utils/isNetworkError', () => jest.fn(() => false));

jest.mock('../../src/utils/settingsCache', () => ({
  get: jest.fn().mockResolvedValue({
    disabledCommands: [],
    prefixes: ['!'],
    language: 'en',
  }),
}));

jest.mock('../../src/utils/permissions', () => ({
  hasAnyPermission: jest.fn(() => true),
}));

jest.mock('../../src/i18n', () => ({
  normalizeLocale: jest.fn(() => 'en'),
  t: jest.fn((lang: string, key: string, vars?: Record<string, unknown>) => {
    if (key === 'commands.help.menuTitle') return 'Fluxy - Help Menu';
    if (key === 'commands.help.menuDescription') return `Prefix: ${vars?.prefix ?? '!'}`;
    if (key === 'commands.help.menuFooter') return `${vars?.prefix ?? '!'}help <command> for details`;
    if (key === 'commands.help.commandListHeader') return `Header ${vars?.prefix ?? '!'}`;
    if (key === 'commands.help.errors.commandNotFound') {
      return `No command called \`${String(vars?.commandName ?? '')}\` found. Use ${String(vars?.prefix ?? '!')}help to see all commands.`;
    }
    if (key === 'commands.help.errors.generic') return 'generic error';
    if (key === 'commands.help.handlerMissing') return 'handler missing';
    return key;
  }),
}));

jest.mock('../../src/utils/reactionPaginator', () => ({
  registerReactionPaginator: jest.fn().mockResolvedValue(undefined),
}));

import helpCommand from '../../src/commands/general/help';
import { registerReactionPaginator } from '../../src/utils/reactionPaginator';

const help = helpCommand as any;
const registerPaginatorMock = registerReactionPaginator as jest.Mock;

function buildCommand(name: string, category: string): any {
  return {
    name,
    category,
    description: `${name} description`,
    usage: '',
    cooldown: 5,
    ownerOnly: false,
    allowDM: true,
  };
}

function makeCommandHandler(commandsByCategory: Record<string, any[]>): any {
  const byName = new Map<string, any>();
  for (const list of Object.values(commandsByCategory)) {
    for (const cmd of list) {
      byName.set(cmd.name, cmd);
      if (Array.isArray(cmd.aliases)) {
        for (const alias of cmd.aliases) byName.set(alias, cmd);
      }
    }
  }

  return {
    getCommand: jest.fn((name: string) => byName.get(name)),
    getCommandsByCategory: jest.fn(() => commandsByCategory),
    getMember: jest.fn().mockResolvedValue({
      permissions: { has: () => true },
      roles: { roleIds: [] },
    }),
  };
}

function makeMessage(authorId = 'user-1') {
  const sentMessages: any[] = [];
  const msg: any = {
    author: { id: authorId },
    guildId: 'guild-1',
    guild: { id: 'guild-1', ownerId: 'owner-1' },
    channelId: 'channel-1',
    reply: jest.fn(async (payload: any) => {
      const sent = {
        id: `m-${sentMessages.length + 1}`,
        channelId: 'channel-1',
        payload,
      };
      sentMessages.push(sent);
      return sent;
    }),
    _sentMessages: sentMessages,
  };
  return msg;
}

describe('help command pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows command detail for help <command>', async () => {
    const commandHandler = makeCommandHandler({
      general: [{
        ...buildCommand('help', 'general'),
        description: [
          'Show every command. Extra details that should not stay in the embed.',
          '',
          'Long-form help text.',
        ],
      }],
    });

    const client: any = { commandHandler };
    const message = makeMessage();

    await help.execute(message, ['help'], client);

    expect(message.reply).toHaveBeenCalledTimes(1);
    const payload = message.reply.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].data.title).toBe('help');
    expect(payload.embeds[0].data.description).toBe('Show every command.');
    expect(payload.embeds[0].data.footer).toBeUndefined();
    expect(payload.embeds[0].data.fields.some((field: any) => field.name === 'Category')).toBe(false);
    expect(registerPaginatorMock).not.toHaveBeenCalled();
  });

  test('shows category pages and registers paginator for help', async () => {
    const commandHandler = makeCommandHandler({
      moderation: [buildCommand('ban', 'moderation')],
      info: [buildCommand('server', 'info')],
      general: [buildCommand('help', 'general')],
    });

    const client: any = { commandHandler };
    const message = makeMessage();

    await help.execute(message, [], client);

    expect(message.reply).toHaveBeenCalledTimes(1);
    const payload = message.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toContain('Moderation');
    expect(payload.embeds[0].data.footer.text).toBe('!help <command> for details • 1/3 ◄►');

    expect(registerPaginatorMock).toHaveBeenCalledTimes(1);
    const opts = registerPaginatorMock.mock.calls[0][1];
    expect(opts.ownerUserId).toBe('user-1');
    expect(opts.initialPageIndex).toBe(0);
    expect(opts.pages).toHaveLength(3);
  });

  test('jumps to category page with help <category>', async () => {
    const commandHandler = makeCommandHandler({
      moderation: [buildCommand('ban', 'moderation')],
      info: [buildCommand('server', 'info')],
      general: [buildCommand('help', 'general')],
    });

    const client: any = { commandHandler };
    const message = makeMessage();

    await help.execute(message, ['info'], client);

    expect(message.reply).toHaveBeenCalledTimes(1);
    const payload = message.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toContain('Info');

    expect(registerPaginatorMock).toHaveBeenCalledTimes(1);
    const opts = registerPaginatorMock.mock.calls[0][1];
    expect(opts.initialPageIndex).toBe(1);
  });

  test('shows not found for unknown command or category', async () => {
    const commandHandler = makeCommandHandler({
      general: [buildCommand('help', 'general')],
    });

    const client: any = { commandHandler };
    const message = makeMessage();

    await help.execute(message, ['does-not-exist'], client);

    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply.mock.calls[0][0]).toContain('No command called');
    expect(registerPaginatorMock).not.toHaveBeenCalled();
  });
});
