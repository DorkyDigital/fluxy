import type { BotEvent } from '../types';
import settingsCache from '../utils/settingsCache';
import isNetworkError from '../utils/isNetworkError';
import * as autoroleQueue from '../utils/autoroleQueue';
import { logServerEvent } from '../utils/logger';
import * as memberCounter from '../utils/memberCounter';
import { generateWelcomeCard } from '../utils/welcomeCard';
import { retrySend } from '../utils/retrySend';
import { EmbedBuilder } from '@erinjs/core';
import GlobalBan from '../models/GlobalBan';
import GlobalBanPrompt from '../models/GlobalBanPrompt';
import { recordJoin, sendRaidAlert, isRaidActive } from '../utils/raidDetector';
import { scoreMember, checkAndAlert } from '../utils/suspiciousDetector';
import { t } from '../i18n';

const welcomeFailCooldowns = new Map<string, number>();
const WELCOME_FAIL_COOLDOWN = 5 * 60 * 1000;

async function handleGlobalBan(member: any, guild: any, client: any, ban: any): Promise<boolean> {
  try {
    try {
      const user = member.user || member;
      await user.send({
        embeds: [new EmbedBuilder()
          .setTitle(t('en', 'auditCatalog.events.guildMemberAdd.l24_setTitle'))
          .setDescription(
            `You have been banned from **${guild.name}** because your account is on the Fluxy global ban list.\n\n` +
            `**Reason:** ${ban.reason}` +
            (ban.evidence ? `\n**Evidence:** ${ban.evidence}` : '')
          )
          .setColor(0xe74c3c)
          .setFooter({ text: t('en', 'auditCatalog.events.guildMemberAdd.l31_setFooter') })
          .setTimestamp(new Date())
          .toJSON()]
      });
    } catch { }

    await guild.ban(member.id || member.user?.id, {
      reason: `[Fluxy Global Ban] ${ban.reason}`,
    });

    await logServerEvent(
      guild,
      t('en', 'auditCatalog.events.guildMemberAdd.l65_setTitle'),
      0xe74c3c,
      [
        { name: 'User', value: `<@${member.id}> (\`${member.id}\`)`, inline: true },
        { name: 'Reason', value: ban.reason, inline: false },
        ...(ban.evidence ? [{ name: 'Evidence', value: ban.evidence, inline: false }] : []),
      ],
      client,
      {
        description: 'This user was automatically banned because they are on the Fluxy global ban list.',
        footer: `Banned by Fluxy Global Protection • Disable with the globalban toggle command`,
        eventType: 'global_ban',
      }
    ).catch(() => { });

    const ownerId = guild.ownerId || (guild as any).owner_id;
    if (ownerId) {
      try {
        const owner = client.users.get(ownerId) || await client.users.fetch(ownerId).catch(() => null);
        if (owner) {
          await owner.send({
            embeds: [new EmbedBuilder()
              .setTitle(t('en', 'auditCatalog.events.guildMemberAdd.l65_setTitle'))
              .setDescription(
                `A user was automatically banned from **${guild.name}** because they are on the Fluxy global ban list.\n\n` +
                `**User:** <@${member.id}> (\`${member.id}\`)\n` +
                `**Reason:** ${ban.reason}` +
                (ban.evidence ? `\n**Evidence:** ${ban.evidence}` : '') +
                `\n\nYou can disable this with \`globalban off\` in your server.`
              )
              .setColor(0xe74c3c)
              .setTimestamp(new Date())
              .toJSON()]
          });
        }
      } catch { }
    }

    return true;
  } catch (err: any) {
    console.error(`[globalban] Failed to enforce ban for ${member.id} in ${guild.name}: ${err.message}`);
    return false;
  }
}

const event: BotEvent = {
  name: 'guildMemberAdd',

  async execute(member: any, client: any) {
    try {
      const guild = member.guild;
      if (!guild) return;

      const settings: any = await settingsCache.get(guild.id);

      const userId = member.id || member.user?.id;
      if (userId) {
        const raid = recordJoin(guild.id, userId, settings);
        if (raid?.detected) {
          sendRaidAlert(client, guild, raid.joinCount, raid.userIds).catch(() => { });
        }
      }

      const suspect = scoreMember(member);
      if (suspect.score >= 50) {
        checkAndAlert(client, guild, member, suspect.score, suspect.reasons, suspect.accountAgeDays);
      }

      if (!settings) return;

      if (settings.globalBanEnabled === true) {
        try {
          const userId = member.id || member.user?.id;
          const ban = await GlobalBan.isGlobalBanned(userId);
          if (ban) {
            const declined = await GlobalBanPrompt.guildDeclinedBan(guild.id, userId);
            if (!declined) {
              const handled = await handleGlobalBan(member, guild, client, ban);
              if (handled) return;
            }
          }
        } catch (err: any) {
          console.error(`[globalban] Check failed for ${member.id}: ${err.message}`);
        }
      }

      if (settings.autoroleId) {
        if (settings.raidDisableAutorole && isRaidActive(guild.id)) {
          console.log(`[autorole] Skipping autorole for ${member.id} in ${guild.name} - raid detected`);
        } else {
          const botMember = guild.members?.me;
          const targetRole = guild.roles?.get(settings.autoroleId);
          const botHighest = botMember
            ? Math.max(0, ...(botMember.roles?.roleIds ?? []).map((id: string) => guild.roles?.get(id)?.position || 0))
            : Infinity;

          if (targetRole && targetRole.position >= botHighest) {
            console.warn(`[autorole] Skipping ${guild.name}: bot role is below ${targetRole.name}`);
          } else {
            try {
              await member.addRole(settings.autoroleId);
            } catch (err: any) {
              if (isNetworkError(err)) {
                autoroleQueue.enqueue(guild.id, member.id, settings.autoroleId);
              } else {
                console.error(`[autorole] Failed to assign role ${settings.autoroleId} to ${member.id} in ${guild.name}: ${err.message}`);
              }
            }
          }
        }
      }

      const user = member.user;
      const createdEpoch = user?.id
        ? Math.floor((parseInt(user.id) / 4194304 + 1420070400000) / 1000)
        : null;

      if (memberCounter.get(guild.id) === null) {
        await memberCounter.fetchAndSetMemberCount(guild.id, client);
      }
      const memberCount = memberCounter.increment(guild.id);

      const joinFields: any[] = [];
      if (createdEpoch) {
        joinFields.push({ name: 'Account Age', value: `<t:${createdEpoch}:R>`, inline: true });
      }
      if (memberCount) {
        joinFields.push({ name: 'Members', value: memberCount.toLocaleString(), inline: true });
      }

      await logServerEvent(
        guild,
        'Member Joined',
        0x2ecc71,
        joinFields,
        client,
        {
          description: `<@${member.id}> joined the server`,
          footer: `User ID: ${member.id}`,
          eventType: 'member_join',
        }
      ).catch(() => { });

      const wm = settings.welcomeMessage;
      if (!wm?.enabled || !wm.channelId) return;

      if (wm.trigger === 'role') return;

      const lastFail = welcomeFailCooldowns.get(guild.id);
      if (lastFail && Date.now() - lastFail < WELCOME_FAIL_COOLDOWN) return;

      let welcomeChannel: any;
      try {
        const channelsMap = guild.channels?.cache || guild.channels;
        welcomeChannel = channelsMap?.get(wm.channelId)
          ?? await client.channels.fetch(wm.channelId).catch(() => null);
      } catch {
        welcomeChannel = null;
      }
      if (!welcomeChannel) return;

      if (welcomeChannel.sendable === false) {
        welcomeFailCooldowns.set(guild.id, Date.now());
        return;
      }

      let roleName: string | null = null;
      if (wm.showRole && settings.autoroleId) {
        const role = guild.roles?.get?.(settings.autoroleId);
        roleName = role?.name || null;
      }

      const avatarURL = user.displayAvatarURL?.({ size: 256, format: 'png' })
        ?? user.avatarURL
        ?? '/assets/default-avatar.png';

      const sendOpts: any = {};
      let cardBuffer: Buffer | null = null;

      if (wm.imageEnabled !== false) {
        try {
          cardBuffer = await generateWelcomeCard({
            username: member.displayName || user.username || 'New Member',
            avatarURL,
            serverName: guild.name,
            memberCount: memberCount || 0,
            card: wm.card || {},
            roleName,
          });
          sendOpts.files = [{ name: 'welcome.png', data: cardBuffer }];
        } catch (err: any) {
          console.error(`[welcome] Card generation failed for ${user.id} in ${guild.name}: ${err.message}`);
        }
      }

      const replaceVars = (text: string) => text
        .replace(/\\n/g, '\n')
        .replace(/\{user\}/gi, `<@${member.id}>`)
        .replace(/\{server\}/gi, guild.name)
        .replace(/\{count\}/gi, String(memberCount || 0))
        .replace(/\{role\}/gi, roleName || 'None');

      if (wm.message) {
        sendOpts.content = replaceVars(wm.message);
      } else {
        sendOpts.content = `Welcome to **${guild.name}**, <@${member.id}>!`;
      }

      if (wm.embed?.enabled) {
        const embConf = wm.embed;
        const embed = new EmbedBuilder();
        if (embConf.title) embed.setTitle(replaceVars(embConf.title));
        if (embConf.description) embed.setDescription(replaceVars(embConf.description));
        if (embConf.color) embed.setColor(parseInt(embConf.color.replace('#', ''), 16));
        if (embConf.footer) embed.setFooter({ text: replaceVars(embConf.footer) });
        if (embConf.thumbnail) {
          const iconURL = guild.iconURL?.({ size: 256 }) || null;
          if (iconURL) embed.setThumbnail(iconURL);
        }
        embed.setTimestamp(new Date());
        sendOpts.embeds = [embed];
      }

      if (sendOpts.content || sendOpts.files || sendOpts.embeds) {
        try {
          await retrySend(welcomeChannel, sendOpts, 'welcome');
          welcomeFailCooldowns.delete(guild.id);
        } catch (err: any) {
          welcomeFailCooldowns.set(guild.id, Date.now());
          console.error(`[welcome] Failed to send welcome in ${guild.name}: ${err.message} (suppressing for 5m)`);
        }
      }

      if (wm.dm?.enabled) {
        try {
          const dmOpts: any = {};

          if (wm.dm.message) {
            dmOpts.content = replaceVars(wm.dm.message);
          } else if (wm.message) {
            dmOpts.content = replaceVars(wm.message);
          } else {
            dmOpts.content = `Welcome to **${guild.name}**!`;
          }

          if (wm.dm.imageEnabled && cardBuffer) {
            dmOpts.files = [{ name: 'welcome.png', data: cardBuffer }];
          }

          await member.user.send(dmOpts).catch(() => { });
        } catch (err: any) {
          console.error(`[welcome] Failed to send DM to ${member.id}: ${err.message}`);
        }
      }

    } catch (error) {
      console.error('Error in guildMemberAdd event:', error);
    }
  }
};

export default event;
