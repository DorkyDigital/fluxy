import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import isNetworkError from '../../utils/isNetworkError';
import { registerReactionPaginator } from '../../utils/reactionPaginator';
import settingsCache from '../../utils/settingsCache';
import { formatCompactPageIndicator, joinCompactFooterParts } from '../../utils/embedPresentation';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'inrole',
  description: 'List every member who has a specific role',
  usage: '<@role or role ID> [starting page]',
  category: 'info',
  cooldown: 10,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) guild = await client.guilds.fetch((message as any).guildId);
    if (!guild) return void await message.reply(t('en', 'commands.inrole.serverOnly'));
    const settings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(settings?.language);

    const roleArg = args[0];
    if (!roleArg) return void await message.reply(t(lang, 'commands.inrole.usage', { prefix }));

    const roleMention = roleArg.match(/^<@&(\d{17,19})>$/);
    let roleId: string;
    if (roleMention) roleId = roleMention[1];
    else if (/^\d{17,19}$/.test(roleArg)) roleId = roleArg;
    else return void await message.reply(t(lang, 'commands.inrole.invalidRoleInput'));

    try {
      let role: any = guild.roles?.get(roleId);
      if (!role) {
        try { role = await guild.fetchRole(roleId); } catch {}
      }
      if (!role) return void await message.reply(t(lang, 'commands.inrole.roleNotFound'));

      let members: any[];
      try {
        members = [];
        let lastId: string | undefined;
        while (true) {
          const batch: any = await guild.members.fetch({ limit: 1000, ...(lastId && { after: lastId }) });
          const arr = Array.isArray(batch) ? batch : [...batch.values()];
          members.push(...arr);
          if (arr.length < 1000) break;
          lastId = arr[arr.length - 1].id;
        }
      } catch (err: any) {
        const guildName = guild?.name || 'Unknown Server';
        if (isNetworkError(err)) {
          console.warn(`[${guildName}] Fluxer API unreachable during !inrole (ECONNRESET)`);
        } else {
          console.error(`[${guildName}] Error in !inrole: ${err.message || err}`);
        }
        return void await message.reply(t(lang, 'commands.inrole.membersFetchFailed'));
      }

      const withRole = members.filter((m: any) => {
        if (typeof m.roles?.has === 'function') return m.roles.has(roleId);
        const ids = m.roles?.roleIds ?? (Array.isArray(m.roles) ? m.roles : []);
        return ids.includes(roleId);
      });

      if (withRole.length === 0) {
        return void await message.reply(t(lang, 'commands.inrole.noneWithRole', { roleName: role.name }));
      }

      const PAGE_SIZE = 50;
      const totalPages = Math.max(1, Math.ceil(withRole.length / PAGE_SIZE));

      let page = 1;
      if (args[1]) {
        const parsed = parseInt(args[1], 10);
        if (isNaN(parsed) || parsed < 1) return void await message.reply(t(lang, 'commands.inrole.invalidPage'));
        if (parsed > totalPages) return void await message.reply(t(lang, 'commands.inrole.pageTooHigh', { totalPages }));
        page = parsed;
      }

      const pageEmbeds = Array.from({ length: totalPages }, (_, pageIndex) => {
        const start = pageIndex * PAGE_SIZE;
        const displayed = withRole.slice(start, start + PAGE_SIZE);

        const list = displayed
          .map((m: any) => m.user ? `<@${m.id}> (${m.user.username})` : `<@${m.id}>`)
          .join('\n');

        return new EmbedBuilder()
          .setTitle(t(lang, 'commands.inrole.embedTitle', { roleName: role.name }))
          .setColor(role.color || 0x5865F2)
          .setDescription(list)
          .setFooter({
            text: joinCompactFooterParts([
              t(lang, 'commands.inrole.footerTotal', { memberCount: withRole.length }),
              formatCompactPageIndicator(pageIndex + 1, totalPages),
            ]),
          });
      });

      const sentMessage: any = await message.reply({ embeds: [pageEmbeds[page - 1]] });

      if (totalPages > 1) {
        const ownerUserId = String((message as any).author?.id ?? (message as any).authorId ?? '');
        const responseChannelId = String(sentMessage?.channelId ?? (message as any).channelId ?? '');
        const responseMessageId = String(sentMessage?.id ?? '');

        if (ownerUserId && responseChannelId && responseMessageId) {
          await registerReactionPaginator(client, {
            messageId: responseMessageId,
            channelId: responseChannelId,
            ownerUserId,
            pages: pageEmbeds,
            initialPageIndex: page - 1,
            ttlMs: 3 * 60 * 1000,
          });
        }
      }

      return;

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !inrole (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !inrole: ${error.message || error}`);
        message.reply(t(lang, 'commands.inrole.genericError')).catch(() => {});
      }
    }
  }
};

export default command;
