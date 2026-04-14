import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { EmbedBuilder } from '@erinjs/core';
import strLen from '../../utils/strlen';
import { t, normalizeLocale } from '../../i18n';

const HEX_RE = /^#[0-9a-f]{6}$/i;

async function save(settings: any, guildId: string): Promise<void> {
  settings.markModified('goodbyeMessage');
  await settings.save();
  settingsCache.invalidate(guildId);
}

function embedReply(message: any, description: string, title?: string): Promise<any> {
  const embed = new EmbedBuilder().setDescription(description).setColor(0x5865f2);
  if (title) embed.setTitle(title);
  return message.reply({ embeds: [embed] });
}

const subcommands: Record<
  string,
  (message: any, args: string[], guild: any, settings: any, client: any, prefix: string) => Promise<any>
> = {
  async status(message, _args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const gm = settings.goodbyeMessage || {};
    const emb = gm.embed || {};

    const ch = gm.channelId ? `<#${gm.channelId}>` : 'Not set';
    const enabled = gm.enabled ? 'Yes' : 'No';
    const msg = gm.message || 'Default';

    const statusEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'auditCatalog.commands.admin.goodbye.l36_setTitle'))
      .setColor(0x5865f2)
      .setDescription(`Enabled: **${enabled}** | Channel: ${ch}\n` + `Text: ${msg}`)
      .addFields({
        name: t(lang, 'auditCatalog.commands.admin.goodbye.l44_addFields_name'),
        value:
          `${emb.enabled ? 'Enabled' : 'Disabled'}${emb.title ? ` | Title: ${emb.title}` : ''}` +
          (emb.description ? `\nDescription: ${emb.description}` : '') +
          (emb.color ? `\nColor: ${emb.color}` : '') +
          (emb.footer ? `\nFooter: ${emb.footer}` : ''),
      })
      .setFooter({ text: t(lang, 'auditCatalog.commands.admin.goodbye.l51_setFooter') });

    return message.reply({ embeds: [statusEmbed] });
  },

  async channel(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0];
    if (!val) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l58_embedReply_description', { prefix }));
    }

    const gm = settings.goodbyeMessage;

    if (val.toLowerCase() === 'clear') {
      gm.channelId = null;
      gm.enabled = false;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l66_embedReply_description'));
    }

    const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(val) ? val : null);
    if (!channelId) return embedReply(message, t(lang, 'verification.errors.invalidChannel'));

    gm.channelId = channelId;
    gm.enabled = true;
    await save(settings, guild.id);
    return embedReply(
      message,
      t(lang, 'auditCatalog.commands.admin.goodbye.l75_embedReply_description', { channelId }),
    );
  },

  async on(message, _args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const gm = settings.goodbyeMessage;
    if (!gm.channelId) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l80_embedReply_description', { prefix }));
    }
    gm.enabled = true;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l83_embedReply_description'));
  },

  async off(message, _args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    settings.goodbyeMessage.enabled = false;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l89_embedReply_description'));
  },

  async message(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args.join(' ').trim();
    if (!val) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l94_embedReply_description', { prefix }));
    }

    const gm = settings.goodbyeMessage;

    if (val.toLowerCase() === 'clear') {
      gm.message = null;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l101_embedReply_description'));
    }

    if (strLen(val) > 500) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l104_embedReply_description'));
    }

    gm.message = val;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l108_embedReply_description', { val }));
  },

  async embed(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const sub = args[0]?.toLowerCase();
    const gm = settings.goodbyeMessage;
    if (!gm.embed) gm.embed = {};
    const emb = gm.embed;

    if (sub === 'on') {
      emb.enabled = true;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l120_embedReply_description'));
    }

    if (sub === 'off') {
      emb.enabled = false;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l126_embedReply_description'));
    }

    if (sub === 'title') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.goodbye.l131_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.title = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l135_embedReply_description'));
      }
      if (strLen(val) > 256) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l137_embedReply_description'));
      }
      emb.title = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l140_embedReply_description', { val }));
    }

    if (sub === 'description') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.goodbye.l145_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.description = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l149_embedReply_description'));
      }
      if (strLen(val) > 2048) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l151_embedReply_description'));
      }
      emb.description = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l154_embedReply_description'));
    }

    if (sub === 'color') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.goodbye.l159_embedReply_description', { prefix }),
        );
      }
      emb.color = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l162_embedReply_description', { hex }));
    }

    if (sub === 'footer') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.goodbye.l167_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.footer = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l171_embedReply_description'));
      }
      if (strLen(val) > 2048) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l173_embedReply_description'));
      }
      emb.footer = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l176_embedReply_description', { val }));
    }

    return embedReply(
      message,
      `\`${prefix}goodbye embed on/off\` - enable or disable the embed\n` +
        `\`${prefix}goodbye embed title <text>\` - set embed title\n` +
        `\`${prefix}goodbye embed description <text>\` - set embed description\n` +
        `\`${prefix}goodbye embed color <#hex>\` - set embed color\n` +
        `\`${prefix}goodbye embed footer <text>\` - set embed footer\n` +
        'Variables: `{user}` `{username}` `{server}` `{count}`',
      t(lang, 'auditCatalog.commands.admin.goodbye.l186_embedReply_title'),
    );
  },

  async test(message, _args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const gm = settings.goodbyeMessage || {};
    if (!gm.enabled && !gm.channelId && !gm.message) {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.goodbye.l193_embedReply_description', { prefix }),
      );
    }

    const user = (message as any).author || (message as any).user;
    const memberCount = guild.members?.size || guild.memberCount || 0;

    const replaceVars = (text: string) =>
      text
        .replace(/\\n/g, '\n')
        .replace(/\{user\}/gi, `<@${user.id}>`)
        .replace(/\{username\}/gi, user.username || 'Unknown')
        .replace(/\{server\}/gi, guild.name)
        .replace(/\{count\}/gi, String(memberCount || 0));

    const sendOpts: any = {};

    if (gm.message) {
      sendOpts.content = replaceVars(gm.message);
    } else {
      sendOpts.content = `**${user.username || 'Someone'}** has left **${guild.name}**.`;
    }

    if (gm.embed?.enabled) {
      const embConf = gm.embed;
      const embed = new EmbedBuilder();
      if (embConf.title) embed.setTitle(replaceVars(embConf.title));
      if (embConf.description) embed.setDescription(replaceVars(embConf.description));
      if (embConf.color) embed.setColor(parseInt(embConf.color.replace('#', ''), 16));
      if (embConf.footer) embed.setFooter({ text: replaceVars(embConf.footer) });

      sendOpts.embeds = [embed];
    }

    const channelNote = gm.channelId
      ? `This is a preview. Real goodbye messages will be sent to <#${gm.channelId}>.`
      : `This is a preview. Set a goodbye channel with \`${prefix}goodbye channel <#channel>\` for messages to send automatically.`;
    await embedReply(message, channelNote);
    await (message as any).channel.send(sendOpts);
  },
};

function showHelp(message: any, prefix = '!', lang = 'en') {
  return embedReply(
    message,
    `\`${prefix}goodbye status\` - show current configuration\n` +
      `\`${prefix}goodbye channel <#channel>\` - set goodbye channel\n` +
      `\`${prefix}goodbye on/off\` - enable or disable\n` +
      `\`${prefix}goodbye message <text>\` - set custom text ({user} {username} {server} {count})\n` +
      `\`${prefix}goodbye embed\` - configure a goodbye embed (title, description, color, footer)\n` +
      `\`${prefix}goodbye test\` - preview the goodbye message`,
    t(lang, 'auditCatalog.commands.admin.goodbye.l242_embedReply_title'),
  );
}

const command: Command = {
  name: 'goodbye',
  description: [
    'Configure goodbye messages for your server. Run `!goodbye` with no arguments for the full guide.',
    '',
    '**Subcommands:**',
    '`status` - show current goodbye configuration',
    '`channel <#channel>` - set the goodbye channel',
    '`on/off` - enable or disable goodbye messages',
    '`message <text>` - set custom goodbye text ({user} {username} {server} {count})',
    '`embed on/off` - toggle a goodbye embed (title, description, color, footer)',
    '`test` - preview the goodbye output',
  ].join('\n'),
  usage: '<subcommand> [options]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void (await embedReply(message, t('en', 'commands.admin.keywords.serverOnly')));

    const settings: any = await GuildSettings.getOrCreate(guild.id);
    const lang = normalizeLocale(settings?.language);
    if (!settings.goodbyeMessage) settings.goodbyeMessage = {};

    const sub = args[0]?.toLowerCase();

    if (!sub || !subcommands[sub]) {
      return showHelp(message, prefix, lang);
    }

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !goodbye (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !goodbye: ${error.message || error}`);
        embedReply(message, t(lang, 'auditCatalog.commands.admin.goodbye.l285_embedReply_description')).catch(() => {});
      }
    }
  },
};

export default command;
