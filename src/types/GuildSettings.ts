export interface IKeywordEntry {
  pattern: string;
  isRegex: boolean;
  label: string | null;
  addedBy: string | null;
}

export interface IKeywordWarnings {
  enabled: boolean;
  action: 'delete' | 'warn' | 'delete+warn';
  keywords: IKeywordEntry[];
}

export interface IHoneypotEntry {
  channelId: string;
  action: 'ban' | 'kick' | 'timeout' | 'role';
  enabled: boolean;
  banDeleteDays: number;
  timeoutHours: number;
  roleId: string | null;
}

export interface IWelcomeCard {
  preset: 'default' | 'dark' | 'light' | 'ocean' | 'sunset' | 'midnight' | 'forest' | null;
  bgColor1: string | null;
  bgColor2: string | null;
  bgColor3: string | null;
  accentColor: string | null;
  textColor: string | null;
  subtextColor: string | null;
  countColor: string | null;
  greetingText: string | null;
  subtitle: string | null;
  showMemberCount: boolean;
  bgImageURL: string | null;
}

export interface IWelcomeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
  thumbnail: boolean;
}

export interface IWelcomeDM {
  enabled: boolean;
  message: string | null;
  imageEnabled: boolean;
}

export interface IWelcomeMessage {
  enabled: boolean;
  type: 'none' | 'preset' | 'custom';
  channelId: string | null;
  message: string | null;
  preset: string | null;
  imageEnabled: boolean;
  card: IWelcomeCard;
  embed: IWelcomeEmbed;
  dm: IWelcomeDM;
  showRole: boolean;
  trigger: 'join' | 'role';
  triggerRoleId: string | null;
}

export interface IReactionRoleEntry {
  emoji: string;
  roleId: string;
  roleIds?: string[];
  removeRoleId: string | null;
}

export interface IReactionRole {
  messageId: string;
  channelId: string;
  roles: IReactionRoleEntry[];
}

export interface IModeration {
  muteRoleId: string | null;
  logChannelId: string | null;
  autoMute: boolean;
  autoMuteThreshold: number;
  muteMethod: 'auto' | 'timeout' | 'mute_role';
}

export interface ICustomCommand {
  name: string;
  response: string;
  embed: boolean;
  color: string | null;
  title: string | null;
}

export interface IAutomodSpam {
  maxMessages: number;
  timeWindow: number;
  timeoutDuration: number;
  violationThreshold: number;
}

export interface IAutomodRaid {
  userThreshold: number;
  timeWindow: number;
}

export type AutomodLevel = 'off' | 'minimal' | 'medium' | 'high';

export interface IAutomod {
  level: AutomodLevel;
  antiSpam: boolean;
  antiLink: boolean;
  antiReactionSpam: boolean;
  ghostPing: boolean;
  maxMentions: number;
  maxLines: number;
  spam: IAutomodSpam;
  raid: IAutomodRaid;
  allowedDomains: string[];
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface IGoodbyeEmbed {
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: string | null;
  footer: string | null;
}

export interface IGoodbyeMessage {
  enabled: boolean;
  channelId: string | null;
  message: string | null;
  embed: IGoodbyeEmbed;
}

export interface ILogChannelOverrides {
  member: string | null;
  voice: string | null;
  message: string | null;
  role: string | null;
  channel: string | null;
  reaction: string | null;
  server: string | null;
}

export interface IStarboard {
  enabled: boolean;
  channelId: string | null;
  threshold: number;
  emoji: string;
  selfStarEnabled: boolean;
  ignoreBots: boolean;
  ignoredChannels: string[];
  ignoredRoles: string[];
}

export interface IVerification {
  enabled: boolean;
  categoryId: string | null;
  verifiedRoleId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  maxAttempts: number;
}

export interface IGuildSettings {
  guildId: string;
  prefixes: string[];
  welcomeMessage: IWelcomeMessage;
  reactionRoles: IReactionRole[];
  moderation: IModeration;
  automod: IAutomod;

  // legacy fields
  automodEnabled: boolean;
  antiLink: boolean;
  antiSpam: boolean;
  antiGhostPing: boolean;

  logChannelId: string | null;
  muteRoleId: string | null;
  prefix: string | null;
  reactionRoleDMEnabled: boolean;
  autoroleId: string | null;
  raidDisableAutorole: boolean;

  staffChannelId: string | null;
  staffRoleId: string | null;
  staffInboxChannelId: string | null;

  keywordWarnings: IKeywordWarnings;
  honeypotChannels: IHoneypotEntry[];
  honeypotAlertRoleId: string | null;

  serverLogChannelId: string | null;
  logChannelOverrides: ILogChannelOverrides;
  disabledLogEvents: string[];
  blacklistedChannels: string[];

  ticketCategoryId: string | null;
  ticketSupportRoleId: string | null;
  ticketSupportRoleIds: string[];
  ticketLogChannelId: string | null;
  ticketMaxOpen: number;
  ticketOpenMessage: string | null;
  ticketSetupChannelId: string | null;
  ticketSetupMessageId: string | null;
  ticketEmoji: string;

  customCommands: ICustomCommand[];

  goodbyeMessage: IGoodbyeMessage;

  lockdownRoles: string[];
  lockdownAllowedRoles: string[];
  lockdownAllowedUsers: string[];

  slowmodeAllowedRoles: string[];
  commandAllowedRoles: string[];

  globalBanEnabled: boolean;
  globalBanAutoApply: boolean;

  disabledCommands: string[];

  verification: IVerification;

  starboard: IStarboard;

  onboardingComplete: boolean;
  onboardingStep: number;

  createdAt: Date;
  updatedAt: Date;
}

export type ModerationAction =
  | 'ban' | 'unban' | 'kick' | 'mute' | 'unmute'
  | 'warn' | 'unwarn' | 'clearwarn' | 'slowmode' | 'unlock'
  | 'purge' | 'softban' | 'tempban' | 'tempmute' | 'timeout'
  | 'nickname' | 'role_add' | 'role_remove' | 'other';

export interface IModerationLogMetadata {
  roleId?: string;
  roleName?: string;
  messageCount?: number;
  channelId?: string;
  channelName?: string;
  slowmodeSeconds?: number;
  oldNickname?: string;
  newNickname?: string;
  warningId?: string;
  caseNumber?: number;
}

export interface IModerationLog {
  guildId: string;
  userId: string;
  targetId: string;
  action: ModerationAction;
  reason: string;
  duration: number | null;
  metadata: IModerationLogMetadata;
  timestamp: Date;
  viaDashboard: boolean;
}

export interface IWarningEntry {
  modId: string;
  reason: string;
  date: Date;
  active: boolean;
}

export interface IWarning {
  userId: string;
  guildId: string;
  warnings: IWarningEntry[];
}

export interface ITranscriptAttachment {
  url: string;
  name: string;
}

export interface ITranscriptMessage {
  authorId: string;
  authorName: string;
  avatarURL: string | null;
  content: string;
  attachments: ITranscriptAttachment[];
  timestamp: Date;
}

export interface ITicket {
  guildId: string;
  channelId: string;
  openedBy: string;
  ticketNumber: number;
  subject: string | null;
  status: 'open' | 'closed';
  claimedBy: string | null;
  claimedAt: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  participants: string[];
  transcript: ITranscriptMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelOverwriteSnapshot {
  channelId: string;
  roleId: string | null;
  previousAllow: string;
  previousDeny: string;
  hadOverwrite: boolean;
}

export interface ILockdownState {
  guildId: string;
  active: boolean;
  lockedBy: string | null;
  lockedAt: Date | null;
  channelSnapshots: IChannelOverwriteSnapshot[];
  invitesWereDisabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
