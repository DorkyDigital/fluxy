import UserSettings from '../models/UserSettings';
import Warning from '../models/Warning';
import ModerationLog from '../models/ModerationLog';
import Ticket from '../models/Ticket';
import GlobalBan from '../models/GlobalBan';
import GlobalBanPrompt from '../models/GlobalBanPrompt';
import GuildSettings from '../models/GuildSettings';
import Stat from '../models/Stat';
import StarboardMessage from '../models/StarboardMessage';
import LockdownState from '../models/LockdownState';

export interface UserDataExport {
  userId: string;
  exportedAt: string;
  userSettings: Record<string, unknown> | null;
  warnings: Array<Record<string, unknown>>;
  moderationLogs: {
    asTarget: Array<Record<string, unknown>>;
    asModerator: Array<Record<string, unknown>>;
  };
  tickets: {
    opened: Array<Record<string, unknown>>;
    participated: Array<Record<string, unknown>>;
    messagesAuthored: number;
  };
  globalBan: Record<string, unknown> | null;
  globalBansAdded: Array<Record<string, unknown>>;
  globalBanPrompts: {
    asBannedUser: Array<Record<string, unknown>>;
    asDecider: Array<Record<string, unknown>>;
  };
  warningsIssued: Array<Record<string, unknown>>;
  commandUsage: number;
  guildSettingsReferences: Array<{ guildId: string; field: string }>;
  starboard: {
    authored: Array<Record<string, unknown>>;
    reacted: Array<Record<string, unknown>>;
  };
  lockdownStates: Array<Record<string, unknown>>;
}

export async function collectUserData(userId: string): Promise<UserDataExport> {
  const [
    userSettings,
    warnings,
    logsAsTarget,
    logsAsModerator,
    ticketsOpened,
    ticketsParticipated,
    globalBan,
    globalBansAdded,
    globalBanPromptsAsBannedUser,
    globalBanPromptsAsDecider,
    warningsIssued,
    commandUsageCount,
    guildSettingsRefs,
    starboardAuthored,
    starboardReacted,
    lockdownStates,
  ] = await Promise.all([
    UserSettings.findOne({ userId }).lean(),
    Warning.find({ userId }).lean(),
    ModerationLog.find({ targetId: userId }).sort({ timestamp: -1 }).lean(),
    ModerationLog.find({ userId }).sort({ timestamp: -1 }).lean(),
    Ticket.find({ openedBy: userId }).lean(),
    Ticket.find({ participants: userId, openedBy: { $ne: userId } })
      .select('-transcript')
      .lean(),
    GlobalBan.findOne({ userId }).lean(),
    GlobalBan.find({ addedBy: userId }).sort({ addedAt: -1 }).lean(),
    GlobalBanPrompt.find({ bannedUserId: userId }).sort({ createdAt: -1 }).lean(),
    GlobalBanPrompt.find({ decidedBy: userId }).sort({ createdAt: -1 }).lean(),
    Warning.find({ 'warnings.modId': userId }).lean(),
    Stat.countDocuments({ 'additionalData.userId': userId }),
    GuildSettings.find({ lockdownAllowedUsers: userId }).select('guildId').lean(),
    StarboardMessage.find({ authorId: userId }).sort({ updatedAt: -1 }).lean(),
    StarboardMessage.find({ reactors: userId }).sort({ updatedAt: -1 }).lean(),
    LockdownState.find({ lockedBy: userId }).sort({ lockedAt: -1 }).lean(),
  ]);

  const allTicketsWithMessages = await Ticket.find({
    'transcript.authorId': userId,
  })
    .select('transcript')
    .lean();

  let messagesAuthored = 0;
  for (const t of allTicketsWithMessages) {
    messagesAuthored += (t as any).transcript.filter((m: any) => m.authorId === userId).length;
  }

  const ticketsOpenedClean = ticketsOpened.map((t: any) => {
    const { transcript, ...rest } = t;
    return { ...rest, transcriptMessageCount: transcript?.length ?? 0 };
  });

  return {
    userId,
    exportedAt: new Date().toISOString(),
    userSettings: userSettings
      ? { prefix: (userSettings as any).prefix, createdAt: (userSettings as any).createdAt }
      : null,
    warnings: warnings.map((w: any) => ({
      guildId: w.guildId,
      warnings: w.warnings,
    })),
    moderationLogs: {
      asTarget: logsAsTarget.map((l: any) => ({
        guildId: l.guildId,
        action: l.action,
        reason: l.reason,
        moderatorId: l.userId,
        timestamp: l.timestamp,
        metadata: l.metadata,
      })),
      asModerator: logsAsModerator.map((l: any) => ({
        guildId: l.guildId,
        action: l.action,
        reason: l.reason,
        targetId: l.targetId,
        timestamp: l.timestamp,
      })),
    },
    tickets: {
      opened: ticketsOpenedClean,
      participated: ticketsParticipated as any[],
      messagesAuthored,
    },
    globalBan: globalBan
      ? {
          reason: (globalBan as any).reason,
          evidence: (globalBan as any).evidence,
          addedBy: (globalBan as any).addedBy,
          addedAt: (globalBan as any).addedAt,
        }
      : null,
    globalBansAdded: globalBansAdded.map((ban: any) => ({
      userId: ban.userId,
      reason: ban.reason,
      evidence: ban.evidence,
      addedAt: ban.addedAt,
    })),
    globalBanPrompts: {
      asBannedUser: globalBanPromptsAsBannedUser.map((prompt: any) => ({
        guildId: prompt.guildId,
        channelId: prompt.channelId,
        messageId: prompt.messageId,
        banReason: prompt.banReason,
        status: prompt.status,
        decidedBy: prompt.decidedBy,
        decidedAt: prompt.decidedAt,
        createdAt: prompt.createdAt,
      })),
      asDecider: globalBanPromptsAsDecider.map((prompt: any) => ({
        guildId: prompt.guildId,
        bannedUserId: prompt.bannedUserId,
        status: prompt.status,
        decidedAt: prompt.decidedAt,
        createdAt: prompt.createdAt,
      })),
    },
    warningsIssued: warningsIssued.map((record: any) => ({
      guildId: record.guildId,
      userId: record.userId,
      warnings: (record.warnings ?? [])
        .filter((warning: any) => warning.modId === userId)
        .map((warning: any) => ({
          reason: warning.reason,
          date: warning.date,
          active: warning.active,
        })),
    })),
    commandUsage: commandUsageCount,
    guildSettingsReferences: guildSettingsRefs.map((g: any) => ({
      guildId: g.guildId,
      field: 'lockdownAllowedUsers',
    })),
    starboard: {
      authored: starboardAuthored.map((entry: any) => ({
        guildId: entry.guildId,
        channelId: entry.channelId,
        messageId: entry.messageId,
        starboardChannelId: entry.starboardChannelId,
        starboardMessageId: entry.starboardMessageId,
        starCount: entry.starCount,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      reacted: starboardReacted.map((entry: any) => ({
        guildId: entry.guildId,
        channelId: entry.channelId,
        messageId: entry.messageId,
        starboardChannelId: entry.starboardChannelId,
        starboardMessageId: entry.starboardMessageId,
        starCount: entry.starCount,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    },
    lockdownStates: lockdownStates.map((state: any) => ({
      guildId: state.guildId,
      active: state.active,
      lockedAt: state.lockedAt,
    })),
  };
}

export interface DeleteUserDataOptions {
  removeGlobalBan?: boolean;
}

export interface DeleteResult {
  userSettings: boolean;
  warnings: number;
  warningsIssuedAnonymized: number;
  moderationLogsAnonymized: number;
  ticketMessagesAnonymized: number;
  ticketsAnonymized: number;
  ticketParticipantsRemoved: number;
  globalBan: boolean;
  globalBansAddedAnonymized: number;
  globalBanPromptsDeleted: number;
  globalBanPromptDecisionsAnonymized: number;
  commandUsage: number;
  guildSettingsReferences: number;
  keywordReferencesAnonymized: number;
  starboardMessagesAnonymized: number;
  starboardReactionsRemoved: number;
  lockdownStatesAnonymized: number;
}

export async function deleteUserData(userId: string, options: DeleteUserDataOptions = {}): Promise<DeleteResult> {
  const result: DeleteResult = {
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
  };

  const userSettingsResult = await UserSettings.deleteOne({ userId });
  result.userSettings = userSettingsResult.deletedCount > 0;

  const warningsResult = await Warning.deleteMany({ userId });
  result.warnings = warningsResult.deletedCount;

  const warningsIssuedResult = await Warning.updateMany(
    { 'warnings.modId': userId },
    { $set: { 'warnings.$[warning].modId': '[deleted]' } },
    { arrayFilters: [{ 'warning.modId': userId }] },
  );
  result.warningsIssuedAnonymized = warningsIssuedResult.modifiedCount || 0;

  const logsAsTarget = await ModerationLog.updateMany({ targetId: userId }, { $set: { targetId: '[deleted]' } });
  const logsAsMod = await ModerationLog.updateMany({ userId }, { $set: { userId: '[deleted]' } });
  result.moderationLogsAnonymized = (logsAsTarget.modifiedCount || 0) + (logsAsMod.modifiedCount || 0);

  const transcriptResult = await Ticket.updateMany(
    { 'transcript.authorId': userId },
    {
      $set: {
        'transcript.$[msg].authorId': '[deleted]',
        'transcript.$[msg].authorName': 'Deleted User',
        'transcript.$[msg].avatarURL': null,
      },
    },
    { arrayFilters: [{ 'msg.authorId': userId }] },
  );
  result.ticketMessagesAnonymized = transcriptResult.modifiedCount || 0;

  const openedTickets = await Ticket.updateMany({ openedBy: userId }, { $set: { openedBy: '[deleted]' } });
  const closedTickets = await Ticket.updateMany({ closedBy: userId }, { $set: { closedBy: '[deleted]' } });
  const claimedTickets = await Ticket.updateMany({ claimedBy: userId }, { $set: { claimedBy: '[deleted]' } });
  const participantTickets = await Ticket.updateMany({ participants: userId }, { $pull: { participants: userId } });
  result.ticketsAnonymized =
    (openedTickets.modifiedCount || 0) + (closedTickets.modifiedCount || 0) + (claimedTickets.modifiedCount || 0);
  result.ticketParticipantsRemoved = participantTickets.modifiedCount || 0;

  if (options.removeGlobalBan) {
    const globalBanResult = await GlobalBan.deleteOne({ userId });
    result.globalBan = globalBanResult.deletedCount > 0;

    const globalBanPromptsResult = await GlobalBanPrompt.deleteMany({ bannedUserId: userId });
    result.globalBanPromptsDeleted = globalBanPromptsResult.deletedCount || 0;
  }

  const globalBansAddedResult = await GlobalBan.updateMany({ addedBy: userId }, { $set: { addedBy: '[deleted]' } });
  result.globalBansAddedAnonymized = globalBansAddedResult.modifiedCount || 0;

  const globalBanPromptDecisionsResult = await GlobalBanPrompt.updateMany(
    { decidedBy: userId },
    { $set: { decidedBy: '[deleted]' } },
  );
  result.globalBanPromptDecisionsAnonymized = globalBanPromptDecisionsResult.modifiedCount || 0;

  const statsResult = await Stat.deleteMany({ 'additionalData.userId': userId });
  result.commandUsage = statsResult.deletedCount;

  const guildSettingsResult = await GuildSettings.updateMany(
    { lockdownAllowedUsers: userId },
    { $pull: { lockdownAllowedUsers: userId } },
  );
  result.guildSettingsReferences = guildSettingsResult.modifiedCount || 0;

  const keywordReferencesResult = await GuildSettings.updateMany(
    { 'keywordWarnings.keywords.addedBy': userId },
    { $set: { 'keywordWarnings.keywords.$[keyword].addedBy': '[deleted]' } },
    { arrayFilters: [{ 'keyword.addedBy': userId }] },
  );
  result.keywordReferencesAnonymized = keywordReferencesResult.modifiedCount || 0;

  const starboardAuthorResult = await StarboardMessage.updateMany(
    { authorId: userId },
    { $set: { authorId: '[deleted]' } },
  );
  result.starboardMessagesAnonymized = starboardAuthorResult.modifiedCount || 0;

  const starboardReactionResult = await StarboardMessage.updateMany(
    { reactors: userId },
    { $pull: { reactors: userId } },
  );
  result.starboardReactionsRemoved = starboardReactionResult.modifiedCount || 0;

  const lockdownStateResult = await LockdownState.updateMany({ lockedBy: userId }, { $set: { lockedBy: '[deleted]' } });
  result.lockdownStatesAnonymized = lockdownStateResult.modifiedCount || 0;

  return result;
}
