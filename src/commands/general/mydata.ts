import type { Command } from '../../types';
import { collectUserData, deleteUserData } from '../../services/UserDataService';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const pendingDeletes = new Set<string>();

const command: Command = {
  name: 'mydata',
  description: 'View, export, or delete all data Fluxy stores about you',
  usage: '<export|delete|info>',
  category: 'general',
  permissions: [],
  cooldown: 30,
  allowDM: true,

  async execute(message, args, client, prefix = '!') {
    const userId = (message as any).author.id;
    const guildId = (message as any).guildId || (message as any).guild?.id;
    const settings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
    const lang = normalizeLocale(settings?.language);
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'info') {
      return void (await message.reply(t(lang, 'commands.mydata.info', { prefix })));
    }

    if (sub === 'export') {
      try {
        await message.reply(t(lang, 'commands.mydata.collecting'));

        const data = await collectUserData(userId);
        const json = JSON.stringify(data, null, 2);
        const buffer = Buffer.from(json, 'utf-8');

        try {
          const dmChannel = await (client as any).users.createDM?.(userId);
          if (dmChannel) {
            await dmChannel.send({
              content: t(lang, 'commands.mydata.dmContent'),
              files: [{ name: `fluxy-data-${userId}.json`, data: buffer }],
            });
            await message.reply(t(lang, 'commands.mydata.dmSent'));
          } else {
            await message.reply(t(lang, 'commands.mydata.dmOpenFailed'));
          }
        } catch {
          await message.reply(t(lang, 'commands.mydata.dmSendFailed'));
        }
      } catch (error: any) {
        if (isNetworkError(error)) return;
        console.error(`[mydata] Export failed for ${userId}: ${error.message}`);
        await message.reply(t(lang, 'commands.mydata.exportFailed')).catch(() => {});
      }
      return;
    }

    if (sub === 'delete') {
      if (!pendingDeletes.has(userId)) {
        pendingDeletes.add(userId);
        setTimeout(() => pendingDeletes.delete(userId), 60 * 1000);

        return void (await message.reply(t(lang, 'commands.mydata.deleteConfirm', { prefix })));
      }

      pendingDeletes.delete(userId);

      try {
        await message.reply(t(lang, 'commands.mydata.deleting'));
        const result = await deleteUserData(userId);

        const lines = [];
        if (result.userSettings) lines.push('- Personal settings deleted');
        if (result.warnings > 0) lines.push(`- ${result.warnings} warning record(s) deleted`);
        if (result.warningsIssuedAnonymized > 0)
          lines.push(`- ${result.warningsIssuedAnonymized} warning issuer reference(s) anonymized`);
        if (result.moderationLogsAnonymized > 0)
          lines.push(`- ${result.moderationLogsAnonymized} moderation log(s) anonymized`);
        if (result.ticketMessagesAnonymized > 0) lines.push('- Ticket transcript messages anonymized');
        if (result.ticketsAnonymized > 0) lines.push(`- ${result.ticketsAnonymized} ticket field(s) anonymized`);
        if (result.ticketParticipantsRemoved > 0)
          lines.push(`- Removed from ${result.ticketParticipantsRemoved} ticket participant list(s)`);
        if (result.globalBansAddedAnonymized > 0)
          lines.push(`- ${result.globalBansAddedAnonymized} global ban creator reference(s) anonymized`);
        if (result.globalBanPromptDecisionsAnonymized > 0)
          lines.push(`- ${result.globalBanPromptDecisionsAnonymized} global ban prompt decision(s) anonymized`);
        if (result.commandUsage > 0) lines.push(`- ${result.commandUsage} command usage record(s) deleted`);
        if (result.guildSettingsReferences > 0)
          lines.push(`- Removed from ${result.guildSettingsReferences} guild allowlist(s)`);
        if (result.keywordReferencesAnonymized > 0)
          lines.push(`- ${result.keywordReferencesAnonymized} keyword author reference(s) anonymized`);
        if (result.starboardMessagesAnonymized > 0)
          lines.push(`- ${result.starboardMessagesAnonymized} starboard author reference(s) anonymized`);
        if (result.starboardReactionsRemoved > 0)
          lines.push(`- Removed from ${result.starboardReactionsRemoved} starboard reactor list(s)`);
        if (result.lockdownStatesAnonymized > 0)
          lines.push(`- ${result.lockdownStatesAnonymized} lockdown state reference(s) anonymized`);

        if (lines.length === 0) {
          lines.push(t(lang, 'commands.mydata.deleteNoData'));
        }

        await message.reply(t(lang, 'commands.mydata.deleteDoneHeader') + '\n' + lines.join('\n'));
      } catch (error: any) {
        if (isNetworkError(error)) return;
        console.error(`[mydata] Delete failed for ${userId}: ${error.message}`);
        await message.reply(t(lang, 'commands.mydata.deleteFailed')).catch(() => {});
      }
      return;
    }

    return void (await message.reply(t(lang, 'commands.mydata.unknown', { prefix })));
  },
};

export default command;
