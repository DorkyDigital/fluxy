import type { Command } from '../../types';
import config from '../../config';
import { collectUserData, deleteUserData, type DeleteResult } from '../../services/UserDataService';
import isNetworkError from '../../utils/isNetworkError';
import parseUserId from '../../utils/parseUserId';

const CONFIRM_EMOJI = '✅';
const CANCEL_EMOJI = '❌';
const CONFIRM_TIMEOUT_MS = 60 * 1000;

function normalizeEmojiName(emoji: any): string {
  return String(emoji?.name ?? emoji ?? '')
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .trim()
    .toLowerCase();
}

function isConfirmEmoji(emoji: any): boolean {
  const name = normalizeEmojiName(emoji);
  return name === normalizeEmojiName(CONFIRM_EMOJI) || name === 'white_check_mark';
}

function isCancelEmoji(emoji: any): boolean {
  const name = normalizeEmojiName(emoji);
  return name === normalizeEmojiName(CANCEL_EMOJI) || name === 'x';
}

async function editOrReply(message: any, targetMessage: any, content: string): Promise<void> {
  if (typeof targetMessage?.edit === 'function') {
    await targetMessage.edit({ content, embeds: [] }).catch(() => {});
    return;
  }

  await message.reply(content).catch(() => {});
}

async function waitForOwnerConfirmation(client: any, confirmationMessage: any, ownerId: string): Promise<boolean> {
  if (typeof client.on !== 'function') return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const cleanup = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.off?.('messageReactionAdd', handler);
      resolve(value);
    };

    const timeout = setTimeout(() => cleanup(false), CONFIRM_TIMEOUT_MS);
    timeout.unref?.();

    const handler = (reaction: any, reactor: any) => {
      if (String(reaction?.messageId ?? '') !== String(confirmationMessage?.id ?? '')) return;
      const confirmationChannelId = confirmationMessage?.channelId;
      if (confirmationChannelId && String(reaction?.channelId ?? '') !== String(confirmationChannelId)) return;
      if (String(reactor?.id ?? '') !== ownerId || reactor?.bot) return;

      if (isConfirmEmoji(reaction?.emoji)) {
        cleanup(true);
      } else if (isCancelEmoji(reaction?.emoji)) {
        cleanup(false);
      }
    };

    client.on('messageReactionAdd', handler);
  });
}

async function sendUserDataDM(client: any, userId: string, data: unknown): Promise<boolean> {
  const json = JSON.stringify(data, null, 2);
  const payload = {
    content: 'Fluxy is removing the data it stores about you. Your export is attached before removal for your records.',
    files: [{ name: `fluxy-data-${userId}.json`, data: Buffer.from(json, 'utf-8') }],
  };

  const user = typeof client.users?.fetch === 'function' ? await client.users.fetch(userId).catch(() => null) : null;
  if (typeof user?.send === 'function') {
    try {
      await user.send(payload);
      return true;
    } catch {}
  }

  const dmChannel =
    typeof client.users?.createDM === 'function' ? await client.users.createDM(userId).catch(() => null) : null;
  if (typeof dmChannel?.send === 'function') {
    try {
      await dmChannel.send(payload);
      return true;
    } catch {}
  }

  return false;
}

function formatDeleteResult(result: DeleteResult): string {
  const lines: string[] = [];

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
  if (result.globalBan) lines.push('- Global ban entry deleted');
  if (result.globalBansAddedAnonymized > 0)
    lines.push(`- ${result.globalBansAddedAnonymized} global ban creator reference(s) anonymized`);
  if (result.globalBanPromptsDeleted > 0)
    lines.push(`- ${result.globalBanPromptsDeleted} global ban prompt(s) deleted`);
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
    lines.push('- No removable data was found');
  }

  return lines.join('\n');
}

const command: Command = {
  name: 'remove',
  description: "Owner-only command to export and remove a user's data",
  usage: '<userId>',
  category: 'owner',
  ownerOnly: true,
  allowDM: true,
  cooldown: 0,

  async execute(message, args, client, prefix = '!') {
    const ownerId = config.ownerId;
    const authorId = String((message as any).author?.id ?? '');

    if (!ownerId || authorId !== ownerId) {
      return void (await message.reply('This command is restricted to the bot owner.'));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply(`Usage: \`${prefix}remove <userId>\``));
    }

    const confirmationMessage = await message.reply(
      `Remove stored data for \`${userId}\`?\n\n` +
        'Fluxy will DM that user a JSON export first. If the export DM cannot be sent, deletion will stop.\n\n' +
        `${CONFIRM_EMOJI} confirm\n${CANCEL_EMOJI} cancel`,
    );

    try {
      await confirmationMessage.react(CONFIRM_EMOJI);
      await confirmationMessage.react(CANCEL_EMOJI);
    } catch {
      await editOrReply(
        message,
        confirmationMessage,
        'I could not add the confirmation reactions. The removal was not started.',
      );
      return;
    }

    const confirmed = await waitForOwnerConfirmation(client, confirmationMessage, ownerId);
    if (!confirmed) {
      await editOrReply(message, confirmationMessage, 'Cancelled. No data was removed.');
      return;
    }

    await editOrReply(message, confirmationMessage, `Collecting and exporting data for \`${userId}\`...`);

    try {
      const data = await collectUserData(userId);
      const dmSent = await sendUserDataDM(client as any, userId, data);

      if (!dmSent) {
        await message
          .reply(`I could not DM \`${userId}\` their data export, so I did not remove anything.`)
          .catch(() => {});
        return;
      }

      const result = await deleteUserData(userId, { removeGlobalBan: true });
      await message.reply(`Data removal complete for \`${userId}\`.\n${formatDeleteResult(result)}`).catch(() => {});
    } catch (error: any) {
      if (isNetworkError(error)) return;
      console.error(`[remove] Failed to remove data for ${userId}: ${error.message || error}`);
      await message
        .reply('The export/removal flow failed before it could complete. Check logs before trying again.')
        .catch(() => {});
    }
  },
};

export default command;
