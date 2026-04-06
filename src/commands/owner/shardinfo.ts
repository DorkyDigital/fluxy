import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import { t } from '../../i18n';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const command: Command = {
  name: 'shardinfo',
  description: 'Shows shard information (owner only)',
  category: 'owner',
  ownerOnly: true,

  async execute(message, _args, client) {
    try {

      const totalShardsEnv = process.env.TOTAL_SHARDS;
      const isSharded = totalShardsEnv !== undefined && process.env.SHARD_IDS !== undefined;
      const totalShards = isSharded ? parseInt(totalShardsEnv!, 10) : 1;

      const thisGuildId = (message as any).guild?.id ?? (message as any).guildId;
      let relevantShardIds: number[] = [];
      if (thisGuildId) {
        try { relevantShardIds = [Number(BigInt(thisGuildId) % BigInt(totalShards))]; } catch {}
      } else if (isSharded) {
        relevantShardIds = (process.env.SHARD_IDS?.split(',').map(Number).filter((n) => !isNaN(n)) ?? []);
      }

      let allShards: any[] = [];
      if (typeof (client as any).fetchAllShardInfo === 'function') {
        try { allShards = await (client as any).fetchAllShardInfo(); } catch {}
      }
      if (!allShards.length) {
        allShards = [{
          workerId: 0,
          shardIds: [0],
          status: 'online',
          guilds: (client as any).guilds.size,
          memory: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
          uptime: Math.floor(process.uptime()),
        }];
      }

      let totalGuilds = 0;
      let totalMemory = 0;
      for (const s of allShards) {
        totalGuilds += s.guilds || 0;
        totalMemory += s.memory || 0;
      }

      const lines: string[] = [];
      for (const s of allShards) {
        const ids = (s.shardIds ?? []).join(', ');
        const marker = (s.shardIds ?? []).some((id: number) => relevantShardIds.includes(id)) ? ' **\u2190**' : '';
        lines.push(
          `Shard ${ids} \u2014 ${s.guilds ?? 0} guilds \u2022 ${s.memory ?? '?'} MB \u2022 ${formatUptime(s.uptime ?? 0)}${marker}`
        );
      }

      const embed = new EmbedBuilder()
        .setTitle(t('en', 'auditCatalog.commands.owner.shardinfo.l66_setTitle'))
        .setDescription(
          `${totalShards} shards \u2022 ${totalGuilds} guilds \u2022 ${totalMemory.toFixed(1)} MB\n\n` +
          lines.join('\n')
        )
        .setColor(0x5865F2);

      await message.reply({ embeds: [embed] });
    } catch (err: any) {
      console.error('[SHARDINFO] error:', err);
      try { await message.reply(t('en', 'auditCatalog.commands.owner.shardinfo.l76_reply')); } catch {}
    }
  },
};

export default command;
