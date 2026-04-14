import type { Command } from '../../types';
import GuildSettings from '../../models/GuildSettings';
import settingsCache from '../../utils/settingsCache';
import isNetworkError from '../../utils/isNetworkError';
import { generateWelcomeCard, PRESETS } from '../../utils/welcomeCard';
import * as bgImageCache from '../../utils/bgImageCache';
import * as memberCounter from '../../utils/memberCounter';
import { EmbedBuilder } from '@erinjs/core';
import { t, normalizeLocale } from '../../i18n';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function strLen(str: string): number {
  return [...str].length;
}

async function save(settings: any, guildId: string): Promise<void> {
  settings.markModified('welcomeMessage');
  await settings.save();
  settingsCache.invalidate(guildId);
}

function replaceVars(
  text: string,
  userId: string,
  guildName: string,
  count: number,
  roleName: string | null,
  username?: string,
): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\{user\}/gi, `<@${userId}>`)
    .replace(/\{username\}/gi, username || 'Unknown')
    .replace(/\{server\}/gi, guildName)
    .replace(/\{count\}/gi, String(count || 0))
    .replace(/\{role\}/gi, roleName || 'None');
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
  async status(message, args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const wm = settings.welcomeMessage;
    const card = wm.card || {};
    const emb = wm.embed || {};
    const dm = wm.dm || {};

    const ch = wm.channelId ? `<#${wm.channelId}>` : 'Not set';
    const enabled = wm.enabled ? 'Yes' : 'No';
    const image = wm.imageEnabled !== false ? 'Yes' : 'No';
    const msg = wm.message || 'Default';

    const trigger = wm.trigger === 'role' ? 'Role assigned' : 'Member join';

    const statusEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'auditCatalog.commands.admin.welcome.l54_setTitle'))
      .setColor(0x5865f2)
      .setDescription(
        `Enabled: **${enabled}** | Channel: ${ch}\n` +
          `Trigger: **${trigger}** | Image card: **${image}** | Show role: **${wm.showRole ? 'Yes' : 'No'}**\n` +
          `Text: ${msg}`,
      )
      .addFields(
        {
          name: t(lang, 'auditCatalog.commands.admin.welcome.l63_addFields_name'),
          value:
            `Preset: **${card.preset || 'default'}**\n` +
            `Accent: ${card.accentColor || 'default'} | Text: ${card.textColor || 'default'}\n` +
            `Greeting: "${card.greetingText || 'WELCOME'}"\n` +
            `Background image: ${card.bgImageURL ? 'Set' : 'None'}`,
        },
        {
          name: t(lang, 'auditCatalog.commands.admin.welcome.l71_addFields_name'),
          value: `${emb.enabled ? 'Enabled' : 'Disabled'}${emb.title ? ` | Title: ${emb.title}` : ''}`,
          inline: true,
        },
        {
          name: t(lang, 'auditCatalog.commands.admin.welcome.l76_addFields_name'),
          value: t(lang, 'auditCatalog.commands.admin.welcome.l77_addFields_value', {
            'dm.enabled': dm.enabled ?? false,
            'dm.imageEnabled': dm.imageEnabled ?? false,
          }),
          inline: true,
        },
      )
      .setFooter({ text: t(lang, 'auditCatalog.commands.admin.welcome.l81_setFooter') });

    return message.reply({ embeds: [statusEmbed] });
  },

  async channel(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0];
    if (!val) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l88_embedReply_description', { prefix }));
    }

    const wm = settings.welcomeMessage;

    if (val.toLowerCase() === 'clear') {
      wm.channelId = null;
      wm.enabled = false;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l96_embedReply_description'));
    }

    const channelId = val.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(val) ? val : null);
    if (!channelId) return embedReply(message, t(lang, 'verification.errors.invalidChannel'));

    wm.channelId = channelId;
    wm.enabled = true;
    await save(settings, guild.id);
    return embedReply(
      message,
      t(lang, 'auditCatalog.commands.admin.welcome.l105_embedReply_description', { channelId }),
    );
  },

  async on(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const wm = settings.welcomeMessage;
    if (!wm.channelId) {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l110_embedReply_description', { prefix }),
      );
    }
    wm.enabled = true;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l113_embedReply_description'));
  },

  async off(message, args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    settings.welcomeMessage.enabled = false;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l119_embedReply_description'));
  },

  async image(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (val !== 'on' && val !== 'off') {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l124_embedReply_description', { prefix }),
      );
    }
    settings.welcomeMessage.imageEnabled = val === 'on';
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l127_embedReply_description', { val }));
  },

  async message(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args.join(' ').trim();
    if (!val) {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l132_embedReply_description', { prefix }),
      );
    }

    const wm = settings.welcomeMessage;

    if (val.toLowerCase() === 'clear') {
      wm.message = null;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l139_embedReply_description'));
    }

    if (strLen(val) > 500) {
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l142_embedReply_description'));
    }

    wm.message = val;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l146_embedReply_description', { val }));
  },

  async card(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const sub = args[0]?.toLowerCase();
    const wm = settings.welcomeMessage;
    if (!wm.card) wm.card = {};
    const card = wm.card;

    if (sub === 'preset') {
      const name = args[1]?.toLowerCase();
      if (!name) {
        const names = Object.keys(PRESETS).filter((n: string) => n !== 'default');
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l159_embedReply_description', {
            availablePresets: names.map((n: string) => `\`${n}\``).join(', '),
          }),
        );
      }
      if (name === 'clear') {
        card.preset = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l164_embedReply_description'));
      }
      if (!(PRESETS as any)[name]) {
        const names = Object.keys(PRESETS).filter((n: string) => n !== 'default');
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l168_embedReply_description', {
            availablePresets: names.map((n: string) => `\`${n}\``).join(', '),
          }),
        );
      }
      card.preset = name;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l172_embedReply_description', { name }));
    }

    if (sub === 'color') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l177_embedReply_description', { prefix }),
        );
      }
      card.accentColor = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l180_embedReply_description', { hex }));
    }

    if (sub === 'bgcolor') {
      const colors = args.slice(1).filter((a: string) => HEX_RE.test(a));
      if (colors.length === 0) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l185_embedReply_description', { prefix }),
        );
      }
      card.bgColor1 = colors[0];
      card.bgColor2 = colors[1] || colors[0];
      card.bgColor3 = colors[2] || colors[1] || colors[0];
      await save(settings, guild.id);
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l190_embedReply_description', {
          colors: colors.join(' → '),
        }),
      );
    }

    if (sub === 'textcolor') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l195_embedReply_description', { prefix }),
        );
      }
      card.textColor = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l198_embedReply_description', { hex }));
    }

    if (sub === 'greeting') {
      const text = args.slice(1).join(' ').trim();
      if (!text) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l203_embedReply_description', { prefix }),
        );
      }
      if (text.toLowerCase() === 'clear') {
        card.greetingText = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l207_embedReply_description'));
      }
      if (strLen(text) > 30) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l209_embedReply_description'));
      }
      card.greetingText = text;
      await save(settings, guild.id);
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l212_embedReply_description', {
          text: text.toUpperCase(),
        }),
      );
    }

    if (sub === 'subtitle') {
      const text = args.slice(1).join(' ').trim();
      if (!text) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l217_embedReply_description', { prefix }),
        );
      }
      if (text.toLowerCase() === 'clear') {
        card.subtitle = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l221_embedReply_description'));
      }
      if (strLen(text) > 50) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l223_embedReply_description'));
      }
      card.subtitle = text;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l226_embedReply_description', { text }));
    }

    if (sub === 'membercount') {
      const val = args[1]?.toLowerCase();
      if (val !== 'on' && val !== 'off') {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l231_embedReply_description', { prefix }),
        );
      }
      card.showMemberCount = val === 'on';
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l234_embedReply_description', { val }));
    }

    if (sub === 'countcolor') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l239_embedReply_description', { prefix }),
        );
      }
      card.countColor = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l242_embedReply_description', { hex }));
    }

    if (sub === 'subtextcolor') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l247_embedReply_description', { prefix }),
        );
      }
      card.subtextColor = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l250_embedReply_description', { hex }));
    }

    if (sub === 'background') {
      const url = args[1];
      if (!url) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l255_embedReply_description', { prefix }),
        );
      }
      if (url.toLowerCase() === 'clear') {
        if (card.bgImageURL) bgImageCache.remove(card.bgImageURL);
        card.bgImageURL = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l260_embedReply_description'));
      }
      if (!/^https?:\/\/.+/i.test(url)) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l262_embedReply_description'));
      }
      try {
        await bgImageCache.download(url);
      } catch (err: any) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l266_embedReply_description', { 'err.message': err.message }),
        );
      }
      card.bgImageURL = url;
      await save(settings, guild.id);
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l270_embedReply_description', { prefix }),
      );
    }

    if (sub === 'reset') {
      if (card.bgImageURL) bgImageCache.remove(card.bgImageURL);
      settings.welcomeMessage.card = {};
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l277_embedReply_description'));
    }

    return embedReply(
      message,
      `\`${prefix}welcome card preset <name>\` - apply a theme (dark, light, ocean, sunset, midnight, forest)\n` +
        `\`${prefix}welcome card color <hex>\` - set accent color\n` +
        `\`${prefix}welcome card bgcolor <hex> [hex] [hex]\` - set gradient colors\n` +
        `\`${prefix}welcome card textcolor <hex>\` - set username text color\n` +
        `\`${prefix}welcome card subtextcolor <hex>\` - set subtitle text color\n` +
        `\`${prefix}welcome card countcolor <hex>\` - set member count text color\n` +
        `\`${prefix}welcome card greeting <text>\` - replace "WELCOME" text on card (emoji supported 🎉)\n` +
        `\`${prefix}welcome card subtitle <text>\` - set subtitle text (max 50 chars)\n` +
        `\`${prefix}welcome card membercount on/off\` - toggle member count on card\n` +
        `\`${prefix}welcome card background <url>\` - set a custom background image\n` +
        `\`${prefix}welcome card reset\` - reset all card settings to defaults`,
      t(lang, 'auditCatalog.commands.admin.welcome.l292_embedReply_title'),
    );
  },

  async dm(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const sub = args[0]?.toLowerCase();
    const wm = settings.welcomeMessage;
    if (!wm.dm) wm.dm = {};

    if (sub === 'on' || sub === 'off') {
      wm.dm.enabled = sub === 'on';
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l304_embedReply_description', { sub }));
    }

    if (sub === 'message') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l309_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        wm.dm.message = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l313_embedReply_description'));
      }
      if (strLen(val) > 500) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l315_embedReply_description'));
      }
      wm.dm.message = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l318_embedReply_description', { val }));
    }

    if (sub === 'image') {
      const val = args[1]?.toLowerCase();
      if (val !== 'on' && val !== 'off') {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l323_embedReply_description', { prefix }),
        );
      }
      wm.dm.imageEnabled = val === 'on';
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l326_embedReply_description', { val }));
    }

    return embedReply(
      message,
      `\`${prefix}welcome dm on/off\` - enable or disable DM welcomes\n` +
        `\`${prefix}welcome dm message <text>\` - set DM text ({user} {server} {count} {role})\n` +
        `\`${prefix}welcome dm image on/off\` - include card image in DM`,
      t(lang, 'auditCatalog.commands.admin.welcome.l333_embedReply_title'),
    );
  },

  async embed(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const sub = args[0]?.toLowerCase();
    const wm = settings.welcomeMessage;
    if (!wm.embed) wm.embed = {};
    const emb = wm.embed;

    if (sub === 'on' || sub === 'off') {
      emb.enabled = sub === 'on';
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l346_embedReply_description', { sub }));
    }

    if (sub === 'title') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l351_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.title = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l355_embedReply_description'));
      }
      if (strLen(val) > 256) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l357_embedReply_description'));
      }
      emb.title = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l360_embedReply_description', { val }));
    }

    if (sub === 'description') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l365_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.description = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l369_embedReply_description'));
      }
      if (strLen(val) > 2048) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l371_embedReply_description'));
      }
      emb.description = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l374_embedReply_description'));
    }

    if (sub === 'color') {
      const hex = args[1];
      if (!hex || !HEX_RE.test(hex)) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l379_embedReply_description', { prefix }),
        );
      }
      emb.color = hex;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l382_embedReply_description', { hex }));
    }

    if (sub === 'footer') {
      const val = args.slice(1).join(' ').trim();
      if (!val) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l387_embedReply_description', { prefix }),
        );
      }
      if (val.toLowerCase() === 'clear') {
        emb.footer = null;
        await save(settings, guild.id);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l391_embedReply_description'));
      }
      if (strLen(val) > 256) {
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l393_embedReply_description'));
      }
      emb.footer = val;
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l396_embedReply_description', { val }));
    }

    if (sub === 'thumbnail') {
      const val = args[1]?.toLowerCase();
      if (val !== 'on' && val !== 'off') {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l401_embedReply_description', { prefix }),
        );
      }
      emb.thumbnail = val === 'on';
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l404_embedReply_description', { val }));
    }

    if (sub === 'clear') {
      settings.welcomeMessage.embed = { enabled: false };
      await save(settings, guild.id);
      return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l410_embedReply_description'));
    }

    return embedReply(
      message,
      `\`${prefix}welcome embed on/off\` - toggle embed\n` +
        `\`${prefix}welcome embed title <text>\` - set title ({user} {server} {count} {role})\n` +
        `\`${prefix}welcome embed description <text>\` - set description\n` +
        `\`${prefix}welcome embed color <hex>\` - set color\n` +
        `\`${prefix}welcome embed footer <text>\` - set footer\n` +
        `\`${prefix}welcome embed thumbnail on/off\` - show server icon\n` +
        `\`${prefix}welcome embed clear\` - reset embed settings`,
      t(lang, 'auditCatalog.commands.admin.welcome.l421_embedReply_title'),
    );
  },

  async role(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    if (val !== 'on' && val !== 'off') {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l428_embedReply_description', { prefix }),
      );
    }
    settings.welcomeMessage.showRole = val === 'on';
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l432_embedReply_description', { val }));
  },

  async trigger(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const val = args[0]?.toLowerCase();
    const wm = settings.welcomeMessage;

    if (!val) {
      let current = 'Member join';
      if (wm.trigger === 'role') {
        const rid = wm.triggerRoleId || settings.autoroleId;
        const rName = rid ? (guild.roles?.get?.(rid)?.name ?? rid) : 'none';
        current = `Role assigned (${rName})`;
      }
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l446_embedReply_description', { current, prefix }),
      );
    }

    if (val !== 'join' && val !== 'role') {
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l450_embedReply_description', { prefix }),
      );
    }

    if (val === 'role') {
      const roleArg = args[1];
      let roleId: string | null = null;

      if (roleArg) {
        const roleMention = roleArg.match(/^<@&(\d{17,19})>$/);
        if (roleMention) {
          roleId = roleMention[1];
        } else if (/^\d{17,19}$/.test(roleArg)) {
          roleId = roleArg;
        }
        if (roleId) {
          const role = guild.roles?.get?.(roleId);
          if (!role) {
            try {
              await guild.fetchRole(roleId);
            } catch {
              return embedReply(message, t(lang, 'commands.inrole.roleNotFound'));
            }
          }
        }
      }

      if (!roleId && !settings.autoroleId) {
        return embedReply(
          message,
          t(lang, 'auditCatalog.commands.admin.welcome.l475_embedReply_description', { prefix }),
        );
      }

      wm.trigger = 'role';
      wm.triggerRoleId = roleId;
      await save(settings, guild.id);

      const effectiveId = roleId || settings.autoroleId;
      const roleName = effectiveId ? (guild.roles?.get?.(effectiveId)?.name ?? effectiveId) : 'unknown';
      return embedReply(
        message,
        t(lang, 'auditCatalog.commands.admin.welcome.l484_embedReply_description', {
          'roleId ? `<@&${roleId}>` : `autorole: **${roleName}**`': roleId
            ? `<@&${roleId}>`
            : `autorole: **${roleName}**`,
        }),
      );
    }

    wm.trigger = val;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l489_embedReply_description'));
  },

  async goodbye(message, args, guild, settings, client, _prefix) {
    const goodbyeCommand = (await import('./goodbye')).default;
    return goodbyeCommand.execute(message, args, client);
  },

  async test(message, args, guild, settings, client, prefix) {
    const lang = normalizeLocale(settings?.language);
    const wm = settings.welcomeMessage;
    const user = message.author;
    const count = memberCounter.get(guild.id) ?? 0;
    const avatarURL =
      (user as any).displayAvatarURL?.({ size: 256, format: 'png' }) ??
      (user as any).avatarURL ??
      '/assets/default-avatar.png';

    let roleName: string | null = null;
    if (wm.showRole) {
      const rid = wm.triggerRoleId || settings.autoroleId;
      if (rid) {
        const role = guild.roles?.get?.(rid);
        roleName = role?.name || null;
      }
    }

    const sendOpts: any = {};

    if (wm.imageEnabled !== false) {
      try {
        const buffer = await generateWelcomeCard({
          username:
            (message as any).member?.displayName || (user as any).globalName || (user as any).username || 'New Member',
          avatarURL,
          serverName: guild.name,
          memberCount: typeof count === 'number' ? count : 0,
          card: wm.card || {},
          roleName,
        });
        sendOpts.files = [{ name: 'welcome.png', data: buffer }];
      } catch (err: any) {
        console.error(`[welcome] Card generation failed: ${err.message}`);
        return embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l529_embedReply_description'));
      }
    }

    if (wm.message) {
      sendOpts.content = replaceVars(wm.message, user.id, guild.name, count, roleName);
    } else {
      sendOpts.content = `Welcome to **${guild.name}**, <@${user.id}>!`;
    }

    if (wm.embed?.enabled) {
      const embConf = wm.embed;
      const embed = new EmbedBuilder();
      if (embConf.title) embed.setTitle(replaceVars(embConf.title, user.id, guild.name, count, roleName));
      if (embConf.description)
        embed.setDescription(replaceVars(embConf.description, user.id, guild.name, count, roleName));
      if (embConf.color) embed.setColor(parseInt(embConf.color.replace('#', ''), 16));
      if (embConf.footer) embed.setFooter({ text: replaceVars(embConf.footer, user.id, guild.name, count, roleName) });
      if (embConf.thumbnail) {
        const iconURL = guild.iconURL?.({ size: 256 }) || null;
        if (iconURL) embed.setThumbnail(iconURL);
      }

      sendOpts.embeds = [embed];
    }

    const channelNote = wm.channelId
      ? `This is a preview. Real welcome messages will be sent to <#${wm.channelId}>.`
      : `This is a preview. Set a welcome channel with \`${prefix}welcome channel <#channel>\` for messages to send automatically.`;
    await embedReply(message, channelNote);
    await (message as any).channel.send(sendOpts);
  },

  async testdm(message, args, guild, settings, _client, _prefix) {
    const lang = normalizeLocale(settings?.language);
    const wm = settings.welcomeMessage;
    const dm = wm.dm || {};
    const user = message.author;
    const count = memberCounter.get(guild.id) ?? 0;
    const avatarURL =
      (user as any).displayAvatarURL?.({ size: 256, format: 'png' }) ??
      (user as any).avatarURL ??
      '/assets/default-avatar.png';

    let roleName: string | null = null;
    if (wm.showRole && settings.autoroleId) {
      const role = guild.roles?.get?.(settings.autoroleId);
      roleName = role?.name || null;
    }

    const dmOpts: any = {};

    if (dm.message) {
      dmOpts.content = replaceVars(dm.message, user.id, guild.name, count, roleName);
    } else if (wm.message) {
      dmOpts.content = replaceVars(wm.message, user.id, guild.name, count, roleName);
    } else {
      dmOpts.content = `Welcome to **${guild.name}**!`;
    }

    if (dm.imageEnabled !== false && wm.imageEnabled !== false) {
      try {
        const buffer = await generateWelcomeCard({
          username:
            (message as any).member?.displayName || (user as any).globalName || (user as any).username || 'New Member',
          avatarURL,
          serverName: guild.name,
          memberCount: typeof count === 'number' ? count : 0,
          card: wm.card || {},
          roleName,
        });
        dmOpts.files = [{ name: 'welcome.png', data: buffer }];
      } catch (err: any) {
        console.error(`[welcome] Card generation failed: ${err.message}`);
      }
    }

    try {
      await (user as any).send(dmOpts);
      await embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l604_embedReply_description'));
    } catch {
      await embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l606_embedReply_description'));
    }
  },
};

function showHelp(message: any, prefix = '!', lang = 'en') {
  return embedReply(
    message,
    `\`${prefix}welcome status\` - show current configuration\n` +
      `\`${prefix}welcome channel <#channel>\` - set welcome channel\n` +
      `\`${prefix}welcome on/off\` - enable or disable\n` +
      `\`${prefix}welcome image on/off\` - toggle the card image\n` +
      `\`${prefix}welcome message <text>\` - set custom text ({user} {server} {count} {role})\n` +
      `\`${prefix}welcome card\` - customize card appearance (preset, colors, background, greeting)\n` +
      `\`${prefix}welcome embed\` - configure a welcome embed\n` +
      `\`${prefix}welcome dm\` - configure DM welcoming\n` +
      `\`${prefix}welcome role on/off\` - show auto-role on card\n` +
      `\`${prefix}welcome trigger join/role\` - trigger on member join or role assignment\n` +
      `\`${prefix}welcome goodbye\` - configure goodbye messages (or use \`${prefix}goodbye\`)\n` +
      `\`${prefix}welcome test\` - preview the welcome card\n` +
      `\`${prefix}welcome test dm\` - preview the DM welcome message`,
    t(lang, 'auditCatalog.commands.admin.welcome.l627_embedReply_title'),
  );
}

const command: Command = {
  name: 'welcome',
  description: [
    'Configure the welcome message system for your server. Run `!welcome` with no arguments for the full guide.',
    '',
    '**Subcommands:**',
    '`status` - show current welcome configuration',
    '`channel <#channel>` - set the welcome channel',
    '`on/off` - enable or disable welcome messages',
    '`image on/off` - toggle the welcome card image',
    '`message <text>` - set custom welcome text ({user} {server} {count} {role})',
    '`card preset <name>` - apply a theme (dark, light, ocean, sunset, midnight, forest)',
    '`card color/bgcolor/textcolor <hex>` - customize card colors',
    '`card greeting <text>` - replace "WELCOME" text on the card (emoji supported)',
    '`card background <url>` - set a custom background image',
    '`embed on/off` - toggle a welcome embed (title, description, color, footer, thumbnail)',
    '`dm on/off` - toggle DM welcome messages',
    '`role on/off` - show auto-role name on the card',
    '`trigger join/role` - trigger on member join or role assignment',
    '`test` - preview the welcome output',
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
    if (!settings.welcomeMessage) settings.welcomeMessage = {};

    let sub = args[0]?.toLowerCase();

    if (sub === 'test' && args[1]?.toLowerCase() === 'dm') {
      sub = 'testdm';
    }

    if (!sub || !subcommands[sub]) {
      return showHelp(message, prefix, lang);
    }

    try {
      await subcommands[sub](
        message,
        sub === 'testdm' ? args.slice(2) : args.slice(1),
        guild,
        settings,
        client,
        prefix,
      );
    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !welcome (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !welcome: ${error.message || error}`);
        embedReply(message, t(lang, 'auditCatalog.commands.admin.welcome.l682_embedReply_description')).catch(() => {});
      }
    }
  },
};

export default command;
