import { Schema, model, Document, Model } from 'mongoose';
import type {
  IGuildSettings, IKeywordEntry, IKeywordWarnings, IHoneypotEntry,
  IWelcomeCard, IWelcomeEmbed, IWelcomeDM, IWelcomeMessage,
  IReactionRole, IReactionRoleEntry, IModeration, ICustomCommand,
  IAutomodSpam, IAutomodRaid, IAutomod, IGoodbyeEmbed, IGoodbyeMessage,
  ILogChannelOverrides, IVerification, IStarboard,
} from '../types';

const keywordEntrySchema = new Schema<IKeywordEntry>({
  pattern: { type: String, required: true },
  isRegex: { type: Boolean, default: false },
  label: { type: String, default: null },
  addedBy: { type: String, default: null },
}, { _id: false });

const keywordWarningsSchema = new Schema<IKeywordWarnings>({
  enabled: { type: Boolean, default: false },
  action: { type: String, enum: ['delete', 'warn', 'delete+warn'], default: 'delete+warn' },
  keywords: { type: [keywordEntrySchema], default: [] },
}, { _id: false });

const honeypotEntrySchema = new Schema<IHoneypotEntry>({
  channelId: { type: String, required: true },
  action: { type: String, enum: ['ban', 'kick', 'timeout', 'role'], default: 'ban' },
  enabled: { type: Boolean, default: true },
  banDeleteDays: { type: Number, default: 1, min: 0, max: 7 },
  timeoutHours: { type: Number, default: 24, min: 1, max: 672 },
  roleId: { type: String, default: null },
}, { _id: false });

const welcomeCardSchema = new Schema<IWelcomeCard>({
  preset: { type: String, enum: ['default', 'dark', 'light', 'ocean', 'sunset', 'midnight', 'forest'], default: null },
  bgColor1: { type: String, default: null },
  bgColor2: { type: String, default: null },
  bgColor3: { type: String, default: null },
  accentColor: { type: String, default: null },
  textColor: { type: String, default: null },
  subtextColor: { type: String, default: null },
  countColor: { type: String, default: null },
  greetingText: { type: String, default: null },
  subtitle: { type: String, default: null },
  showMemberCount: { type: Boolean, default: true },
  bgImageURL: { type: String, default: null },
}, { _id: false });

const welcomeEmbedSchema = new Schema<IWelcomeEmbed>({
  enabled: { type: Boolean, default: false },
  title: { type: String, default: null },
  description: { type: String, default: null },
  color: { type: String, default: null },
  footer: { type: String, default: null },
  thumbnail: { type: Boolean, default: false },
}, { _id: false });

const welcomeDMSchema = new Schema<IWelcomeDM>({
  enabled: { type: Boolean, default: false },
  message: { type: String, default: null },
  imageEnabled: { type: Boolean, default: false },
}, { _id: false });

const welcomeMessageSchema = new Schema<IWelcomeMessage>({
  enabled: { type: Boolean, default: false },
  type: {
    type: String,
    enum: ['none', 'preset', 'custom'],
    default: 'none',
  },
  channelId: { type: String, default: null },
  message: { type: String, default: null },
  preset: { type: String, default: null },
  imageEnabled: { type: Boolean, default: true },
  card: { type: welcomeCardSchema, default: () => ({}) },
  embed: { type: welcomeEmbedSchema, default: () => ({}) },
  dm: { type: welcomeDMSchema, default: () => ({}) },
  showRole: { type: Boolean, default: false },
  trigger: { type: String, enum: ['join', 'role'], default: 'join' },
  triggerRoleId: { type: String, default: null },
}, { _id: false });

const reactionRoleEntrySchema = new Schema<IReactionRoleEntry>({
  emoji: { type: String, required: true },
  roleId: { type: String, required: true },
  roleIds: { type: [String] },
  removeRoleId: { type: String, default: null },
}, { _id: false });

const reactionRoleSchema = new Schema<IReactionRole>({
  messageId: { type: String, required: true },
  channelId: { type: String, required: true },
  roles: [reactionRoleEntrySchema],
}, { _id: false });

const moderationSchema = new Schema<IModeration>({
  muteRoleId: { type: String, default: null },
  logChannelId: { type: String, default: null },
  autoMute: { type: Boolean, default: false },
  autoMuteThreshold: { type: Number, default: 3, min: 1, max: 20 },
  muteMethod: { type: String, enum: ['auto', 'timeout', 'mute_role'], default: 'auto' },
}, { _id: false });

const customCommandSchema = new Schema<ICustomCommand>({
  name: { type: String, required: true },
  response: { type: String, required: true },
  embed: { type: Boolean, default: false },
  color: { type: String, default: null },
  title: { type: String, default: null },
}, { _id: false });

const automodSpamSchema = new Schema<IAutomodSpam>({
  maxMessages: { type: Number, default: 5, min: 2, max: 20 },
  timeWindow: { type: Number, default: 5, min: 1, max: 60 },
  timeoutDuration: { type: Number, default: 10, min: 1, max: 1440 },
  violationThreshold: { type: Number, default: 3, min: 1, max: 10 },
}, { _id: false });

const automodRaidSchema = new Schema<IAutomodRaid>({
  userThreshold: { type: Number, default: 5, min: 2, max: 50 },
  timeWindow: { type: Number, default: 10, min: 1, max: 120 },
}, { _id: false });

const automodSchema = new Schema<IAutomod>({
  level: {
    type: String,
    enum: ['off', 'minimal', 'medium', 'high'],
    default: 'off',
  },
  antiSpam: { type: Boolean, default: false },
  antiLink: { type: Boolean, default: false },
  antiReactionSpam: { type: Boolean, default: false },
  ghostPing: { type: Boolean, default: false },
  maxMentions: { type: Number, default: 5, min: 0, max: 50 },
  maxLines: { type: Number, default: 10, min: 0, max: 100 },
  spam: { type: automodSpamSchema, default: () => ({}) },
  raid: { type: automodRaidSchema, default: () => ({}) },
  allowedDomains: { type: [String], default: [] },
  exemptRoles: { type: [String], default: [] },
  exemptChannels: { type: [String], default: [] },
}, { _id: false });

const verificationSchema = new Schema<IVerification>({
  enabled: { type: Boolean, default: false },
  categoryId: { type: String, default: null },
  verifiedRoleId: { type: String, default: null },
  panelChannelId: { type: String, default: null },
  panelMessageId: { type: String, default: null },
  logChannelId: { type: String, default: null },
  maxAttempts: { type: Number, default: 2, min: 1, max: 5 },
}, { _id: false });

const starboardSchema = new Schema<IStarboard>({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: null },
  threshold: { type: Number, default: 3, min: 1, max: 100 },
  emoji: { type: String, default: '⭐' },
  selfStarEnabled: { type: Boolean, default: false },
  ignoreBots: { type: Boolean, default: true },
  ignoredChannels: { type: [String], default: [] },
  ignoredRoles: { type: [String], default: [] },
}, { _id: false });

export interface GuildSettingsDocument extends IGuildSettings, Document { }

export interface GuildSettingsModel extends Model<GuildSettingsDocument> {
  getOrCreate(guildId: string): Promise<GuildSettingsDocument>;
  updateSetting(guildId: string, key: string, value: unknown): Promise<GuildSettingsDocument | null>;
  addReactionRole(guildId: string, reactionRole: IReactionRole): Promise<GuildSettingsDocument | null>;
  removeReactionRole(guildId: string, messageId: string): Promise<GuildSettingsDocument | null>;
  addPrefix(guildId: string, prefix: string): Promise<GuildSettingsDocument | null>;
  removePrefix(guildId: string, prefix: string): Promise<GuildSettingsDocument | null>;
}

const settingsSchema = new Schema<GuildSettingsDocument, GuildSettingsModel>({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  prefixes: {
    type: [String],
    default: () => [process.env.PREFIX || '!'],
    validate: {
      validator: function (v: string[]) {
        return v.length <= 15;
      },
      message: 'Cannot have more than 15 prefixes',
    },
  },

  welcomeMessage: { type: welcomeMessageSchema, default: () => ({}) },

  reactionRoles: { type: [reactionRoleSchema], default: [] },

  moderation: { type: moderationSchema, default: () => ({}) },

  automod: { type: automodSchema, default: () => ({}) },

  // "legacy" kept for servers taht been wit me since the beginign do not remove or we will have a bad time
  automodEnabled: { type: Boolean, default: false },
  antiLink: { type: Boolean, default: false },
  antiSpam: { type: Boolean, default: false },
  antiGhostPing: { type: Boolean, default: false },

  logChannelId: { type: String, default: null },

  muteRoleId: { type: String, default: null },

  prefix: { type: String, default: null },

  reactionRoleDMEnabled: { type: Boolean, default: false },

  autoroleId: { type: String, default: null },
  raidDisableAutorole: { type: Boolean, default: false },

  staffChannelId: { type: String, default: null },
  staffRoleId: { type: String, default: null },
  staffInboxChannelId: { type: String, default: null },

  keywordWarnings: { type: keywordWarningsSchema, default: () => ({}) },

  honeypotChannels: { type: [honeypotEntrySchema], default: [] },
  honeypotAlertRoleId: { type: String, default: null },

  serverLogChannelId: { type: String, default: null },

  logChannelOverrides: {
    type: new Schema<ILogChannelOverrides>({
      member: { type: String, default: null },
      voice: { type: String, default: null },
      message: { type: String, default: null },
      role: { type: String, default: null },
      channel: { type: String, default: null },
      reaction: { type: String, default: null },
      server: { type: String, default: null },
    }, { _id: false }),
    default: () => ({}),
  },

  disabledLogEvents: { type: [String], default: [] },

  blacklistedChannels: { type: [String], default: [] },

  ticketCategoryId: { type: String, default: null },
  ticketSupportRoleId: { type: String, default: null },
  ticketSupportRoleIds: { type: [String], default: [] },
  ticketLogChannelId: { type: String, default: null },
  ticketMaxOpen: { type: Number, default: 3, min: 1, max: 10 },
  ticketOpenMessage: { type: String, default: null },
  ticketSetupChannelId: { type: String, default: null },
  ticketSetupMessageId: { type: String, default: null },
  ticketEmoji: { type: String, default: '🎫' },

  customCommands: {
    type: [customCommandSchema],
    default: [],
    validate: {
      validator: function (v: ICustomCommand[]) { return v.length <= 50; },
      message: 'Cannot have more than 50 custom commands',
    },
  },

  goodbyeMessage: {
    type: new Schema<IGoodbyeMessage>({
      enabled: { type: Boolean, default: false },
      channelId: { type: String, default: null },
      message: { type: String, default: null },
      embed: {
        type: new Schema<IGoodbyeEmbed>({
          enabled: { type: Boolean, default: false },
          title: { type: String, default: null },
          description: { type: String, default: null },
          color: { type: String, default: null },
          footer: { type: String, default: null },
        }, { _id: false }),
        default: () => ({}),
      },
    }, { _id: false }),
    default: () => ({}),
  },

  lockdownRoles: { type: [String], default: [] },
  lockdownAllowedRoles: { type: [String], default: [] },
  lockdownAllowedUsers: { type: [String], default: [] },

  slowmodeAllowedRoles: { type: [String], default: [] },
  commandAllowedRoles: { type: [String], default: [] },

  globalBanEnabled: { type: Boolean, default: false },
  globalBanAutoApply: { type: Boolean, default: false },

  disabledCommands: { type: [String], default: [] },

  verification: { type: verificationSchema, default: () => ({}) },

  starboard: { type: starboardSchema, default: () => ({}) },

  onboardingComplete: { type: Boolean, default: false },
  onboardingStep: { type: Number, default: 0, min: 0 },
}, {
  timestamps: true,
});


settingsSchema.statics.getOrCreate = async function (guildId: string) {
  let settings = await this.findOne({ guildId });
  if (!settings) {
    settings = await this.create({ guildId });
  }
  return settings;
};


settingsSchema.statics.updateSetting = async function (guildId: string, key: string, value: unknown) {
  return this.findOneAndUpdate(
    { guildId },
    { [key]: value },
    { returnDocument: 'after', upsert: true },
  );
};

settingsSchema.statics.addReactionRole = async function (guildId: string, reactionRole: IReactionRole) {
  return this.findOneAndUpdate(
    { guildId },
    { $push: { reactionRoles: reactionRole } },
    { returnDocument: 'after', upsert: true },
  );
};

settingsSchema.statics.removeReactionRole = async function (guildId: string, messageId: string) {
  return this.findOneAndUpdate(
    { guildId },
    { $pull: { reactionRoles: { messageId } } },
    { returnDocument: 'after' },
  );
};


settingsSchema.statics.addPrefix = async function (guildId: string, prefix: string) {
  const settings = await this.findOne({ guildId });
  if (settings && settings.prefixes.length >= 15) {
    return null;
  }
  return this.findOneAndUpdate(
    { guildId },
    { $addToSet: { prefixes: prefix } },
    { returnDocument: 'after', upsert: true },
  );
};

settingsSchema.statics.removePrefix = async function (guildId: string, prefix: string) {
  return this.findOneAndUpdate(
    { guildId },
    { $pull: { prefixes: prefix } },
    { returnDocument: 'after' },
  );
};

export default model<GuildSettingsDocument, GuildSettingsModel>('GuildSettings', settingsSchema);
