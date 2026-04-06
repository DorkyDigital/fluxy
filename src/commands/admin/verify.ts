import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { generateCaptcha } from '../../utils/captchaCard';
import { EmbedBuilder, PermissionFlags } from '@erinjs/core';
import { t, normalizeLocale } from '../../i18n';

export const verificationSessions = new Map<string, {
  userId: string;
  code: string;
  attempts: number;
  maxAttempts: number;
  panelChannelId: string;
  panelMessageId: string;
  timeout: ReturnType<typeof setTimeout>;
}>();

function embedReply(message: any, description: string, title?: string): Promise<any> {
  const embed = new EmbedBuilder().setDescription(description).setColor(0x5865F2);
  if (title) embed.setTitle(title);
  return message.reply({ embeds: [embed] });
}

async function save(settings: any, guildId: string): Promise<void> {
  settings.markModified('verification');
  await settings.save();
  settingsCache.invalidate(guildId);
}


async function setupVerification(message: any, args: string[], guild: any, settings: any, client: any, _prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;
  const botId = client.user?.id;
  const everyoneRoleId = guild.id;

  let verifiedRoleId = verification.verifiedRoleId;
  if (!verifiedRoleId) {
    try {
      const role = await guild.createRole({
        name: 'Verified',
        color: 0x2ecc71,
        mentionable: false,
      });
      verifiedRoleId = role.id;
      verification.verifiedRoleId = verifiedRoleId;
    } catch (err: any) {
      return embedReply(message, t(lang, 'verification.errors.createVerifiedRoleFailed', { error: err.message }));
    }
  }

  let categoryId = verification.categoryId;
  if (!categoryId) {
    try {
      const category = await guild.createChannel({
        type: 4,
        name: 'Verification',
        permission_overwrites: [
          { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
          ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageChannels | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: '0' }] : []),
        ],
      });
      categoryId = category.id;
      verification.categoryId = categoryId;
    } catch (err: any) {
      return embedReply(message, t(lang, 'verification.errors.createCategoryFailed', { error: err.message }));
    }
  }

  let panelChannelId = verification.panelChannelId;
  if (!panelChannelId) {
    try {
      const panelChannel = await guild.createChannel({
        type: 0,
        name: 'verify-here',
        parent_id: categoryId,
        topic: 'React with ✅ to begin the verification process.',
        permission_overwrites: [
          { id: everyoneRoleId, type: 0, allow: String(PermissionFlags.ViewChannel | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: String(PermissionFlags.SendMessages) },
          ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions), deny: '0' }] : []),
          { id: verifiedRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
        ],
      });
      panelChannelId = panelChannel.id;
      verification.panelChannelId = panelChannelId;
    } catch (err: any) {
      return embedReply(message, t(lang, 'verification.errors.createPanelChannelFailed', { error: err.message }));
    }
  }

  try {
    const panelEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.panel.title'))
      .setDescription(t(lang, 'verification.panel.description'))
      .setColor(0x5865F2)
      .setFooter({ text: t(lang, 'verification.panel.footer') })

    const channel = guild.channels?.get?.(panelChannelId) || await client.channels.fetch(panelChannelId);
    const panelMessage = await channel.send({ embeds: [panelEmbed] });
    await panelMessage.react('✅');

    verification.panelMessageId = panelMessage.id;
  } catch (err: any) {
    return embedReply(message, t(lang, 'verification.errors.postPanelFailed', { error: err.message }));
  }

  verification.enabled = true;
  await save(settings, guild.id);

  const statusEmbed = new EmbedBuilder()
    .setTitle(t(lang, 'verification.setupComplete.title'))
    .setDescription(t(lang, 'verification.setupComplete.description', { panelChannelId, verifiedRoleId }))
    .setColor(0x2ecc71)

  return message.reply({ embeds: [statusEmbed] });
}

async function postPanel(message: any, args: string[], guild: any, settings: any, client: any, prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;

  const channelArg = args[0];
  let channelId = verification.panelChannelId;

  if (channelArg) {
    const parsed = channelArg.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(channelArg) ? channelArg : null);
    if (parsed) channelId = parsed;
  }

  if (!channelId) {
    return embedReply(message, t(lang, 'verification.errors.missingPanelChannel', { prefix }));
  }

  try {
    const panelEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.panel.title'))
      .setDescription(t(lang, 'verification.panel.description'))
      .setColor(0x5865F2)
      .setFooter({ text: t(lang, 'verification.panel.footer') })

    const channel = guild.channels?.get?.(channelId) || await client.channels.fetch(channelId);
    const panelMsg = await channel.send({ embeds: [panelEmbed] });
    await panelMsg.react('✅');

    verification.panelChannelId = channelId;
    verification.panelMessageId = panelMsg.id;
    await save(settings, guild.id);

    return embedReply(message, t(lang, 'verification.panelPosted', { channelId }));
  } catch (err: any) {
    return embedReply(message, t(lang, 'verification.errors.postPanelGenericFailed', { error: err.message }));
  }
}

async function setRole(message: any, args: string[], guild: any, settings: any, _client: any, prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const roleArg = args[0];
  if (!roleArg) return embedReply(message, t(lang, 'verification.errors.usageRole', { prefix }));

  const roleId = roleArg.match(/^<@&(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(roleArg) ? roleArg : null);
  if (!roleId) return embedReply(message, t(lang, 'verification.errors.invalidRole'));

  settings.verification.verifiedRoleId = roleId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.roleSetDone', { roleId }));
}

async function setCategory(message: any, args: string[], guild: any, settings: any, _client: any, prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const catArg = args[0];
  if (!catArg) return embedReply(message, t(lang, 'verification.errors.usageCategory', { prefix }));

  const catId = /^\d{17,19}$/.test(catArg) ? catArg : null;
  if (!catId) return embedReply(message, t(lang, 'verification.errors.invalidCategory'));

  settings.verification.categoryId = catId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.categorySetDone', { categoryId: catId }));
}

async function setLog(message: any, args: string[], guild: any, settings: any, _client: any, prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const channelArg = args[0];
  if (!channelArg) return embedReply(message, t(lang, 'verification.errors.usageLog', { prefix }));

  if (channelArg.toLowerCase() === 'clear') {
    settings.verification.logChannelId = null;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'verification.log.cleared'));
  }

  const channelId = channelArg.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(channelArg) ? channelArg : null);
  if (!channelId) return embedReply(message, t(lang, 'verification.errors.invalidChannel'));

  settings.verification.logChannelId = channelId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.log.setDone', { channelId }));
}

async function showStatus(message: any, args: string[], guild: any, settings: any, _client: any, _prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const v = settings.verification;

  const statusEmbed = new EmbedBuilder()
    .setTitle(t(lang, 'verification.status.title'))
    .setColor(0x5865F2)
    .setDescription(
      `**Enabled:** ${v.enabled ? t(lang, 'verification.status.enabledYes') : t(lang, 'verification.status.enabledNo')}\n` +
      `**Verified Role:** ${v.verifiedRoleId ? `<@&${v.verifiedRoleId}>` : t(lang, 'verification.status.notSet')}\n` +
      `**Category:** ${v.categoryId || t(lang, 'verification.status.notSet')}\n` +
      `**Panel Channel:** ${v.panelChannelId ? `<#${v.panelChannelId}>` : t(lang, 'verification.status.notSet')}\n` +
      `**Log Channel:** ${v.logChannelId ? `<#${v.logChannelId}>` : t(lang, 'verification.status.notSet')}\n` +
      `**${t(lang, 'verification.status.maxAttemptsLabel')}:** ${v.maxAttempts || 2}`
    )

  return message.reply({ embeds: [statusEmbed] });
}

async function resetVerification(message: any, args: string[], guild: any, settings: any, _client: any, _prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  settings.verification = {
    enabled: false,
    categoryId: null,
    verifiedRoleId: null,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    maxAttempts: 2,
  };
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.resetDone'));
}

async function testVerification(message: any, args: string[], guild: any, settings: any, client: any, prefix: string): Promise<any> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;

  if (!verification.categoryId) {
    return embedReply(message, t(lang, 'verification.errors.usageTestFirst', { prefix }));
  }

  const userId = message.author.id;
  const botId = client.user?.id;
  const everyoneRoleId = guild.id;

  let channel: any;
  try {
    const username = (message as any).member?.displayName || (message.author as any).username || 'user';
    const safeName = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';

    channel = await guild.createChannel({
      type: 0,
      name: `verify-${safeName}`,
      parent_id: verification.categoryId,
      permission_overwrites: [
        { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
        { id: userId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ReadMessageHistory), deny: '0' },
        ...(botId ? [{ id: botId, type: 1, allow: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ManageChannels | PermissionFlags.ManageMessages | PermissionFlags.EmbedLinks | PermissionFlags.AttachFiles | PermissionFlags.ReadMessageHistory), deny: '0' }] : []),
      ],
    });
  } catch (err: any) {
    return embedReply(message, t(lang, 'verification.errors.createTestVerificationChannelFailed', { error: err.message }));
  }

  try {
    const { code, image } = await generateCaptcha();
    const maxAttempts = verification.maxAttempts || 2;

    const captchaEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.captcha.title'))
      .setDescription(t(lang, 'verification.captcha.description', { userId, maxAttempts }))
      .setColor(0x5865F2)

    await channel.send({
      embeds: [captchaEmbed],
      files: [{ name: 'captcha.png', data: image }],
    });

    const timeout = setTimeout(async () => {
      verificationSessions.delete(channel.id);
      try {
        await channel.delete();
      } catch { }
    }, 60_000);

    verificationSessions.set(channel.id, {
      userId,
      code,
      attempts: 0,
      maxAttempts,
      panelChannelId: verification.panelChannelId || '',
      panelMessageId: verification.panelMessageId || '',
      timeout,
    });

    return embedReply(message, t(lang, 'verification.testChannelCreated', { channelId: channel.id }));
  } catch (err: any) {
    try { await channel.delete(); } catch { }
    return embedReply(message, t(lang, 'verification.errors.generateCaptchaFailed', { error: err.message }));
  }
}


function showHelp(message: any, prefix: string, lang: string): Promise<any> {
  return embedReply(message, t(lang, 'verification.help.body', { prefix }), t(lang, 'verification.help.title'));
}


const subcommands: Record<string, (message: any, args: string[], guild: any, settings: any, client: any, prefix: string) => Promise<any>> = {
  setup: setupVerification,
  panel: postPanel,
  role: setRole,
  category: setCategory,
  log: setLog,
  status: showStatus,
  reset: resetVerification,
  test: testVerification,
};


const command: Command = {
  name: 'verify',
  description: [
    'Set up manual captcha verification for your server.',
    '',
    '**Subcommands:**',
    '`setup` - auto-create category, channel, role, and panel',
    '`panel [#channel]` - (re-)post the verification panel embed',
    '`role <@role>` - set the verified role',
    '`category <id>` - set the verification category',
    '`log <#channel>` - set a verification log channel',
    '`status` - show current verification config',
    '`reset` - disable and clear settings',
    '`test` - test verification with a temp channel',
  ].join('\n'),
  usage: '<subcommand> [options]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 5,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await embedReply(message, t('en', 'verification.errors.serverOnly'));

    const sub = args[0]?.toLowerCase();

    let settings: any = null;
    let lang = 'en';

    try {
      settings = await GuildSettings.getOrCreate(guild.id);
      if (!settings.verification) settings.verification = {};
      lang = normalizeLocale(settings.language);
    } catch {}

    if (!sub || !subcommands[sub]) return showHelp(message, prefix, lang);

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !verify (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !verify: ${error.message || error}`);
        embedReply(message, t(lang, 'verification.errors.updateFailed')).catch(() => { });
      }
    }
  },
};

export default command;
