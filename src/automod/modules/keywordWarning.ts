import Warning from '../../models/Warning';
import ModerationLog from '../../models/ModerationLog';
import { logModAction } from '../../utils/logger';
import { t, normalizeLocale } from '../../i18n';


function buildMatcher(entry: any): (content: string) => boolean {
  if (entry.isRegex) {
    try {
      const re = new RegExp(entry.pattern, 'i');
      return (content: string) => {
        if (content.length > 5000) return false;
        try { return re.test(content); } catch { return false; }
      };
    } catch {
      return () => false;
    }
  }
  const lower = entry.pattern.toLowerCase();
  return (content: string) => content.toLowerCase().includes(lower);
}

async function check(message: any, client: any, settings: any): Promise<boolean> {
  const kw = settings?.keywordWarnings;
  if (!kw?.enabled || !kw.keywords?.length) return false;

  const content = message.content;
  if (!content) return false;

  let matched: any = null;
  for (const entry of kw.keywords) {
    const matches = buildMatcher(entry);
    if (matches(content)) {
      matched = entry;
      break;
    }
  }

  if (!matched) return false;

  const action = kw.action || 'delete+warn';
  const guild  = message.guild || await client.guilds.fetch(message.guildId).catch(() => null);
  if (!guild) return false;

  const author = message.author;
  const label  = matched.label || matched.pattern;
  const reason = `Keyword filter: "${label}"`;

  if (action === 'delete' || action === 'delete+warn') {
    message.delete().catch(() => {});
  }

  if (action === 'warn' || action === 'delete+warn') {
    try {
      const warningRecord = await (Warning as any).addWarning(guild.id, author.id, client.user?.id || 'automod', reason);
      const warningCount  = warningRecord.warnings.length;

      await logModAction(guild, { id: 'automod', username: 'Automod' }, author, 'warn', reason, {
        fields: [
          { name: 'Trigger',        value: matched.isRegex ? `regex: \`${matched.pattern}\`` : `"${matched.pattern}"`, inline: true },
          { name: 'Total Warnings', value: `${warningCount}`, inline: true }
        ],
        client
      });

      await ModerationLog.logAction({
        guildId:  guild.id,
        targetId: author.id,
        userId:   'automod',
        action:   'warn',
        reason,
        metadata: { warningCount, keyword: matched.pattern } as any
      });

      author.send(
        t(normalizeLocale(settings?.language), 'auditCatalog.automod.modules.keywordWarning.l75_send', {
          'guild.name': guild.name,
          reason,
          warningCount
        })
      ).catch(() => {});

    } catch (err: any) {
      console.error(`[${guild.name}] Keyword warning failed: ${err.message || err}`);
    }
  } else if (action === 'delete') {
    await logModAction(guild, { id: 'automod', username: 'Automod' }, author, 'delete', reason, {
      fields: [
        { name: 'Trigger', value: matched.isRegex ? `regex: \`${matched.pattern}\`` : `"${matched.pattern}"`, inline: true }
      ],
      client
    }).catch(() => {});
  }

  return true;
}

export default { check };
