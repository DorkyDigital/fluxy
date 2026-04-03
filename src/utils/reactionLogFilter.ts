import { Routes } from '@fluxerjs/types';

const BOT_MESSAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const BOT_MESSAGE_CACHE_MAX_SIZE = 3000;

interface BotMessageCacheEntry {
  isBotAuthor: boolean;
  expiresAt: number;
}

const botMessageCache = new Map<string, BotMessageCacheEntry>();

function cacheKey(reaction: any): string | null {
  const channelId = String(reaction?.channelId ?? '');
  const messageId = String(reaction?.messageId ?? '');
  if (!channelId || !messageId) return null;
  return `${channelId}:${messageId}`;
}

function getCachedBotAuthorStatus(key: string, now: number): boolean | null {
  const entry = botMessageCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    botMessageCache.delete(key);
    return null;
  }
  return entry.isBotAuthor;
}

function setCachedBotAuthorStatus(key: string, isBotAuthor: boolean, now: number): void {
  if (botMessageCache.size >= BOT_MESSAGE_CACHE_MAX_SIZE) {
    botMessageCache.delete(botMessageCache.keys().next().value!);
  }

  botMessageCache.set(key, {
    isBotAuthor,
    expiresAt: now + BOT_MESSAGE_CACHE_TTL_MS,
  });
}

function readBotFlagFromReactionPayload(reaction: any): boolean | null {
  const inlineBot = reaction?.message?.author?.bot;
  if (typeof inlineBot === 'boolean') return inlineBot;

  return null;
}

function readAuthorIdFromReactionPayload(reaction: any): string | null {
  const inlineId = reaction?.message?.author?.id;
  if (inlineId) return String(inlineId);

  const fallbackId = reaction?.messageAuthorId ?? reaction?.message_author_id;
  if (fallbackId) return String(fallbackId);

  return null;
}

function lookupUserBotFlag(client: any, userId: string | null): boolean | null {
  if (!userId) return null;

  const user = client?.users?.get?.(userId);
  if (user && typeof user.bot === 'boolean') {
    return user.bot;
  }

  return null;
}

export async function isReactionOnBotMessage(client: any, reaction: any): Promise<boolean> {
  const key = cacheKey(reaction);
  const now = Date.now();

  if (key) {
    const cached = getCachedBotAuthorStatus(key, now);
    if (cached !== null) return cached;
  }

  const payloadBotFlag = readBotFlagFromReactionPayload(reaction);
  if (payloadBotFlag !== null) {
    if (key) setCachedBotAuthorStatus(key, payloadBotFlag, now);
    return payloadBotFlag;
  }

  const payloadAuthorId = readAuthorIdFromReactionPayload(reaction);
  const userCacheBotFlag = lookupUserBotFlag(client, payloadAuthorId);
  if (userCacheBotFlag !== null) {
    if (key) setCachedBotAuthorStatus(key, userCacheBotFlag, now);
    return userCacheBotFlag;
  }

  if (!reaction?.channelId || !reaction?.messageId) return false;

  try {
    const msg = await client?.rest?.get?.(Routes.channelMessage(reaction.channelId, reaction.messageId));
    const isBot = Boolean(msg?.author?.bot);
    if (key) setCachedBotAuthorStatus(key, isBot, now);
    return isBot;
  } catch {
    return false;
  }
}

export function clearReactionLogFilterCache(): void {
  botMessageCache.clear();
}
