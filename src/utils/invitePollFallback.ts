import log from './consoleLogger';
import { Routes } from '@fluxerjs/types';

const inviteCodesByGuild = new Map<string, Set<string>>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
const permissionWarned = new Set<string>();

function parsePollMs(): number {
  const raw = process.env.INVITE_POLL_MS;
  if (raw === '0' || raw === 'false') return 0;
  const n = parseInt(raw ?? '60000', 10);
  return Number.isFinite(n) && n >= 5000 ? n : 60000;
}

export function startInvitePollFallback(
  client: any,
  shouldProcessGuild: (guildId: string) => boolean
): void {
  const ms = parsePollMs();
  if (ms <= 0) {
    log.info('Invites', 'Invite poll fallback disabled (INVITE_POLL_MS=0)');
    return;
  }

  async function pollPass(label: 'baseline' | 'delta'): Promise<void> {
    for (const guild of client.guilds?.values?.() ?? []) {
      const gid = guild?.id as string;
      if (!gid || !shouldProcessGuild(gid)) continue;

      try {
        const data = await client.rest.get(Routes.guildInvites(gid));
        const invites: any[] = Array.isArray(data) ? data : (data?.invites ?? []);
        const nextCodes = new Set(invites.map((i: any) => i.code).filter(Boolean));
        inviteCodesByGuild.set(gid, nextCodes);
      } catch (error: any) {
        if (!permissionWarned.has(gid)) {
          permissionWarned.add(gid);
          log.warn('Invites', `Poll skipped for guild ${gid}: ${error?.message || error}`);
        }
      }
    }
  }

  void (async () => {
    await pollPass('baseline');
    log.info('Invites', `Invite poll fallback active (every ${ms}ms)`);
    pollTimer = setInterval(() => {
      pollPass('delta').catch((e) => log.error('Invites', e?.message || e));
    }, ms);
  })();
}

export function stopInvitePollFallback(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  inviteCodesByGuild.clear();
}
