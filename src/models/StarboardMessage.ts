import { Schema, model, Document } from 'mongoose';

export interface IStarboardMessage {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  starboardMessageId: string | null;
  starCount: number;
  reactors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StarboardMessageDocument extends IStarboardMessage, Document {}

const starboardMessageSchema = new Schema<StarboardMessageDocument>({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  authorId: { type: String, required: true },
  starboardMessageId: { type: String, default: null },
  starCount: { type: Number, default: 0, min: 0 },
  reactors: { type: [String], default: [] },
}, {
  timestamps: true,
});

starboardMessageSchema.index({ guildId: 1, messageId: 1 }, { unique: true });
starboardMessageSchema.index({ guildId: 1, starCount: -1 });
starboardMessageSchema.index({ guildId: 1, starboardMessageId: 1 });

export default model<StarboardMessageDocument>('StarboardMessage', starboardMessageSchema);
