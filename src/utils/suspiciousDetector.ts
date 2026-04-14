import { EmbedBuilder } from '@erinjs/core';
import config from '../config';
import { t } from '../i18n';

const BATCH_SIZE = 3;
const BATCH_WINDOW_MS = 60_000;

const SINGLE_ALERT_COOLDOWN_MS = 2 * 60_000;
const USER_DEDUP_MS = 10 * 60_000;

const DAY_MS = 86_400_000;
const FLUXER_EPOCH = 1_420_070_400_000;

const FIRSTNAME_LASTNAME_RE = /^[A-Z][a-z]+[_ ][A-Z][a-z]+$/;

interface SuspectEntry {
  userId: string;
  username: string;
  score: number;
  reasons: string[];
  accountAgeDays: number | null;
  timestamp: number;
}

const suspectBuffers = new Map<string, SuspectEntry[]>();
const lastSingleAlert = new Map<string, number>();
const recentlyAlerted = new Map<string, number>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scoreMember(member: any): { score: number; reasons: string[]; accountAgeDays: number | null } {
  const user = member.user || member;
  const username: string = user.username || user.global_name || '';
  let score = 0;
  const reasons: string[] = [];

  if (FIRSTNAME_LASTNAME_RE.test(username)) {
    score += 40;
    reasons.push('Name matches Firstname_Lastname pattern (+40)');
  }

  const accountAgeDays = getAccountAgeDays(user.id);
  if (accountAgeDays !== null) {
    if (accountAgeDays < 1) {
      score += 30;
      reasons.push(`Account < 24 hours old (+30)`);
    } else if (accountAgeDays < 3) {
      score += 25;
      reasons.push(`Account < 3 days old (+25)`);
    } else if (accountAgeDays < 7) {
      score += 15;
      reasons.push(`Account < 7 days old (+15)`);
    } else if (accountAgeDays < 30) {
      score += 5;
      reasons.push(`Account < 30 days old (+5)`);
    }
  }

  if (!user.avatar) {
    score += 15;
    reasons.push('No custom avatar (+15)');
  }

  const displayName: string = user.global_name || user.displayName || '';
  if (displayName && displayName !== username && FIRSTNAME_LASTNAME_RE.test(displayName)) {
    score += 10;
    reasons.push('Display name also matches Firstname Lastname (+10)');
  }

  return { score, reasons, accountAgeDays };
}

export function checkAndAlert(
  client: any,
  guild: any,
  member: any,
  score: number,
  reasons: string[],
  accountAgeDays: number | null,
): void {
  const user = member.user || member;
  const userId: string = user.id || member.id;
  const username: string = user.username || user.global_name || userId;
  const now = Date.now();

  const lastAlerted = recentlyAlerted.get(userId);
  if (lastAlerted && now - lastAlerted < USER_DEDUP_MS) return;

  const guildId: string = guild.id;

  let buffer = suspectBuffers.get(guildId);
  if (!buffer) {
    buffer = [];
    suspectBuffers.set(guildId, buffer);
  }

  const cutoff = now - BATCH_WINDOW_MS;
  while (buffer.length > 0 && buffer[0].timestamp < cutoff) {
    buffer.shift();
  }

  const entry: SuspectEntry = { userId, username, score, reasons, accountAgeDays, timestamp: now };
  buffer.push(entry);
  recentlyAlerted.set(userId, now);

  if (buffer.length >= BATCH_SIZE) {
    for (const e of buffer) {
      if (!e.reasons.some((r) => r.includes('Burst'))) {
        e.score += 10;
        e.reasons.push(`Burst: ${buffer.length} suspects in 60s (+10)`);
      }
    }
    clearFlushTimer(guildId);
    const batch = [...buffer];
    buffer.length = 0;
    sendSuspectAlert(client, guild, batch).catch(() => {});
    return;
  }

  if (!flushTimers.has(guildId)) {
    const timer = setTimeout(() => {
      flushTimers.delete(guildId);
      const buf = suspectBuffers.get(guildId);
      if (!buf || buf.length === 0) return;

      const lastSingle = lastSingleAlert.get(guildId);
      if (lastSingle && now - lastSingle < SINGLE_ALERT_COOLDOWN_MS) {
        return;
      }
      lastSingleAlert.set(guildId, Date.now());

      const toSend = [...buf];
      buf.length = 0;
      sendSuspectAlert(client, guild, toSend).catch(() => {});
    }, 10_000);
    flushTimers.set(guildId, timer);
  }
}

async function sendSuspectAlert(client: any, guild: any, suspects: SuspectEntry[]): Promise<void> {
  if (suspects.length === 0) return;

  const lines = suspects.map((s) => {
    const age =
      s.accountAgeDays !== null ? (s.accountAgeDays < 1 ? `< 1 day` : `${Math.floor(s.accountAgeDays)}d`) : '?';
    return `\`${s.userId}\` **${s.username}** - score ${s.score}, age ${age}\n> ${s.reasons.join(', ')}`;
  });

  const idList = suspects.map((s) => s.userId).join(',');

  const ownerEmbed = new EmbedBuilder()
    .setTitle(
      t('en', 'auditCatalog.utils.suspiciousDetector.l153_setTitle', {
        "suspects.length > 1 ? 's' : ''": suspects.length > 1 ? 's' : '',
        'guild.name': guild.name,
      }),
    )
    .setDescription(
      `**${suspects.length}** suspicious account${suspects.length > 1 ? 's' : ''} joined **${guild.name}** (\`${guild.id}\`)\n\n` +
        lines.join('\n\n'),
    )
    .addFields({
      name: t('en', 'auditCatalog.utils.suspiciousDetector.l159_addFields_name'),
      value: t('en', 'auditCatalog.utils.suspiciousDetector.l160_addFields_value', {
        idList: idList.length > 900 ? idList.slice(0, 900) + '...' : idList,
      }),
      inline: false,
    })
    .setColor(0xffa500)
    .setTimestamp(new Date());

  if (config.ownerId) {
    try {
      const dm = await client.users.createDM?.(config.ownerId);
      if (dm) await dm.send({ embeds: [ownerEmbed] });
    } catch {}
  }

  const guildOwnerId = guild.ownerId || (guild as any).owner_id;
  if (guildOwnerId && guildOwnerId !== config.ownerId) {
    try {
      const guildOwnerEmbed = new EmbedBuilder()
        .setTitle(t('en', 'auditCatalog.utils.suspiciousDetector.l177_setTitle', { 'guild.name': guild.name }))
        .setDescription(
          `**${suspects.length}** suspicious account${suspects.length > 1 ? 's' : ''} joined your server.\n` +
            `These accounts match patterns commonly seen in bot raids (generated names, new accounts, no avatars).\n\n` +
            suspects
              .map(
                (s) =>
                  `**${s.username}** (\`${s.userId}\`) - age ${s.accountAgeDays !== null ? (s.accountAgeDays < 1 ? '< 1 day' : `${Math.floor(s.accountAgeDays)}d`) : '?'}`,
              )
              .join('\n'),
        )
        .setColor(0xffa500)
        .setFooter({ text: t('en', 'auditCatalog.utils.suspiciousDetector.l184_setFooter') })
        .setTimestamp(new Date());

      const dm = await client.users.createDM?.(guildOwnerId);
      if (dm) await dm.send({ embeds: [guildOwnerEmbed] });
    } catch {}
  }

  console.warn(
    `[suspect-detect] ALERT: ${suspects.length} suspect(s) in ${guild.name} (${guild.id}): ` +
      suspects.map((s) => `${s.username}(${s.userId})`).join(', '),
  );
}

function getAccountAgeDays(userId: string | undefined): number | null {
  if (!userId) return null;
  try {
    const createdMs = Number(BigInt(userId) >> 22n) + FLUXER_EPOCH;
    return (Date.now() - createdMs) / DAY_MS;
  } catch {
    return null;
  }
}

function clearFlushTimer(guildId: string): void {
  const t = flushTimers.get(guildId);
  if (t) {
    clearTimeout(t);
    flushTimers.delete(guildId);
  }
}

setInterval(() => {
  const cutoff = Date.now() - USER_DEDUP_MS;
  for (const [id, ts] of recentlyAlerted) {
    if (ts < cutoff) recentlyAlerted.delete(id);
  }
}, 30 * 60_000);
