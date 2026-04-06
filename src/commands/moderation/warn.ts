import { EmbedBuilder } from '@erinjs/core';
import type { Command } from '../../types';
import parseUserId from '../../utils/parseUserId';
import { canModerate, getMemberHighestRolePosition } from '../../utils/permissions';
import { logModAction } from '../../utils/logger';
import Warning from '../../models/Warning';
import ModerationLog from '../../models/ModerationLog';
import isNetworkError from '../../utils/isNetworkError';
import settingsCache from '../../utils/settingsCache';
import { t, normalizeLocale } from '../../i18n';

const command: Command = {
  name: 'warn',
  description: 'Issue a formal warning to a user \u2014 reason is stored and can be reviewed with !warnings or cleared with !clearwarns',
  usage: '<@user or user ID> <reason>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = (message as any).guild;
    if (!guild && (message as any).guildId) {
      guild = await client.guilds.fetch((message as any).guildId);
    }

    if (!guild) {
      return void await message.reply(t('en', 'commands.moderation.warn.serverOnly'));
    }

    const guildSettings: any = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void await message.reply(t(lang, 'commands.moderation.warn.usage', { prefix }));
    }

    if (!args[1]) {
      return void await message.reply(t(lang, 'commands.moderation.warn.missingReason'));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void await message.reply(t(lang, 'commands.moderation.warn.invalidUser'));
    }

    const reason = args.slice(1).join(' ').trim();

    let moderator: any = guild.members?.get((message as any).author.id);
    if (!moderator) {
      moderator = await guild.fetchMember((message as any).author.id);
    }

    let targetMember: any = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        targetMember = null;
      }
    }

    if (targetMember) {
      const modCheck = canModerate(moderator, targetMember);
      if (!modCheck.canModerate) {
        return void await message.reply(`${modCheck.reason}`);
      }
    }

    try {
      const warningRecord = await Warning.addWarning(guild.id, userId, (message as any).author.id, reason);
      const warningCount = warningRecord.warnings.length;

      let targetUser: any = targetMember?.user;
      if (!targetUser) {
        try {
          targetUser = await client.users.fetch(userId);
        } catch {
          targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
        }
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.warn.success', {
          username: displayName,
          userId: targetUser.id,
          reason,
          warningCount
        })
      );

      try {
        const moderation = guildSettings?.moderation ?? {};
        const autoMuteEnabled = moderation.autoMute === true;
        const muteMethod: 'auto' | 'timeout' | 'mute_role' = moderation.muteMethod || 'auto';
        const threshold = Number.isFinite(Number(moderation.autoMuteThreshold))
          ? Math.max(1, Number(moderation.autoMuteThreshold))
          : 3;

        if (autoMuteEnabled && warningCount >= threshold && targetMember) {
          const muteRoleId = moderation.muteRoleId || guildSettings?.muteRoleId || null;
          const alreadyTimedOut = targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date();
          const alreadyRoleMuted = muteRoleId && targetMember.roles?.roleIds?.includes?.(muteRoleId);

          if (!alreadyTimedOut && !alreadyRoleMuted) {
            const botUserId = client.user?.id;
            let botMember: any = null;
            if (botUserId) {
              try {
                await guild.fetchRoles?.();
                botMember = await guild.fetchMember(botUserId);
              } catch {}
              if (!botMember) botMember = guild.members?.get?.(botUserId) ?? guild.members?.me;
            }

            let muted = false;
            const tryRole = muteMethod === 'mute_role' || muteMethod === 'auto';
            const tryTimeout = muteMethod === 'timeout' || muteMethod === 'auto';

            if (tryRole && muteRoleId && botMember) {
              const muteRole = guild.roles?.get(muteRoleId) ?? (guild.roles as any)?.cache?.get?.(muteRoleId);
              if (muteRole) {
                const muteRolePos = typeof (muteRole as any).position === 'number' ? (muteRole as any).position : 0;
                const botHighest = getMemberHighestRolePosition(botMember, guild);
                if (botHighest >= 0 && muteRolePos < botHighest) {
                  await targetMember.addRole(muteRoleId);
                  muted = true;
                }
              }
            }

            if (!muted && tryTimeout) {
              const canBotModerate = botMember ? canModerate(botMember, targetMember).canModerate : true;
              if (canBotModerate) {
                const timeoutUntil = new Date(Date.now() + 10 * 60 * 1000);
                await targetMember.edit({
                  communication_disabled_until: timeoutUntil.toISOString(),
                  timeout_reason: `Auto-mute threshold reached (${warningCount}/${threshold})`,
                });
                muted = true;
              }
            }

            if (muted) {
              const autoMuteReason = t(lang, 'commands.moderation.warn.autoMuteReason', { warningCount, threshold });
              await message.reply(
                t(lang, 'commands.moderation.warn.autoMuteApplied', {
                  targetUserId: targetMember.id,
                  warningCount,
                  threshold
                })
              );
              await logModAction(guild, (message as any).author, targetUser, 'mute', autoMuteReason, { client });
              await ModerationLog.logAction({
                guildId: guild.id,
                targetId: targetMember.id,
                userId: (message as any).author.id,
                action: 'mute',
                reason: autoMuteReason,
                duration: 10 * 60 * 1000,
              });
            }
          }
        }
      } catch (autoMuteErr: any) {
        console.warn(`[${guild.name}] Auto-mute on warn failed: ${autoMuteErr?.message || autoMuteErr}`);
      }

      try {
        if (targetUser && targetUser.id) {
          const dmEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'commands.moderation.warn.dmTitle', { guildName: guild.name }))
            .setDescription(t(lang, 'commands.moderation.warn.dmDescription', { guildName: guild.name }))
            .addFields(
              { name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason },
              { name: t(lang, 'commands.moderation.warn.dmFieldTotalWarnings'), value: `${warningCount}` }
            )
            .setColor(0xf39c12);

          const dmChannel = await (client as any).users.createDM?.(targetUser.id);
          if (dmChannel) {
            await dmChannel.send({ embeds: [dmEmbed] });
          }
        }
      } catch (dmError: any) {
        console.log('Could not DM user about warning:', dmError.message);
      }

      await logModAction(guild, (message as any).author, targetUser, 'warn', reason, {
        fields: [
          { name: 'Total Warnings', value: `${warningCount}`, inline: true }
        ],
        client
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: (message as any).author.id,
        action: 'warn',
        reason,
        metadata: { caseNumber: warningCount } as any
      });

    } catch (error: any) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !warn (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !warn: ${error.message || error}`);
        message.reply(t(lang, 'commands.moderation.warn.errors.generic')).catch(() => {});
      }
    }
  }
};

export default command;
